import type { GraphBounds, GraphCamera } from "./graphTypes";

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function graphBounds(positions: Float32Array, active: Uint8Array): GraphBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < active.length; i++) {
    if (!active[i]) continue;
    const x = positions[i * 2], y = positions[i * 2 + 1];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
}

export function fitGraph(bounds: GraphBounds, width: number, height: number): GraphCamera {
  const availableWidth = Math.max(60, width - 100), availableHeight = Math.max(60, height - 120);
  const scale = clamp(Math.min(availableWidth / Math.max(80, bounds.maxX - bounds.minX + 40), availableHeight / Math.max(80, bounds.maxY - bounds.minY + 40)), 0.03, 3);
  return { x: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale, y: height / 2 - (bounds.minY + bounds.maxY) / 2 * scale, scale };
}

export function screenToWorld(x: number, y: number, camera: GraphCamera) {
  return { x: (x - camera.x) / camera.scale, y: (y - camera.y) / camera.scale };
}

export function zoomAt(camera: GraphCamera, x: number, y: number, factor: number): GraphCamera {
  const world = screenToWorld(x, y, camera);
  const scale = clamp(camera.scale * factor, 0.03, 6);
  return { x: x - world.x * scale, y: y - world.y * scale, scale };
}

export function clampMinimapPosition(x: number, y: number, width: number, height: number, mapWidth: number, mapHeight: number) {
  return { x: clamp(x, 8, Math.max(8, width - mapWidth - 8)), y: clamp(y, 8, Math.max(8, height - mapHeight - 8)) };
}
