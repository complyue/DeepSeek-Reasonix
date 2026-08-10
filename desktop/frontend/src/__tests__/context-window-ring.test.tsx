// Run: tsx src/__tests__/context-window-ring.test.tsx

import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ContextWindowRing } from "../components/ContextWindowRing";
import { layoutThresholdMarks } from "../lib/thresholdLayout";
import { LocaleProvider } from "../lib/i18n";
import type { ContextPanelInfo } from "../lib/types";

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

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
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
  globalThis.ResizeObserver = TestResizeObserver;
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

function contextPanelInfo(requestCount: number): ContextPanelInfo {
  return {
    usedTokens: 0,
    windowTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    sessionCacheHitTokens: 0,
    sessionCacheMissTokens: 0,
    sessionCompletionTokens: 0,
    requestCount,
    elapsedMs: 0,
    sessionCost: 0,
    sessionCurrency: "",
    readFiles: [],
    changedFiles: [],
  };
}

function installContextPanelMock(fn: (tabId: string) => Promise<ContextPanelInfo>) {
  (window as unknown as { go: { main: { App: { ContextPanel: typeof fn } } } }).go = {
    main: {
      App: {
        ContextPanel: fn,
      },
    },
  };
}

async function renderRing(props: Partial<Parameters<typeof ContextWindowRing>[0]> = {}) {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing root");
  const root = createRoot(rootEl);
  let currentProps: Parameters<typeof ContextWindowRing>[0] = {
    enabled: true,
    tabId: "tab-a",
    context: { used: 10, window: 100, compactRatio: 0.8 },
    ...props,
  };
  const paint = async (nextProps: Partial<Parameters<typeof ContextWindowRing>[0]> = {}) => {
    currentProps = { ...currentProps, ...nextProps };
    await act(async () => {
      root.render(
        <LocaleProvider>
          <ContextWindowRing {...currentProps} />
        </LocaleProvider>,
      );
      await wait();
    });
  };
  await paint();
  return { root, rerender: paint };
}

console.log("\ncontext window ring");

