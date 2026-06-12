import { Network } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAdjacency,
  buildLocalGraph,
  EMPTY_GRAPH,
  type GraphNode,
} from "../editor2026/graphModel";
import { cn } from "../lib/cn";
import { DEFAULT_NOTE_TITLE } from "../lib/format";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";

// ─── Layout constants (SVG viewBox units) ───────────────────────────────────

const VB_W = 600;
const VB_H = 320;
const CX = VB_W / 2;
const CY = VB_H / 2;
// Ellipse rings per hop level (wider than tall to fill the box).
const RINGS: Record<number, { rx: number; ry: number }> = {
  1: { rx: 190, ry: 95 },
  2: { rx: 268, ry: 138 },
};
// Tighter rings for the narrow side panel, leaving room for below-node labels.
const RINGS_COMPACT: Record<number, { rx: number; ry: number }> = {
  1: { rx: 150, ry: 80 },
  2: { rx: 210, ry: 112 },
};
const NODE_R = 6;
const CENTER_R = 9;
/** Cap rendered nodes so a hub's 2-hop blast doesn't turn into mush. */
const MAX_NODES = 40;

/** Alias so existing layout/render code keeps its old name. Under the hood
 *  this is the shared `GraphNode` (with an extra `degree` field SVG doesn't
 *  use , harmless). `buildAdjacency` + `buildLocalGraph` live in
 *  `editor2026/graphModel` and are shared with the future WebGL renderer +
 *  the Backlinks contract , one source of truth for "what's connected". */
type NBNode = GraphNode;

//  and the local BFS were lifted into editor2026/graphModel
// as  , shared with the future WebGL local-graph + tests.


