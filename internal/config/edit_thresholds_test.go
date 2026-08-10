package config

import (
	"math"
	"testing"
)

func TestSetCompactRatio(t *testing.T) {
	c := Default()
	for _, ratio := range []float64{0.65, 0.7, 0.8, 0.85} {
		if err := c.SetCompactRatio(ratio); err != nil {
			t.Fatalf("SetCompactRatio(%v): %v", ratio, err)
		}
		if c.Agent.CompactRatio != ratio {
			t.Fatalf("compact ratio = %v, want %v", c.Agent.CompactRatio, ratio)
		}
	}
	// Low thresholds are reachable once the snip ratio is lowered first.
	if err := c.SetToolResultSnipRatio(0.15); err != nil {
		t.Fatalf("SetToolResultSnipRatio(0.15): %v", err)
	}
	if err := c.SetCompactRatio(0.2); err != nil {
		t.Fatalf("SetCompactRatio(0.2) after lowering snip: %v", err)
	}
	if c.Agent.CompactRatio != 0.2 {
		t.Fatalf("compact ratio = %v, want 0.2", c.Agent.CompactRatio)
	}

	c2 := Default()
	previous := c2.Agent.CompactRatio
	for _, ratio := range []float64{0.09, 0.96, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if err := c2.SetCompactRatio(ratio); err == nil {
			t.Fatalf("SetCompactRatio(%v) should fail", ratio)
		}
		if c2.Agent.CompactRatio != previous {
			t.Fatalf("rejected ratio %v changed compact ratio to %v", ratio, c2.Agent.CompactRatio)
		}
	}

	c2.Agent.ToolResultSnipRatio = 0.75
	if err := c2.SetCompactRatio(0.7); err == nil {
		t.Fatal("SetCompactRatio should reject a value at or below the configured snip ratio")
	}
	c2.Agent.ToolResultSnipRatio = 0.6
	c2.Agent.CompactForceRatio = 0.8
	if err := c2.SetCompactRatio(0.8); err == nil {
		t.Fatal("SetCompactRatio should reject a value at or above the configured force ratio")
	}
}

func TestSetSoftCompactRatio(t *testing.T) {
	c := Default()
	for _, ratio := range []float64{0.05, 0.3, 0.5, 0.59} {
		if err := c.SetSoftCompactRatio(ratio); err != nil {
			t.Fatalf("SetSoftCompactRatio(%v): %v", ratio, err)
		}
		if c.Agent.SoftCompactRatio != ratio {
			t.Fatalf("soft ratio = %v, want %v", c.Agent.SoftCompactRatio, ratio)
		}
	}
	previous := c.Agent.SoftCompactRatio
	for _, ratio := range []float64{0.04, 0.96, math.NaN(), math.Inf(1)} {
		if err := c.SetSoftCompactRatio(ratio); err == nil {
			t.Fatalf("SetSoftCompactRatio(%v) should fail", ratio)
		}
		if c.Agent.SoftCompactRatio != previous {
			t.Fatalf("rejected soft ratio %v changed value to %v", ratio, c.Agent.SoftCompactRatio)
		}
	}
	// soft must stay below the snip ratio.
	c.Agent.ToolResultSnipRatio = 0.2
	if err := c.SetSoftCompactRatio(0.3); err == nil {
		t.Fatal("SetSoftCompactRatio should reject a value at or above the snip ratio")
	}
}

