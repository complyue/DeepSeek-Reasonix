// Run: tsx src/__tests__/context-panel-pins.test.tsx
// Overview tab capacity card: threshold pills anchor to their percentages on
// a LOG-scaled track (settings-slider semantics) and alternate ABOVE/BELOW
// the progress track; a pill that would collide with its same-side neighbor
// springs to a deeper row. Each pill is a single line "name percent" with the
// full 11px font — no wrapping, no shrinking.

import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ContextPanel } from "../components/ContextPanel";
import { LocaleProvider } from "../lib/i18n";
import type { ContextInfo } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(value: boolean, label: string) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(true, label);
  else ok(false, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function approx(actual: number, expected: number, tol: number, label: string) {
  if (Math.abs(actual - expected) <= tol) ok(true, label);
  else ok(false, `${label}: expected ~${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
  return dom;
}

// The panel renders the capacity card synchronously when no tabId is passed
// (refresh is a no-op), so context props drive everything.
function renderPanel(context: ContextInfo) {
  const root = createRoot(document.getElementById("root")!);
  act(() => {
    root.render(
      <LocaleProvider>
        <ContextPanel context={context} />
      </LocaleProvider>,
    );
  });
  const pins = Array.from(document.querySelectorAll<HTMLElement>(".context-panel__capacity-pin"));
  const lines = Array.from(document.querySelectorAll<HTMLElement>(".context-panel__capacity-pin-line"));
  const getLeft = (el: HTMLElement) => Number.parseFloat(el.style.left);
  const getRow = (el: HTMLElement) => Number.parseFloat(el.style.getPropertyValue("--pin-row") || "0");
  const getSide = (el: HTMLElement) =>
    el.closest(".context-panel__capacity-scale-bottom") ? "bottom" : "top";
  const getText = (el: HTMLElement) => el.textContent ?? "";
  root.unmount();
  return { pins, lines, getLeft, getRow, getSide, getText };
}

// Matches the panel's log mapping (5–95% compressed to 0–100%).
function logPosOf(pct: number) {
  return (Math.log(Math.max(pct, 5) / 5) / Math.log(95 / 5)) * 100;
}

{
  // Thresholds 12/15/20/25: four pills render, anchor x is the log position
  // (never shifted sideways); soft/snip sit on the first rows, compact/force
  // spring to a deeper row because 66px single-line pills collide there.
  const dom = installDom();
  const { pins, lines, getLeft, getRow, getSide, getText } = renderPanel({
    used: 170_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  // Every pill gets a vertical leader line at the same anchor x.
  eq(lines.length, 5, "five leader lines render (one per pill)");
  const lineLefts = new Set(lines.map((el) => Number.parseFloat(el.style.left).toFixed(2)));
  for (const el of pins) {
    ok(lineLefts.has(getLeft(el).toFixed(2)), `pill at ${getLeft(el).toFixed(2)}% has a leader line at the same x`);
  }
  eq(pins.length, 5, "capacity card renders five pills (used + 4 thresholds)");
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  for (const k of ["used", "soft", "snip", "compact", "force"]) {
    ok(Boolean(byKey[k]), `pin --${k} rendered`);
  }
  // Anchor x = log position, accurate to the percent.
  approx(getLeft(byKey.used), logPosOf(17), 0.1, "used pin anchors at log(17%)");
  approx(getLeft(byKey.soft), logPosOf(12), 0.1, "soft pin anchors at log(12%)");
  approx(getLeft(byKey.snip), logPosOf(15), 0.1, "snip pin anchors at log(15%)");
  approx(getLeft(byKey.compact), logPosOf(20), 0.1, "compact pin anchors at log(20%)");
  approx(getLeft(byKey.force), logPosOf(25), 0.1, "force pin anchors at log(25%)");
  // Single-line pills carry the name and percent together; used is a bare
  // percent.
  ok(getText(byKey.used).trim() === "17%", "used pill shows the bare percent");
  ok(getText(byKey.soft).includes("12%") && getText(byKey.soft).includes("Notice"), "soft pill text = name + percent");
  ok(getText(byKey.force).includes("25%") && getText(byKey.force).includes("Force"), "force pill text = name + percent");
  // Alternate sides: soft/compact above, snip/force below; thresholds stay
  // on first rows when the log gap clears their width (gap 0, edge-to-edge).
  eq(getSide(byKey.soft), "top", "soft pill above the track");
  eq(getSide(byKey.compact), "top", "compact pill above the track");
  eq(getSide(byKey.snip), "bottom", "snip pill below the track");
  eq(getSide(byKey.force), "bottom", "force pill below the track");
  // With gap -3 (3px overlap tolerance) the 48.7px log gaps on the 280px
  // fallback meter clear 46px pills, so thresholds stay on row 0 — a visible
  // seam means "far enough", per the user.
  eq(getRow(byKey.soft), 0, "soft pill on top row 0");
  // Used 17% is only ~15px from compact 20% on the log track, so compact
  // springs to top row 1 and used stays on a first row with soft 12%.
  eq(getRow(byKey.compact), 1, "compact pill springs to top row 1 for used 17%");
  eq(getRow(byKey.snip), 0, "snip pill on bottom row 0");
  eq(getRow(byKey.force), 0, "force pill stays on bottom row 0 (seam is enough)");
  eq(getSide(byKey.used), "top", "used 17% sits above the track");
  eq(getRow(byKey.used), 0, "used 17% stays on a first row (compact springs instead)");
  // Same side & same row must not overlap: log anchors on the 280px fallback
  // meter leave a non-negative clearance.
  for (const [a, b] of [
    [byKey.soft, byKey.compact],
    [byKey.snip, byKey.force],
  ] as const) {
    const gap = (getLeft(b) - getLeft(a)) / 100 * 280;
    ok(gap >= 46, `same-side pair ${a.className} / ${b.className} cleared (${gap.toFixed(1)}px)`);
  }
  dom.window.close();
}

{
  // Only the default compact (0.8) pill when no thresholds configured;
  // position is still log-scaled.
  const dom = installDom();
  const { pins, getLeft } = renderPanel({
    used: 10_000,
    window: 100_000,
    sessionTokens: 0,
  } as ContextInfo);
  eq(pins.length, 2, "no thresholds configured -> used + default compact pills");
  approx(getLeft(pins[0]), logPosOf(80), 0.1, "default compact pill anchors at log(80%)");
  approx(getLeft(pins[1]), logPosOf(10), 0.1, "used pill anchors at log(10%)");
  dom.window.close();
}

{
  // Used 8% sits comfortably away from the thresholds (34px+ log gaps), so
  // it must stay on a first row near the track, not spring away.
  const dom = installDom();
  const { pins, getRow, getSide } = renderPanel({
    used: 80_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  eq(getSide(byKey.used), "top", "used 8% hugs the track on the top side");
  eq(getRow(byKey.used), 0, "used 8% stays on a first row (near the track)");
  eq(getSide(byKey.soft), "top", "soft 12% sits above the track");
  eq(getRow(byKey.soft), 0, "soft 12% stays on a first row");
  dom.window.close();
}

{
  // Used 14% is only 14.7px from soft 12% on the log track but 34px from
  // compact 20% (2px overlap, reads as "far enough"): soft must spring to
  // top row 1 while used shares row 0 with compact.
  const dom = installDom();
  const { pins, getRow, getSide, getLeft } = renderPanel({
    used: 140_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  eq(getSide(byKey.soft), "top", "soft 12% above the track");
  eq(getRow(byKey.soft), 1, "soft 12% springs to top row 1 (too close to used 14%)");
  eq(getSide(byKey.used), "top", "used 14% above the track");
  eq(getRow(byKey.used), 0, "used 14% stays on a first row");
  eq(getRow(byKey.compact), 0, "compact 20% stays on row 0 (2px overlap is far enough)");
  const usedCompactGap = (getLeft(byKey.compact) - getLeft(byKey.used)) / 100 * 280;
  ok(usedCompactGap >= 33, `used/compact share row 0 within tolerance (${usedCompactGap.toFixed(1)}px)`);
  dom.window.close();
}

{
  // Used 16% sits 27.4px from soft 12% and 21.3px from compact 20% on the
  // log track — both overlap beyond the 7px tolerance, so both soft and
  // compact must spring while used stays on row 0.
  const dom = installDom();
  const { pins, getRow, getSide } = renderPanel({
    used: 160_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  eq(getSide(byKey.used), "top", "used 16% above the track");
  eq(getRow(byKey.used), 0, "used 16% stays on a first row");
  eq(getRow(byKey.soft), 1, "soft 12% springs to top row 1 (27.4px from used 16%)");
  eq(getRow(byKey.compact), 1, "compact 20% springs to top row 1 (21.3px from used 16%)");
  eq(getRow(byKey.snip), 0, "snip 15% stays on bottom row 0");
  eq(getRow(byKey.force), 0, "force 25% stays on bottom row 0");
  dom.window.close();
}

{
  // Used 19% is only 4.8px from compact 20% but 44px from soft 12%: compact
  // must spring to top row 1 while used stays on row 0 next to soft.
  const dom = installDom();
  const { pins, getRow, getSide } = renderPanel({
    used: 190_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  eq(getSide(byKey.used), "top", "used 19% above the track");
  eq(getRow(byKey.used), 0, "used 19% stays on a first row");
  eq(getRow(byKey.soft), 0, "soft 12% stays on row 0 (44px from used 19%)");
  eq(getRow(byKey.compact), 1, "compact 20% springs to top row 1 (4.8px from used 19%)");
  dom.window.close();
}

{
  // Measured-width path: when pills actually render narrower than the 66px
  // estimate, the layout decides by the real on-screen width and keeps rows
  // that fit (compact no longer springs to row 1 at a 43.5px log gap).
  const dom = installDom();
  // Define on the NEW jsdom's prototype so the panel's measurement sees it.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 30;
    },
  });
  const { pins, getRow, getSide, getLeft } = renderPanel({
    used: 170_000,
    window: 1_000_000,
    sessionTokens: 0,
    compactRatio: 0.2,
    softRatio: 0.12,
    snipRatio: 0.15,
    forceRatio: 0.25,
  } as ContextInfo);
  const byKey: Record<string, HTMLElement> = {};
  for (const el of pins) {
    const cls = [...el.classList].find((c) => c.startsWith("context-panel__capacity-pin--"));
    if (cls) byKey[cls.replace("context-panel__capacity-pin--", "")] = el;
  }
  // 30px measured pills: used 17% collides with compact 20% (15px apart),
  // so compact springs to top row 1 and used stays on a first row — sharing
  // row 0 with soft 12% whose 33px gap clears the 30px half-widths.
  eq(getRow(byKey.compact), 1, "compact springs to top row 1 for used 17%");
  eq(getSide(byKey.used), "top", "used stays top side with narrow widths");
  eq(getRow(byKey.used), 0, "used stays on a first row");
  const usedSoftGap = (getLeft(byKey.used) - getLeft(byKey.soft)) / 100 * 280;
  ok(usedSoftGap >= 30, `used/soft share row 0 without overlap (${usedSoftGap.toFixed(1)}px)`);
  dom.window.close();
  delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
