package config

import (
	"fmt"
	"math"
)

// SetCompactRatio updates the auto-compaction threshold. The editable range is
// deliberately wider than the historical 65-85% so low-window models or
// performance-first setups can compact early; the snip/force guard rails still
// keep the chain soft < snip < compact < force valid.
func (c *Config) SetCompactRatio(ratio float64) error {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0.10 || ratio > 0.95 {
		return fmt.Errorf("compact ratio %v: must be between 0.10 and 0.95", ratio)
	}
	snip := c.Agent.ToolResultSnipRatio
	force := c.Agent.CompactForceRatio
	if snip > 0 && ratio <= snip {
		return fmt.Errorf("compact ratio %.2f: must be greater than tool result snip ratio %.2f", ratio, snip)
	}
	if force > 0 && ratio >= force {
		return fmt.Errorf("compact ratio %.2f: must be less than force ratio %.2f", ratio, force)
	}
	c.Agent.CompactRatio = ratio
	return nil
}

// SetSoftCompactRatio updates the notice-only threshold. It must stay below the
// snip ratio, otherwise the soft branch in maybeCompact would never fire.
func (c *Config) SetSoftCompactRatio(ratio float64) error {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0.05 || ratio > 0.95 {
		return fmt.Errorf("soft compact ratio %v: must be between 0.05 and 0.95", ratio)
	}
	snip := c.Agent.ToolResultSnipRatio
	if snip > 0 && ratio >= snip {
		return fmt.Errorf("soft compact ratio %.2f: must be less than tool result snip ratio %.2f", ratio, snip)
	}
	c.Agent.SoftCompactRatio = ratio
	return nil
}

// SetToolResultSnipRatio updates the stale-tool-result snip threshold. It must
// stay below the compact ratio; the soft side is left alone because a lone snip
// change may legitimately sit above a default soft value (the agent clamps soft
// below snip at runtime).
func (c *Config) SetToolResultSnipRatio(ratio float64) error {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0.05 || ratio > 0.95 {
		return fmt.Errorf("tool result snip ratio %v: must be between 0.05 and 0.95", ratio)
	}
	compact := c.Agent.CompactRatio
	if compact > 0 && ratio >= compact {
		return fmt.Errorf("tool result snip ratio %.2f: must be less than compact ratio %.2f", ratio, compact)
	}
	c.Agent.ToolResultSnipRatio = ratio
	return nil
}

// SetCompactForceRatio updates the high-water force-compaction threshold. It
// must stay above the compact ratio and below 1.0 to keep exhaustion headroom.
func (c *Config) SetCompactForceRatio(ratio float64) error {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0.10 || ratio > 0.95 {
		return fmt.Errorf("compact force ratio %v: must be between 0.10 and 0.95", ratio)
	}
	compact := c.Agent.CompactRatio
	if compact > 0 && ratio <= compact {
		return fmt.Errorf("compact force ratio %.2f: must be greater than compact ratio %.2f", ratio, compact)
	}
	c.Agent.CompactForceRatio = ratio
	return nil
}

// SetCompactionThresholds updates all four compaction thresholds atomically:
// the chain soft < snip < compact < force is validated before any field
// changes, so a settings slider cannot persist an intermediate invalid state.
func (c *Config) SetCompactionThresholds(soft, snip, compact, force float64) error {
	bounds := []struct {
		name          string
		value, lo, hi float64
	}{
		{"soft compact ratio", soft, 0.05, 0.95},
		{"tool result snip ratio", snip, 0.05, 0.95},
		{"compact ratio", compact, 0.10, 0.95},
		{"compact force ratio", force, 0.10, 0.95},
	}
	for _, v := range bounds {
		if math.IsNaN(v.value) || math.IsInf(v.value, 0) || v.value < v.lo || v.value > v.hi {
			return fmt.Errorf("%s %v: must be between %v and %v", v.name, v.value, v.lo, v.hi)
		}
	}
	if soft >= snip {
		return fmt.Errorf("soft compact ratio %.2f: must be less than tool result snip ratio %.2f", soft, snip)
	}
	if snip >= compact {
		return fmt.Errorf("tool result snip ratio %.2f: must be less than compact ratio %.2f", snip, compact)
	}
	if compact >= force {
		return fmt.Errorf("compact ratio %.2f: must be less than compact force ratio %.2f", compact, force)
	}
	c.Agent.SoftCompactRatio = soft
	c.Agent.ToolResultSnipRatio = snip
	c.Agent.CompactRatio = compact
	c.Agent.CompactForceRatio = force
	return nil
}

// SaveMinimalProjectCompactRatio writes a new project config that only
// overrides [agent].compact_ratio.
func SaveMinimalProjectCompactRatio(path string, ratio float64) (float64, error) {
	cfg := Default()
	if err := cfg.SetCompactRatio(ratio); err != nil {
		return 0, err
	}
	body := fmt.Sprintf(`# Reasonix project configuration.
# Project-local overrides are merged over the user config.

[agent]
compact_ratio = %s
`, formatFloat(cfg.Agent.CompactRatio))
	return cfg.Agent.CompactRatio, writeConfigFile(path, body)
}

// SaveMinimalProjectSnipRatio writes a new project config that only overrides
// [agent].tool_result_snip_ratio.
func SaveMinimalProjectSnipRatio(path string, ratio float64) (float64, error) {
	cfg := Default()
	if err := cfg.SetToolResultSnipRatio(ratio); err != nil {
		return 0, err
	}
	body := fmt.Sprintf(`# Reasonix project configuration.
# Project-local overrides are merged over the user config.

[agent]
tool_result_snip_ratio = %s
`, formatFloat(cfg.Agent.ToolResultSnipRatio))
	return cfg.Agent.ToolResultSnipRatio, writeConfigFile(path, body)
}
