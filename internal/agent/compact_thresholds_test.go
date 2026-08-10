package agent

import (
	"context"
	"strings"
	"testing"

	"reasonix/internal/ablation"
	"reasonix/internal/event"
	"reasonix/internal/provider"
	"reasonix/internal/tool"
)

func TestCompactThresholds(t *testing.T) {
	a := &Agent{contextWindow: 1_000_000, softCompactRatio: 0.5, toolResultSnipRatio: 0.6, compactRatio: 0.8, compactForceRatio: 0.9}
	soft, snip, high := a.compactThresholds()
	if soft != 500_000 || snip != 600_000 || high != 800_000 {
		t.Fatalf("default thresholds = %d/%d/%d, want 500000/600000/800000", soft, snip, high)
	}
	if !(soft < snip && snip < high) {
		t.Fatalf("threshold chain broken: %d/%d/%d", soft, snip, high)
	}
}

func TestCompactThresholdsSoftClampedBelowSnip(t *testing.T) {
	a := &Agent{contextWindow: 1_000_000, softCompactRatio: 0.5, toolResultSnipRatio: 0.15, compactRatio: 0.2, compactForceRatio: 0.25}
	soft, snip, high := a.compactThresholds()
	if snip != 150_000 || high != 200_000 {
		t.Fatalf("snip/high = %d/%d, want 150000/200000", snip, high)
	}
	if soft >= snip {
		t.Fatalf("soft %d not clamped below snip %d", soft, snip)
	}
	if soft != 125_000 {
		t.Fatalf("clamped soft = %d, want 125000 (snip*5/6)", soft)
	}
}

func TestCompactThresholdsAblationCollapsesToSoft(t *testing.T) {
	off := &Agent{contextWindow: 100_000, softCompactRatio: 0.5, toolResultSnipRatio: 0.15, compactRatio: 0.2, compactForceRatio: 0.25,
		ablation: ablation.New(ablation.Compaction),
	}
	soft, snip, high := off.compactThresholds()
	if soft != snip || snip != high {
		t.Fatalf("ablation should collapse thresholds: %d/%d/%d", soft, snip, high)
	}
}

func TestCompactResumeOverNewLowThresholdPrunesOnly(t *testing.T) {
	// Resuming a session under a newly lowered compact threshold (0.2 on a 1M
	// window, i.e. 200K): when eliding stale tool results alone clears the
	// trigger, the first pass must prune without paying for a summarize call.
	big := strings.Repeat("tool output ", 4000) // ~52K chars -> ~13K tokens each
	sess := &Session{Messages: []provider.Message{
		{Role: provider.RoleSystem, Content: "sys"},
		{Role: provider.RoleUser, Content: "task"},
		{Role: provider.RoleAssistant, Content: big},
		{Role: provider.RoleTool, ToolCallID: "1", Name: "read_file", Content: big},
		{Role: provider.RoleUser, Content: "keep going"},
		{Role: provider.RoleAssistant, Content: "done"},
	}}
	a := New(&fakeProvider{reply: "digest"}, tool.NewRegistry(), sess,
		Options{ContextWindow: 1_000_000, SoftCompactRatio: 0.12, ToolResultSnipRatio: 0.15, CompactRatio: 0.2, CompactForceRatio: 0.25, RecentKeep: 2, ArchiveDir: t.TempDir()}, event.Discard)

	// 210K is just over the new 200K compact point; the two ~13K-token tool
	// results (~26K saved) pull the prompt back under the trigger.
	a.maybeCompact(context.Background(), &provider.Usage{PromptTokens: 210_000})

	var snipped, summarized bool
	for _, m := range sess.Snapshot() {
		if m.Role == provider.RoleTool && (strings.HasPrefix(m.Content, prunedMarker) || strings.HasPrefix(m.Content, snippedMarker)) {
			snipped = true
		}
		if isCompactionSummary(m) {
			summarized = true
		}
	}
	if !snipped {
		t.Fatalf("stale tool results not pruned on over-threshold resume: %+v", sess.Snapshot())
	}
	if summarized {
		t.Fatalf("prune-only pass still paid for a summarize call")
	}
}

func TestCompactResumeOverNewLowThresholdFolds(t *testing.T) {
	// Pruning alone cannot clear the trigger, so the first pass folds; a later
	// healthy turn clears the stuck latch. The session must stay bigger than
	// the 16K-token verbatim tail after pruning, or nothing is foldable.
	big := strings.Repeat("work output ", 8000) // ~104K chars -> ~26K tokens each
	sess := &Session{Messages: []provider.Message{
		{Role: provider.RoleSystem, Content: "sys"},
		{Role: provider.RoleUser, Content: "task"},
		{Role: provider.RoleAssistant, Content: big},
		{Role: provider.RoleTool, ToolCallID: "1", Name: "read_file", Content: big},
		{Role: provider.RoleUser, Content: "keep going"},
		{Role: provider.RoleAssistant, Content: big},
		{Role: provider.RoleTool, ToolCallID: "2", Name: "read_file", Content: big},
		{Role: provider.RoleUser, Content: "last one"},
		{Role: provider.RoleAssistant, Content: big},
	}}
	a := New(&fakeProvider{reply: "digest"}, tool.NewRegistry(), sess,
		Options{ContextWindow: 1_000_000, SoftCompactRatio: 0.12, ToolResultSnipRatio: 0.15, CompactRatio: 0.2, CompactForceRatio: 0.25, RecentKeep: 2, ArchiveDir: t.TempDir()}, event.Discard)

	a.maybeCompact(context.Background(), &provider.Usage{PromptTokens: 500_000})

	var summarized bool
	for _, m := range sess.Snapshot() {
		if isCompactionSummary(m) {
			summarized = true
		}
	}
	if !summarized {
		t.Fatalf("over-threshold resume did not summarize: %+v", sess.Snapshot())
	}

	// A turn back under the trigger is the healthy outcome compaction buys.
	a.maybeCompact(context.Background(), &provider.Usage{PromptTokens: 30_000})
	if a.compactStuck {
		t.Fatalf("healthy pass must clear the stuck latch")
	}
}
