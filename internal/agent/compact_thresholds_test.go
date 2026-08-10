package agent

import (
	"testing"

	"reasonix/internal/ablation"
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


func TestCompactThresholdsAblationCollapsesToSoft(t *testing.T) {
	off := &Agent{contextWindow: 100_000, softCompactRatio: 0.5, toolResultSnipRatio: 0.15, compactRatio: 0.2, compactForceRatio: 0.25,
		ablation: ablation.New(ablation.Compaction),
	}
	soft, snip, high := off.compactThresholds()
	if soft != snip || snip != high {
		t.Fatalf("ablation should collapse thresholds: %d/%d/%d", soft, snip, high)
	}
}


