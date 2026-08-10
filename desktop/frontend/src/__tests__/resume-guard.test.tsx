// Run: tsx src/__tests__/resume-guard.test.tsx
// The resume guard asks before restoring a session whose estimated size already
// exceeds the compact threshold; confirming continues the hydrate, cancelling
// leaves the tab on a cancelled hydrate error.

import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useController } from "../lib/useController";
import type { AppBindings } from "../lib/bridge";
import type { BalanceInfo, CheckpointMeta, ContextInfo, EffortInfo, HistoryMessage, JobView, Meta, TabMeta, WireEvent } from "../lib/types";

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
  if (actual === expected) {
    ok(true, label);
  } else {
    ok(false, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(label: string, predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await act(async () => {
      await flushPromises();
    });
    if (predicate()) return;
  }
  throw new Error(`timed out waiting for ${label}`);
}

function tabMeta(overrides: Partial<TabMeta> = {}): TabMeta {
  return {
    id: "tab-a",
    scope: "project",
    workspaceRoot: "/repo",
    workspaceName: "repo",
    workspacePath: "/repo",
    gitBranch: "main",
    topicId: "topic-a",
    topicTitle: "General",
    label: "model",
    ready: true,
    running: false,
    mode: "normal",
    toolApprovalMode: "ask",
    tokenMode: "full",
    active: true,
    cwd: "/repo",
    ...overrides,
  };
}

function meta(overrides: Partial<Meta> = {}): Meta {
  return {
    label: "model",
    ready: true,
    cwd: "/repo",
    workspaceRoot: "/repo",
    topicId: "topic-a",
    ...overrides,
  };
}

const context: ContextInfo = { used: 10, window: 1_000_000, sessionTokens: 0, compactRatio: 0.2 };
const balance: BalanceInfo = { available: false, display: "" };
const jobs: JobView[] = [];
const checkpoints: CheckpointMeta[] = [];

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
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
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return dom;
}

type Controller = ReturnType<typeof useController>;
let controller: Controller | undefined;

async function setup(resumeTokens: number) {
  const dom = installDom();
  window.runtime = {
    EventsOn: () => () => {},
    BrowserOpenURL: () => {},
  };
  window.go = {
    main: {
      App: {
        ListTabs: async () => [tabMeta()],
        MetaForTab: async () => meta(),
        ContextUsageForTab: async () => context,
        EffortForTab: async () => ({}) as EffortInfo,
        BalanceForTab: async () => balance,
        JobsForTab: async () => jobs,
        CheckpointsForTab: async () => checkpoints,
        HistoryForTab: async () => [],
        HistoryPageForTab: async () => ({ messages: [], startTurn: 0, endTurn: 0, totalTurns: 0, hasOlder: false }),
        HistoryCheckpointTurnsForTab: async () => [],
        ReplayPendingPrompts: async () => {},
        ResumeSessionPageForTab: async () => ({
          messages: [
            { role: "user", content: "restore", level: "user" } as HistoryMessage,
            { role: "assistant", content: "done", level: "assistant" } as HistoryMessage,
          ],
          startTurn: 0,
          endTurn: 1,
          totalTurns: 1,
          hasOlder: false,
          estimatedTokens: resumeTokens,
        }),
        ResumeSessionForTab: async () => [],
        OpenChannelSessionPageForTab: async () => ({ messages: [], startTurn: 0, endTurn: 0, totalTurns: 0, hasOlder: false }),
      } as Partial<AppBindings> as AppBindings,
    },
  };

  function Probe() {
    controller = useController();
    return <>{controller?.resumeGuardDialog}</>;
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing root");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(<Probe />);
    await flushPromises();
  });
  await waitFor("active tab", () => controller?.activeTabId === "tab-a");
  return { dom, root };
}

console.log("\nresume guard");

{
  // Over-threshold resume asks first; confirming continues the hydrate.
  const { dom, root } = await setup(500_000);

  // The guard blocks the resume on user confirmation, so drive it
  // fire-and-forget and resolve the dialog afterwards.
  let resume: Promise<void>;
  await act(async () => {
    resume = controller?.resumeSession("/repo/session.jsonl", "tab-a") ?? Promise.resolve();
    await flushPromises();
  });
  void resume;

  const dialog = document.querySelector(".reasonix-confirm-dialog");
  ok(dialog !== null, "over-threshold resume opens the confirm dialog");
  const message = document.querySelector(".reasonix-confirm-dialog__message")?.textContent ?? "";
  ok(
    message.includes("500,000") && message.includes("200,000"),
    `dialog names the estimated size and threshold, got ${message}`,
  );

  const confirmButton = [...document.querySelectorAll(".reasonix-confirm-dialog button")]
    .find((b) => b.textContent?.includes("Resume"));
  ok(confirmButton !== undefined, "confirm button labelled for resuming");
  await act(async () => {
    (confirmButton as HTMLButtonElement).click();
    await flushPromises();
  });

  await waitFor("hydrate completes after confirm", () => document.querySelector(".reasonix-confirm-dialog") === null);
  await waitFor("hydrate history loaded", () => (controller?.state.items?.length ?? 0) > 0);
  ok(
    !controller?.state.hydrateError && (controller?.state.items?.length ?? 0) > 0,
    "confirmed resume hydrates the restored conversation",
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

{
  // Cancelling leaves the session unchanged and surfaces a cancelled notice.
  const { dom, root } = await setup(500_000);

  let resume: Promise<void>;
  await act(async () => {
    resume = controller?.resumeSession("/repo/session.jsonl", "tab-a") ?? Promise.resolve();
    await flushPromises();
  });
  void resume;
  const dialog = document.querySelector(".reasonix-confirm-dialog");
  ok(dialog !== null, "over-threshold resume re-opens the confirm dialog");

  const cancelButton = [...document.querySelectorAll(".reasonix-confirm-dialog button")]
    .find((b) => b.textContent === "Cancel");
  await act(async () => {
    (cancelButton as HTMLButtonElement).click();
    await flushPromises();
  });
  await waitFor("dialog closes on cancel", () => document.querySelector(".reasonix-confirm-dialog") === null);
  ok(
    controller?.state.hydrateError != null && controller?.state.hydrateError.includes("unchanged"),
    `cancelled resume surfaces a hydrate error, got ${controller?.state.hydrateError}`,
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
