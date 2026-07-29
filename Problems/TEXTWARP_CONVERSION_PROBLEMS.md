# TextWarp Conversion Problems

Status: **resolved — fixed and regression-tested on 2026-07-29 on `develop`**.

This report covers the current blocks-to-text and text-to-blocks implementation,
including the parser/compiler/decompiler, visual synchronization, `.textwarp`
packages, conversion UI, compatibility, data preservation, performance, and
test coverage.

The dedicated suite was green during the audit (`npm run test:textwarp`: 94/94),
but the tests do not exercise several destructive and lossy round trips below.
“Supported opcode” is not the same as “lossless conversion”: fields, input
shapes, mutations, variable identity, comments, layout, and package ownership
must also survive.

## Resolution

The findings below are retained as the audit record. Their release blockers are
closed by the conversion transaction and metadata model introduced after the
audit:

| Findings | Resolution |
| --- | --- |
| CONV-P0-001, P1-013 | Unknown commands, reporters, hats, stacks, nested inputs, shadows, mutations and sequences use safe, non-executing `opaque.*` payloads. The complete original root is adopted once. |
| CONV-P0-002, P1-005, P1-018 | Every apply validates before deletion, rolls back an exact target snapshot on failure, and records the same complete snapshot for manual and automatic Undo. |
| CONV-P0-003, P1-014, P1-015 | Packages carry a per-module ownership state, remap SB3-optimized IDs, bind by saved `targetId` first, and refuse invalid or divergent exports. |
| CONV-P0-004 | Scratch coercion is distinct from the preferred shadow type; active text/number inputs and their replaced shadows round-trip. |
| CONV-P1-006–P1-009, P1-012 | Inline conversion metadata preserves procedure mutations/defaults, variable/cloud identity, durable unit IDs, layout and attached comments. |
| CONV-P1-010 | A visual change that would discard source comments becomes an explicit semantic conflict. |
| CONV-P1-011 | Text to Blocks with unowned visual roots requires Replace matching, Add as new, or Cancel, with root counts shown before applying. |
| CONV-P1-016–P1-021 | Live conversion waits for execution to stop; automatic sync is bidirectional; divergence is tracked independently; Compare performs a fresh unit diff; conflict review shows the semantic apply plan. |
| CONV-P1-022–P2-025 | Interactive compile/decompile and comparison run in a cancellable worker, large automatic work is bounded, source ownership is compacted, depth has controlled limits, and one prepared workspace index is reused per project-change pass. |
| CONV-P1-026–P1-028 | Regression coverage now asserts graph/state equivalence, package behavior, rollback, real-VM production-editor policies and limits. `test:textwarp` is required in CI and before web publishing. |
| Internet-project compatibility follow-up | Negative declaration values, orphaned/custom argument reporters, malformed legacy procedures and procedure names that collide with built-ins now compile or use lossless `opaque.*` fallbacks. The supplied six `.sb3` samples cover all 30 original stage/actor targets. |
| Project-wide Blocks to Text follow-up | Convert can decompile every original target in one validated transaction. Any failure or source conflict prevents all mutation, and one project snapshot undoes the complete operation. |

Closure validation is the matrix at the end of this document plus
`test/textwarp/conversion-regressions.test.js`,
`editor-conversion-behavior.test.js`, `language-v03.test.js`,
`package.test.js`, `sample-projects.test.js`, `source-merge.test.js`, and
`ui-integration.test.js`. The current dedicated suite passes 122/122 tests.

## Release-blocking correctness problems

### CONV-P0-001 — An unsupported nested block can duplicate the rest of its stack

- **Evidence:** `decompileTarget` replaces an unsupported command with
  `pass # bloco indisponível: <opcode>`, marks the root unsupported, and still
  emits the supported commands around it (`decompiler.js:390-410`,
  `decompiler.js:492-544`). The result is valid, compilable TextWarp source.
  `acceptVisualChanges` adopts only `importedRootIds`, then compiles and applies
  the entire emitted source (`textwarp-editor.jsx:1166-1195`).
