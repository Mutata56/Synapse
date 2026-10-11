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
