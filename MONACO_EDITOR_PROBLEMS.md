# Current Monaco Editor Problem Backlog

Status: **open audit for a future fixing agent**.

This document describes problems that still exist in the current Monaco/TextWarp implementation. It is intentionally
written as an implementation backlog, not as a list of already-resolved historical issues. A fix should preserve the
existing parser/compiler behavior, keep the primary and secondary editors isolated, and add a regression test for every
item that changes.

## Priority guide

- **P0** — can produce incorrect edits, wrong navigation, data loss, or a broken editor workflow.
- **P1** — materially incorrect language intelligence or diagnostics, but the project can still be edited.
- **P2** — usability, performance, consistency, or coverage gap.

## Syntax and parsing problems

### P1 — Monaco tokenizer and parser are maintained separately

The Monarch tokenizer in `src/lib/textwarp/monaco-loader.js:149-186` has its own keyword and command lists, while the
actual grammar is defined by `parser.js`, `block-registry.js`, `control-registry` and `operator-registry`. The tokenizer
does not represent the parser's complete grammar, declaration roles, extension syntax, or all invalid constructs.

Consequences:

- valid syntax can receive the wrong token color;
- unsupported syntax can look valid in Monaco;
- a registry change can update compilation without updating editor highlighting;
- semantic tokens and Monarch tokens can disagree.

Required fix: derive lexical metadata from one source of truth where possible, or document and test the intentional
split. Add tokenization tests for declarations, events, operators, extension blocks, strings, comments, malformed
input, and dotted names.

### P1 — Automatic indentation does not use the actual block structure

The language configuration only increases indentation after a colon and decreases for `else`/`branch` text
(`monaco-loader.js:137-147`). It does not calculate the parent block, indentation level, or whether a colon belongs to a
construct that actually owns a body. This can disagree with both `parser.js` and `formatText()`.

Required fix: implement an indentation provider/configuration based on parser-aware structure and test Enter, paste,
outdent, `else`, numbered branches, nested loops, comments, and incomplete blocks.

### P1 — Completion context is still heuristic at top level

`getCompletions()` decides whether the cursor is top-level using the amount of leading whitespace
(`language-service.js` near `getCompletions`). A malformed or temporarily indented top-level declaration is therefore
treated as a body position. Completion lists can contain control blocks when declarations are expected, or hide
declaration snippets while the user is repairing indentation.

Required fix: use parser recovery/context rather than indentation alone, while retaining a safe partial-AST fallback for
incomplete input.

### P1 — Formatter can normalize the wrong structure

`formatText()` (`language-service.js:1066-1140`) is a line/indentation algorithm with regular-expression block detection.
It deliberately returns the original text for some errors, but its safe path can still make decisions without a complete
AST. Multiline expressions, unusual but valid extension forms, incomplete branches, and recovery syntax need explicit
coverage.

Required fix: format from parser nodes or a tokenizer-aware structural model; never change text when ownership is
ambiguous. Add tests proving formatting preserves comments, strings, malformed-but-recoverable code, and compilation
semantics.

### P2 — Invalid lexical characters are not represented consistently

`scanSource()` in `language-service.js` classifies unknown characters as generic delimiters, while `parser.js` reports
invalid-expression-character diagnostics. Language-service features can therefore index or complete around text that
the compiler considers invalid.

Required fix: expose invalid tokens or parser diagnostics in the index and make completion, hover, semantic tokens and
inlay hints ignore invalid spans safely.

## Symbol, scope, and semantic-logic problems

### P0 — Local symbol resolution is not procedure-scope aware

`moduleSymbol()` returns the first variable/list/procedure with a matching name (`language-service.js:389-391`).
`resolveName()` checks parameters, then that first module symbol, then globals (`393-402`). It does not select a local
declaration by lexical scope or declaration identity.

Example:

```text
procedure first():
    variable value = 1
    say(value)

procedure second():
    variable value = 2
    say(value)
```

Definition, references, rename, hover, semantic tokens, and completion can bind `second`'s `value` to the first
declaration. This is an incorrect edit/navigation result, not merely a missing feature.

Required fix: give every declaration a scope and stable identity; resolve the innermost legal binding at the cursor;
test same-name locals, parameters versus locals, module symbols, and shadowed globals.

### P0 — Rename collision checks are broader and narrower than the real language rules

`getRenamePlan()` checks collisions by symbol kind, module, and `global` flags (`language-service.js:497-508`), but the
underlying resolver does not model lexical scopes. It can reject a legal rename in an unrelated procedure or allow a
rename that becomes ambiguous in a nested scope.

Required fix: perform collision checks against the resolved binding scope and the compiler's visibility rules. Add
positive and negative rename tests before exposing the operation as a safe Monaco rename.

### P0 — Cross-file rename still depends on loaded Monaco models

The Monaco rename provider creates edits only for models returned by `monaco.editor.getModel(resource)` and filters out
edits without a numeric `versionId` (`monaco-loader.js:331-351`). An unloaded or separately owned model is silently
omitted. The project source and Monaco models can then disagree after a rename.

Required fix: introduce a workspace-edit transaction that updates loaded models and unloaded project modules, checks
versions/conflicts, and propagates every edit through the container before reporting success.