- **Confirmed reproduction:** a visual
  `when green flag -> vendor_missing -> say("after")` stack decompiles to:

  ```text
  on green_flag:
      pass # bloco indisponível: vendor_missing
      say("after")
  ```

  `importedRootIds` is empty, the original root is retained as unsupported, and
  recompilation creates a second green-flag stack containing `say("after")`.
- **Impact:** accepting visual changes or later editing the imported source can
  run supported commands twice while the UI says the unsupported block was
  “kept only as blocks.” Procedures and loose stacks have the same failure mode.
- **Required fix / acceptance:** never compile a textual placeholder for a root
  that remains block-only. Represent the entire root as an opaque preserved
  unit, or exclude it from the compilation being applied. Add command,
  reporter, control-body, procedure, event, and loose-stack regression tests
  asserting that root count and runtime behavior do not change.

### CONV-P0-002 — “Undo conversion” cannot undo Text to Blocks

- **Evidence:** `captureConversionSnapshot` stores only the current source,
  target ID, filename, direction, and timestamp
  (`textwarp-editor.jsx:822-848`). For a `text-to-blocks` undo,
  `undoLastConversion` recompiles that same source and applies it again
  (`textwarp-editor.jsx:850-870`).
- **Impact:** the advertised undo action cannot restore the previous block
  graph, positions, comments, mutations, or variables. It reports success after
  repeating the conversion.
- **Required fix / acceptance:** snapshot the affected block roots, comments,
  variable state, source record, and relevant monitor metadata before mutation,
  or use a VM-native transactional undo. A test must compare the complete
  pre-conversion and post-undo project structures.

### CONV-P0-003 — Exporting an ordinary Scratch project as `.textwarp` can duplicate every converted stack on import

- **Evidence:** when a target has no embedded TextWarp record,
  `exportTextwarpProject` decompiles source for the package but saves the SB3
  without adopting or marking those existing roots
  (`textwarp-package.js:225-250`). Import loads that SB3, writes a source-only
  record, compiles the module, and applies it (`textwarp-package.js:313-361`).
  With no generated-root markers in the loaded SB3, `applyCompilation` treats
  all compiled units as new and preserves all original roots
  (`vm-adapter.js:301-350`).
- **Impact:** a blocks-only Scratch project can reopen from its `.textwarp`
  export with duplicate scripts and duplicate runtime behavior.
- **Required fix / acceptance:** package export must record the ownership map
  for decompiled roots, or import must adopt matching loaded roots before
  applying source. Add a real VM round-trip test starting with a marker-free SB3
  and assert identical root count, opcodes, IDs/ownership, and behavior.

### CONV-P0-004 — Valid Scratch input connections can decompile to TextWarp that refuses to compile

- **Evidence:** the decompiler correctly emits the active reporter connected to
  an input (`decompiler.js:261-290`), but semantic analysis rejects a literal
  whose type differs from the registry's preferred input type
  (`compiler.js:360-375`). Scratch's string/number inputs permit coercible
  reporters of either shape.
- **Confirmed reproductions:**

  - a valid `say` block whose active input is `math_number(123)` becomes
    `say(123)` and fails with `invalid-argument-type`;
  - a valid `move` block whose active input is `text("hello")` becomes
    `move("hello")` and fails with the same diagnostic.

- **Impact:** native, executable Scratch stacks can be classified as supported
  by the decompiler but cannot complete Blocks to Text or automatic
  synchronization.
- **Required fix / acceptance:** model Scratch coercion separately from editor
  shadow preference. Test every native and extension input with literal text,
  number, reporter, menu shadow, and replaced-shadow forms; require successful
  round-trip with the same active and shadow input semantics.

## Data-loss and compatibility problems

### CONV-P1-005 — Applying a compilation is not atomic

