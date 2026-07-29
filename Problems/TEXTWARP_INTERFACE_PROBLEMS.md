# TextWarp Interface Remediation Report

Status: **resolved on 2026-07-26; follow-up reviewed on 2026-07-29**.

This document is the completed acceptance checklist for the TextWarp interface audit. It covers layout, interaction,
navigation, menus, responsive behavior, accessibility, visual feedback, performance safeguards, state restoration, and
UI regression coverage. Monaco language and editor-engine issues remain tracked separately in
`Problems/MONACO_EDITOR_PROBLEMS.md`.

The implementation remains in the shared `scratch-gui` TextWarp surface and preserves the established TextWarp/Scratch
color variables. The workspace now follows a fixed IDE composition: compact application menu, activity bar, contextual
sidebar, editor, resizable stage/inspector, bottom panel, and status bar.

## Completed layout and control organization

- [x] **P1 — Primary tools hidden on compact screens.** Files, Search, Actors, Extensions, Debugging, Documentation, and
  Preferences are stable activity-bar destinations. File actions stay beside the active file; editor-wide commands stay
  in More actions.
- [x] **P1 — Primary controls consumed the mobile viewport.** The former six-button grid was replaced with compact
  file, conversion, and overflow menus. Mobile retains 44px touch targets without adding extra action rows; the sidebar
  becomes a dismissible overlay and the stage starts collapsed, while larger screens can opt into a denser persistent
  interface.
- [x] **P1 — Mixed top-toolbar responsibilities.** The top region now separates active target/file identity, view tabs,
  and open-file actions. Application navigation is reduced to File, Edit, Project, Help, and Settings.
- [x] **P1 — Open-file tabs behaved like a carousel.** Tabs now support reorder by drag, middle-click close, dirty state,
  close buttons, an overflow selector, roving keyboard navigation, and a context menu for close/split actions.
- [x] **P2 — Ambiguous conversion directions.** One primary Convert menu exposes Text to Blocks, Blocks to Text,
  automatic synchronization, and version comparison with explicit synchronization state beside it.

## Completed navigation, panel, and overlay work

- [x] **P1 — Project navigation had no fixed home.** A vertical activity bar opens Files, Search, Actors, Extensions,
  Outline, History, Debugging, Documentation, and Settings without adding horizontal toolbars.
- [x] **P1 — Mobile sidebar visibility was not announced.** Activity buttons use `aria-controls` and `aria-expanded`;
  the sidebar has a stable ID, dialog semantics on narrow layouts, backdrop/Escape close, focus trapping, and return to
  the invoking activity button.
- [x] **P1 — Ambiguous collapsed bottom panel.** A single `activeBottomPanel` plus `bottomPanelCollapsed` model now keeps
  tab selection, content, expansion, and restored state synchronized.
- [x] **P1 — Status row overcrowding.** The status bar now contains only save state, file/cursor, diagnostics,
  synchronization, FPS, and runtime state. Font and layout controls moved to Preferences.
- [x] **P1 — Debugger and Extensions overflow.** Problems, Console, Debugger, Output, and Backpack occupy the bottom
  panel; Extensions moved to the sidebar. Long values scroll inside their own regions.
- [x] **P2 — Inconsistent panel/menu behavior.** Preferences, External Editor, and conflict review use the shared
  non-modal `QuickPanel` primitive. More actions provides outside/Escape close, arrow/Home/End navigation, initial focus,
  and focus restoration.

## Completed file, project, and editor workflows

- [x] **P0 — File commands disconnected from operation state.** The Redux command bridge now carries working, success,
  cancellation, and error states back to File. Busy items are disabled, duplicate operations are blocked, a status
  message remains at the command source, and focus returns to the File trigger.
- [x] **P1 — Open and Import had unclear formats.** File entries now explain editable `.textwarp` projects versus
  compiled Scratch projects while keeping the established command names. Editable actions use the TextWarp operation
  status; compiled imports continue through the Scratch loading/invalid-project feedback flow.
- [x] **P1 — Save feedback disappeared with the menu.** TextWarp Open, Save, and Save As share the same visible
  operation-status surface and detailed editor announcement path. Compiled export continues to use the established
  Scratch saving/success alerts.
- [x] **P1 — External Editor state was not persistent or discoverable.** The primary control reports disconnected,
  connected, synchronized, dirty, imported, or conflict state. External modification timestamps are checked before
  overwrite, with explicit reload and save paths.
- [x] **P1 — Conflict resolution lacked context.** The persistent alert identifies the affected file and conflict count,
  opens side-by-side text/block review, and keeps the selected resolution in the normal source/history workflow.
- [x] **P1 — Active target/file identity was inconsistent.** Toolbar, Files/Actors sidebars, open tabs, actor navigation,
  and split-file selector use the same active target and filename model with selected/current semantics.