{
  const dom = installDom();
  const calls: string[] = [];
  installContextPanelMock(async (tabId) => {
    calls.push(tabId);
    return contextPanelInfo(1);
  });

  const { root } = await renderRing({ enabled: false });

  eq(document.querySelector(".context-ring"), null, "disabled ring renders nothing");
  eq(calls.length, 0, "disabled ring does not request context panel data");

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

{
  const dom = installDom();
  installContextPanelMock(async () => contextPanelInfo(0));

  const { root } = await renderRing({ turnCost: 0.125, currency: "$" });
  const button = document.querySelector(".context-ring") as HTMLButtonElement | null;
  if (!button) throw new Error("missing context ring button");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await wait(220);
  });
  const turnCostRow = [...document.querySelectorAll(".context-ring-popover__row")]
    .find((row) => row.querySelector(".context-ring-popover__label")?.textContent === "turn cost");
  eq(
    turnCostRow?.querySelector(".context-ring-popover__value")?.textContent,
    "$0.1250",
    "turn cost uses the session currency before panel info is available",
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

{
  const dom = installDom();
  const calls: string[] = [];
  const resolvers = new Map<string, (value: ContextPanelInfo) => void>();
  installContextPanelMock((tabId) => {
    calls.push(tabId);
    return new Promise<ContextPanelInfo>((resolve) => {
      resolvers.set(tabId, resolve);
    });
  });

  const { root, rerender } = await renderRing({ tabId: "old-tab" });
  const button = document.querySelector(".context-ring") as HTMLButtonElement | null;
  if (!button) throw new Error("missing context ring button");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await wait();
  });

  await rerender({ tabId: "new-tab" });
  const nextButton = document.querySelector(".context-ring") as HTMLButtonElement | null;
  if (!nextButton) throw new Error("missing context ring button after tab switch");
  await act(async () => {
    nextButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await wait();
  });

  await act(async () => {
    resolvers.get("new-tab")?.(contextPanelInfo(2));
    await wait();
  });
  await act(async () => {
    resolvers.get("old-tab")?.(contextPanelInfo(1));
    await wait();
  });
  await act(async () => {
    nextButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await wait(220);
  });

  eq(calls[0], "old-tab", "old tab request starts first");
  eq(calls[1], "new-tab", "new tab request starts after tab switch");
  const requestRow = [...document.querySelectorAll(".context-ring-popover__row")]
    .find((row) => row.querySelector(".context-ring-popover__label")?.textContent === "Requests");
  eq(
    requestRow?.querySelector(".context-ring-popover__value")?.textContent,
    "2",
    "stale old-tab response cannot overwrite the new tab info",
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

{
  // The gauge renders all four threshold marks (soft/snip/compact/force) with a
  // compact label row; each mark sits at its percentage on the bar.
  const dom = installDom();
  installContextPanelMock(async () => contextPanelInfo(0));

  const { root } = await renderRing({
    context: { used: 10, window: 1_000_000, compactRatio: 0.2, softRatio: 0.12, snipRatio: 0.15, forceRatio: 0.25 },
  });
  const button = document.querySelector(".context-ring") as HTMLButtonElement | null;
  if (!button) throw new Error("missing context ring button");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await wait(220);
  });

  const marks = [...document.querySelectorAll(".context-ring-popover__mark")];
  eq(marks.length, 4, "gauge renders all four threshold marks");
  const keys = marks.map((m) => (m.className.match(/--([a-z]+)$/) ?? [])[1]);
  ok(
    keys.includes("soft") && keys.includes("snip") && keys.includes("compact") && keys.includes("force"),
    `marks carry the four threshold keys, got ${keys.join(",")}`,
  );
  const compactMark = marks.find((m) => m.className.includes("--compact"));
  eq(compactMark?.getAttribute("style"), "left: 20%;", "compact mark positioned at 20% on the gauge");

  const thresholdText = document.querySelector(".context-ring-popover__thresholds")?.textContent ?? "";
  ok(
    thresholdText.includes("12%") && thresholdText.includes("15%") && thresholdText.includes("20%") && thresholdText.includes("25%"),
    `thresholds row shows all percentages, got ${thresholdText}`,
  );

  const thresholdLabels = [...document.querySelectorAll(".context-ring-popover__threshold")];
  eq(thresholdLabels.length, 4, "threshold labels render all four marks");
  const firstLabel = thresholdLabels[0] as HTMLElement | undefined;
  ok(
    (firstLabel?.style.left ?? "").endsWith("%"),
    `threshold labels anchor to mark percentages, got left=${firstLabel?.style.left ?? "none"}`,
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

{
  // Colliding labels push apart in order and stay inside the row; extreme
  // clusters shrink instead of overflowing the fixed-height row.
  const wide = (s: string) => ({ w: s.length * 6.3 });
  const result = layoutThresholdMarks(
    [
      { key: "soft", pct: 12, text: "Notice 12%" },
      { key: "snip", pct: 15, text: "Trim 15%" },
      { key: "compact", pct: 20, text: "Compact 20%" },
      { key: "force", pct: 25, text: "Force 25%" },
    ],
    400,
  );
  eq(result.length, 4, "layout keeps every label");
  const byKey = Object.fromEntries(result.map((r) => [r.key, r]));
  ok(byKey.soft.left < byKey.snip.left && byKey.snip.left < byKey.compact.left && byKey.compact.left < byKey.force.left,
    "labels stay in threshold order after pushing apart");
  const text = (k: string) => ({ soft: "Notice 12%", snip: "Trim 15%", compact: "Compact 20%", force: "Force 25%" }[k]);
  const halfW = (k: string) => wide(text(k)).w / 2;
  const gap = (a: string, b: string) => ((byKey[b].left - byKey[a].left) / 100) * 400 - halfW(a) - halfW(b);
  ok(gap("soft", "snip") >= 8, `colliding labels push apart (soft->snip gap ${gap("soft", "snip").toFixed(1)}px)`);

  const tight = layoutThresholdMarks(
    [
      { key: "soft", pct: 10, text: "Notice 10%" },
      { key: "snip", pct: 12, text: "Trim 12%" },
      { key: "compact", pct: 14, text: "Compact 14%" },
      { key: "force", pct: 90, text: "Force 90%" },
    ],
    200,
  );
  for (const r of tight) {
    ok(r.left > 0 && r.left < 100, `row keeps labels inside bounds (${r.key} left=${r.left.toFixed(1)})`);
  }
  const tightByKey = Object.fromEntries(tight.map((r) => [r.key, r]));
  const visualGap = (a: string, b: string) =>
    ((tightByKey[b].left - tightByKey[a].left) / 100) * 200 - (halfW(a) + halfW(b)) * tightByKey[a].scale;
  ok(
    visualGap("soft", "snip") >= 0 && visualGap("snip", "compact") >= 0 && visualGap("compact", "force") >= 0,
    `tight row never overlaps (soft->snip ${visualGap("soft", "snip").toFixed(1)}px, snip->compact ${visualGap("snip", "compact").toFixed(1)}px, compact->force ${visualGap("compact", "force").toFixed(1)}px)`,
  );

  // A 220px popover (min-width) with CJK labels ("提示 12%" etc. ~49px each)
  // cannot fit four pushed-apart labels at full size: the row must shrink the
  // text (scale < 1) and stay inside the container instead of overflowing.
  const zh = ["提示 12%", "清理 15%", "压缩 20%", "强制 25%"];
  const zhW = (s: string) => [...s].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0) + 2;
  const narrow = layoutThresholdMarks(
    [
      { key: "soft", pct: 12, text: zh[0] },
      { key: "snip", pct: 15, text: zh[1] },
      { key: "compact", pct: 20, text: zh[2] },
      { key: "force", pct: 25, text: zh[3] },
    ],
    220,
  );
  const nByKey = Object.fromEntries(narrow.map((r) => [r.key, r]));
  const keyToText = { soft: zh[0], snip: zh[1], compact: zh[2], force: zh[3] } as const;
  const nGap = (a: keyof typeof keyToText, b: keyof typeof keyToText) =>
    ((nByKey[b].left - nByKey[a].left) / 100) * 220 - zhW(keyToText[a]) / 2 * nByKey[a].scale - zhW(keyToText[b]) / 2 * nByKey[b].scale;
  ok(
    narrow.some((r) => r.scale < 1),
    `narrow row shrinks labels (scales ${narrow.map((r) => r.scale).join(",")})`,
  );
  for (const r of narrow) {
    const edge = (r.left / 100) * 220;
    ok(edge >= zhW(keyToText[r.key as keyof typeof keyToText]) * r.scale / 2 - 1 && edge <= 220 - zhW(keyToText[r.key as keyof typeof keyToText]) * r.scale / 2 + 1,
      `narrow row keeps labels inside bounds (${r.key} left=${r.left.toFixed(1)}, scale=${r.scale})`);
  }
  ok(
    nGap("soft", "snip") >= 0 && nGap("snip", "compact") >= 0 && nGap("compact", "force") >= 0,
    `narrow row never overlaps after shrink (${nGap("soft", "snip").toFixed(1)}px / ${nGap("snip", "compact").toFixed(1)}px / ${nGap("compact", "force").toFixed(1)}px)`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