- **Evidence:** changed roots are deleted before generated-ID collision checks,
  block creation, variable synchronization, and source-record writing
  (`vm-adapter.js:336-408`). Any exception after deletion leaves a partially
  mutated target. The UI catches the exception only after the adapter has
  changed project state (`textwarp-editor.jsx:1904-1936`).
- **Impact:** an ID collision, malformed graph, VM failure, or variable failure
  can remove working scripts without a rollback.
- **Required fix / acceptance:** validate the full plan first, then apply it
  transactionally or restore an exact snapshot on failure. Inject failures at
  deletion, creation, variable sync, and record write in tests.

### CONV-P1-006 — Scratch custom-procedure signatures and defaults are lossy

- **Evidence:** the decompiler derives a procedure name from only the text
  before the first `%s`, `%b`, or `%n` placeholder and reads parameter names and
  IDs, but not `argumentdefaults` or the complete label structure
  (`decompiler.js:119-158`). The compiler regenerates a signature as
  `<sanitized-name> %type %type` with empty/false defaults
  (`compiler.js:171-205`, `compiler.js:1246-1280`).
- **Confirmed reproduction:** Scratch mutation
  `say %s for %s seconds`, defaults `["hello","2"]`, becomes
  `procedure say(message, duration)` and recompiles as `say %s %s`, defaults
  `["",""]`.
- **Impact:** Blocks to Text changes the visible custom-block label, default
  arguments, encoded procedure IDs, and potentially extension-specific
  procedure mutation data even though procedure calls still appear to run.
- **Required fix / acceptance:** introduce a lossless signature model that
  preserves literal label segments, placeholder order/type, defaults, warp,
  return metadata, and unknown mutation properties. Compare complete prototype
  and call mutations in round-trip tests.

### CONV-P1-007 — Renaming a TextWarp variable replaces its Scratch identity

- **Evidence:** new variable IDs are hashes of owner, type, and source name
  (`compiler.js:140-168`). `syncVariables` deletes generated variables absent
  from the new declaration set, then creates replacements
  (`vm-adapter.js:241-278`). A rename from `score` to `points` therefore changes
  the ID instead of renaming the existing variable.
- **Confirmed reproduction:** compiling the two declarations produces different
  stable IDs even when the old generated variable is supplied in compiler
  options.
- **Impact:** current value, cloud association, monitors, sliders, and blocks in
  other targets that refer to the old ID can be lost or disconnected. The
  Monaco rename provider makes this destructive path easy to invoke.
- **Required fix / acceptance:** persist declaration identity independently of
  the source spelling and call the VM's rename operation. Preserve values,
  `isCloud`, monitor records, and cross-target references in local/global
  rename tests.

### CONV-P1-008 — Variable declarations do not represent full Scratch variable state

- **Evidence:** decompilation records name, list/scalar type, and current value
  only (`decompiler.js:479-487`). Compiler/adapter metadata does not carry
  `isCloud`, monitor visibility/mode/position, slider range, or an exact
  distinction among all runtime value types (`compiler.js:140-168`,
  `vm-adapter.js:241-278`).
- **Impact:** source is not a portable canonical representation of cloud
  variables or monitor state. Recreating a variable after rename/deletion can
  silently downgrade it and reset associated UI.
- **Required fix / acceptance:** define which state is source-owned and preserve
  all non-source-owned state by stable ID. Add cloud, scalar, list, visible
  monitor, slider, and cross-target tests.

### CONV-P1-009 — Changed units lose visual layout and block-attached information

- **Evidence:** a changed unit is deleted and recreated
  (`vm-adapter.js:316-350`). Generated event/procedure/loose-stack coordinates
  are fixed grid positions (`compiler.js:1185-1283`); comments and other
  per-block UI metadata are not transferred by the adapter.
- **Impact:** a small text edit can move a stack, orphan or delete comments, and
  discard visual organization. This makes repeated text/blocks editing
  progressively destructive even when opcode semantics survive.