- [x] **P1 — Stage and inspector consumed a rigid column.** The stage dock is collapsible and horizontally resizable,
  persists its width in browser storage, and uses a single Compact/Normal/Expanded view selector. The actor inspector
  uses consistent labels, units, and a visibility switch.
- [x] **P1 — Actors and Backdrops were hard-capped to short panels.** Both target tabs now grow with the stage dock,
  retain a 12 rem minimum working height, and keep long actor lists scrollable instead of showing only a narrow strip.

## Completed accessibility and interaction work

- [x] **P1 — Pointer targets did not adapt to input context.** Mobile primary actions, tabs, close buttons, sidebar
  actions, panel tabs, documentation controls, and font controls retain a shared 44px minimum. Desktop defaults to
  36px and the persistent compact option uses 30px controls.
- [x] **P1 — Nested tabs lacked a keyboard contract.** View, open-file, and bottom-panel tabs use roving
  `tabIndex`, Arrow keys, Home/End, stable IDs, `aria-selected`, and associated tab panels.
- [x] **P1 — Async status lacked announcement detail.** Durable visible status is separate from transient live
  announcements; file, compile, analysis, execution, autosave, external synchronization, and failure messages include
  operation context.
- [x] **P2 — Icon-only controls were inconsistent.** Direction, close, collapse, font, insertion, and reset controls use
  one stroke-based SVG icon component with synchronized accessible labels.
- [x] **P2 — Focus was lost after overlays/navigation.** Shared panels restore the invoker, the sidebar returns focus after
  close, file operations return to File, active tabs scroll into view, and navigation updates the appropriate panel.

## Completed visual consistency and localization work

- [x] **P1 — Scratch menus and TextWarp controls used unrelated states.** TextWarp control-height, radius, gap, focus,
  active, disabled, and status rules are centralized while continuing to use the existing theme color variables. Generic
  menu items now expose consistent disabled and keyboard-focus states.
- [x] **P1 — User-facing strings bypassed localization.** Editor, sidebar, debugger, documentation, external-file,
  conflict, history, status, density, menu, and accessibility strings are centralized in the TextWarp English/Portuguese
  catalog. Source extraction passes with unique message IDs.
- [x] **P2 — Long localized labels were untested by layout.** Primary labels wrap safely, tabs and identities provide
  ellipsis plus full accessible text where necessary, and the measured-width browser matrix exercises the complete
  control row down to 320px.

## Completed performance and state work

- [x] **P1 — Large lists rendered without limits.** Files/resources/search/symbol/history, Problems, Console,
  Debugger lists, and Extensions are capped at 100 initial entries with total counts and keyboard-reachable Show More
  pagination.
- [x] **P1 — No layout recovery action.** Preferences includes Reset layout. Sidebar, split, bottom panel, font, and
  interface density values are persisted; numeric values are clamped, resizers support keyboard arrows/Home, and reset
  restores safe defaults.
- [x] **P2 — UI state restoration was inconsistent.** Safe navigation state (view, sidebar visibility/panel, bottom tab,
  and collapse state) is normalized and restored. Ephemeral quick panels and file handles deliberately remain
  session-only so reload never opens an unexpected overlay or stores an unsafe browser handle.

## Completed regression coverage

- [x] **P1 — Tests inspected source but not behavior.** Browser coverage loads the production Monaco build and exercises
  responsive controls, sidebar visibility, dialog semantics, Escape, and focus restoration. Unit tests cover panel
  lifecycle and Redux file-operation state.
- [x] **P1 — Measured-width matrix was incomplete.** The deterministic browser matrix now covers 320, 600, 768, 1024,
  and 1440px, both with and without the sidebar, and with Text + Blocks active. It asserts the single-row view toolbar,
  direct-action count, mobile 44px targets, desktop density, and no root horizontal overflow.
- [x] **P2 — No visual regression baseline.** `test/fixtures/textwarp-interface-layout-baseline.json` is the committed
  deterministic layout baseline; the browser test compares live production DOM measurements against it and checks panel
  boundaries/focus behavior, including the minimum Actors and Backdrops panel heights. Theme colors remain token-driven,
  avoiding a theme-specific duplicated baseline.

## Validation

The resolved checklist is guarded by:

- `npm run test:textwarp`
- `npx jest --runInBand test/unit/reducers/tw-reducer.test.js test/unit/components/textwarp-quick-panel.test.jsx test/unit/components/textwarp-monaco-editor.test.jsx`
- `npm run docs:textwarp:check`
- `npm run i18n:src`
- `npm run build:textwarp:web`
- `CHROMEDRIVER_PATH=/usr/bin/chromedriver npx jest --runInBand test/integration/textwarp-monaco.test.js`
- `git diff --check`
