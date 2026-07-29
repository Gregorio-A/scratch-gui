# Monaco Navigation and Editor UX Problem Backlog

Status: **active backlog created on 2026-07-29; first remediation batch implemented locally**.

This document covers user-facing navigation, keyboard shortcuts, focus behavior, split-editor ownership, menus,
mobile access, and daily editing quality of life in the current TextWarp Monaco interface.

Compiler, parser, symbol-resolution, provider, model-lifecycle, and diagnostic-correctness defects remain tracked in
[`MONACO_EDITOR_PROBLEMS.md`](./MONACO_EDITOR_PROBLEMS.md). In particular, its P0 items for wrong same-name symbol
resolution and cross-editor model namespaces must be fixed together with the navigation work below. This report does
not repeat those engine findings.

## Implemented in the first remediation batch

The following repository-owned items from this audit are now implemented and covered by targeted tests:

- TextWarp's capture-phase shortcuts are inert while the editor is hidden, outside its root, or an ordinary form
  control owns focus;
- dual-editor command palette, formatting, Problems navigation, and breakpoint commands follow the focused pane;
- only the glyph margin toggles breakpoints; line numbers retain normal Monaco caret/selection behavior;
- `Ctrl+P` and **More actions → Quick Open** filter project actors and the stage;
- `Ctrl+Left`/`Ctrl+Right` and their Shift selection variants remain owned by Monaco and native text fields instead
  of being captured by the block-workspace navigation history;
- `F8`/`Shift+F8` navigate Problems and `F9` toggles a breakpoint at the caret;
- file-tab context menus support pointer, Menu key, and `Shift+F10`, focus the first enabled item, skip disabled and
  checkbox items correctly, and restore focus on Escape;
- shortcut preferences use a draft/apply workflow, reject duplicate values before applying, and allow an empty field
  to disable an action;
- resetting shortcuts no longer resets the editor font size.

The cross-file navigation service/history, stable ambiguous-resource chooser, complete keybinding registry, and
end-to-end browser coverage remain open because they require broader architectural work than this focused batch.

## Priority guide

- **P0** — can execute, edit, or navigate the wrong target, or intercept commands outside the visible editor.
- **P1** — breaks an important keyboard, focus, mobile, split-view, or navigation workflow.
- **P2** — significant quality-of-life, discoverability, consistency, or coverage gap.

## Executive summary

The current interface has useful foundations: Monaco's command palette and language providers, open-file tabs,
project search, Outline, Problems, breakpoint decorations, responsive sidebars, and primary/secondary editors.
However, those pieces do not yet share one navigation and command-routing model.

The highest-risk current problems are:

1. TextWarp installs capture-phase document shortcuts while it is mounted but hidden.
2. toolbar commands always operate on the primary editor, even when the secondary editor was last active;
3. clicking a line number toggles a breakpoint;
4. split-view navigation and commands are isolated by editor instance;
5. shortcut editing and conflict handling do not reliably describe the binding that will actually run.

The intended architecture should have one workspace navigation service, one active-editor concept, one keybinding
registry, and UI actions which route through those services instead of addressing the primary Monaco instance
directly.

## Command routing and navigation correctness

### P0 — Hidden TextWarp captures document-wide shortcuts

`TextWarpEditor` remains mounted in the Blocks tab and receives `isVisible={blocksTabVisible}`
(`src/components/gui/gui.jsx:594-603`). The container nevertheless installs a capture-phase
`document.addEventListener('keydown', ..., true)` unconditionally (`src/containers/textwarp-editor.jsx:325-378`).
`handleKeyDown()` does not check `this.props.isVisible`, whether focus is inside the TextWarp root, or whether the
event target is an editable control (`textwarp-editor.jsx:1418-1533`).

Consequences:

- F5 can run a TextWarp project while the Costumes or Sounds tab is active;
- Ctrl/Cmd+S can invoke TextWarp save while another Scratch control owns focus;
- Ctrl/Cmd+B, Ctrl/Cmd+J, Ctrl/Cmd+Shift+E/F/P, and font shortcuts can mutate a hidden editor layout;
- shortcut handling can override browser or Scratch behavior before the intended target receives the event;
- F5 and editor commands also run while a Preferences, search, replace, or external-editor input owns focus.

Required fix:

- return immediately when TextWarp is not visible;
- scope editor-only bindings to focus inside `rootElement` or an explicit TextWarp command context;
- define which project-level commands may run while a non-editor TextWarp control has focus;
- never consume ordinary editing shortcuts from `input`, `textarea`, `select`, or content-editable controls unless a
  documented binding is explicitly valid there;
