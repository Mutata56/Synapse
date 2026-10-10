import { graphBounds } from "./graphGeometry";
import type { GraphData } from "./graphTypes";

/** Start from real connectivity, so the first frame already exposes hubs and islands. */
export function seedClassicLayout(data: GraphData, distance: number): Float32Array {
  const positions = new Float32Array(data.nodes.length * 2);
  const seen = new Uint8Array(data.nodes.length);
  const components: number[][] = [];
  const ranked = data.nodes.map((_, index) => index).sort((a, b) => data.nodes[b].degree - data.nodes[a].degree);
  for (const root of ranked) {
    if (seen[root]) continue;
    const members = [root]; seen[root] = 1;
    for (let cursor = 0; cursor < members.length; cursor++) for (const child of data.adjacency[members[cursor]]) {
      if (!seen[child]) { seen[child] = 1; members.push(child); }
    }
    components.push(members);
  }
  components.sort((a, b) => b.length - a.length);
  seen.fill(0);
  let mainRadius = 0;
  for (let component = 0; component < components.length; component++) {
    const members = components[component], root = members[0];
    const queue: Array<{ index: number; heading: number }> = [{ index: root, heading: hashAngle(data.nodes[root].key) }];
    seen[root] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { index, heading } = queue[cursor];
      const children = data.adjacency[index].filter((child) => !seen[child]);
      const span = cursor === 0 ? Math.PI * 2 : Math.PI * 1.75;
      const radius = distance * (1 + Math.sqrt(children.length) * 0.10);
      for (let child = 0; child < children.length; child++) {
        const next = children[child]; if (seen[next]) continue;
        seen[next] = 1;
        const angle = heading - span / 2 + (child + 0.5) / children.length * span;
        positions[next * 2] = positions[index * 2] + Math.cos(angle) * radius;
        positions[next * 2 + 1] = positions[index * 2 + 1] + Math.sin(angle) * radius;
        queue.push({ index: next, heading: angle });
      }
    }
    const local = new Float32Array(members.flatMap((index) => [positions[index * 2], positions[index * 2 + 1]]));
    const bounds = graphBounds(local, new Uint8Array(members.length).fill(1));
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    const radius = Math.max(distance / 3, (bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2);
    if (component === 0) mainRadius = radius;
    const angle = component * 2.39996323;
    const offset = component === 0 ? 0 : mainRadius + radius + distance * (1 + Math.sqrt(component));
    for (const index of members) {
      positions[index * 2] += Math.cos(angle) * offset - cx;
      positions[index * 2 + 1] += Math.sin(angle) * offset - cy;
    }
  }
  return positions;
}

function hashAngle(key: string) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff * Math.PI * 2;
}