function layout(
  nodes: NBNode[],
  compact: boolean,
): Map<string, { x: number; y: number }> {
  const rings = compact ? RINGS_COMPACT : RINGS;
  const byLevel = new Map<number, NBNode[]>();
  for (const n of nodes) {
    const arr = byLevel.get(n.level);
    if (arr) arr.push(n);
    else byLevel.set(n.level, [n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [lvl, arr] of byLevel) {
    if (lvl === 0) {
      pos.set(arr[0].id, { x: CX, y: CY });
      continue;
    }
    const ring = rings[lvl] ?? rings[2];
    arr.forEach((n, i) => {
      // Offset every other ring's start angle so rings don't line up radially.
      const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2 + (lvl - 1) * 0.4;
      pos.set(n.id, {
        x: CX + Math.cos(a) * ring.rx,
        y: CY + Math.sin(a) * ring.ry,
      });
    });
  }
  return pos;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * "Local graph" for the open note (Obsidian-style): its wiki-link neighbourhood
 * up to 1–2 hops, drawn as a light SVG (no PixiJS). Click a node to navigate.
 * Hidden when the note has no connections.
 */
export function LocalGraph({ compact = false }: { compact?: boolean }) {
  const activeId = useNotesStore((s) => s.activeId);
  const tree = useNotesStore((s) => s.tree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const [hops, setHops] = useState(1);

  // Pan/zoom as an outer transform in viewBox units:
  // screenPoint = view.{x,y} + worldPoint * view.k.
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{
    sx: number;
    sy: number;
    vx: number;
    vy: number;
  } | null>(null);

  const notes = useMemo(() => flattenNotes(tree), [tree]);
  // Adjacency depends ONLY on the fields buildAdjacency reads (id + body links
  // serialized in `preview`). Other autosave-bumped fields (icon, cover,
  // favorite, updatedAt, mood) flip `tree` identity , `notes` identity but
  // don't change the link graph. A content signature collapses those into a
  // single string so the heavy buildAdjacency walk only re-runs on actual
  // link changes.
  const adjSig = useMemo(
    () => notes.map((n) => `${n.id}|${n.preview ?? ""}`).join("\n"),
    [notes],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adj = useMemo(() => buildAdjacency(notes), [adjSig]);
  // Compute the full 2-hop neighbourhood once so we know whether a 2nd level
  // even exists (used to enable/disable that toggle). The displayed graph is
  // just this, filtered to the selected depth. Delegates to the shared
  // graphModel , same BFS one source of truth for SVG / future WebGL / tests.
  const full = useMemo(
    () =>
      activeId
        ? buildLocalGraph(notes, activeId, 2, {
            adjacency: adj,
            maxNodes: MAX_NODES,
          })
        : EMPTY_GRAPH,
    [notes, adj, activeId],
  );
  const hasLevel2 = useMemo(() => full.nodes.some((n) => n.level === 2), [full]);
  // Fall back to depth 1 when there's nothing at depth 2, so the toggle never
  // sits on a "2 уровня" that looks identical to "1 уровень".
  const effectiveHops = hasLevel2 ? hops : 1;
  const { nodes, edges } = useMemo(() => {
    if (effectiveHops >= 2) return full;
    const keep = new Set(
      full.nodes.filter((n) => n.level <= effectiveHops).map((n) => n.id),
    );
    return {
      nodes: full.nodes.filter((n) => keep.has(n.id)),
      edges: full.edges.filter((e) => keep.has(e.a) && keep.has(e.b)),
    };
  }, [full, effectiveHops]);
  const pos = useMemo(() => layout(nodes, compact), [nodes, compact]);

  const showGraph = !!activeId && nodes.length > 1;

  // Reset zoom/pan when switching notes (the new graph has a fresh layout).
  useEffect(() => {
    setView({ x: 0, y: 0, k: 1 });
  }, [activeId]);

  // Wheel-zoom around the cursor. Attached as a non-passive native listener so
  // preventDefault() stops the page from scrolling (React's onWheel is passive).
  // Re-runs when the svg mounts (showGraph false, true).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scale = VB_W / rect.width; // viewBox units per screen px
      const px = (e.clientX - rect.left) * scale;
      const py = (e.clientY - rect.top) * scale;
      setView((v) => {
        const k = Math.min(
          4,
          Math.max(0.4, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)),
        );
        const f = k / v.k;
        // Keep the world point under the cursor fixed on screen.
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [showGraph]);

  // Nothing to show if the note has no links/backlinks.
  if (!showGraph) return null;

  // ── Pan by dragging empty canvas (nodes stopPropagation, so a click still
  // navigates) ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = panRef.current;
    if (!p) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = rect ? VB_W / rect.width : 1;
    setView((v) => ({
      ...v,
      x: p.vx + (e.clientX - p.sx) * scale,
      y: p.vy + (e.clientY - p.sy) * scale,
    }));
  };
  const endPan = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const resetView = () => setView({ x: 0, y: 0, k: 1 });
  const dirty = view.x !== 0 || view.y !== 0 || view.k !== 1;

  return (
    <div
      className={
        compact ? "w-full" : "max-w-3xl mx-auto w-full px-5 sm:px-12 pb-10 pt-4"
      }
    >
      <div className={compact ? "" : "border-t border-[var(--color-border)] pt-6"}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 flex items-center gap-1.5">
            <Network size={12} strokeWidth={2} />
            Локальный граф · {nodes.length - 1}
          </h3>
          <div className="flex items-center gap-1.5 text-[11px]">
            {dirty && (
              <button
                type="button"
                onClick={resetView}
                title="Сбросить масштаб (двойной клик по графу)"
                className="px-2 py-0.5 rounded font-medium text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                Сброс
              </button>
            )}
            <div className="flex items-center gap-0.5">
              {[1, 2].map((h) => {
                const disabled = h === 2 && !hasLevel2;
                const active = effectiveHops === h;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={disabled}
                    onClick={() => setHops(h)}
                    title={
                      disabled
                        ? "У этой заметки нет связей второго уровня"
                        : `Показывать связи на ${h} ${h === 1 ? "уровень" : "уровня"} вглубь`
                    }
                    className={cn(
                      "px-2 py-0.5 rounded transition-colors font-medium",
                      disabled
                        ? "text-zinc-700 cursor-not-allowed"
                        : active
                          ? "bg-white/[0.08] text-zinc-200"
                          : "text-zinc-600 hover:text-zinc-300",
                    )}
                  >
                    {h} {h === 1 ? "уровень" : "уровня"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            className={cn(
              "w-full touch-none select-none",
              panning ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDoubleClick={resetView}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map((e) => {
              const a = pos.get(e.a);
              const b = pos.get(e.b);
              if (!a || !b) return null;
              return (
                <line
                  key={`${e.a} ${e.b}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--color-border-strong)"
                  strokeWidth={1}
                  opacity={0.6}
                />
              );
            })}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const isCenter = n.level === 0;
              const r = isCenter ? CENTER_R : NODE_R;
              // Full title, no truncation (по запросу). Long labels may extend
              // past the node; the hover tooltip still shows the same text.
              const label = n.note.title || DEFAULT_NOTE_TITLE;
              const labelRight = p.x <= CX;
              return (
                <g
                  key={n.id}
                  className={isCenter ? undefined : "cursor-pointer"}
                  // A press on a node must not start a canvas pan; a plain
                  // click (no drag) still navigates.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={isCenter ? undefined : () => void selectNote(n.id)}
                >
                  <title>{n.note.title || DEFAULT_NOTE_TITLE}</title>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={
                      isCenter
                        ? "var(--color-accent)"
                        : n.level === 1
                          ? "#a1a1aa"
                          : "#52525b"
                    }
                    stroke="var(--color-bg-elevated)"
                    strokeWidth={2}
                  />
                  <text
                    x={compact ? p.x : labelRight ? p.x + r + 4 : p.x - r - 4}
                    y={compact ? p.y + r + 22 : p.y + 4}
                    textAnchor={compact ? "middle" : labelRight ? "start" : "end"}
                    fontSize={compact ? 24 : 12}
                    className="select-none"
                    fill={isCenter ? "#e4e4e7" : "#a1a1aa"}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
