# TextWarp IDE

The TextWarp IDE extends the existing Scratch/TurboWarp shell. It does not create a separate runtime: code,
blocks, stage, targets and project assets still operate on the same VM.

## Code editor

Monaco provides syntax highlighting, indentation, bracket completion, minimap, multiple target models and
independent primary/secondary editors. Font size is persistent and can be changed in Preferences, from the
slider below the editor, or with `Ctrl++`, `Ctrl+-` and `Ctrl+0`.

Each model has one URI contract shared by model creation, definitions, references and rename. The project identity
and editor instance are both part of the namespace, so switching projects or using the primary and secondary
editors cannot reuse a model from another context. Each namespace loads every editable workspace module, and a
cross-file result therefore targets a real, versioned Monaco model. Dirty models are not overwritten by an older
workspace refresh, and models removed from the project release their subscriptions and language context.

## Language intelligence

The parser-backed language service keeps a cached index for every source version. Symbols retain declaration
identity, lexical scope, owning target and local/global visibility, so parameters, local symbols and project
globals with the same spelling resolve independently.

A single completion provider combines controls, events, operators, native commands, extensions, procedures,
parameters, variables, lists and project resources without duplicate entries. It also reads valid dropdown values
from native and extension block metadata: keys, menu modes, effects, math operations and other finite choices appear
inside the active argument, while color arguments offer selectable hexadecimal samples with Monaco color entries.
It filters by prefix, scope, stage/actor and syntax position; comments do not receive code suggestions, while strings
receive only values and resources valid for the active argument. Replacement ranges cover partial words and quoted
values, and multiline snippets preserve the current indentation.

Completion, hover, signatures, document symbols, definitions, references, scope-safe project rename, formatting
and resource navigation all use the same index. An incomplete-call scanner handles nested calls, strings,
comments and multiline edits for signature help and resource completion. Monaco also exposes semantic tokens,
document highlights, syntax folding, structural selection, parameter inlay hints and diagnostic quick actions.

Diagnostics always retain their stable error code. Analysis is debounced away from the immediate keystroke path,
associated with the current source version, range-clamped to the model and discarded when stale. Suggestions and
quick actions follow the active interface language. VM compilation/application remains a separate delayed step.

## Software-specific resources

Actors, stage, variables, lists, broadcasts, costumes, sounds and loaded extensions appear as project resources.
References use stable IDs and owning targets so renaming a resource can update textual modules safely. Ctrl/Cmd
click resolves the resource binding rather than navigating by a coincidental matching name, including when
different actors own resources with the same name.

## Project organization

Every target is an editable `.tw` module. The explorer distinguishes editable source from generated artifacts.
Open-file tabs, project-wide search and replacement, recent targets and local history support larger projects.
**Quick Open** (`Ctrl+P`) filters actors and the stage by friendly name or filename without leaving the editor.
The Convert menu can turn the stage and all original actors into text modules in one transactional action, with
one Undo snapshot for the complete project.

## Main software integration

Compilation writes directly to `scratch-vm`; the native Blocks view reads the same target. The browser uses web
file APIs and downloads. Electron injects native file handles through the shared platform boundary.

An empty actor starts with a small arrow-key movement script. Its canonical Scratch values (`"right arrow"` and
`"left arrow"`) are compiled into blocks as soon as the target is loaded, so the Text and Blocks views agree before
the first edit. The stage starts as an empty `stage` module.

Scratch variable and list names containing spaces, accents, or symbols receive a stable TextWarp identifier, such
as `Gear Speed °/s` → `Gear_Speed_s`. Block fields retain the original name and ID, so round trips do not create a
different variable or lose the actor/stage binding. Normalized-name collisions receive deterministic suffixes.

Empty control arms are represented by `pass`, including both sides of an empty `if/else`, and compile back to empty
visual branches. Command stacks not attached to an event use `stack:`, while disconnected reporter blocks use
`reporter expression`. Genuinely unknown opcodes use non-executing `opaque.*` forms and are listed in the semantic
conversion plan and technical report.

## Execution and console

Run, Stop, Restart and selection execution operate on the current VM. The Console tab records input, output,
runtime errors and target context.

## Debugging

The Debugger tab exposes threads, execution state, source location, call stacks, variables, target state and safe
watch expressions. Breakpoints can pause concurrent scripts independently. Click the glyph margin or press `F9`
to toggle a breakpoint at the caret; clicking a line number only moves the caret.

