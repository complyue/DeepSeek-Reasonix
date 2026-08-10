package cli

import (
	"os"
	"strings"
	"testing"

	"reasonix/internal/config"
)

func TestConfigCompactRatioLowThresholdAfterSnip(t *testing.T) {
	isolateCLIConfigHome(t)

	// The compact threshold must stay above snip; lower snip first, then the
	// low compact target is reachable — the CLI ordering the slider hides.
	out := captureStdout(t, func() {
		if rc := Run([]string{"config", "snip-ratio", "15"}, "test-version"); rc != 0 {
			t.Fatalf("config snip-ratio 15 rc = %d, want 0", rc)
		}
	})
	if !strings.Contains(out, "tool_result_snip_ratio = 15%") {
		t.Fatalf("config snip-ratio output = %q", out)
	}
	out = captureStdout(t, func() {
		if rc := Run([]string{"config", "compact-ratio", "20"}, "test-version"); rc != 0 {
			t.Fatalf("config compact-ratio 20 rc = %d, want 0", rc)
		}
	})
	if !strings.Contains(out, "compact_ratio = 20%") {
		t.Fatalf("config compact-ratio output = %q", out)
	}
	cfg := config.LoadForEdit(config.UserConfigPath())
	if cfg.Agent.ToolResultSnipRatio != 0.15 || cfg.Agent.CompactRatio != 0.2 {
		t.Fatalf("thresholds = snip %v compact %v, want 0.15/0.2", cfg.Agent.ToolResultSnipRatio, cfg.Agent.CompactRatio)
	}
}

func TestConfigSnipRatioCommandWritesUserConfigAndReportsSource(t *testing.T) {
	isolateCLIConfigHome(t)

	out := captureStdout(t, func() {
		if rc := Run([]string{"config", "snip-ratio", "15"}, "test-version"); rc != 0 {
			t.Fatalf("config snip-ratio rc = %d, want 0", rc)
		}
	})
	if !strings.Contains(out, "tool_result_snip_ratio = 15%") || !strings.Contains(out, "user:") {
		t.Fatalf("config snip-ratio output = %q", out)
	}
	cfg := config.LoadForEdit(config.UserConfigPath())
	if got := cfg.Agent.ToolResultSnipRatio; got != 0.15 {
		t.Fatalf("saved snip ratio = %v, want 0.15", got)
	}
	if got := cfg.Agent.CompactRatio; got != 0.8 {
		t.Fatalf("snip-ratio update changed compact ratio to %v, want 0.8", got)
	}

	out = captureStdout(t, func() {
		if rc := Run([]string{"config", "snip-ratio"}, "test-version"); rc != 0 {
			t.Fatalf("config snip-ratio query rc = %d, want 0", rc)
		}
	})
	if !strings.Contains(out, "tool_result_snip_ratio = 15%") || !strings.Contains(out, "user:") {
		t.Fatalf("config snip-ratio query output = %q", out)
	}
}

func TestConfigSnipRatioRejectsValuesOutsideEditableRange(t *testing.T) {
	isolateCLIConfigHome(t)

	for _, value := range []string{"4", "96", "NaN", "+Inf", "not-a-number"} {
		t.Run(value, func(t *testing.T) {
			errOut := captureStderr(t, func() {
				if rc := Run([]string{"config", "snip-ratio", value}, "test-version"); rc != 2 {
					t.Fatalf("config snip-ratio %s rc = %d, want 2", value, rc)
				}
			})
			if !strings.Contains(errOut, "percentage between 5 and 95") {
				t.Fatalf("config snip-ratio %s stderr = %q", value, errOut)
			}
		})
	}
	if _, err := os.Stat(config.UserConfigPath()); !os.IsNotExist(err) {
		t.Fatalf("invalid snip ratio wrote user config, stat err=%v", err)
	}
}
