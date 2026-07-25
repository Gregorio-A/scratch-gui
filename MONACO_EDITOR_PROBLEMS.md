# Monaco Editor Remediation Record

Status: **resolved in the implementation covered by this document**.

This file preserves the original audit as a regression checklist. The “Required fix” paragraphs describe the
acceptance criteria implemented in the Monaco component, language adapter, parser-backed workspace index, editor
container, tests and canonical IDE manuals.

The completed remediation includes:

- one parser-backed, version-cached workspace index with scoped symbol identities;
- one context-aware completion provider with explicit ranges and deduplication;
- workspace-and-instance-namespaced model URIs and version-safe cross-file definition, references and rename;
- resource navigation by stable ID and owner;
- nested/incomplete call analysis, semantic tokens, highlights, folding, inlay hints and quick actions;
- debounced diagnostics, localized suggestions and clamped marker ranges;
- isolated model contexts, dirty-model protection, model reconciliation and tracked breakpoints;
- retryable/deduplicated Monaco loading and nested-base-path coverage;
- focused language/provider and React-component tests, a real-browser Monaco completion smoke test, and
  production-build validation.

The individual findings below are historical descriptions of the pre-remediation code and must remain covered by
tests when this integration changes.

The main files are:

- `src/components/textwarp-editor/monaco-editor.jsx` — React/Monaco lifecycle, models, markers, actions, navigation.
- `src/lib/textwarp/monaco-loader.js` — Monaco loading, language registration, providers, model contexts and URIs.
- `src/lib/textwarp/language-service.js` — parser-backed index, symbols, completion, hover, definitions, references and rename.
- `src/lib/textwarp/workspace-service.js` — project modules/resources/search.
- `src/containers/textwarp-editor.jsx` — project context, compilation and editor synchronization.

## Critical correctness problems

### 1. Cross-file Monaco URIs do not match created model URIs

`MonacoEditor.getModel()` creates models at:

```text
inmemory://textwarp/<instanceKey>/<modelKey>.tw
```

in `src/components/textwarp-editor/monaco-editor.jsx:182-185`.

The providers create result URIs at:

```text
inmemory://textwarp/<modelKey>.tw
```

in `src/lib/textwarp/monaco-loader.js:31` and `294-317`.

Therefore definition/reference/rename results for another document point to a URI for which Monaco has no model. Go to Definition may open nothing, Peek Definition may be empty, references may not be navigable, and rename edits cannot reliably resolve the target model. The primary and secondary editor instances also need distinct URI namespaces.

**Required fix:** centralize URI creation in one function shared by model creation and every provider. Use a stable workspace/instance namespace and test that every returned URI resolves through `monaco.editor.getModel()`.

### 2. Rename is not scope-aware

`findReferences()` filters by parameter scope only when the symbol is a parameter (`language-service.js:200-207`). A local variable or procedure with a common name is renamed across unrelated procedures and blocks. `canRename()` also checks whether the name exists anywhere in the document rather than resolving the declaration at the cursor (`210-218`).

**Example failure:** two procedures each declare `variable value`; renaming one can change both declarations/usages and unrelated references.

**Required fix:** resolve a symbol identity at the cursor, including declaration kind, owner/module, lexical scope and parameter scope. Rename only references bound to that identity. Reject ambiguous or unresolved names.

### 3. Rename cannot reliably edit all project models

`provideRenameEdits()` obtains models with `monaco.editor.getModel(resource)` (`monaco-loader.js:342-350`). Because of the URI mismatch, `documentModel` is often absent and edit versions are undefined. Even after URI correction, edits must be applied to all loaded and unloaded workspace documents consistently and then propagated through `onWorkspaceModelChange`; currently that contract is not tested.

**Required fix:** implement a workspace edit path that updates Monaco models and the project sources atomically, handles unloaded models, reports conflicts/version changes, and has an end-to-end cross-file rename test.

### 4. The index is a line-regex scan, not a language index

