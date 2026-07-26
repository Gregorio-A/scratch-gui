# Current TextWarp Interface Problem Backlog

Status: **open audit for a future fixing agent**.

This document tracks current interface problems in the TextWarp editor. It is separate from
`MONACO_EDITOR_PROBLEMS.md`: this file covers layout, interaction, navigation, menus, responsive behavior,
accessibility, visual feedback, and UI integration. Every fix should preserve the existing TextWarp colors, labels,
project behavior, and shared `scratch-gui` ownership.

## Priority guide

- **P0** — blocks a primary workflow, hides an important action, or can cause accidental data loss.
- **P1** — materially harms discoverability, navigation, responsive behavior, or accessibility.
- **P2** — polish, consistency, performance, or missing regression coverage.

## Layout and control organization

### P1 — Tools are hidden by default on compact screens

At widths below the editor's compact breakpoint, the action drawer receives `drawerClosed` unless `toolsOpen` is true
(`src/containers/textwarp-editor.jsx:1990-1993`). The user must first find and open `Tools` before seeing Commands,
Templates, External Editor, Text to Blocks, Blocks to Text, and Projects.

Required fix: keep the requested control group discoverable on compact screens, or provide a clear persistent affordance
with an explicit open state, keyboard shortcut, focus movement, and accessible expanded/collapsed semantics.

### P1 — Six primary controls still become visually dense at intermediate widths

The large layout uses six equal grid columns (`text-editor.css:129-153`) and truncates button labels with ellipsis.
The compact layout changes to three columns and the narrow layout to two (`text-editor.css:1057-1099`), but there is no
content-aware breakpoint or tooltip/accessible name for truncated labels.

Required fix: test the actual available editor width, not only viewport width; preserve readable labels, expose full
labels through `title`/ARIA, and choose breakpoints based on measured control width.

### P1 — The top toolbar still mixes identity, view modes, and utility navigation

The toolbar contains the target identity, five view-mode tabs, and the Tools toggle (`textwarp-editor.jsx:1930-1990`).
The identity, Code/Blocks/Split/Dual/Documentation navigation, and utility controls have different jobs but share one
visual row and compete for width.

Required fix: establish clear regions for target identity, view navigation, and utilities; define the priority and
collapse behavior at each width; add visual tests for 320px, 600px, 1024px, and 1440px.

### P1 — Open file tabs consume a full extra row without clear overflow behavior

`openTabs` is always rendered below the action drawer (`textwarp-editor.jsx:2064-2085`). Each tab has a minimum width of
7rem and a maximum width of 13rem (`text-editor.css:195-220`). Long file names are truncated and the tab strip has no
visible overflow affordance, tab menu, or indication of hidden files.

Required fix: provide a tab overflow menu or scroll controls, preserve active-tab visibility after opening/switching,
and test many files, long names, close buttons, keyboard navigation, and narrow widths.

### P2 — Conversion direction is represented only by text arrows

Text to Blocks and Blocks to Text use literal arrow characters in their labels. The direction is not exposed as a
separate icon/accessible description, and the disabled state gives no reason when there is no active target or a
conversion is busy.

Required fix: use consistent directional icons or explicit accessible labels and explain disabled states through tooltip
or status text.

## Navigation, panels, and overlays

### P1 — The Projects sidebar has no explicit close control in overlay mode

On narrow layouts the sidebar becomes an overlay (`ide-sidebar.css:13-24`), but `IdeSidebar` renders no close button and
there is no outside-click or Escape handler (`ide-sidebar.jsx:20-45`). The user must rediscover the Projects control to
close the overlay, and the overlay can obscure the editor.

Required fix: add a labelled close button, Escape handling, outside-click behavior where safe, focus trapping/return, and
an overlay backdrop.

### P1 — Sidebar active state and overlay state are not announced consistently

Sidebar tabs set `aria-selected`, but the sidebar visibility toggle is a generic button and does not expose
`aria-expanded`/`aria-controls` (`textwarp-editor.jsx:1982-1987`). The overlay itself does not announce when it opens or
closes.

Required fix: connect toggle and sidebar IDs with `aria-expanded`, `aria-controls`, and a predictable focus target.

### P1 — Bottom-panel state is ambiguous when collapsed

The Problems tab is considered active whenever Debugger, Console, and Extensions are closed, even when the panel itself is
collapsed (`textwarp-editor.jsx:2353-2378`). The collapse button changes only height, so the selected content and the
collapsed state are not communicated together.

Required fix: expose a panel state model (`activePanel`, `collapsed`), add selected/expanded semantics, and keep the
active tab and panel contents synchronized after collapse/expand.

### P1 — Bottom-panel controls compete for a single status row

Status text, four panel tabs, font controls, runtime summary, and collapse are all siblings in `statusRow`
(`textwarp-editor.jsx:2350-2406`). At narrow widths the font slider disappears, but the status, tabs, runtime summary,
and collapse button still compete and can become cramped or truncated.