- **Required fix / acceptance:** map old and new blocks structurally and
  transfer root coordinates, attached comments, and supported visual metadata.
  Assert those properties after edits inside events, controls, procedures,
  loose stacks, and reporters.

### CONV-P1-010 — Comments inside a visually changed textual unit are silently discarded

- **Evidence:** `mergeVisualSource` replaces the complete source range for a
  visually changed unit (`source-merge.js:14-69`). Decompilation emits generated
  statements, not the user's comments (`decompiler.js:304-415`). Existing tests
  only promise preservation *outside* a changed unit.
- **Impact:** moving or editing one block can erase explanatory comments in the
  corresponding TextWarp event/procedure/stack without a merge conflict.
- **Required fix / acceptance:** merge comments/formatting at statement level or
  surface an explicit conflict. Add leading, inline, between-statement, and
  nested comments to visual-edit tests.

### CONV-P1-011 — Text to Blocks silently adds scripts beside unowned visual scripts

- **Evidence:** `applyCompilation` removes only roots owned by the embedded
  generated-root record and deliberately leaves manual roots untouched
  (`vm-adapter.js:281-350`). The Convert menu leaves Text to Blocks enabled even
  when the target has existing unowned blocks
  (`textwarp-editor.jsx:2824-2855`).
- **Impact:** on a blocks-first target, compiling the starter or another source
  adds parallel event handlers instead of converting/replacing the visible
  scripts. The only protection is passive help text shown when the target is
  first loaded.
- **Required fix / acceptance:** require an explicit scope choice: replace
  matching roots, add as new roots, or cancel. Preview root-level additions and
  replacements before applying.

### CONV-P1-012 — Positional unit IDs cause unrelated stacks to be replaced

- **Evidence:** loose stacks and standalone reporters use `stack:#<index>` and
  `reporter:#<index>` identities; repeated events use
  `script:<event>#<occurrence>` (`compiler.js:1185-1244`).
- **Confirmed reproduction:** inserting a new loose stack at the top assigns the
  old first stack's ID/root to the new stack, shifts the old first stack to the
  old second root, and allocates a new root for the old second stack.
- **Impact:** insertion/reordering churns roots, positions, comments,
  breakpoints/source maps, and running threads for otherwise unchanged units.
- **Required fix / acceptance:** persist durable unit identity or match units by
  content/structure plus history. Test insertion, deletion, and reordering of
  identical events, stacks, reporters, and procedures.

### CONV-P1-013 — Unavailable extensions make editable source incomplete by design

- **Evidence:** unsupported blocks are represented by comments and `pass`/`0`,
  and the decompiler explicitly never writes a lossless `raw.*` form
  (`decompiler.js:193-249`, `decompiler.js:390-544`). Extension syntax exists
  only for the catalog currently loaded from runtime `getInfo()`.
- **Impact:** an SB3 with unavailable, denied, obsolete, or malformed extension
  metadata cannot have a complete editable TextWarp representation. The source
  cannot recreate the project by itself, and the nested-root duplication bug
  makes partial conversion unsafe.
- **Required fix / acceptance:** provide a safe opaque AST/unit format for
  unknown blocks, including fields, inputs, shadows, mutation, and branches,
  without executing untrusted primitives. Clearly mark block-only units in the
  editor and package manifest.

### CONV-P1-014 — `.textwarp` export can package stale source and current blocks as if they agree

- **Evidence:** export always prefers an existing source record and does not
  compare it with the current block fingerprint or decompile the current target
  (`textwarp-package.js:225-250`). When automatic block sync is disabled, the
  source record can legitimately be stale.
- **Impact:** the package contains two conflicting representations. Import then
  loads the current SB3 and applies the stale source to generated roots, so the
  reopened project can differ from both the exported blocks and the editor text.
- **Required fix / acceptance:** block export on unresolved divergence or store
  both versions with an explicit resolution state. A package round trip must
  cover auto-sync off, visual edits, text errors, conflicts, and unsupported
  roots.