- add browser tests which press every global binding in TextWarp, Blocks, Costumes, Sounds, Preferences, Search, and a
  modal input.

Acceptance criteria: the event is consumed only in its declared context, and hiding TextWarp makes its shortcut handler
observably inert.

### P0 — Toolbar commands can edit the wrong pane in dual view

The container stores `monacoEditor` and `secondaryMonacoEditor`, but it has no active/last-focused editor state.
`handleMobileCommands()`, Ctrl/Cmd+Shift+P, and More actions → Format document always call `monacoEditor`
(`textwarp-editor.jsx:996-999`, `1480-1483`, and `3555-3561`). Formatting can therefore modify the primary file after
the user was editing the secondary file.

The secondary editor also omits `onRunSelection`, while the primary editor receives it
(`textwarp-editor.jsx:3903-3981`). The same configured action is consequently present in one pane and absent from the
other.

Required fix: track the last-focused pane, expose a common editor-command adapter, and route palette, format, run
selection, navigation, diagnostics, and breakpoint commands to that pane. Show a visible focus treatment and announce
the active file/pane to assistive technology.

Acceptance criteria: every command invoked after focusing the secondary pane operates on the secondary file unless its
label explicitly names another target.

### P0 — Cross-file navigation is split between incompatible routes

Monaco definitions/references use `registerEditorOpener()`, which only accepts models owned by the current editor
instance (`src/components/textwarp-editor/monaco-editor.jsx:448-467`). Sidebar and Problems navigation instead use the
container's `openLocation()` (`src/containers/textwarp-editor.jsx:1581-1593`). Resource Ctrl/Cmd-click uses a third path,
`getResourceAt()` plus `openResource()`, which changes the target but does not reveal a declaration
(`monaco-editor.jsx:127-139`, `textwarp-editor.jsx:1595-1610`).

This is also tracked as a model/provider P0 in `MONACO_EDITOR_PROBLEMS.md`; the UX requirement is that all entry points
produce the same target, pane, selection, focus, and history behavior.

Required fix: introduce a workspace-level `openLocation({targetId, range, preferredPane, origin})` service used by
Monaco providers, Ctrl/Cmd-click, Outline, Search, Problems, Explorer, and resource links. Reject ambiguous locations
with a chooser rather than silently selecting the first match.

### P1 — Resource navigation silently selects the first same-name resource

`navigateResourceByName()` uses `workspace.resources.find(item => item.name === name)`
(`textwarp-editor.jsx:1608-1610`). Projects can contain same-name variables, lists, costumes, sounds, or broadcasts
owned by different targets.

Required fix: navigate by stable resource identity and owner, not display name. If a legacy call only supplies a name,
show a compact target chooser containing kind, owner, and friendly name.

### P1 — Navigation has no back/forward history

Definition, reference, Problems, Search, Outline, Explorer, and resource jumps replace the current location without
recording where the user came from. There is no Alt+Left/Alt+Right or equivalent Go Back/Go Forward action, and open
file tabs are not a substitute for cursor-location history.

Required fix: keep a bounded workspace navigation stack containing target, pane, model, selection, and scroll anchor.
Deduplicate adjacent cursor-only moves, invalidate deleted targets safely, and expose Back/Forward in both the command
palette and keyboard settings.

### P1 — Pending cross-target jumps are a single unversioned slot

`openLocation()` assigns one mutable `pendingLocation`, switches the VM target, and retries the location after the
target source loads (`textwarp-editor.jsx:1581-1592`, `1938-1945`). A second asynchronous jump can overwrite the first;
there is no request ID, cancellation, timeout, or failure feedback.

Required fix: version navigation requests and complete or cancel each request explicitly. A stale target load must not
steal focus from a newer jump, and a missing target must produce a visible status without leaving pending state behind.

### P1 — Line-number clicks unexpectedly toggle breakpoints

The Monaco mouse handler treats both `GUTTER_GLYPH_MARGIN` and `GUTTER_LINE_NUMBERS` as breakpoint targets
(`src/components/textwarp-editor/monaco-editor.jsx:120-125`). Clicking a line number therefore changes debugger state
instead of behaving like a normal line-number interaction.

Required fix: limit pointer breakpoint toggling to the glyph margin or a dedicated breakpoint control. Preserve normal
Monaco line-number selection and navigation. Add Toggle Breakpoint to the command palette and context menu with a
documented keyboard binding so the operation is not pointer-only.

### P2 — Navigating from sidebars unnecessarily forces the single code view