Required fix: make the status row responsive with explicit priority, move secondary metadata to a details area, and
preserve reachable panel tabs at all supported widths.

### P1 — Debugger and extension panels are not responsive enough

The debugger uses fixed minimum grid tracks of 18rem and 22rem (`text-editor.css:743-748`), and extension entries use a
four-column grid with a minimum 10rem track (`text-editor.css:649-660`). These minimums can force horizontal overflow in
small panels and leave controls inaccessible.

Required fix: collapse debugger columns and extension metadata into stacked rows at narrow widths; test long names,
large watch values, runtime errors, extension XML, and keyboard access.

### P2 — Quick panels do not have a common modal/overlay contract

Templates, Preferences, and External Editor render as `role="dialog"` quick panels, but there is no shared focus trap,
Escape-to-close behavior, initial focus policy, or `aria-modal` contract (`textwarp-editor.jsx:2088-2151`). Each panel has
different close behavior and can remain visually attached to a control after the layout changes.

Required fix: create a shared non-modal popover or modal primitive with focus management, Escape handling, placement,
scrolling, and consistent close semantics.

## File, project, and editor workflow problems

### P0 — File menu actions and editor state can become disconnected

File menu commands are dispatched through the Redux UI-command bridge, then interpreted by the editor container. There is
no visible pending/error state in the File menu while Open/Save/Save As is running, and repeated commands are only
identified internally by an incrementing command ID.

Required fix: expose disabled/busy state and failure feedback at the command source, prevent duplicate operations, and
return focus to the invoking menu item after completion or cancellation.

### P1 — Import Project and Open `.textwarp` have different interaction models

Open `.textwarp` uses the native file picker with an input fallback, while Import Project uses the existing Scratch file
upload callback (`src/components/menu-bar/menu-bar.jsx:645-706`). The menus do not clearly explain that one loads an
editable TextWarp project and the other loads a compiled Scratch project.

Required fix: clarify scope and file types in labels/help text, unify progress/error feedback, and show the resulting
project state after either import path.

### P1 — Save feedback is not consistently visible where the action occurs

Save operations update editor status text, but the File menu closes immediately and does not show whether the operation is
complete, cancelled, or failed. Native picker errors and browser capability fallback are also surfaced only in the editor
status area.

Required fix: use a shared operation-status surface (menu item state, toast/status region, or dialog) with success,
failure, cancellation, and retry actions.

### P1 — External Editor workflow is hard to discover after connection

The External Editor button opens a quick panel with Connect, Save source, Reload file, and Close
(`textwarp-editor.jsx:2140-2151`). The connected filename/handle state is not reflected on the primary button, and the
user has no persistent indicator that external changes are pending.

Required fix: show connected/disconnected/synchronized states on the control, warn before overwriting external changes,
and provide a clear conflict/reload path.

### P1 — Conflict resolution is too easy to miss

The conflict banner is rendered above the workspace (`textwarp-editor.jsx:2153-2165`) and offers Keep text/Use blocks,
but it has no close/dismiss action, no explanation of which target/unit conflicts, and no route to inspect the differing
versions.

Required fix: identify the affected target/unit, provide a diff or review action, make the decision persistent, and keep
the banner accessible until resolved.

### P1 — Target/file identity is repeated but not always actionable

The toolbar shows target name and filename, while the sidebar, open tabs, dual-editor selector, and Project resources
repeat related identity information. There is no single consistent active-target indicator across all views, especially
when the sidebar is hidden or the dual editor is open.

Required fix: define one active-target model and use consistent label, selected state, and navigation behavior in the
toolbar, sidebar, tabs, and dual editor.

## Accessibility and interaction quality

### P1 — Small controls do not meet a reliable touch target

Many controls use 0.58–0.7rem padding and 0.62–0.68rem text (`text-editor.css` throughout). The interface has no
automated 44px-equivalent target check for the TextWarp controls, sidebar actions, panel tabs, close buttons, or font
controls.

Required fix: establish minimum pointer targets, preserve compact visual density with hit-area wrappers, and add browser
checks for keyboard and touch-sized interaction targets.

### P1 — Keyboard navigation is not defined across nested tab systems

The TextWarp view tabs, sidebar tabs, open file tabs, bottom panel tabs, and Monaco editor all expose tab-like controls,
but there is no documented roving-tabindex/Arrow-key behavior or test that focus moves between nested systems without
getting trapped.

Required fix: implement consistent WAI-ARIA tab behavior where appropriate, avoid using `role="tab"` for non-tab
navigation, and add keyboard-only regression tests.

### P1 — Status and asynchronous operations are not announced with enough detail

The editor has one `role="status"` live region (`textwarp-editor.jsx:2352`), but loading, analysis, compilation,
autosave, external-file synchronization, and failures reuse short status strings. Important changes can be overwritten
before assistive technology announces them.

Required fix: separate durable status from transient announcements, use appropriate live-region politeness, and include
operation/action context in messages.