### CONV-P1-015 — Package import ignores the saved target ID when attaching modules

- **Evidence:** the manifest stores both `targetId` and `moduleId`, but
  `targetForModule` selects actors by name or first unused target and never
  checks `module.targetId` (`textwarp-package.js:225-237`,
  `textwarp-package.js:272-276`).
- **Impact:** projects with duplicate actor names, renamed actors, or changed
  target order can attach a module's source to the wrong sprite and then compile
  it there.
- **Required fix / acceptance:** match the loaded SB3 target ID first, validate
  stage/actor kind, then use an explicit migration fallback. Add duplicate-name
  and reordered-target package tests.

### CONV-P1-016 — Applying source during a running project changes execution non-transactionally

- **Evidence:** changed-root threads are stopped individually before roots are
  deleted (`vm-adapter.js:196-217`, `vm-adapter.js:336-350`). Automatic compile
  applies after a short typing delay without first stopping or pausing the
  project as a whole (`textwarp-editor.jsx:1751-1800`).
- **Impact:** some threads continue on old code while changed threads disappear;
  variables and broadcasts can be modified mid-run. The resulting runtime state
  is not an atomic old-version or new-version execution.
- **Required fix / acceptance:** define and expose a live-update policy. Either
  stop/restart deterministically, queue conversion until stopped, or provide a
  VM transaction/safe point. Test concurrent threads and clones.

## Interface and synchronization problems

### CONV-P1-017 — Disabling Automatic synchronization does not disable automatic Text to Blocks

- **Evidence:** `setAutoSync` changes a preference used only by
  `handleProjectChanged` for blocks-to-text synchronization
  (`textwarp-editor.jsx:812-815`, `textwarp-editor.jsx:1082-1125`).
  `handleChange` always compiles valid text and applies it after 120 ms + 300 ms,
  with no `autoSync` check (`textwarp-editor.jsx:1751-1800`).
- **Impact:** the label implies a bidirectional switch, but blocks continue to
  mutate automatically. The explicit Text to Blocks menu action is therefore
  not the actual commit boundary.
- **Required fix / acceptance:** either make the preference bidirectional or
  split it into clearly named directions. With automatic text application off,
  typing must only analyze/save source until the user confirms conversion.

### CONV-P1-018 — Automatic conversions have no working conversion undo

- **Evidence:** only the explicit `handleCompile` path captures a conversion
  snapshot (`textwarp-editor.jsx:1939-1961`). The automatic apply path calls
  `applyCompilation` without one (`textwarp-editor.jsx:1792-1798`).
- **Impact:** typing valid source can replace blocks after 420 ms without showing
  the conversion banner or offering any conversion-level recovery.
- **Required fix / acceptance:** every project mutation caused by text editing
  must enter the same undo transaction/history as an explicit conversion.

### CONV-P1-019 — The synchronization indicator ignores live block divergence

- **Evidence:** the rendered state is derived from source vs.
  `lastAppliedSource`, diagnostics, and `visualConflict`; it does not compare the
  current block fingerprint (`textwarp-editor.jsx:2596-2605`). With auto-sync
  off, `handleProjectChanged` returns without creating a conflict
  (`textwarp-editor.jsx:1082-1092`).
- **Impact:** the status can say “Synchronized with blocks” after blocks have
  changed.
- **Required fix / acceptance:** derive status from independently versioned text
  and block snapshots. Test visual edits with auto-sync on/off, code-only view,
  invalid text, and cancelled conflicts.

### CONV-P1-020 — “Compare versions” does not compare versions

- **Evidence:** when no stored conflict exists, `compareTextAndBlocks` only opens
  split view and unconditionally reports `versionsSynchronized`
  (`textwarp-editor.jsx:817-821`). It does not decompile, fingerprint, compile,
  or diff anything.
- **Impact:** users can receive a false synchronized result precisely when they
  request verification. The split view is code plus Blockly, not a semantic
  text/block diff.
