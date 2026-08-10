import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n, type DictKey } from "../lib/i18n";

// CompactionThresholdsSlider renders the four compaction thresholds (soft /
// snip / compact / force) as draggable thumbs on one log-scaled track. Values
// snap to integer percentages; the chain soft < snip < compact < force is
// enforced by clamping plus neighbour push so a single gesture lands a legal
// combination (e.g. 12/15/20/25 for early cleanup on a 1M window).
//
// Labels alternate above/below the track by thumb parity; when same-parity
// neighbours (soft<->compact, snip<->force) collide horizontally, the later
// one springs to a second-depth row. Row assignment is locked while dragging
// so a gesture never reflows mid-pull, then recomputed on release.

const MIN = 5;
const MAX = 95;
const LOG_RANGE = Math.log(MAX / MIN);

function posOf(p: number): number {
  return Math.log(p / MIN) / LOG_RANGE;
}

function pctAt(pos: number): number {
  return MIN * Math.pow(MAX / MIN, pos);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// dragValues applies a drag target to thumb i of a four-thumb chain, pushing
// neighbours outward so soft < snip < compact < force holds with ≥1% spacing.
// The target is pre-clamped so the whole chain always fits inside [MIN, MAX].
export function dragValues(values: [number, number, number, number], i: number, rawTarget: number): [number, number, number, number] {
  const target = clamp(rawTarget, MIN + i, MAX - (3 - i));
  const next = [...values] as [number, number, number, number];
  next[i] = clamp(target, MIN, MAX);
  for (let j = i - 1; j >= 0; j--) {
    if (next[j] >= next[j + 1] - 1) {
      const pushed = Math.max(MIN, next[j + 1] - 1);
      if (pushed === next[j]) break;
      next[j] = pushed;
    } else {
      break;
    }
  }
  for (let j = i + 1; j < 4; j++) {
    if (next[j] <= next[j - 1] + 1) {
      const pushed = Math.min(MAX, next[j - 1] + 1);
      if (pushed === next[j]) break;
      next[j] = pushed;
    } else {
      break;
    }
  }
  return next;
}

export interface CompactionThresholds {
  soft: number;
  snip: number;
  compact: number;
  force: number;
}

interface Props {
  thresholds: CompactionThresholds;
  windowTokens: number;
  busy: boolean;
  onChange: (t: CompactionThresholds) => Promise<unknown>;
}

interface Preset {
  labelKey: DictKey;
  values: CompactionThresholds;
}

const PRESETS: Preset[] = [  { labelKey: "settings.compactionPreset.conservative", values: { soft: 0.5, snip: 0.6, compact: 0.8, force: 0.9 } },
  { labelKey: "settings.compactionPreset.balanced", values: { soft: 0.35, snip: 0.45, compact: 0.6, force: 0.8 } },
  { labelKey: "settings.compactionPreset.aggressive", values: { soft: 0.12, snip: 0.15, compact: 0.2, force: 0.25 } },
];

export function CompactionThresholdsSlider({ thresholds, windowTokens, busy, onChange }: Props) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbEls = useRef<(HTMLButtonElement | null)[]>([]);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const rowsLockedRef = useRef<[number, number, number, number] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const draftRef = useRef<CompactionThresholds>(thresholds);
  const [draft, setDraft] = useState<CompactionThresholds>(thresholds);
  const [dragging, setDragging] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  // The slider is a transient editor: re-sync the draft when persisted values
  // change, but never while dragging or mid-save — the parent re-renders with
  // a fresh thresholds literal on every state flip (busy included), and
  // clobbering the draft there makes the thumb jump back to the old spot on
  // release before the save round-trip lands. The value comparison keeps the
  // effect a no-op for re-renders that carry identical numbers.
  useEffect(() => {
    if (dragIndexRef.current !== null || savingRef.current) return;
    setDraft((d) =>
      d.soft === thresholds.soft && d.snip === thresholds.snip && d.compact === thresholds.compact && d.force === thresholds.force
        ? d
        : thresholds,
    );
  }, [thresholds]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const pct = (v: number) => Math.round(v * 100);
  const list = useMemo(
    () => [pct(draft.soft), pct(draft.snip), pct(draft.compact), pct(draft.force)] as [number, number, number, number],
    [draft],
  );

  const flashThumb = useCallback((i: number) => {
    setFlash(i);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 280);
  }, []);

  // dragValue is extracted for unit tests: applies the target to thumb i and
  // pushes neighbours outward to preserve the ≥1% spacing chain, pre-clamping
  // the target so the chain always fits inside [MIN, MAX] (i left neighbours
  // need MIN..MIN+i-1, the 3-i right neighbours MAX-(3-i)+1..MAX).
  const dragValue = useCallback(
    (values: [number, number, number, number], i: number, rawTarget: number) => dragValues(values, i, rawTarget),
    [],
  );

  // persist wraps onChange so the resync effect stays suppressed while a
  // save round-trip is in flight; a rejected save restores the last synced
  // values instead of leaving a stale draft.
  const persist = useCallback(
    (value: CompactionThresholds) => {
      savingRef.current = true;
      void onChange(value)
        .catch(() => setDraft(thresholds))
        .finally(() => {
          savingRef.current = false;
        });
    },
    [onChange, thresholds],
  );

  const applyNext = useCallback(
    (next: [number, number, number, number], save: boolean) => {
      const value: CompactionThresholds = { soft: next[0] / 100, snip: next[1] / 100, compact: next[2] / 100, force: next[3] / 100 };
      setDraft(value);
      draftRef.current = value;
      if (save) {
        persist(value);
      }
    },
    [persist],
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent, i: number) => {
      if (busy) return;
      e.preventDefault();
      dragIndexRef.current = i;
      setDragging(i);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [busy],
  );

  // moveToPointer writes only the moved thumbs/labels straight to the DOM
  // (style.left plus value/token text) and never setDraft: a drag frame then
  // costs a few style/textContent writes instead of a slider re-render, and
  // the same nodes persist across the gesture instead of being rebuilt.
  const moveToPointer = useCallback(
    (clientX: number) => {
      const i = dragIndexRef.current;
      const track = trackRef.current;
      if (i === null || !track) return;
      const rect = track.getBoundingClientRect();
      const pos = clamp((clientX - rect.left) / rect.width, 0, 1);
      const target = Math.round(pctAt(pos));
      const cur = [pct(draftRef.current.soft), pct(draftRef.current.snip), pct(draftRef.current.compact), pct(draftRef.current.force)] as [number, number, number, number];
      const next = dragValue(cur, i, target);
      if (next[i] === cur[i]) flashThumb(i);
      const value: CompactionThresholds = { soft: next[0] / 100, snip: next[1] / 100, compact: next[2] / 100, force: next[3] / 100 };
      draftRef.current = value;
      for (let j = 0; j < 4; j += 1) {
        if (next[j] === cur[j]) continue;
        const thumb = thumbEls.current[j];
        if (thumb) thumb.style.left = `${posOf(next[j]) * 100}%`;
        const label = labelEls.current[j];
        if (!label) continue;
        label.style.left = `${posOf(next[j]) * 100}%`;
        const valueEl = label.querySelector(".cthresholds__label-value");
        if (valueEl) valueEl.textContent = `${next[j]}%`;
        const tokens = fmtTokens(next[j], windowTokens);
        const tokensEl = label.querySelector(".cthresholds__label-tokens");
        if (tokensEl) tokensEl.textContent = tokens ? `≈${tokens}` : "";
        else if (tokens) {
          const span = document.createElement("span");
          span.className = "cthresholds__label-tokens";
          span.textContent = `≈${tokens}`;
          label.appendChild(span);
        }
      }
    },
    [dragValue, flashThumb, windowTokens],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (dragIndexRef.current === null) return;
      moveToPointer(e.clientX);
    },
    [moveToPointer],
  );

  const onPointerUp = useCallback(() => {
    const i = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragging(null);
    rowsLockedRef.current = null;
    if (i === null) return;
    // Commit the drag result in one pass so React state (aria, labels) and
    // the imperatively written DOM converge for the release frame.
    setDraft(draftRef.current);
    persist(draftRef.current);
  }, [persist]);

  const onKey = useCallback(
    (e: ReactKeyboardEvent, i: number) => {
      if (busy) return;
      let step = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") step = -1;
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") step = 1;
      else if (e.key === "Home") step = -MAX;
      else if (e.key === "End") step = MAX;
      if (step === 0) return;
      e.preventDefault();
      const cur = [...list] as [number, number, number, number];
      const next = dragValue(cur, i, cur[i] + step);
      if (next[i] === cur[i]) flashThumb(i);
      applyNext(next, true);
    },
    [applyNext, busy, dragValue, flashThumb, list],
  );

  // Row assignment: parity alternation plus a second depth when same-parity
  // labels collide. Widths are estimated from label text (fonts are stable);
  // locked while dragging so the gesture does not reflow.
  const labelWidth = useCallback(
    (i: number) => {
      const name = labelFor(i, t);
      const tokens = fmtTokens(list[i], windowTokens);
      const width = name.length * 7 + 34 + (tokens ? 46 : 0);
      return Math.max(width, 56);
    },
    [list, t, windowTokens],
  );

  const rows = useMemo(() => {
    if (rowsLockedRef.current) return rowsLockedRef.current;
    const base: [number, number, number, number] = [0, 1, 0, 1];
    const out = [...base] as [number, number, number, number];
    const collide = (a: number, b: number) => {
      const ax = posOf(list[a]) * 100;
      const bx = posOf(list[b]) * 100;
      const aw = labelWidth(a);
      const bw = labelWidth(b);
      // Approximate pixels on a 560px track, then back to percent for the check.
      const trackPx = 560;
      const gapPx = (Math.abs(ax - bx) / 100) * trackPx;
      return gapPx < (aw + bw) / 2 + 8;
    };
    if (collide(0, 2)) out[2] = 2;
    if (collide(1, 3)) out[3] = 3;
    return out;
  }, [labelWidth, list]);

  useEffect(() => {
    if (dragging !== null && !rowsLockedRef.current) rowsLockedRef.current = rows;
  }, [dragging, rows]);

  const selectPreset = (p: CompactionThresholds) => {
    setDraft(p);
    draftRef.current = p;
    persist(p);
  };

  const colors = ["var(--fg)", "var(--accent)", "var(--warn)", "var(--danger)"];
  const activePreset = PRESETS.find(
    (p) => list[0] === pct(p.values.soft) && list[1] === pct(p.values.snip) && list[2] === pct(p.values.compact) && list[3] === pct(p.values.force),
  );

  return (
    <div className="cthresholds" data-testid="compaction-thresholds-slider">
      <div className="cthresholds__presets" role="group" aria-label={t("settings.compactionPresets")}>
        {PRESETS.map((p) => (
          <button
            key={p.labelKey}
            type="button"
            className={`btn btn--small cthresholds__preset${activePreset === p ? " cthresholds__preset--on" : ""}`}
            disabled={busy}
            aria-pressed={activePreset === p}
            onClick={() => selectPreset(p.values)}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      <div className="cthresholds__stage">
        <div className="cthresholds__labels">
          {[0, 1, 2, 3].map((i) => {
            const top = rows[i] % 2 === 0;
            const tokens = fmtTokens(list[i], windowTokens);
            return (
              <div
                key={i}
                ref={(el) => {
                  labelEls.current[i] = el;
                }}
                className={`cthresholds__label cthresholds__label--${top ? "top" : "bottom"}${rows[i] >= 2 ? ` cthresholds__label--depth${rows[i]}` : ""}${flash === i ? " cthresholds__label--flash" : ""}`}
                style={{ left: `${posOf(list[i]) * 100}%`, "--thumb-color": colors[i] } as CSSProperties}
                title={hintFor(i, t)}
              >
                <span className="cthresholds__label-name">{labelFor(i, t)}</span>
                <span className="cthresholds__label-value">{list[i]}%</span>
                {tokens && <span className="cthresholds__label-tokens">≈{tokens}</span>}
              </div>
            );
          })}
        </div>
        <div
          ref={trackRef}
          className="cthresholds__track"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="cthresholds__track-bg" />
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              ref={(el) => {
                thumbEls.current[i] = el;
              }}
              type="button"
              className={`cthresholds__thumb${dragging === i ? " cthresholds__thumb--active" : ""}${flash === i ? " cthresholds__thumb--flash" : ""}`}
              style={{ left: `${posOf(list[i]) * 100}%`, "--thumb-color": colors[i] } as CSSProperties}
              role="slider"
              aria-label={labelFor(i, t)}
              aria-valuemin={MIN}
              aria-valuemax={MAX}
              aria-valuenow={list[i]}
              aria-valuetext={`${list[i]} percent`}
              disabled={busy}
              onPointerDown={(e) => startDrag(e, i)}
              onKeyDown={(e) => onKey(e, i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtTokens(p: number, windowTokens: number): string {
  if (windowTokens <= 0) return "";
  const n = Math.round((windowTokens * p) / 100);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return `${n}`;
}

function labelFor(i: number, t: ReturnType<typeof useI18n>["t"]): string {
  switch (i) {
    case 0:
      return t("settings.compactionSoft");
    case 1:
      return t("settings.compactionSnip");
    case 2:
      return t("settings.compactionCompact");
    default:
      return t("settings.compactionForce");
  }
}

function hintFor(i: number, t: ReturnType<typeof useI18n>["t"]): string {
  switch (i) {
    case 0:
      return t("settings.compactionSoftHint");
    case 1:
      return t("settings.compactionSnipHint");
    case 2:
      return t("settings.compactionCompactHint");
    default:
      return t("settings.compactionForceHint");
  }
}