`getDocumentSymbols()` only recognizes declarations matching a small set of whole-line regular expressions (`language-service.js:60-111`). It does not use the parser/compiler AST or retain symbol identity, scope, declaration location, type, owner, visibility or references.

This causes failures with valid syntax that differs from the regex, declarations with comments/formatting variations, nested/lexically scoped constructs, multiline declarations, malformed-but-recoverable code and extension-defined syntax. The outline and all navigation features inherit these limitations.

**Required fix:** build a recoverable AST/index from the actual TextWarp parser/compiler, with a fallback partial index while code is incomplete. Keep source ranges in Monaco coordinates.

### 5. Project-wide symbol resolution is logically incorrect

`documentsForSymbol()` decides whether a name is global by searching for any global symbol with that name (`monaco-loader.js:33-42`). A local symbol can therefore be treated as project-wide if another file happens to declare a global with the same spelling. Conversely, global procedures/events and other valid shared symbols are not modeled as global because only global variables/lists receive the `global` flag.

**Required fix:** index project symbols with explicit visibility and declaration identity. Resolve local symbols first, then legal global/project symbols, with deterministic shadowing rules.

### 6. Definition/reference results can include declarations that are not semantically related

`findDefinitions()` returns every document symbol with a matching name (`language-service.js:192-198`), and `findReferences()` returns every lexical identifier with that name (`200-207`). There is no binding resolution for locals, parameters, globals, procedures, event names, resource names or shadowed declarations.

**Required fix:** return only references bound to the selected symbol. Add tests for shadowing, same names in different actors, parameters versus variables, and local versus global declarations.

## Completion and suggestion problems

### 7. Two completion providers overlap and produce duplicate/noisy suggestions

`configureLanguage()` registers one provider at `monaco-loader.js:104-242` and another at `244-264`. The first returns snippets for controls, native blocks, events and extensions; the second returns language-service symbols/resources. They are not coordinated, deduplicated or given explicit replacement ranges.

This can show duplicate entries, inconsistent sorting, inconsistent snippet behavior and different results depending on whether completion was manually invoked or triggered by `(`, `,` or `.`.

**Required fix:** use one provider or a shared aggregation layer. Deduplicate by semantic identity, provide explicit `range`, `filterText`, `sortText`, `insertTextRules` and trigger behavior.

### 8. Completion does not filter by the actual prefix/context

The providers return the full catalog and all local/project symbols (`monaco-loader.js:104-264`, `language-service.js:259-294`). They do not calculate the current identifier prefix or suppress irrelevant categories in comments, strings, declarations, block bodies, event headers or invalid contexts.

**Required fix:** calculate the replacement range and syntactic context. Do not suggest code inside comments/strings. Filter commands, events, declarations, parameters, resources and operators according to the cursor location.

### 9. Language-service completion omits major language items

`getCompletions()` only adds resource suggestions, current-file variables/lists/procedures, parameters and project variables/lists (`language-service.js:259-294`). The second provider does not add keywords, operators, events, native commands or extension catalog items. It relies on the separate provider, causing incomplete results when context-specific completion is expected.

**Required fix:** expose a complete catalog through one context-aware provider, including keywords, operators, native commands, events, extension blocks, procedures, parameters, variables/lists and project resources.

### 10. Completion visibility and ownership rules are incomplete

Project variables and lists are offered from all resources without clear global/target visibility filtering (`language-service.js:278-288`). Resource suggestions identify owner for costumes/sounds but variable/list suggestions do not enforce the language's access rules. Duplicate names across actors are not disambiguated.

**Required fix:** resolve visibility from compiler semantics; display owner/module in detail text; insert a qualified form where required; never offer an ambiguous resource as if it were unique.

### 11. Completion insertion is unsafe for several constructs

The first provider builds snippets manually (`monaco-loader.js:111-242`) and the second provider inserts procedure calls as plain text (`language-service.js:266-274`). There is no explicit replacement range, no validation that the cursor is at the expected token, and no handling for already-present parentheses or partial calls. Event and branch snippets can also insert multiline structures into invalid indentation contexts.