### P1 — Definition and reference resolution does not cover every semantic symbol

`resolveName()` only treats variables, lists, procedures, parameters, and global variables/lists as resolvable. Event
symbols, actors/stage declarations, resource names, extension symbols, and ambiguous project symbols require separate
behavior. Resource definitions are synthesized in `monaco-loader.js:255-281` and point to line 1 of the owner model,
which is not a real declaration range.

Required fix: define navigation semantics for each symbol kind, return exact declaration ranges, and reject ambiguous
targets instead of navigating to an approximate location.

### P1 — Inlay hints identify procedures by name only

`getInlayHints()` finds a procedure with `index.symbols.find(...)` (`language-service.js:1239-1248`). It does not resolve
the call using the same binding logic as definitions/references. Same-name procedures or unresolved calls can receive
the wrong parameter labels.

Required fix: resolve the call target first and generate hints only for the bound procedure/registry entry. Add tests for
same-name procedures, nested calls, unknown calls, and calls inside strings/comments.

### P1 — Semantic tokens are not fully semantic

`getSemanticTokens()` falls back from symbols to catalog names (`language-service.js:1195-1223`) and does not expose
unresolved identifiers, declaration roles for every grammar construct, resource ownership, or scope information. Monaco
can show a plausible color for a name that is not actually bound.

Required fix: base semantic tokens on the same resolved symbol graph used by navigation and emit stable token types for
declarations, references, resources, keywords, and unresolved names.

## Diagnostics and editor feedback

### P1 — The Problems panel uses the wrong locale for suggestions

Monaco markers pass `this.props.locale` to `getDiagnosticSuggestion()` (`monaco-editor.jsx:486-505`), but the TextWarp
Problems panel calls `getDiagnosticSuggestion(item)` without a locale (`textwarp-editor.jsx:1682-1699`). The helper
defaults to Portuguese (`language-service.js:1159`), so English users can receive Portuguese suggestions in the panel.

Required fix: pass the active locale everywhere and add an English-panel regression test.

### P1 — Diagnostics are only compiled for the active source after a delay

`handleChange()` clears markers immediately and schedules compilation with timers (`textwarp-editor.jsx:1207-1258`).
There is no worker/incremental analysis, and compilation remains on the UI thread. Large projects can freeze while
typing; the editor can also show an empty Problems panel during the analysis window.

Required fix: use a cancellable/versioned analysis pipeline, preferably off the main thread for expensive compilation,
and distinguish "analysis pending" from "no problems".

### P1 — Diagnostics are not versioned as Monaco model data

Markers are derived from React props and installed on the active model (`monaco-editor.jsx:486-505`). A delayed parent
update can apply diagnostics from an older source version after the user has typed again. The current timer checks the
React source string, but there is no explicit Monaco model version in the diagnostic payload or marker owner.

Required fix: associate diagnostics with model key and version, discard stale results, and clear only the affected
model's markers.

### P2 — Only a truncated subset of diagnostics is exposed in the panel

`renderDiagnostics()` displays the first eight diagnostics and Monaco's fallback view displays the first ten
(`textwarp-editor.jsx:1685`, `monaco-editor.jsx:577-583`). There is no "show all" or filtering by severity/code, which
makes the remaining compiler errors hard to inspect.

Required fix: provide a virtualized/filterable Problems list or an explicit count and navigation through all diagnostics.

## Monaco lifecycle, models, and synchronization

### P0 — Cross-editor navigation is isolated by instance namespace

Primary and secondary editors receive different model namespaces (`instanceKey="primary"` and `instanceKey="secondary"`).
`registerEditorOpener()` accepts only models present in the current editor's `modelKeysByUri`
(`monaco-editor.jsx:435-463`). A definition/reference result from the other editor instance is therefore rejected even
when the target model exists in the other Monaco editor.

Required fix: use a workspace-level model registry/opener shared by both editor instances, or route navigation through
the container so the correct editor/model is activated.

### P1 — Dirty-state synchronization can lose or reorder external edits

For non-active models, `syncDocumentModels()` calls `existing.setValue(document.source)` when the model is not marked
dirty (`monaco-editor.jsx:295-318`). The model change callback immediately calls `onWorkspaceModelChange()` and then
resets `dirty` to false (`256-291`). There is no revision/transaction ID from the container, so a refresh racing with a
user edit can overwrite text or make a just-applied edit appear clean before the parent has committed it.

Required fix: use source revisions and origin tags, preserve dirty state until the parent acknowledges the revision, and
surface conflicts instead of silently replacing text.

### P1 — Diagnostics and model synchronization are asymmetric in dual view

The secondary editor has its own model namespace and diagnostics, while the primary editor owns the workspace model
set. Updates made in the secondary editor are compiled/applied through container callbacks, but there is no explicit
cross-instance model synchronization protocol or test for changing the same target from both panes.

Required fix: define ownership for each target, synchronize revisions between panes, and test simultaneous edits,
target switching, navigation, rename, and diagnostics in dual view.

### P2 — Editor feature registration is not observable after recovery

