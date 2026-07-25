# TextWarp 0.3

TextWarp is a text-first programming environment that compiles to Scratch blocks while preserving compatibility
with the TurboWarp runtime. The text source, generated blocks and project assets can travel together in a
`.textwarp` package.

## Install and run

For web development:

```bash
npm install
npm start
```

Create a production build for the `/textwarp/` route with:

```bash
npm run build:textwarp:web
```

For Desktop development, build and link this package before starting the Electron repository:

```bash
BUILD_MODE=dist npm run build
npm link
```

## Editor workflow

Select the stage or an actor in the regular Scratch target pane. Each target becomes an editable `.tw` module.
The Code, Blocks and Split views edit the same target. Dual editor opens two different target modules and keeps
each Monaco model independent.

TextWarp automatically validates text after an edit and compiles the last valid version. Use Compile for an
explicit validation, Run for the green flag, Stop to stop all threads and Restart to compile then run again.

The project sidebar exposes editable modules, resources, search, symbols and local history. The lower panel keeps
Problems, Console, Debugger and extension information in separate tabs. All panels can be resized.

## Syntax

Modules begin with `stage` or `actor Name`. Indentation uses four spaces and tabs are rejected.

```textwarp
actor Cat

variable speed = 5
list hits = []

on green_flag:
    forever:
        if key_pressed("right"):
            change_x(speed)
        wait(0)
```

### Variables, lists and expressions

Use `global variable` and `global list` on the stage. Actor declarations are local unless they reference a global
stage resource.

```textwarp
global variable score = 0
global list players = ["Ada", "Linus"]

score += 1
list_add(players, "Grace")
say(join("Score: ", score))
```

Expressions support numbers, strings, booleans, variables, reporters and operators such as `+`, `-`, `*`, `/`,
`and`, `or` and `not`.

### Conditions and loops

```textwarp
if score > 10:
    say("You win")
else:
    say("Keep going")

repeat 10:
    move(10)

forever:
    wait(0)
```

Extension conditionals with more than two branches use explicit `branch N:` sections when required by their
mutation.

### Procedures and parameters

```textwarp
procedure move_steps(amount: number):
    move(amount)

procedure doubled(value: number) -> number:
    return value * 2

procedure draw_fast(size: number) warp:
    move(size)
```

Parameters may be `any`, `number`, `string` or `boolean`. Reporter procedures require TurboWarp-compatible
execution and keep their type metadata in the generated block mutation.

### Events, broadcasts and clones

```textwarp
on green_flag:
    broadcast("start")

on receive("start"):
    create_clone("myself")

on clone_started:
    show()

on key_pressed("space"):
    change_y(10)
```

### Complete block catalog

See [TEXTWARP_BLOCOS.md](TEXTWARP_BLOCOS.md) for the complete native syntax and the Documentation view for
extensions loaded by the current project.

## Extensions

Loaded extension metadata is read from `getInfo()`. Commands, reporters, booleans, hats, loops and conditional
blocks receive canonical names such as `extensionId.opcode(...)`. Dynamic mutation variants preserve their
generated signature.

Labels, buttons, separators and raw XML are palette items, not language commands. Third-party extension code may
require user permission and each extension keeps its own license and security model.

## `.textwarp` format

A `.textwarp` file is a ZIP package containing:

- `manifest.json`;
- editable target sources;
- a compiled Scratch project;
- assets and project resources;
- an extension lock when third-party dependencies are used.

Import validates entry count, compressed and expanded size, source paths, duplicate entries and module limits.
This prevents common ZIP bomb and path traversal attacks.

## Block import

Import Blocks decompiles existing Scratch stacks into named TextWarp syntax. Unavailable historical or
third-party opcodes remain visible as blocks and are reported instead of being silently replaced with unsafe raw
code.

## Synchronized visual editing

Blocks and text are compared at compilation-unit level. Independent edits merge automatically. When both sides
modify the same semantic unit, TextWarp shows a conflict and lets the user keep text or accept the visual blocks.

## Concurrent debugger

Breakpoints are stored per target. The debugger can pause independent Scratch threads, inspect variables and
call stacks, evaluate safe watch expressions, and step through compiled frames without permanently disabling the
JIT.

## Incremental compilation

Stable unit and block identifiers allow TextWarp to replace only changed scripts or procedures. Unchanged block
objects, comments and visual coordinates are preserved.

## Architecture

The shared editor lives in `scratch-gui`:

- `src/components/textwarp-editor/` contains visual components;
- `src/containers/textwarp-editor.jsx` coordinates the GUI and VM;
- `src/lib/textwarp/` contains parser, compiler, decompiler, workspace, debugger and package services;
- the Desktop fork injects only filesystem and Electron platform adapters.

## Persistence in `.sb3`

TextWarp records source metadata in project comments so a compatible `.sb3` can restore textual modules. The
`.textwarp` package remains the recommended editable format because it stores sources and dependencies
explicitly.

## Current limits

- Some historical or private extension opcodes cannot be reconstructed without the original extension.
- Scratch cloud variables and network features still follow the host platform policy.
- Browser filesystem handles depend on File System Access API support; download/upload remains the fallback.
- External editor synchronization is explicit: write the `.tw` file, edit it externally, then reload it.