**Required fix:** make insertion context-aware, preserve existing text, avoid duplicate delimiters, calculate indentation from the model, and test every snippet with cursor positions before/after prefixes and inside blocks.

### 12. Dynamic extension blocks are not completed robustly

Dynamic extension metadata is encoded into synthetic names in `extension-catalog.js:100-125`, but completion and signature lookup do not clearly resolve/display the original dynamic block name or decode variants for user-facing behavior. The synthetic identifier can be long, opaque and unstable if serialized block information changes.

**Required fix:** give dynamic blocks stable semantic IDs separate from display labels and insertion text. Preserve mutation data without exposing encoded payloads as the primary user-facing symbol.

### 13. Completion has no cancellation or stale-context protection

Providers read mutable model context synchronously and return results without checking a Monaco cancellation token (`monaco-loader.js:104-264`). Context changes while a model is switching or the workspace is refreshing can produce stale suggestions.

**Required fix:** accept and honor cancellation tokens, snapshot the model version/context, and discard results for obsolete versions.

## Signature help, hover and language intelligence

### 14. Call/argument parsing is fragile

`argumentContext()` scans only the current line and uses `/([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^()]*)$/` (`language-service.js:224-230`). It fails for nested calls, parentheses in strings, multiline calls, escaped strings, comments, incomplete nesting and calls with more complex expressions.

As a result signature help often disappears or reports the wrong active parameter. Resource completion has the same dependency.

**Required fix:** use the parser/tokenizer to find the enclosing call and comma depth, including multiline and incomplete input.

### 15. Signature help does not model real parameter semantics

`getSignatureHelp()` uses only procedure parameter names or catalog argument names (`language-service.js:296-322`). It does not expose defaults, optional parameters accurately, types in a consistent Monaco format, variadic behavior, overloads, extension menus or dynamic variants. `activeParameter` is clamped rather than validated.

**Required fix:** derive signatures from compiler metadata, support overloads/optional arguments and return accurate active parameter/type information.

### 16. Hover is local and name-based, not resolved

`getHover()` checks the current file's symbols before catalog/resources (`language-service.js:151-187`). It does not resolve project-wide declarations, shadowing or the exact resource kind/owner. A same-named local symbol can mask the intended global/resource documentation.

**Required fix:** hover the resolved symbol identity and provide consistent markdown/type/signature/source information for local, global, procedure, parameter, extension and project-resource symbols.

### 17. Hover markdown is not escaped or normalized

The Monaco hover provider interpolates titles, code and documentation into markdown (`monaco-loader.js:266-277`). Catalog/resource text can contain markdown-sensitive characters or untrusted project names, which can render incorrectly or create misleading links/formatting.

**Required fix:** use structured MarkdownString content with escaping/sanitization and explicit trusted-markdown policy.

### 18. Missing language features reduce editor usefulness

The integration has providers for completion, hover, symbols, definition, references, rename, formatting and signature help, but no semantic token provider, code actions/quick fixes, inlay hints, type information, document highlights, linked editing, selection ranges, folding ranges based on syntax, or real semantic diagnostics from Monaco.

These should be treated as planned gaps, especially code actions for compiler diagnostics and document highlights for the resolved symbol under the cursor.

## Diagnostics, parser and formatting problems

### 19. Diagnostics are compiler snapshots, not editor-aware diagnostics

Markers are copied from `props.diagnostics` (`monaco-editor.jsx:266-281`). They are not recomputed from Monaco model changes inside the editor, and there is no debounced background analysis, version association, cancellation or stale-result protection. Compilation currently occurs synchronously in `handleChange()` (`textwarp-editor.jsx:1165-1177`), which can block typing for larger projects.

**Required fix:** debounce/incrementally analyze the active model, associate diagnostics with model version, cancel obsolete work, and keep compile/apply separate from editor feedback.

### 20. Marker ranges are not clamped or normalized

Diagnostic line/column values are passed directly to Monaco (`monaco-editor.jsx:268-279`). A parser error at EOF, an empty line, a deleted line or an out-of-range end column can generate invalid/poorly displayed markers.