### P2 — Icon-only controls rely on symbols with inconsistent meaning

Collapse, close, font controls, breakpoint glyphs, and resource insertion use characters such as `⌃`, `⌄`, `×`, `−`,
`＋`, and `＋` without a shared icon system. Some have ARIA labels, but visual meaning and focus styling are not
consistent.

Required fix: use the existing icon conventions or a documented TextWarp icon set, keep labels synchronized with state,
and test dark/light themes and high contrast.

### P2 — Focus is not restored after navigation or overlays close

Opening a template/preferences/external panel, selecting a diagnostic, opening a file location, or closing a sidebar can
leave focus on a removed element or in the wrong editor pane.

Required fix: record the invoking element, restore focus after close/navigation, and announce the new location/panel.

## Visual consistency and localization

### P1 — TextWarp and Scratch menu conventions are mixed

The File and Advanced menus use Scratch menu components and icons, while the editor uses custom small text buttons and
literal symbols. The contrast, spacing, hover states, and disabled states are not governed by one TextWarp design token
layer.

Required fix: define shared interface tokens/components for menu items, editor controls, tabs, dialogs, statuses, and
disabled/active states without changing the established brand colors.

### P1 — Several interface strings are still assembled outside the translation catalog

The editor directly builds strings such as `Runtime ...`, `Run action`, `Outline of`, `TextWarp 0.3`, and parts of
diagnostic/help labels (`textwarp-editor.jsx`, `ide-sidebar.jsx`, and panel renderers). Portuguese and English coverage
is therefore inconsistent, and other locales fall back unevenly.

Required fix: move all user-visible interface text into the TextWarp message catalog, including dynamic labels and
accessibility text, then run source extraction without duplicate IDs.

### P2 — Long localized labels are not layout-tested

The grid, tabs, sidebar headings, diagnostics, menu items, and quick panels assume short English labels. German,
Portuguese, and other locales can overflow, truncate essential actions, or make buttons indistinguishable.

Required fix: test every supported locale at 320px, 600px, 1024px, and 1440px; allow wrapping where safe and use
accessible full labels when visual truncation is necessary.

## Performance and state consistency

### P1 — Large panels render all entries without virtualization

The sidebar renders every module/resource/history/search result, the Problems panel renders diagnostics, the Console
renders all entries, and Extensions renders the full catalog. Large projects can make panel opening and scrolling
expensive.

Required fix: cap or virtualize long lists, preserve keyboard navigation, and show counts plus filtering/pagination.

### P1 — Resize state has no visible reset or layout recovery action

Sidebar width, split ratio, bottom-panel height, and font size are persisted in preferences. A bad stored value or an
extreme drag can make a pane unusable, but the UI exposes no reset-layout action near the affected controls.

Required fix: add Reset layout to Preferences, clamp values visibly, and provide a keyboard-accessible resize/reset path.

### P2 — Panel state is not persisted consistently

The editor persists some layout/font preferences but does not clearly persist or restore the active view mode, active
sidebar panel, open files, bottom panel tab, or open quick panel. Reloading can return the user to a different context
than the one they were working in.

Required fix: define which UI state is session state versus project state, persist only safe state, and restore it without
opening unexpected overlays.

## Test and validation gaps

### P1 — Existing UI tests inspect source structure more than rendered behavior

`test/textwarp/ui-integration.test.js` checks JSX ordering and labels, but does not render the editor or verify focus,
overflow, overlay closing, menu keyboard behavior, panel resizing, or state restoration.

Required fix: add browser-level interface tests for the critical workflows and retain source tests only for structural
invariants.

### P1 — Responsive coverage does not cover the editor's measured width matrix

The editor computes `compactLayout` and `narrowLayout` from its own effective width, not just the browser viewport. Tests
must cover the editor embedded beside the stage/sidebar as well as full-page desktop and mobile views.

Required fix: use real browser screenshots/DOM measurements at 320px, 600px, 768px, 1024px, and 1440px, with and
without the Projects sidebar and dual editor.

### P2 — No visual regression baseline exists for the redesigned controls

The latest control organization has no committed screenshot baseline for toolbar, action drawer, open tabs, bottom
panels, sidebar overlay, menus, or quick panels.

Required fix: establish a small deterministic visual smoke suite that checks no overflow, visible labels, focus rings,
panel boundaries, and dark/light theme rendering.

## Suggested fixing order

1. Fix overlay closing/focus, panel state semantics, and hidden/overcrowded primary controls (P0/P1).
2. Fix target/file identity, file-operation feedback, conflict resolution, and external-editor states (P0/P1).
3. Establish responsive and accessibility primitives for tabs, dialogs, buttons, status, and resizing (P1).
4. Centralize localization/design tokens and handle long labels/locales (P1/P2).
5. Add rendered browser tests, visual baselines, list virtualization, and layout persistence rules (P1/P2).

Each completed item should update this document, add a regression test, run the relevant UI/browser checks, and finish with
`git diff --check`.