- **Required fix / acceptance:** compute a fresh comparison and show per-unit
  added/removed/changed/unsupported results before claiming synchronization.

### CONV-P2-021 — Conversion conflict preview is an unstructured full-source dump

- **Evidence:** conflict review renders the complete current and decompiled
  sources in two `<pre>` elements without a diff model, unit navigation, or
  unsupported-root detail (`textwarp-editor.jsx:3075-3090`).
- **Impact:** large projects make it difficult to identify the actual changed
  unit or understand what “Use Blocks” will preserve, duplicate, or replace.
- **Required fix / acceptance:** show a scalable, line/unit-level diff with
  affected roots, unsupported opcodes, and the exact apply plan.

## Performance and robustness problems

### CONV-P1-022 — Conversion and full-record serialization run synchronously on the UI thread

- **Evidence:** parsing, semantic analysis, graph generation, decompilation,
  fingerprinting, source-record JSON serialization, and block mutation are all
  synchronous calls from React/VM event handlers
  (`textwarp-editor.jsx:1082-1125`, `textwarp-editor.jsx:1751-1800`,
  `textwarp-editor.jsx:1904-1957`). There is no worker, cancellation token, or
  incremental compiler.
- **Measured during this audit:** 5,000 small event stacks (15,000 blocks) took
  about **311 ms** for `compileText` alone on the audit machine, longer than the
  300 ms auto-apply delay. This excludes React rendering, VM mutation,
  decompilation, and JSON persistence.
- **Impact:** typing, Blockly edits, conversion, and menus can freeze on large
  projects; stale work cannot be cancelled once it starts.
- **Required fix / acceptance:** move pure conversion to a worker or chunked
  cancellable pipeline, compile only changed units, and publish latency/memory
  budgets for representative project sizes.

### CONV-P1-023 — The embedded source record amplifies project size

- **Evidence:** each target comment stores the full source, full source map,
  generated block ID list, per-unit block ID/opcode lists, bindings, and other
  metadata as one JSON string (`vm-adapter.js:5-19`, `vm-adapter.js:142-163`,
  `vm-adapter.js:367-408`).
- **Measured during this audit:** for generated projects with 100, 1,000, and
  5,000 simple event stacks, the record was approximately **25–27 times** the
  source size (about 4.5 MB for 183 KB of source at 5,000 stacks), before SB3
  container overhead.
- **Impact:** every source save parses and rewrites a large comment; SB3 size,
  memory, project-change traffic, and save time grow much faster than source.
- **Required fix / acceptance:** normalize/compact ownership metadata, avoid
  duplicated ID arrays, persist source maps separately or regenerate them, and
  benchmark SB3 size plus edit/save latency.

### CONV-P1-024 — Deep but valid projects crash conversion with `RangeError`

- **Evidence:** parser block nesting, compiler graph generation, decompiler
  nested sequences, and adapter graph walks are recursive and have no depth
  guard or controlled diagnostic.
- **Confirmed reproduction on the audit machine:** about 2,000 nested TextWarp
  `forever` bodies overflowed during compilation; about 5,000 nested visual
  control blocks overflowed during decompilation.
- **Impact:** a large/malicious SB3 or generated source can throw out of manual
  conversion and automatic sync. `handleImportBlocks` and
  `handleProjectChanged` do not wrap the full conversion pipeline in a recovery
  boundary.
- **Required fix / acceptance:** use iterative traversals where practical, set a
  documented safe depth/size limit, return diagnostics instead of throwing, and
  test just below and above the limit.

### CONV-P2-025 — Project-change synchronization repeats full-project work

- **Evidence:** every debounced project change calls
  `synchronizeProjectReferences`, which builds the whole workspace, iterates
  every target, and may call `getCompileOptions`; `getCompileOptions` builds the
  whole workspace again (`textwarp-editor.jsx:1082-1144`,
  `textwarp-editor.jsx:1009-1037`). The active target is then fingerprinted by
  sorting and JSON-stringifying every block and variable
  (`textwarp-editor.jsx:135-159`).