**Required fix:** clamp every range to the current model, provide a minimum one-character range where appropriate, and use Monaco's model APIs for EOF positions.

### 21. Diagnostic suggestions are incomplete and locale-inconsistent

`getDiagnosticSuggestion()` matches a small set of code strings (`language-service.js:342-353`) and returns Portuguese text regardless of editor locale. The component then prefixes it with the localized “suggestion” label (`monaco-editor.jsx:270-274`). Many compiler diagnostics have no actionable suggestion, and diagnostic codes are matched inconsistently with regular expressions.

**Required fix:** make suggestions structured, localized through the existing catalog, tied to diagnostic codes, and exposed as Monaco code actions where possible.

### 22. The formatter is not syntax-aware and can change meaning

`formatText()` is indentation/text based (`language-service.js:324-340`). It does not parse strings/comments or validate indentation structure. It resets indentation for declarations using regular expressions and infers nesting only from a preceding colon. It can misformat malformed code, multiline expressions, comments and constructs whose body rules differ.

**Required fix:** format from the parser/AST or implement a tokenizer-aware formatter with preserved comments and a safe no-op behavior when structure is ambiguous. Add idempotence and semantic-preservation tests.

### 23. Language configuration indentation rules are wrong/incomplete

The Monarch configuration increases indentation after any colon and decreases only on an empty line (`monaco-loader.js:52-64`). It does not decrease for `else`/`branch`, declarations or dedent-to-parent cases. Monaco's automatic indentation therefore disagrees with the formatter/compiler.

**Required fix:** implement `onEnterRules`, `indentationRules`, and/or a language configuration provider based on actual block structure. Test Enter, paste, auto-indent and outdent in every control construct.

### 24. Tokenization does not match the language grammar

The Monarch tokenizer has a separately maintained keyword/command list (`monaco-loader.js:66-101`) and a broad identifier regex. It does not tokenize operators from `operatorRegistry`, resource literals, declarations, procedure parameters, invalid constructs or extension syntax consistently. The tokenizer can drift from the compiler and does not provide semantic coloring.

**Required fix:** derive lexical/token metadata from one source of truth or document the intentional split; add tokenization tests for all grammar constructs and error cases.

## Model, lifecycle and synchronization problems

### 25. Model contexts are global mutable state with weak lifecycle isolation

`modelContexts` is a module-level `Map` (`monaco-loader.js:17-23`). Context is keyed by a URI string, and providers read it later. Context updates are not versioned. A model can briefly have the previous file's resources/documents during target switches; stale contexts can also survive if a model is not disposed through every path.

**Required fix:** attach/version context by model, clear it on every disposal, and ensure provider calls see the context matching the current model version.

### 26. Asynchronous Monaco loading has unmount/race hazards

`componentDidMount()` starts `loadMonaco().then(...)` and only checks `this.container` (`monaco-editor.jsx:51-57`). A component can unmount and another component can reuse/clear the DOM before the promise resolves. There is no mounted flag, cancellation or cleanup of a script-load failure path.

**Required fix:** guard initialization with a mounted token, dispose any created editor/model subscriptions on cancellation, and make concurrent primary/secondary initialization deterministic.

### 27. `loadMonaco()` has fragile global loader assumptions

The loader injects `loader.js` and uses global `window.require` (`monaco-loader.js:388-415`). It does not deduplicate an already injected script, verify `window.monaco` after AMD loading, handle an existing unrelated AMD loader, or reset the rejected promise for retry. A transient failure permanently leaves `monacoPromise` rejected for the session.

**Required fix:** implement explicit loader state (`idle/loading/ready/failed`), validate the loaded API, isolate AMD configuration, and support a controlled retry/fallback.

### 28. Model synchronization can overwrite user edits

`getModel()` calls `existing.setValue(value)` whenever the model key exists and the value differs (`monaco-editor.jsx:176-178`). `syncDocumentModels()` also calls `existing.setValue(document.source)` for non-active models (`198-214`). There is no model-version/source-origin check or conflict policy. A workspace refresh can replace an unsaved Monaco edit.