When Monaco fails, the component falls back to a basic editor. `initializeMonaco()` catches the failure and exposes a
retry, but there is no telemetry/status distinguishing loader failure, provider registration failure, or runtime model
failure. A partially initialized Monaco instance can leave the user with no clear recovery reason.

Required fix: expose structured lifecycle states and ensure every failed initialization disposes partial models,
subscriptions, and registrations before retry.

### P2 — Global AMD loader configuration can conflict with other Monaco instances

`loadMonaco()` mutates `window.require.config({paths: {vs: baseUrl}})` and uses global `window.require`
(`monaco-loader.js:570-615`). Multiple embedded editors or another AMD consumer can change the global `vs` path while a
load is in progress.

Required fix: isolate loader configuration, validate the requested base URL, and test two simultaneous deployments with
different base paths.

## Completion, hover, and provider behavior

### P1 — Completion aggregation still has weak semantic de-duplication

The single provider combines resources, symbols, declarations, controls, registry commands, operators, events, and
extensions (`language-service.js` in `getCompletions()`). Filtering uses labels and tokenized prefix terms, but there is
no semantic conflict policy when a user symbol has the same name as a command, extension, resource, or procedure.

Required fix: deduplicate by binding/semantic ID, show ownership and kind consistently, and define deterministic ordering
for shadowed or ambiguous names.

### P1 — Snippet insertion can produce invalid indentation or duplicate delimiters

`snippetForMetadata()` and `getCompletions()` construct multiline snippets by string replacement. They do not ask
Monaco for the current indentation context and only special-case an existing `(`. Nested blocks, an existing closing
delimiter, continuation lines, and snippets inserted after a prefix need explicit tests.

Required fix: calculate insertion ranges and indentation from the model, preserve existing delimiters, and test each
snippet at beginning/middle/end-of-line and inside nested blocks.

### P2 — Hover and signature help lack a shared resolved target

Hover, signature help, completion, inlay hints, and definition each perform their own lookup. They can disagree for the
same cursor position, especially with shadowing, overloaded extensions, or an unresolved procedure call.

Required fix: expose one cursor-resolution result (symbol/call/resource plus range and diagnostics) and have providers
reuse it.

### P2 — Code actions are suggestions, not real edits

The code-action provider (`monaco-loader.js:506-529`) returns commands that trigger formatting or completion. It does not
return a concrete `WorkspaceEdit` for indentation, unknown names, delimiters, or resource corrections, so the quick-fix
UI cannot reliably fix the diagnostic it advertises.

Required fix: implement concrete, version-checked edits for each supported diagnostic and return no action when an edit
cannot be made safely.

## Performance, accessibility, and test coverage

### P1 — Index/cache work is repeated for every provider request

The language service creates document/workspace indexes for completion, hover, definition, references, rename, semantic
tokens, and inlay hints. The cache is keyed by full source text and model key, but there is no shared per-model snapshot
between provider requests or invalidation signal from Monaco. Large workspaces can repeatedly parse every document on
cursor movement.

Required fix: maintain a versioned workspace index per model/context, invalidate it on source/context revision, and reuse
the snapshot across provider calls.

### P2 — Accessibility coverage is incomplete for advanced editor output

The fallback has status text, but Monaco markers, inlay hints, glyph breakpoints, bottom-panel diagnostics, and the
secondary editor do not have a documented keyboard-only workflow or automated accessibility assertions.

Required fix: test focus order, screen-reader labels, diagnostic navigation, editor switching, breakpoint actions, and
fallback/retry states.

### P1 — Browser integration test depends on an incompatible driver selection

`test/integration/textwarp-monaco.test.js` prefers the repository's `chromedriver` package when it exists and otherwise
uses `/usr/bin/chromedriver`. The pinned package can be incompatible with the installed Chromium version, causing the
test server/driver to terminate before Monaco is exercised.

Required fix: pin Chromium and ChromeDriver together in CI, or resolve the driver from the browser version and report a
clear skip/failure. Keep the real completion smoke test mandatory once the versions match.

### P2 — Provider tests are mostly mocked and do not cover browser behavior

`test/textwarp/monaco-language.test.js` uses a hand-built Monaco mock. It verifies registration and selected provider
results, but not actual Monaco ranges, widget behavior, model switching, cancellation timing, marker rendering, or
cross-instance navigation. The integration test currently covers loading and one completion path only.

Required fix: add browser tests for definitions, references, rename, formatting, diagnostics, code actions, hover,
signature help, inlay hints, dual editors, retry, and dirty-model protection.

## Suggested fixing order

1. Fix binding/scope identity and cross-file/dual-editor workspace edits (P0).
2. Make diagnostics versioned, localized, complete, and non-blocking (P1).
3. Align tokenizer, indentation, formatter, completion snippets, and parser recovery (P1).
4. Unify cursor resolution across providers and implement real code actions (P1/P2).
5. Improve model lifecycle, cache/index reuse, accessibility, and browser-driver/test coverage (P1/P2).

Every completed item should add a focused regression test, update this file's status, and be validated with
`npm run test:textwarp`, `npm run docs:textwarp:check`, the relevant Jest tests, a real browser smoke test, and
`git diff --check`.