## Productivity and recovery

Autosave snapshots remain local to the device. Every manual or automatic block mutation creates an exact target
snapshot and exposes **Undo** and **View differences**. Formatting, project-wide replacement and `.textwarp` packages help
recover and transfer editable work.

Preferences includes a persistent **Compact interface** option for denser toolbars, tabs, sidebars, and panels on
larger screens. **Programming** contains Text, Blocks, Split, and Documentation directly above the editor. Files,
Search, Actors, Extensions, Debugging, Documentation, and Settings live in the activity bar.
Conversion is a file-level menu with explicit synchronization state; **More actions** contains the command palette,
Quick Open, formatting, breakpoint and Problems navigation, split editor, documentation, external editor, and
preferences. In dual view these editor commands follow the last-focused pane. On mobile, the sidebar becomes a
dismissible overlay and the stage starts collapsed to preserve code space.

The right dock follows Stage, Actor Inspector, then one Actors/Backdrops tabbed area. Both target tabs expand with
the dock, retain at least 12 rem of working height, and scroll long actor lists inside that area. The explorer groups
modules under Actors and Stage, while Outline groups Variables, Procedures, and Events. When text and blocks differ,
the in-app conflict surface offers Compare, Use text, Use blocks, and Cancel instead of silently replacing work.

Configurable shortcuts support letters, digits, function keys, arrows, navigation keys, Space, Tab, Escape,
Backspace and Delete. Preferences stages edits until **Apply shortcuts** is selected, rejects duplicates, and accepts
an empty field as an intentionally disabled command.
Breakpoints use tracked Monaco decorations, so persisted line positions follow inserted and deleted lines.

Problem entries show file, line, and column and navigate to that location. The Problems tab always offers
**Copy technical report** and **Download technical report**. The report includes
editor status, Monaco loader failures, Blocks-to-Text conversion results, unavailable opcodes, original variable/list
names and IDs, runtime errors, console entries, and the current source. Review it before sharing because the complete
module source is included. `F8` and `Shift+F8` move to the next and previous problem in the focused editor pane.
The same report actions remain available in the basic-editor fallback.

## Integrated documentation

Documentation is selected from the active Scratch GUI language. Portuguese uses the canonical Portuguese
manuals; all other locales fall back to the complete English manuals.

## Security and stability

Documentation HTML is sanitized. External links use `noopener,noreferrer`. Package import has strict archive and
path limits. External source files are read or written only after an explicit user picker action.

The Monaco loader deduplicates concurrent requests, validates the AMD editor API and supports retry after a
transient failure. Assets resolve from `document.baseURI`, including subdirectory deployments. If loading still
fails, the basic editor preserves the source and diagnostics, keeps technical details behind an expandable control,
offers copy/download technical reports, and provides a retry action.

## Usability and accessibility

The interface uses a fixed IDE layout with an activity bar, contextual sidebar, editor, resizable stage/inspector,
bottom panel, and status bar. The stage can be resized or collapsed and remembers its width. Side, split and bottom
panels are resizable; the sidebar becomes an overlay when space is limited. All important commands remain keyboard
reachable. The legacy permanent Find field stays hidden; `Ctrl+F` opens Monaco Find over the text editor.

## Default shortcuts

| Command | Shortcut |
| --- | --- |
| Compile | `F7` |
| Run project | `F5` |
| Run project | `Ctrl+Enter` |
| Run selection | `Ctrl+Shift+Enter` |
| Stop | `Shift+F5` |
| Restart | `Ctrl+Shift+F5` |
| Format | `Ctrl+Shift+I` |
| Project explorer | `Ctrl+Shift+E` |
| Project search | `Ctrl+Shift+F` |
| Quick Open | `Ctrl+P` |
| Command palette | `Ctrl+Shift+P` |
| Move the caret by word | `Ctrl+←` / `Ctrl+→` |
| Select by word | `Ctrl+Shift+←` / `Ctrl+Shift+→` |
| Next problem | `F8` |
| Previous problem | `Shift+F8` |
| Toggle breakpoint at caret | `F9` |
| Toggle sidebar | `Ctrl+B` |
| Toggle bottom panel | `Ctrl+J` |
| Save `.textwarp` | `Ctrl+S` |
| Save `.textwarp` as | `Ctrl+Shift+S` |
| Increase editor text | `Ctrl++` |
| Decrease editor text | `Ctrl+-` |
| Reset editor text | `Ctrl+0` |
