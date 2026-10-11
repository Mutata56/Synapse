# Synapse

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Desktop application using Tauri 2, Rust, React, TypeScript and Vite. The interface is HTML/CSS in a native webview; it uses Zustand, BlockNote and Pixi.js.

## Users

The current user keeps personal study and warehouse software notes, including an imported Obsidian vault, and wants a local alternative to Obsidian.

## Product Purpose

Read, edit, organize and connect local notes without depending on a cloud service. Fast, predictable interaction and preservation of the user's content are primary requirements.

## Operating Context

The application runs offline on desktop. Notes are ordinary Markdown files. Existing users also work with folders, links, graphs, tags, a calendar and an embedded board.

## Capabilities and Constraints

- Preserve the existing local files and lossless imported Markdown workflow.
- The Tags view's confirmed primary job is to find notes by one or several tags, with convenient hierarchy.
- Existing navigation from a tag in the editor or overview must open the Tags view with that tag selected.
- The user requested a complete Tags redesign and performance optimization, with a visual mockup approved before implementation.
- Mass renaming, merging or rewriting tags in note files is outside this confirmed task.
- Preserve the surrounding application's behavior and its existing React/Tauri architecture.

## Evidence on Hand

The current metadata cache contains 530 notes, 173 distinct tags and 1660 tag memberships. Repository components and CSS provide the incumbent visual implementation. Synthetic nested tags may illustrate hierarchy in mockups; they must not be presented as imported user data.

## Product Principles

- Preserve source content and make state changes explicit.
- Keep finding and opening a note fast as the vault grows.
- Prefer local indexes and bounded rendering over repeated full scans and unnecessary background work.
- Use familiar keyboard, search, filtering and navigation controls.

## Accessibility and Inclusion

Support keyboard navigation, visible focus, meaningful labels, empty states, and the existing Russian/English interface translation mechanism.

## All Notes Library

The user requested a complete rethink, redesign and optimization of All Notes. They prioritize visual browsing with large cards and meaningful grouping. They asked for a separate branch and authorized Codex to choose the composition and finish while they sleep. The library preserves local source content, ordinary note opening, favorites and recoverable bulk actions. It adds metadata search, filters, sorting, grouped shelves and bounded quick reading. Large libraries must mount only nearby cards, defer cover work until visible and preserve browsing context across editor navigation.

## Files and Trash Workspace

Files is the local vault-management workspace: navigate folders, search metadata, select notes and folders, create or rename items, and move or trash a batch. Trash remains a separate navigation item with the same browser and selection model, exposing restore and explicitly confirmed permanent deletion. The user delegated scoped application decisions and the final composition while asleep.

Browsing must preserve source content and avoid reading Markdown bodies. A shared in-memory folder index and bounded mounted rows keep list work predictable as the vault grows. Quick look is explicit, read-only and bounded; the full note opens through the existing editor. Moves preserve typed file/folder identities, unknown frontmatter, source-mode state and attachments inside moved folders. Batch moves use one final refresh and one composite undo entry for successful work. Permanent deletion is irreversible and requires an explicit confirmation.

## Settings and Modularity

Settings is the control center for choosing which Synapse features are available. The user requested a complete Settings redesign and independent switches for each left-menu entry and its functionality, including separate graph renderers and extras. This is an Operate surface within the established Synapse design system. Its composition and scoped visual roles are recorded in `.impeccable/surfaces/src-components-settingsview-tsx.md`.

There are 17 optional module flags. The confirmed default and Minimal preset enable All Notes, Files, Search and New note only; the All modules preset enables every flag. Disabling a module removes its navigation entry and blocks its view routes, commands and associated panels. Existing note editing and Settings remain reachable even when every optional module is disabled. The New tab flag also controls creating additional tabs while preserving existing tabs. Disabling Canvas or Database preserves existing rich-block properties and shows a module-disabled placeholder without mounting that module's tools. Disabling a feature preserves its vault data.

Graph configuration independently controls Volume, Obsidian, minimap, node breathing and local graph. Obsidian is configured by default; the other graph options are off, and the graph module itself is outside the minimal default. At least one renderer remains configured; the whole graph module can be disabled. Node breathing is available with Volume. Module and graph choices, animations and other AppSettings use the existing `notes/.settings.json`; language keeps the existing i18n storage mechanism. Older or invalid fields fall back individually to safe values. Complete settings writes are serialized, and a failed write leaves the active configuration at its last successful value with an explicit error state.

Settings temporarily uses the full workspace width by hiding the file and context panes while retaining their saved visibility. Opening it flushes pending rich-block state before the enclosing document, preserving rapid board edits across navigation. Settings provides category navigation, search, automatic-save feedback and a recovery path to enable disabled features. Its synthetic preview notes and captures are verification fixtures, not imported user content.
