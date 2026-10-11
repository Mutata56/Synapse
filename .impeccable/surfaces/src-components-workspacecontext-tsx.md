---
version: 1
slug: src-components-workspacecontext-tsx
primary_target: src/components/WorkspaceContext.tsx
related_targets: [src/components/LocalGraph.tsx, src/components/workspace.css, src/store/workspace.ts]
---

# Resizable note context

Mode: Operate. The user requested a local graph alongside Outline and Backlinks in the right pane, and a draggable width. Preserve current workspace typography and semantic colors.

The three tab buttons choose one visible region. The pane's left-edge separator supports pointer drag, keyboard arrows and double-click/Home reset. Width and selected pane persist as UI preferences, never document destinations or bodies. Docked width leaves a usable center; the existing narrow overlay behavior remains.

The local graph reuses the metadata adjacency/BFS model and a bounded static SVG, avoiding an extra animation or GPU loop. It renders only while its region is selected. Node labels stay in a full-width HTML caption on hover/focus rather than colliding in the small canvas. Click/Enter/Space opens the connected note through existing save-aware navigation. The one/two-hop controls, pan/zoom and global-graph link remain explicit. No-links and no-note states explain recovery.

The existing optional local graph under the editor stays controlled by its editor feature preference. The new graph is an explicit view inside the optional Context module; module disabling still removes that whole pane.
