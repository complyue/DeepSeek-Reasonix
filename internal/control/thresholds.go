package control

// CompactThresholds returns the four compaction thresholds (soft, snip,
// compact, force) as window fractions; all zero when the executor is unset.
func (c *Controller) CompactThresholds() (soft, snip, compact, force float64) {
	if c.executor == nil {
		return 0, 0, 0, 0
	}
	return c.executor.CompactThresholds()
}