**Required fix:** track source revisions and dirty state per model; only apply external updates when they are known to be newer or when explicitly accepted by the user.

### 29. Secondary editor contexts and cross-editor navigation are incomplete

The secondary editor uses `workspaceModels={false}` and has a separate `instanceKey`, while providers still create document URIs from only `modelKey` (`textwarp-editor.jsx:2142-2160`, `monaco-loader.js:31`). Cross-editor results can target a nonexistent or wrong instance. The primary editor's callbacks are also the main route for opening resources.

**Required fix:** define workspace identity and editor-instance identity explicitly; route navigation to the correct editor/model and test dual-editor definition/reference/rename behavior.

### 30. Model disposal and context disposal are not fully coordinated

The component disposes models on unmount (`monaco-editor.jsx:152-166`), but there is no explicit cleanup when workspace documents disappear from `workspaceModels`, and no protection against a model being reused by another editor instance. This can leak models, subscriptions and contexts during target/project changes.

**Required fix:** reconcile model sets, dispose removed models safely, and use reference counting or an owner registry for shared workspace models.

### 31. Breakpoint and decoration positions are not adjusted explicitly

Breakpoints and active lines are recreated from raw line numbers (`monaco-editor.jsx:284-300`). Monaco decorations can track edits, but the external breakpoint state remains line-number based. Inserting/deleting lines can leave breakpoints pointing at the wrong source line until another state refresh.

**Required fix:** store breakpoints as tracked ranges/markers or update them from Monaco content changes, then persist the adjusted positions.

### 32. Keybinding parsing is incomplete and silently falls back

`parseKeybinding()` only recognizes a small set of named keys and single-letter keys (`monaco-editor.jsx:8-30`). It does not support arrows, digits, punctuation, Escape, Tab, PageUp/PageDown, platform-specific alternatives or invalid-binding diagnostics. Unknown values silently become the fallback, which can cause shortcut collisions.

**Required fix:** use Monaco's key-code map or a complete parser, detect collisions, expose invalid shortcut feedback and test all configured defaults/platforms.

## Resource navigation and indexing problems

### 33. Ctrl/Cmd-click navigation is lexical and can navigate to the wrong resource

The mouse handler chooses quoted text or `getWordAtPosition()` (`monaco-editor.jsx:90-112`) and then calls `navigateResourceByName`. It does not ask the language service which argument/resource reference is under the cursor. A same-named resource owned by another actor may open the wrong target; arbitrary strings can trigger navigation.

**Required fix:** implement a resource definition provider and use resolved resource bindings/IDs, not names alone.

### 34. Resource indexing is incomplete and can be ambiguous

`targetResources()` indexes variables, lists, broadcast messages, costumes and sounds (`workspace-service.js:9-49`), but consumers use names as lookup keys (`textwarp-editor.jsx:866-869`). Duplicate names across owners are not represented in navigation, completion insertion or diagnostics. Asset fallback IDs based on names are not guaranteed stable.

**Required fix:** preserve IDs and owner/module in every reference, resolve by semantic binding, and define duplicate-name behavior.

### 35. Workspace search is not language-aware

`searchWorkspace()` performs one case-insensitive substring search per line (`workspace-service.js:92-110`). It searches comments, strings and generated-looking text equally, returns only the first match per line, and does not provide token/range-aware replace semantics.

**Required fix:** decide whether search is text or semantic search; for text search return all match ranges and preserve Unicode/case behavior; for semantic search use the index. Make replace preview and model synchronization safe.

## Performance and packaging problems

### 36. Repeated full-source rescans are used on interactive paths

`identifierRanges()`, `getDocumentSymbols()` and `getParameterScopes()` rescan complete source strings and are called repeatedly by hover, definitions, references, rename, completion and signatures. Cross-file operations rescan every document. There is no cache keyed by model version.

**Required fix:** maintain an incremental per-model index keyed by Monaco version ID and invalidate only affected documents/context.

### 37. Compilation is synchronous on every keystroke