`openLocation()` always calls `setViewMode('code')` (`textwarp-editor.jsx:1588`). A Search, Outline, or Problems click
therefore exits dual view instead of revealing the location in the most appropriate existing pane.

Required fix: preserve dual view where possible, route to an already-open target pane, and only change view mode when no
visible editor can display the requested target. The origin should be able to request primary, secondary, or
last-focused behavior.

## Keyboard shortcut UX

### P1 — Shortcut preferences save incomplete text before validation

Preferences renders plain controlled text inputs and saves on every `onChange`
(`textwarp-editor.jsx:3645-3666`). Typing `Ctrl+Enter` temporarily stores `C`, `Ct`, and other invalid intermediate
values. Validation happens later inside Monaco action registration, with only a general status error. The field has no
inline validity state, normalized preview, or explanation of the binding that remains active.

Required fix:

- use a keybinding recorder or a draft field with Apply/Cancel;
- validate before persistence;
- show an inline localized error and the effective fallback;
- expose an accessible description and error relationship;
- do not rebuild Monaco actions for every character typed.

### P1 — Conflict handling checks only six TextWarp actions

`registerActions()` compares custom TextWarp actions only with one another
(`src/components/textwarp-editor/monaco-editor.jsx:347-435`). It does not inspect Monaco built-ins, the container's
hard-coded document bindings, Scratch shortcuts, browser bindings, or operating-system reservations.

The defaults themselves have common conflicts:

- Ctrl/Cmd+Shift+I is commonly developer tools;
- Ctrl/Cmd+Plus, Minus, and 0 are browser zoom;
- F5 is browser refresh and is also separately hard-coded as TextWarp Run;
- Ctrl/Cmd+B and Ctrl/Cmd+J have browser/editor meanings depending on platform.

If two custom actions collide, both are reset to their defaults. A second default collision can remain because the loop
stops once no binding changes.

Required fix: build one keybinding registry with contexts, precedence, normalized display labels, reserved-binding
warnings, and deterministic conflict resolution. Conflicts must identify both commands and offer Change, Keep, or
Restore Default rather than silently changing bindings.

### P1 — The customizable and hard-coded shortcut sets disagree

Preferences exposes only compile, run, run selection, stop, restart, and format
(`textwarp-editor.jsx:91-105`, `3645-3666`). The container independently hard-codes run/stop F5, command palette,
sidebar, panel, font, Explorer, Search, and Save (`textwarp-editor.jsx:1418-1533`).

Users cannot discover, change, or disable the second group. F5 Run remains active even if Run is changed in
Preferences.

Required fix: register every TextWarp shortcut through one service and show all commands in a searchable keybinding
table. Command context and whether a binding is editable must be explicit.

### P2 — A shortcut cannot be intentionally unbound

An empty value is parsed as invalid and silently returns the fallback, while `onInvalid` is called only for a non-empty
value (`src/lib/textwarp/shortcut-service.js:46-84`). Clearing a field therefore restores the default instead of
disabling the command.

Required fix: distinguish unset, disabled, invalid, and explicit default states. Provide a Remove Binding action and
persist it without converting it back to the default.

### P2 — The shortcut syntax is limited and platform presentation is inaccurate

The parser accepts one non-modifier key and cannot represent chords such as Ctrl/Cmd+K followed by Ctrl/Cmd+S, or
multiple alternative bindings (`shortcut-service.js:46-84`). `Ctrl`, `Cmd`, `Command`, `Meta`, and `Mod` all map to
Monaco `CtrlCmd`, but the UI stores and displays raw user text rather than a platform-correct label.

More actions always displays `Ctrl+Shift+P`, including on macOS, and does not display the configured Format binding
(`textwarp-editor.jsx:3555-3561`).

Required fix: store a normalized platform-neutral representation, render Ctrl/Command/Option appropriately, and
support either chords or an explicit documented single-stroke limitation. Menu labels must come from the effective
keybinding registry.

### P2 — Reset shortcuts also resets font size

The Reset defaults button inside the shortcut preference list resets `fontSize` as a side effect
(`textwarp-editor.jsx:3652-3666`). A separate Reset layout action is shown immediately afterward, so the scope of the
first reset is unclear.

Required fix: provide independently named Reset Shortcuts, Reset Editor Appearance, and Reset Layout actions, each with
an exact summary of what will change.

### P2 — Command-palette action names are partly hard-coded English

The Run Selection suffix and `TextWarp: Format document` label bypass the localized TextWarp catalog
(`monaco-editor.jsx:371-399`). This makes command search inconsistent in Portuguese and with the surrounding UI.

