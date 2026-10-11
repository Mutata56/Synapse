---
version: 1
slug: src-components-workspacechrome-tsx
primary_target: src/components/WorkspaceChrome.tsx
related_targets: [src/components/workspace.css]
---

# Document tabs

Mode: Operate. Scoped refinement of the existing Synapse workspace chrome.

The user requested a more attractive document-tab strip and supplied a current screenshot. Preserve the incumbent palette, surrounding panels, note content, source toolbar, tab destinations, save-before-navigation, reorder, close and overflow actions. The earlier shell arrangement remains evidence; this request supersedes its stretched and centered document-tab treatment.

Direction: compact content-sized tabs anchored at the leading edge of the work area. Use existing tonal surfaces and Lucide icons. A bright active label, violet icon, fine outline and inset underline identify selection; restrained separators and hover/focus disclosure reduce inactive close-button noise. Keep the close slot stable so titles do not jump.

Geometry and type: 36px tab height, 13px labels at weight 500 and line-height 1.4, 15px outline icons, 8px tab corners, 6px gap and a 26px close slot. A tab caps at 280px (240px in the compact viewport), further constrained by the actual strip width. The active tab and its close button must remain visible after selection, reordering, renaming or resizing. Short state transitions respect reduced motion; no entrance, loop, new dependency or background workload is introduced.

Acceptance: inspect desktop and a narrow work area with short, long and many tabs; check arrow navigation, visible keyboard focus, Close, overflow selection, and panel resizing. Available accent palettes retain readable labels. Native verification uses the existing installed application and preserves its newer calendar and all local note files. The source-boundary graph is stale for the workspace files; current owning-worktree source is the implementation authority.