- **Impact:** target/resource/reference synchronization trends toward repeated
  full-project or quadratic work as actor count grows, before actual
  decompilation begins.
- **Required fix / acceptance:** maintain versioned indexes per target/resource,
  invalidate only affected records, and benchmark many-target projects.

## Test and release-gate gaps

### CONV-P1-026 — Round-trip tests mostly prove opcode presence, not equivalence

- **Evidence:** `complete-block-coverage.test.js` generally compiles one
  registry-generated example, checks that the opcode exists, decompiles without
  `raw.*`, recompiles, and checks that the opcode exists again. It does not
  compare complete fields, active/shadow inputs, mutations, coordinates,
  comments, variable IDs/state, monitors, root count, or execution equivalence.
- **Impact:** all 94 TextWarp tests pass while P0-001 through P0-004 remain
  reproducible.
- **Required fix / acceptance:** add a canonical graph comparator with explicit
  exclusions, real SB3 fixtures, package round trips, UI conversion tests, and
  runtime equivalence checks. Coverage must include non-default values and
  legal cross-shaped/coercible inputs.

### CONV-P1-027 — UI tests inspect source markup instead of exercising conversion behavior

- **Evidence:** `ui-integration.test.js` asserts that conversion menu strings and
  handlers appear in source, but there are no behavioral tests for conversion
  confirmation, auto-sync directions, status truthfulness, compare, conflict
  decisions, or undo.
- **Impact:** broken controls and false status messages can ship with green unit
  and interface suites.
- **Required fix / acceptance:** drive the production editor with a real VM and
  Blockly workspace. Assert block/source state before and after each menu action,
  conflict choice, automatic-sync mode, and undo.

### CONV-P1-028 — CI does not currently make conversion regressions release-blocking

- **Evidence:** the broader repository audit already records that the normal CI
  and publish workflows omit `npm run test:textwarp`
  (`Problems/PROJECT_P0_PROBLEMS.md`, P0-003 and P0-004).
- **Impact:** even improved conversion tests would not prevent merge or web
  publication until the workflow runs them.
- **Required fix / acceptance:** make TextWarp conversion/unit/browser/package
  tests required for CI and publishing.

## Recommended remediation order

1. Stop destructive/duplicating paths: CONV-P0-001 through CONV-P0-004, then
   make apply transactional (CONV-P1-005).
2. Repair recovery and truthfulness: CONV-P0-002 and CONV-P1-017 through
   CONV-P1-020.
3. Establish a lossless ownership/identity model for procedures, variables,
   units, comments, layout, and opaque blocks (CONV-P1-006 through
   CONV-P1-013).
4. Make `.textwarp` round trips consistent and target-safe (CONV-P0-003,
   CONV-P1-014, CONV-P1-015).
5. Move conversion off the interactive hot path and compact persisted metadata
   (CONV-P1-022 through CONV-P2-025).
6. Replace opcode-presence coverage with semantic, package, and UI round trips,
   then require them in CI (CONV-P1-026 through CONV-P1-028).

## Minimum validation matrix for closure

- Directions: Text to Blocks, Blocks to Text, automatic sync both directions,
  conflict choices, cancel, and undo.
- Origins: ordinary Scratch SB3, TextWarp-generated SB3, `.textwarp`, extension
  project, and legacy embedded record.
- Structures: events, duplicate events, loose stacks, reporters, nested control,
  procedures, unsupported nested blocks, and empty branches.
- State: variables/lists/cloud variables, broadcasts, monitors, comments,
  positions, mutations, active/shadow inputs, running threads, and clones.
- Scale: many targets, many roots, large source, deep nesting, and large
  extension catalogs.
- Assertions: no duplicate roots, no lost blocks/state, exact owned-root map,
  truthful sync state, working undo, bounded latency/memory, and equivalent
  runtime behavior.
