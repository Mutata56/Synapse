import type { TreeNode } from "./storage";
const cache = new WeakMap<TreeNode[], Map<string, string>>();
/** Simple rainbow uses each folder's position among its siblings, just as AnuPpuccin. */
export function themeFolderColors(tree: TreeNode[]): Map<string, string> {
  const found = cache.get(tree); if (found) return found;
  const result = new Map<string, string>();
  const stack = [tree];
  while (stack.length) {
    const siblings = stack.pop()!; let index = 0;
    for (const node of siblings) if (node.kind === "folder") {
      result.set(node.path, `var(--folder-tone-${index++ % 12})`); stack.push(node.children);
    }
  }
  cache.set(tree, result); return result;
}
