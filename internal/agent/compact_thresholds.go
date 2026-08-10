package agent

// CompactThresholds returns the four compaction thresholds (soft, snip,
// compact, force) as window fractions. The desktop overview ring and the
// settings slider render them as marks on the context gauge.
func (a *Agent) CompactThresholds() (soft, snip, compact, force float64) {
	return a.softCompactRatio, a.toolResultSnipRatio, a.compactRatio, a.compactForceRatio
}
