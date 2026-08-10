package main

import "reasonix/internal/config"

// SetColdResumePrune toggles auto-elision of stale tool results on cold resume.
func (a *App) SetColdResumePrune(enabled bool) error {
	return a.applyConfigChange(func(c *config.Config) error { return c.SetColdResumePrune(enabled) })
}

// SetCompactRatio updates the auto-compaction threshold via the shared config
// setter, with the active-work guard and user-config persistence.
func (a *App) SetCompactRatio(ratio float64) error {
	_, err := a.applyConfigChangeWithWarning("context compaction threshold", func(c *config.Config) error {
		return c.SetCompactRatio(ratio)
	})
	return err
}

// SetCompactionThresholds persists all four compaction thresholds atomically.
// The slider saves one gesture as a single validated change so the chain
// soft < snip < compact < force can never land in an intermediate invalid state.
func (a *App) SetCompactionThresholds(soft, snip, compact, force float64) error {
	_, err := a.applyConfigChangeWithWarning("context compaction thresholds", func(c *config.Config) error {
		return c.SetCompactionThresholds(soft, snip, compact, force)
	})
	return err
}