`handleChange()` calls `compileText()` before updating state and does so for every content event (`textwarp-editor.jsx:1165-1177`). This can cause input latency and React churn. The later timer only delays applying successful compilation; it does not delay analysis.

**Required fix:** debounce analysis, move expensive work off the typing path where possible, use incremental parsing, and benchmark large projects.

### 38. Monaco bundle/static loading has no verified runtime contract

Webpack copies `node_modules/monaco-editor/min/vs` to `static/monaco/vs` (`webpack.config.js:139-140`), while the runtime constructs the URL from `document.baseURI` (`monaco-loader.js:397`). There are no tests here proving the loader works under the deployed base path, nested routes, cached assets, or offline/fallback conditions.

**Required fix:** add a production smoke test for the emitted `static/monaco/vs/loader.js`, base-path deployment, nested URL, cache failure and basic-editor fallback.

### 39. Monaco registration is effectively permanent and not test-isolated

`languageRegistered` is a module-level boolean (`monaco-loader.js:18,48-50`). Tests or hot reloads cannot safely re-register/reset providers, and a failed/partially initialized Monaco instance can leave registration state inconsistent.

**Required fix:** make registration idempotent per Monaco instance, retain provider disposables, and expose test cleanup/reset hooks without leaking global providers.

## Accessibility and UX problems

### 40. Monaco loading failure only provides a basic textarea, losing all language features

The fallback at `monaco-editor.jsx:302-335` offers plain text editing but no diagnostics, completion, formatting, navigation, breakpoints or shortcuts. The UI does not provide a retry action or preserve the reason in an actionable way.

**Required fix:** add retry and useful fallback diagnostics/actions, and ensure failure is visible without exposing raw technical errors as the main user message.

### 41. Editor options are not adaptive to the language

The editor always enables the minimap, word wrap and selection-only whitespace (`monaco-editor.jsx:59-79`). There is no language-specific folding, bracket matching strategy, code lens policy, sticky scroll or large-file policy. Word wrap can make line-based diagnostics/navigation and breakpoint interpretation confusing.

**Required fix:** choose defaults based on TextWarp syntax and user preferences; verify behavior in narrow/split/dual layouts.

### 42. Provider and UI behavior is insufficiently tested

Current tests cover pure language-service examples (`test/textwarp/ide-services.test.js`) but do not instantiate Monaco or test provider output, model URIs, completion duplication/ranges, marker clamping, lifecycle races, cross-file navigation, workspace edits, dual editors, loader paths or fallback behavior.

**Required fix:** add unit tests for the index/service and Monaco-provider adapters, plus browser tests for the actual editor interactions listed above.

## Suggested fix order

1. Establish parser/compiler-backed symbol and resource indexing with stable symbol identities and scopes.
2. Fix URI/model/workspace identity and model synchronization.
3. Replace the two completion providers with one context-aware provider.
4. Implement correct cross-file definition, references and rename workspace edits.
5. Replace fragile call parsing with parser/tokenizer context for completion and signature help.
6. Make diagnostics versioned, debounced, clamped and localized; add code actions.
7. Make formatting and indentation agree with the parser.
8. Add lifecycle, loader, dual-editor, performance and browser coverage.
9. Add semantic highlighting/document highlights and remaining quality-of-life features.

## Definition of done

- Every provider result points to an existing, correctly namespaced Monaco model.
- Local, parameter, global, project-resource and extension symbols resolve by identity, not just spelling.
- Completion has no duplicates, has correct ranges, filters by syntax context and inserts valid code.
- Rename is scope-safe, cross-file, version-safe and updates loaded/unloaded project modules atomically.
- Hover, signature help, definition, references and document outline agree with compiler semantics.
- Diagnostics are debounced/versioned, ranges are valid, suggestions are localized and actionable.
- Formatting, Enter indentation and compiler parsing agree on valid code.
- Primary/secondary editors, target switching, refreshes and unmounts do not lose edits or leak models.
- Production Monaco loading works under the deployed base path and has a tested fallback/retry.
- Automated tests cover the above behavior, not only pure helper happy paths.
