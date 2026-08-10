package main

import (
	"testing"

	"reasonix/internal/config"
)

func TestSetCompactionThresholdsPersistsAtomically(t *testing.T) {
	isolateDesktopUserDirs(t)

	app := NewApp()
	defaultView := app.Settings()
	if defaultView.Agent.SoftRatio != 0.5 || defaultView.Agent.SnipRatio != 0.6 || defaultView.Agent.ForceRatio != 0.9 {
		t.Fatalf("default threshold view = %v/%v/%v, want 0.5/0.6/0.9", defaultView.Agent.SoftRatio, defaultView.Agent.SnipRatio, defaultView.Agent.ForceRatio)
	}
	if err := app.SetCompactionThresholds(0.12, 0.15, 0.2, 0.25); err != nil {
		t.Fatalf("SetCompactionThresholds: %v", err)
	}

	view := app.Settings()
	if view.Agent.SoftRatio != 0.12 || view.Agent.SnipRatio != 0.15 || view.Agent.CompactRatio != 0.2 || view.Agent.ForceRatio != 0.25 {
		t.Fatalf("threshold view = %v/%v/%v/%v, want 0.12/0.15/0.2/0.25", view.Agent.SoftRatio, view.Agent.SnipRatio, view.Agent.CompactRatio, view.Agent.ForceRatio)
	}

	cfg := config.LoadForEdit(config.UserConfigPath())
	if cfg.Agent.SoftCompactRatio != 0.12 || cfg.Agent.ToolResultSnipRatio != 0.15 || cfg.Agent.CompactRatio != 0.2 || cfg.Agent.CompactForceRatio != 0.25 {
		t.Fatalf("saved thresholds = %v/%v/%v/%v, want 0.12/0.15/0.2/0.25", cfg.Agent.SoftCompactRatio, cfg.Agent.ToolResultSnipRatio, cfg.Agent.CompactRatio, cfg.Agent.CompactForceRatio)
	}

	if err := app.SetCompactionThresholds(0.2, 0.15, 0.25, 0.3); err == nil {
		t.Fatal("SetCompactionThresholds should reject a broken soft < snip chain")
	}
	cfg = config.LoadForEdit(config.UserConfigPath())
	if cfg.Agent.SoftCompactRatio != 0.12 || cfg.Agent.ToolResultSnipRatio != 0.15 || cfg.Agent.CompactRatio != 0.2 || cfg.Agent.CompactForceRatio != 0.25 {
		t.Fatalf("rejected batch changed saved thresholds to %v/%v/%v/%v", cfg.Agent.SoftCompactRatio, cfg.Agent.ToolResultSnipRatio, cfg.Agent.CompactRatio, cfg.Agent.CompactForceRatio)
	}
}