Required fix: localize complete command names, descriptions, categories, and keybinding labels. Do not concatenate an
English suffix onto a translated fragment.

## Menus, focus, and accessibility

### P1 — Shared menu keyboard navigation skips checkboxes and includes disabled items

`handleActionMenuKeyDown()` queries only `[role="menuitem"]` and does not exclude disabled controls
(`textwarp-editor.jsx:1030-1040`). The Convert menu's Auto Sync control is a `menuitemcheckbox`, so Arrow/Home/End
navigation skips it. File-tab context menu navigation can focus disabled Close commands.

Required fix: query enabled `menuitem`, `menuitemcheckbox`, and `menuitemradio` elements; implement Arrow, Home, End,
Enter/Space, Escape, and typeahead consistently; and add keyboard tests for every menu item type.

### P1 — File-tab context menus have no reliable keyboard/focus contract

The context menu is opened from `onContextMenu` using `clientX/clientY` on a draggable wrapper
(`textwarp-editor.jsx:3328-3434`). It has no explicit Shift+F10/Menu-key handler, `aria-haspopup`, initial item focus,
keyboard-position fallback, or reference used to restore focus. Escape only clears state
(`textwarp-editor.jsx:1418-1427`).

Required fix: open the menu from keyboard and pointer, anchor keyboard invocation to the active tab, focus the first
enabled item, return focus to the invoking tab after close, and keep the menu within the viewport.

### P1 — Breakpoint operations do not have a documented keyboard-only workflow

Breakpoints are visible in the glyph margin and can be clicked, but there is no TextWarp command, shortcut preference,
or direct debugger-list action for toggling the current line. The line-number workaround is itself erroneous.

Required fix: add Toggle Breakpoint, Enable/Disable Breakpoint, Remove All Breakpoints, and Next/Previous Breakpoint to
the command palette and debugger UI, with focus-visible and screen-reader status.

### P1 — Touch users cannot reliably invoke symbol navigation

Resource navigation has a special Ctrl/Cmd-click path, while Monaco definition/reference commands are discoverable
primarily through desktop keyboard or context-menu knowledge. More actions on compact layouts exposes only command
palette, format, split, docs, external editor, and preferences. There is no direct Go to Definition, Find References,
Rename, or Quick Fix action for touch.

Required fix: add a compact cursor/symbol action menu for selection-sensitive commands. Only show supported actions and
include the resolved friendly symbol/owner in the label.

### P2 — Status-bar information is not interactive

The status bar renders file, cursor, problem count, synchronization, FPS, and runtime state as plain spans
(`textwarp-editor.jsx:4134-4150`). Users cannot open Problems from the count, jump to a line from the cursor indicator,
inspect sync details, or open runtime/debug controls.

Required fix: make actionable status items buttons with clear labels and focus states. At minimum, problem count should
open Problems and select the current/next diagnostic.

### P2 — Basic-editor fallback removes navigation without an equivalent route

When Monaco fails, the fallback provides a textarea, diagnostics text, retry, and technical-report actions
(`src/components/textwarp-editor/monaco-editor.jsx:565-635`). It does not provide line navigation, clickable
diagnostics, search, breakpoint access, or a clear list of unavailable commands.

Required fix: keep Problems links functional against the textarea, support Ctrl/Cmd+F and Go to Line, preserve line and
selection when retry succeeds, and announce which advanced features are temporarily unavailable.

## Daily editing quality of life

### P1 — There is no Quick Open file workflow

Files can be chosen from tabs, the Explorer, Actors, or a select containing already-open tabs, but there is no
Ctrl/Cmd+P fuzzy file switcher for all project modules. Command palette does not replace file-oriented recent/fuzzy
navigation.

Required fix: add Quick Open with friendly actor/stage names, filenames, recent files, open/dirty state, fuzzy matching,
and keyboard preview. It must work on touch through More actions as well as by shortcut.

### P1 — Problems lacks next/previous and current-diagnostic navigation

Problems entries can be clicked, but there is no Next Problem/Previous Problem action, selected problem, F8/Shift+F8
workflow, severity filter, or synchronization between cursor markers and the panel.

Required fix: add next/previous commands which traverse all diagnostics across targets, open the correct pane, announce
severity/message/location, and keep the panel selection synchronized.

### P2 — Project Search is missing standard navigation controls

Search has query, replacement, Replace All, a count, and paged result buttons
(`src/components/textwarp-editor/ide-sidebar.jsx:296-345`). It lacks case sensitivity, whole word, regular expression,
include/exclude target filters, next/previous result, collapse by file, and a replacement preview.

