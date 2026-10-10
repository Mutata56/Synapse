import type { GraphColorGroup, GraphNode, GraphOptions } from "./graphTypes";

export type GraphStyle = { colorGroups: GraphColorGroup[]; nodeSize: number; lineWidth: number };
export const DEFAULT_GRAPH_STYLE: GraphStyle = { colorGroups: [], nodeSize: 1, lineWidth: 0.75 };
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function coerceGraphStyle(value: unknown): GraphStyle {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const groups = Array.isArray(raw.colorGroups) ? raw.colorGroups : [];
  const colorGroups: GraphColorGroup[] = [];
  for (const group of groups.slice(0, 24)) {
    if (!group || typeof group !== "object" || typeof group.query !== "string") continue;
    let color = group.color;
    if (color && typeof color === "object" && typeof color.rgb === "number" && Number.isInteger(color.rgb) && color.rgb >= 0 && color.rgb <= 0xffffff) color = `#${color.rgb.toString(16).padStart(6, "0")}`;
    if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) colorGroups.push({ query: group.query.slice(0, 300), color });
  }
  return { colorGroups, nodeSize: bounded(raw.nodeSize ?? raw.nodeSizeMultiplier, 1, 0.4, 3), lineWidth: bounded(raw.lineWidth ?? raw.lineSizeMultiplier, 0.75, 0.2, 3) };
}

/** Read only the supported graph preferences from the copied Obsidian vault. */
export function readObsidianGraphPreferences(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const options: GraphOptions = {
    showTags: raw.showTags === true, showAttachments: raw.showAttachments === true,
    showUnresolved: raw.hideUnresolved !== true, showOrphans: raw.showOrphans !== false,
  };
  return { style: coerceGraphStyle(raw), options,
    repulsion: bounded(raw.repelStrength, 5, 0.1, 20) * 10000,
    centerForce: bounded(raw.centerStrength, 0.5, 0.01, 3) * 0.01,
    linkDistance: bounded(raw.linkDistance, 160, 15, 500),
    linkStrength: bounded(raw.linkStrength, 1, 0.05, 5) * 0.12,
  };
}

/** Color rules use the same useful path/file/tag query vocabulary as Obsidian. */
export function matchesGraphQuery(node: GraphNode, query: string): boolean {
  const alternatives = query.trim().split(/\s+OR\s+/i);
  if (!query.trim()) return false;
  return alternatives.some((alternative) => {
    const terms = [...alternative.matchAll(/(-?)(?:(path|file|tag):)?(?:"((?:\\.|[^"])*)"|([^\s]+))/gi)];
    return terms.length > 0 && terms.every(([, negative, field, quoted, bare]) => {
      const target = (quoted ?? bare ?? "").replace(/\\"/g, '"').toLocaleLowerCase();
      const value = field?.toLowerCase();
      const path = node.path.toLocaleLowerCase();
      const matches = value === "path" ? path.includes(target)
        : value === "file" ? path.split("/").pop()!.includes(target)
          : value === "tag" ? (node.kind === "tag" ? [node.path] : node.note?.tags ?? []).some((tag) => tag.toLocaleLowerCase().replace(/^#/, "") === target.replace(/^#/, ""))
            : `${node.label} ${node.path}`.toLocaleLowerCase().includes(target);
      return negative ? !matches : matches;
    });
  });
}

export function classicNodeColor(node: GraphNode, groups: readonly GraphColorGroup[], fallback = 0x8e91a6): number {
  const matching = groups.find((group) => matchesGraphQuery(node, group.query));
  return matching ? Number.parseInt(matching.color.slice(1), 16) : node.kind === "unresolved" ? 0x7c7c7c : node.kind === "tag" ? 0x7bbba4 : node.kind === "attachment" ? 0xad9875 : fallback;
}

/** Keep low-degree points visible at overview zoom, while hubs remain larger. */
export function classicNodeRadius(degree: number, scale: number, multiplier = 1): number {
  return Math.max(0.75, 11 * scale * multiplier) * (1 + 0.32 * Math.sqrt(degree));
}
