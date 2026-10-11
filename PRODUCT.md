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

## Calendar Workspace

Calendar combines local planning and dated notes around one selected date, with month, hourly week and monthly list modes. The user requested a complete redesign and optimization on a separate branch and delegated scoped choices. The selected-day plan holds a direct task composer, distinct task/event/note sections and the chosen day's journal. Opening a note uses the existing editor; calendar date, mode, filters and pane choice survive navigation within the current application session.

Tasks keep explicit time/date/repeat/color/tag editing, completion for the selected recurrence occurrence and recovery of the last removed task. Source filters and metadata search narrow the displayed period without rewriting stored entries. Daily notes retain their filename date; other notes use their creation date. Journal mood, writing streak and up to six earlier records from the same day and month use existing note metadata.

Browsing indexes note metadata once per immutable tree revision and caches task/event occurrences for up to four visited ranges per source revision. Month uses 42 date cells, week uses seven days, cell previews are bounded, and each selected-day task/event/note list pages in groups of 20. Browsing does not read Markdown bodies. External iCal reading retains explicit or stale synchronization; CalDAV sending remains a deliberate connection-menu action. The idle calendar uses a midnight timer and a visibility refresh rather than a polling or animation loop.

Calendar inherits the shipped dark semantic palette and Inter family. Narrow work areas replace the canvas with a labeled full-width day plan and transfer keyboard focus after the visible region changes. Local light-token overrides and the synthetic compatibility capture do not introduce a global application light theme. Surface direction and acceptance evidence belong in .impeccable/surfaces/src-components-calendarview-tsx.md.