Required fix: add progressive-disclosure search modes, keyboard traversal, per-result/per-file replacement, and a
preview diff before multi-file mutation. Preserve the current compile-before-apply safeguard.

### P2 — Outline does not follow or filter the current symbol

Outline groups variables/lists, procedures, and events and provides jump buttons
(`ide-sidebar.jsx:347-388`). It has no filter, sort mode, collapsible groups, active-symbol highlight, or follow-cursor
behavior.

Required fix: add a lightweight filter and optional Follow Cursor. Highlight the enclosing declaration without moving
keyboard focus or scroll unexpectedly.

### P2 — Advanced Monaco commands are difficult to discover

Go to Definition, Peek Definition, Find References, Rename Symbol, Quick Fix, Go to Symbol, and Go to Line rely on
Monaco knowledge. The More actions menu and TextWarp documentation do not expose a concise context-sensitive command
entry or searchable shortcut reference.

Required fix: add a localized Keyboard Shortcuts/Editor Commands view, surface common actions in More actions, and
provide context-sensitive entries when the cursor is on a symbol or diagnostic.

### P2 — There is no location context beyond file and sticky scope

The editor shows the active filename and enables Monaco sticky scroll for smaller desktop files, but there is no
breadcrumb/current-symbol path linking actor or stage, procedure/event, and current line.

Required fix: add a compact optional breadcrumb that uses friendly target names and resolved symbols, collapses on
narrow screens, and supports keyboard navigation without duplicating the open-file tabs.

## Test and validation gaps

### P1 — Browser tests do not exercise navigation or shortcut ownership

The real-browser TextWarp test checks loading/completion and measured responsive layouts, but it does not validate
definition/reference navigation, active pane command routing, hidden-editor shortcut isolation, file-tab context-menu
keyboard access, breakpoint input, or navigation history. Most provider tests use mocked Monaco behavior.

Required browser matrix:

- visible versus hidden TextWarp shortcut routing;
- focus in primary editor, secondary editor, Search, Preferences, Scratch controls, and modal inputs;
- definition, reference, resource, Outline, Search, and Problems jumps across targets;
- Go Back/Go Forward and stale asynchronous navigation cancellation;
- pointer and keyboard file-tab context menus;
- breakpoint mouse, keyboard, and screen-reader flows;
- compact/touch access to symbol actions;
- Windows/Linux Ctrl labels and macOS Command/Option labels;
- Monaco failure, basic-editor navigation, and retry selection restoration.

### P2 — Existing interface assertions are structural rather than behavioral

`test/textwarp/ui-integration.test.js` mainly asserts that roles, strings, and handlers exist in source. That catches
missing markup but not focus order, disabled-item skipping, event propagation, wrong-pane edits, shortcut collision
resolution, or actual screen-reader announcements.

Required fix: keep inexpensive structural checks, but add React interaction tests and real-browser assertions for
behavioral contracts. Every fixed item in this report should include a regression that fails on the current
implementation.

## Suggested fixing order

1. Scope the document shortcut handler to visible TextWarp contexts and editable controls.
2. Add last-focused editor ownership and route all commands through a shared editor adapter.
3. Unify all jumps behind a workspace location service; fix cross-instance navigation and ambiguous resources.
4. Restore normal line-number behavior and complete keyboard/pointer breakpoint workflows.
5. Replace raw shortcut inputs with one validated, context-aware keybinding registry and recorder.
6. Repair menu focus/navigation contracts and expose touch-friendly symbol actions.
7. Add navigation history, Quick Open, next/previous Problems, and improved Search/Outline workflows.
8. Add behavioral browser coverage before marking the audit resolved.

## Definition of done

The audit is resolved only when:

- no TextWarp shortcut fires while TextWarp is hidden or an incompatible control owns focus;
- primary and secondary panes have explicit ownership and all commands target the intended pane;
- every navigation origin resolves through one location service with deterministic ambiguity handling;
- navigation history, Quick Open, Problems traversal, and breakpoint commands work by keyboard and pointer;
- compact/touch users can reach definition/reference/rename/fix actions without a hardware modifier key;
- keybindings show their effective context, conflicts, platform label, and disabled/default state;
- menus meet their keyboard and focus-return contracts;
- the fallback editor retains essential navigation;
- focused unit and real-browser regressions cover each corrected P0/P1 item;
- `npm run test:textwarp`, the relevant Jest suites, the real-browser TextWarp test, documentation checks, and
  `git diff --check` pass.
