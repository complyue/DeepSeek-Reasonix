export interface ThresholdLabelLayout {
  key: string;
  left: number;
  scale: number;
}

// Gauge threshold labels: each anchors to its mark's percentage, then labels
// push apart horizontally in order (min gap) so tight clusters never overlap.
// Overflow shrinks the text in steps before the row gives up and center-aligns;
// the row height is fixed, labels never wrap.
export function layoutThresholdMarks(
  marks: ReadonlyArray<{ key: string; pct: number; text: string }>,
  containerW: number,
  padPx = 0,
): ThresholdLabelLayout[] {
  if (containerW <= 0) {
    return marks.map((m) => ({ key: m.key, left: m.pct, scale: 1 }));
  }
  const charW = (ch: string) => (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.3);
  // The rendered box is wider than the glyphs: callers with padded/bordered
  // labels pass the box allowance (e.g. 16px for the capacity pins) so pushed
  // gaps are measured against real widths, not bare text.
  const textW = (s: string) => [...s].reduce((sum, ch) => sum + charW(ch), 0) + 2 + padPx;
  const items = marks.map((m) => ({ key: m.key, pct: m.pct, w: textW(m.text) }));

  const place = (gap: number, scale: number) => {
    const out: { key: string; pct: number; w: number; x: number }[] = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      const anchor = (it.pct / 100) * containerW;
      const x = prev ? Math.max(anchor, prev.x + ((prev.w + it.w) / 2) * scale + gap) : anchor;
      out.push({ ...it, x });
    }
    return out;
  };
  const edges = (placed: { w: number; x: number }[], scale: number) => ({
    left: Math.min(...placed.map((it) => it.x - (it.w / 2) * scale)),
    right: Math.max(...placed.map((it) => it.x + (it.w / 2) * scale)),
  });
  const toPct = (placed: { key: string; x: number }[], shift: number, scale: number) =>
    placed.map((it) => ({ key: it.key, left: ((it.x + shift) / containerW) * 100, scale }));

  for (const [gap, scale] of [[8, 1], [4, 0.92], [2, 0.84], [2, 0.76], [2, 0.68], [2, 0.6]] as const) {
    const placed = place(gap, scale);
    const e = edges(placed, scale);
    if (e.left >= 0 && e.right <= containerW) return toPct(placed, 0, scale);
    // Both edges inside is the goal; a row narrower than the container can
    // always be shifted to fit, so accept that before shrinking further.
    if (e.right - e.left <= containerW) {
      let shift = -e.left;
      if (e.right + shift > containerW) shift = containerW - e.right;
      return toPct(placed, shift, scale);
    }
  }
  // Smallest scale still overflows: center the row so overflow is symmetric.
  const placed = place(2, 0.6);
  const e = edges(placed, 0.6);
  return toPct(placed, (containerW - (e.left + e.right)) / 2, 0.6);
}
