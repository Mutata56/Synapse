# Shared typography

MODE: Operate for the interface; Read for note content.

USER PIN: use Obsidian's font logic while keeping Synapse's palette and element
placement. The working Obsidian renderer uses Inter with an active26px note base;
the stored appearance file was stale at17px.
The AnuPpuccin style-settings profile selects JetBrains Mono for source
Markdown, Inter for live preview/reading and Inter for headings. The user
explicitly clarified JetBrains Mono for code.

IMPLEMENTATION: four self-hosted variable faces, normal glyphs, semantic
interface/text/code stacks in src/typography.css. Inter normal/italic are
unchanged packaged Obsidian files; JetBrains Mono normal/italic are official
2.304 files. Both families' cmap tables contain the complete Russian and Latin
alphabets. Full SIL OFL notices are included in the built public/fonts folder.

TYPE: interface15px/1.3; files/vault13px, tabs12px; primary note26px/1.5;
heading ratios1.618/1.462/1.318/1.188/1.076/1; code0.875em; raw Markdown26px.
Dense Tags/library/Files previews retain their local13/14px scales. The inline
title follows body zoom; width/font changes schedule one guarded resize frame.

QUALITY BAR: normal Russian/English glyphs, genuine italic, visible heading
steps, fixed-width code, usable narrow readers and200% editor text. Wrapped
note titles must fit their textarea after resizing. No polling or animation
loop is introduced for title measurement. Browser checks use synthetic
in-memory notes; their native-attachment lookup is unavailable in the browser
and is not evidence about the installed native app.

EVIDENCE: font cmap/axis checks and browser computed roles/captures are retained
locally in the calling task's typography artifact directory. TypeScript,
production bundle dependency checks, the repository regression suite and the
native macOS bundle validate the implementation. Original note files are not
part of the source changes or font assets.

CONFIRMATION: browser1280×800 reading showed Inter17px/25.5px, H1 27.506px,
H2 24.854px, genuine Inter italic and JetBrains Mono code14.875px. Both faces
needed by the page were loaded locally. At760×900 the wrapped title's client
and scroll heights both measured148px; at390×844 both measured115px. Editor
zoom200% produced34px prose and55.012px title/heading without page overflow.
No ResizeObserver loop warning appeared. The full suite passed156 tests with
one optional copied-vault case skipped; TypeScript and macOS release build
passed. The final type detector only flagged Inter as a common font: this is
an intentional user-pinned exception, not a reason to replace the chosen face.

COMBINED DELIVERY: merged the latest Settings/module changes from main before
shipping. The combined suite passed170 tests with one optional copied-vault
test skipped. Production startup remained within the existing budget:936322
bytes of library JavaScript and278168 bytes for quick capture; both editors
remain deferred. Only the four intended font files and both licenses appear
in the build. This merge changes no typography selectors or title measurement
logic validated above.

LIVE SCALE CORRECTION: native Obsidian Elements/Computed confirmed26px/39px
prose,42.068px/50.4816px title at700,22.75px/34.125px code,13px/16.9px file labels,
12px/15.6px tabs and15px/19.5px interface body. Synapse browser metrics match
these values. The renderer uses one-time scale-version migration so an old
relative zoom cannot multiply the new base; future manual zoom is retained.
At760px the wrapped title fitted268px with no page overflow. At200% explicit
editor zoom, prose52px and title84.136px fitted without page overflow.
Earlier17px captures above are historical baseline evidence. Inter remains an
explicit user pin despite the generic overused-font detector warning.
