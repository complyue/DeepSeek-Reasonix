// Run: tsx src/__tests__/compaction-slider-resync.test.tsx
// Regression: the parent re-renders with a fresh thresholds literal on every
// state flip (busy included). The slider must not clobber a drag in progress
// or a just-released draft with those identical-but-new objects, and must
// still pick up genuinely changed persisted values outside a gesture.

import { JSDOM } from "jsdom";
import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CompactionThresholdsSlider, type CompactionThresholds } from "../components/CompactionThresholdsSlider";
import { LocaleProvider } from "../lib/i18n";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "https://example.com/",
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.PointerEvent = dom.window.MouseEvent as unknown as typeof PointerEvent;
Object.defineProperty(globalThis.HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });

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
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}: got ${JSON.stringify(actual)}\n`);
    failed += 1;
  }
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log("\ncompaction slider resync");

// Track geometry: the drag math converts clientX via getBoundingClientRect.
const TRACK_W = 560;
const posOf = (p: number) => Math.log(p / 5) / Math.log(95 / 5);
const clientXFor = (pct: number) => Math.round(posOf(pct) * TRACK_W);

let latestThresholds: CompactionThresholds = { soft: 0.5, snip: 0.6, compact: 0.8, force: 0.9 };
let savedCalls: CompactionThresholds[] = [];
const onChange = async (v: CompactionThresholds) => {
  savedCalls.push({ ...v });
  // The parent applies the save: on the next render thresholds carry the new
  // numbers (a brand-new object literal, as in SettingsPanel).
  latestThresholds = { ...v };
};

function SliderApp() {
  const [, setTick] = useState(0);
  // A state flip elsewhere in the parent re-renders the slider with a fresh
  // literal carrying the same numbers — exactly what SettingsPanel does when
  // busy toggles. Clicking re-triggers that re-render.
  const bump = () => setTick((n) => n + 1);
  return (
    <LocaleProvider>
      <CompactionThresholdsSlider thresholds={{ ...latestThresholds }} windowTokens={100_000} busy={false} onChange={onChange} />
      <button id="bump" onClick={bump}>
        bump
      </button>
    </LocaleProvider>
  );
}

const rootEl = document.getElementById("root") as HTMLElement;
const root = createRoot(rootEl);
const trackLeft = (i: number) => {
  const thumbs = rootEl.querySelectorAll(".cthresholds__thumb");
  return (thumbs[i] as HTMLElement).style.left;
};

{
  await act(async () => {
    root.render(<SliderApp />);
  });

  const track = rootEl.querySelector(".cthresholds__track") as HTMLElement;
  track.getBoundingClientRect = () => ({ left: 0, top: 0, right: TRACK_W, bottom: 24, width: TRACK_W, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const thumbs = rootEl.querySelectorAll(".cthresholds__thumb");
  eq(trackLeft(2), `${posOf(80) * 100}%`, "compact thumb starts at 80%");

  // Begin dragging the compact thumb toward 70%.
  await act(async () => {
    thumbs[2].dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    track.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: clientXFor(70) }));
  });
  eq(trackLeft(2), `${posOf(70) * 100}%`, "drag moves the compact thumb to 70%");

  // Parent re-render mid-drag with an identical-but-new thresholds literal:
  // the thumb must not snap back to the persisted 80%.
  await act(async () => {
    (rootEl.querySelector("#bump") as HTMLElement).click();
  });
  eq(trackLeft(2), `${posOf(70) * 100}%`, "mid-drag parent re-render does not snap the thumb back");

  // Release: the save round-trip is in flight; a re-render during it must not
  // clobber the draft either.
  await act(async () => {
    track.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
  });
  await act(async () => {
    (rootEl.querySelector("#bump") as HTMLElement).click();
  });
  eq(savedCalls.length, 1, "release persists exactly one update");
  eq(savedCalls[0], { soft: 0.5, snip: 0.6, compact: 0.7, force: 0.9 }, "release saves the dragged chain");
  eq(trackLeft(2), `${posOf(70) * 100}%`, "post-release re-render keeps the released value");

  // An external settings refresh (no gesture) with genuinely new values must
  // still re-sync the draft.
  latestThresholds = { soft: 0.4, snip: 0.5, compact: 0.7, force: 0.9 };
  await act(async () => {
    (rootEl.querySelector("#bump") as HTMLElement).click();
  });
  eq(trackLeft(0), `${posOf(40) * 100}%`, "external refresh with new values re-syncs the draft");
  eq(trackLeft(2), `${posOf(70) * 100}%`, "unchanged thumbs keep their position");

  await act(async () => {
    root.unmount();
  });
}

{
  // SettingsPanel-accurate apply timing: onChange awaits the backend save;
  // thresholds only carry the new numbers after the reload lands, and the
  // parent re-renders with an identical literal while the save is in flight.
  latestThresholds = { soft: 0.5, snip: 0.6, compact: 0.8, force: 0.9 };
  savedCalls = [];
  let rejectSaves = false;
  const onChangeAccurate = async (v: CompactionThresholds) => {
    savedCalls.push({ ...v });
    await flushPromises(); // backend save round-trip (reload not landed yet)
    if (rejectSaves) throw new Error("rejected");
    latestThresholds = { ...v }; // reload() re-reads the persisted values
  };
  function AccurateApp() {
    const [, setTick] = useState(0);
    const bump = () => setTick((n) => n + 1);
    return (
      <LocaleProvider>
        <CompactionThresholdsSlider thresholds={{ ...latestThresholds }} windowTokens={100_000} busy={false} onChange={onChangeAccurate} />
        <button id="bump2" onClick={bump}>
          bump2
        </button>
      </LocaleProvider>
    );
  }
  const rootEl2 = document.getElementById("root") as HTMLElement;
  const root2 = createRoot(rootEl2);
  await act(async () => {
    root2.render(<AccurateApp />);
  });
  const track2 = rootEl2.querySelector(".cthresholds__track") as HTMLElement;
  track2.getBoundingClientRect = () => ({ left: 0, top: 0, right: TRACK_W, bottom: 24, width: TRACK_W, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const thumbs2 = () => rootEl2.querySelectorAll(".cthresholds__thumb");
  const leftOf = (i: number) => (thumbs2()[i] as HTMLElement).style.left;

  // Preset switch with the accurate save timing: the aggressive preset must
  // stick after the reload lands its numbers. Its en label is "Early cleanup".
  await act(async () => {
    [...rootEl2.querySelectorAll(".cthresholds__preset")].find((b) => b.textContent?.includes("Early cleanup"))?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await flushPromises();
  });
  await act(async () => {
    (rootEl2.querySelector("#bump2") as HTMLElement).click();
  });
  eq(leftOf(0), `${posOf(12) * 100}%`, "preset switch sticks after the save round-trip");
  eq(savedCalls.length, 1, "preset switch persists exactly one update");
  eq(savedCalls[0], { soft: 0.12, snip: 0.15, compact: 0.2, force: 0.25 }, "preset switch saves the aggressive chain");

  // Drag with the accurate timing: release must not snap back before reload.
  await act(async () => {
    thumbs2()[2].dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    track2.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: clientXFor(70) }));
  });
  await act(async () => {
    track2.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
    await flushPromises();
  });
  await act(async () => {
    (rootEl2.querySelector("#bump2") as HTMLElement).click();
  });
  eq(leftOf(2), `${posOf(70) * 100}%`, "accurate-timing drag release keeps the dragged value");
  eq(savedCalls.length, 2, "accurate-timing drag persists one more update");

  // A rejected save restores the last persisted values (the catch path).
  rejectSaves = true;
  await act(async () => {
    thumbs2()[1].dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    track2.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: clientXFor(30) }));
  });
  await act(async () => {
    track2.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
    await flushPromises();
  });
  eq(leftOf(1), `${posOf(15) * 100}%`, "rejected save restores the last persisted values");

  await act(async () => {
    root2.unmount();
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