func TestSetToolResultSnipRatio(t *testing.T) {
	c := Default()
	for _, ratio := range []float64{0.05, 0.15, 0.4, 0.79} {
		if err := c.SetToolResultSnipRatio(ratio); err != nil {
			t.Fatalf("SetToolResultSnipRatio(%v): %v", ratio, err)
		}
		if c.Agent.ToolResultSnipRatio != ratio {
			t.Fatalf("snip ratio = %v, want %v", c.Agent.ToolResultSnipRatio, ratio)
		}
	}
	previous := c.Agent.ToolResultSnipRatio
	for _, ratio := range []float64{0.04, 0.96, math.NaN(), math.Inf(1)} {
		if err := c.SetToolResultSnipRatio(ratio); err == nil {
			t.Fatalf("SetToolResultSnipRatio(%v) should fail", ratio)
		}
		if c.Agent.ToolResultSnipRatio != previous {
			t.Fatalf("rejected snip ratio %v changed value to %v", ratio, c.Agent.ToolResultSnipRatio)
		}
	}
	// snip must stay below the compact ratio (default 0.8).
	if err := c.SetToolResultSnipRatio(0.8); err == nil {
		t.Fatal("SetToolResultSnipRatio should reject a value at or above the compact ratio")
	}
}

func TestSetCompactForceRatio(t *testing.T) {
	c := Default()
	for _, ratio := range []float64{0.81, 0.9, 0.95} {
		if err := c.SetCompactForceRatio(ratio); err != nil {
			t.Fatalf("SetCompactForceRatio(%v): %v", ratio, err)
		}
		if c.Agent.CompactForceRatio != ratio {
			t.Fatalf("force ratio = %v, want %v", c.Agent.CompactForceRatio, ratio)
		}
	}
	previous := c.Agent.CompactForceRatio
	for _, ratio := range []float64{0.09, 0.96, math.NaN(), math.Inf(1)} {
		if err := c.SetCompactForceRatio(ratio); err == nil {
			t.Fatalf("SetCompactForceRatio(%v) should fail", ratio)
		}
		if c.Agent.CompactForceRatio != previous {
			t.Fatalf("rejected force ratio %v changed value to %v", ratio, c.Agent.CompactForceRatio)
		}
	}
	// force must stay above the compact ratio (default 0.8).
	if err := c.SetCompactForceRatio(0.8); err == nil {
		t.Fatal("SetCompactForceRatio should reject a value at or below the compact ratio")
	}
}

func TestSetCompactionThresholds(t *testing.T) {
	c := Default()
	if err := c.SetCompactionThresholds(0.12, 0.15, 0.2, 0.25); err != nil {
		t.Fatalf("SetCompactionThresholds(0.12,0.15,0.2,0.25): %v", err)
	}
	if c.Agent.SoftCompactRatio != 0.12 || c.Agent.ToolResultSnipRatio != 0.15 || c.Agent.CompactRatio != 0.2 || c.Agent.CompactForceRatio != 0.25 {
		t.Fatalf("thresholds = %v/%v/%v/%v, want 0.12/0.15/0.2/0.25", c.Agent.SoftCompactRatio, c.Agent.ToolResultSnipRatio, c.Agent.CompactRatio, c.Agent.CompactForceRatio)
	}

	rejected := [][4]float64{
		{0.15, 0.12, 0.2, 0.25},  // soft >= snip
		{0.12, 0.2, 0.15, 0.25},  // snip >= compact
		{0.12, 0.15, 0.25, 0.2},  // compact >= force
		{0.04, 0.15, 0.2, 0.25},  // soft below 0.05
		{0.12, 0.15, 0.09, 0.25}, // compact below 0.10
		{0.12, 0.15, 0.2, 0.96},  // force above 0.95
		{math.NaN(), 0.15, 0.2, 0.25},
	}
	for _, tc := range rejected {
		if err := c.SetCompactionThresholds(tc[0], tc[1], tc[2], tc[3]); err == nil {
			t.Fatalf("SetCompactionThresholds(%v,%v,%v,%v) should fail", tc[0], tc[1], tc[2], tc[3])
		}
		if c.Agent.SoftCompactRatio != 0.12 || c.Agent.ToolResultSnipRatio != 0.15 || c.Agent.CompactRatio != 0.2 || c.Agent.CompactForceRatio != 0.25 {
			t.Fatalf("rejected batch changed thresholds to %v/%v/%v/%v", c.Agent.SoftCompactRatio, c.Agent.ToolResultSnipRatio, c.Agent.CompactRatio, c.Agent.CompactForceRatio)
		}
	}
}
