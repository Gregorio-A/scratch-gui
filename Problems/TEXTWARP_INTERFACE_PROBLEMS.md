# TextWarp Interface Remediation Report

Status: **resolved on 2026-07-26**.

This document is the completed acceptance checklist for the TextWarp interface audit. It covers layout, interaction,
navigation, menus, responsive behavior, accessibility, visual feedback, performance safeguards, state restoration, and
UI regression coverage. Monaco language and editor-engine issues remain tracked separately in
`Problems/MONACO_EDITOR_PROBLEMS.md`.

The implementation remains in the shared `scratch-gui` TextWarp surface and preserves the established TextWarp/Scratch
color variables. Run, Stop, and Restart are not interface buttons; execution remains available through Monaco commands
and keyboard shortcuts.

## Completed layout and control organization

- [x] **P1 — Primary tools hidden on compact screens.** The Tools drawer and `toolsOpen` state were removed. Commands,
  Templates, External Editor, Text to Blocks, Blocks to Text, and Projects are always visible in one responsive action
  grid.
- [x] **P1 — Six controls dense at intermediate widths.** Layout mode is calculated from the measured editor width.
  Controls use 6 columns when wide, 3 when condensed/compact, and 2 when narrow. Labels wrap instead of being clipped;
  full names and descriptions are available through `title` and ARIA.
- [x] **P1 — Mixed top-toolbar responsibilities.** The top region now separates active target/file identity, view tabs,
  and the six-action command grid. There are no execution or duplicate panel buttons in the top toolbar.
- [x] **P1 — Open-file tabs without overflow controls.** The tab strip has previous/next scroll buttons, an overflow file
  selector, active-tab auto-scroll, close controls, and roving keyboard navigation.
- [x] **P2 — Ambiguous conversion directions.** Text to Blocks and Blocks to Text use opposite SVG arrows, explicit
  accessible descriptions, and disabled-state explanations.

## Completed navigation, panel, and overlay work

- [x] **P1 — Projects overlay could not be closed directly.** Narrow layouts now provide a backdrop, a labelled sidebar
  close button, Escape handling, and focus return to the Projects control.
- [x] **P1 — Sidebar visibility not announced.** Projects uses `aria-controls` and `aria-expanded`; the sidebar has a
  stable ID, visibility state, selected tabs, and a predictable close/focus target.
- [x] **P1 — Ambiguous collapsed bottom panel.** A single `activeBottomPanel` plus `bottomPanelCollapsed` model now keeps
  tab selection, content, expansion, and restored state synchronized.
- [x] **P1 — Status row overcrowding.** Durable status, panel tabs, runtime details, font controls, and collapse controls
  are separated into responsive rows with horizontal tab access where required.
- [x] **P1 — Debugger and Extensions overflow.** Debugger, inspector, console, and extension content stack at compact
  widths; long values scroll inside their own regions rather than widening the editor.
- [x] **P2 — Inconsistent quick-panel behavior.** Templates, Preferences, External Editor, and conflict review use the
  shared non-modal `QuickPanel` primitive with initial focus, Escape/outside close, scrolling, explicit `aria-modal`,
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
- [x] **P1 — Active target/file identity was inconsistent.** Toolbar, Projects sidebar, open tabs, and dual-file selector
  use the same active target and filename model with selected/current semantics.

## Completed accessibility and interaction work

- [x] **P1 — Pointer targets were too small.** Primary actions, tab controls, close buttons, sidebar actions, panel tabs,
  documentation controls, and font controls use a shared 44px minimum control size.
- [x] **P1 — Nested tabs lacked a keyboard contract.** View, sidebar, open-file, and bottom-panel tabs use roving
  `tabIndex`, Arrow keys, Home/End, stable IDs, `aria-selected`, and associated tab panels.
- [x] **P1 — Async status lacked announcement detail.** Durable visible status is separate from transient live
  announcements; file, compile, analysis, execution, autosave, external synchronization, and failure messages include
  operation context.
- [x] **P2 — Icon-only controls were inconsistent.** Direction, close, collapse, font, insertion, and reset controls use
  one stroke-based SVG icon component with synchronized accessible labels.
- [x] **P2 — Focus was lost after overlays/navigation.** Shared panels restore the invoker, Projects returns focus after
  close, file operations return to File, active tabs scroll into view, and navigation updates the appropriate panel.

## Completed visual consistency and localization work

- [x] **P1 — Scratch menus and TextWarp controls used unrelated states.** TextWarp control-height, radius, gap, focus,
  active, disabled, and status rules are centralized while continuing to use the existing theme color variables. Generic
  menu items now expose consistent disabled and keyboard-focus states.
- [x] **P1 — User-facing strings bypassed localization.** Editor, sidebar, debugger, documentation, external-file,
  conflict, history, status, template, and accessibility strings are centralized in the TextWarp English/Portuguese
  catalog. Source extraction passes with unique message IDs.
- [x] **P2 — Long localized labels were untested by layout.** Primary labels wrap safely, tabs and identities provide
  ellipsis plus full accessible text where necessary, and the measured-width browser matrix exercises the complete
  control row down to 320px.

## Completed performance and state work

- [x] **P1 — Large lists rendered without limits.** Projects modules/resources/search/symbol/history, Problems, Console,
  Debugger lists, and Extensions are capped at 100 initial entries with total counts and keyboard-reachable Show More
  pagination.
- [x] **P1 — No layout recovery action.** Preferences includes Reset layout. Sidebar, split, bottom panel, and font
  values are clamped, resizers support keyboard arrows/Home, and reset restores safe defaults.
- [x] **P2 — UI state restoration was inconsistent.** Safe navigation state (view, sidebar visibility/panel, bottom tab,
  and collapse state) is normalized and restored. Ephemeral quick panels and file handles deliberately remain
  session-only so reload never opens an unexpected overlay or stores an unsafe browser handle.

## Completed regression coverage

- [x] **P1 — Tests inspected source but not behavior.** Browser coverage loads the production Monaco build and exercises
  responsive controls, Projects visibility, dialog semantics, Escape, and focus restoration. Unit tests cover panel
  lifecycle and Redux file-operation state.
- [x] **P1 — Measured-width matrix was incomplete.** The deterministic browser matrix now covers 320, 600, 768, 1024,
  and 1440px, both with and without Projects, and with the dual editor active. It asserts the expected grid, all six
  visible actions, 44px targets, and no root horizontal overflow.
- [x] **P2 — No visual regression baseline.** `test/fixtures/textwarp-interface-layout-baseline.json` is the committed
  deterministic layout baseline; the browser test compares live production DOM measurements against it and checks panel
  boundaries/focus behavior. Theme colors remain token-driven, avoiding a theme-specific duplicated baseline.

## Validation

The resolved checklist is guarded by:

- `npm run test:textwarp`
- `npx jest --runInBand test/unit/reducers/tw-reducer.test.js test/unit/components/textwarp-quick-panel.test.jsx test/unit/components/textwarp-monaco-editor.test.jsx`
- `npm run docs:textwarp:check`
- `npm run i18n:src`
- `npm run build:textwarp:web`
- `CHROMEDRIVER_PATH=/usr/bin/chromedriver npx jest --runInBand test/integration/textwarp-monaco.test.js`
- `git diff --check`
