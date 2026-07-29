# TextWarp Performance Audit and Optimization Backlog

Status: **resolved and regression-guarded on 2026-07-29**.

This document records performance problems confirmed in the current `scratch-gui` TextWarp web/editor implementation.
It covers startup transfer, retained memory, typing and analysis latency, project-wide search, history storage, debugger
updates, and render frequency. It does not duplicate correctness-only items from
`Problems/MONACO_EDITOR_PROBLEMS.md`.

No P0 performance failure was confirmed in this pass. The P1 items are capable of producing visible pauses, large memory
growth, or slow startup on realistic large projects and mobile hardware.

## Priority guide

- **P0** — reliably freezes, crashes, or makes the editor unusable in a normal supported workflow.
- **P1** — causes material startup, memory, or interaction cost and should be addressed before calling large projects
  performant.
- **P2** — smaller or workload-specific gain, or missing protection against a future regression.

## Audit baseline

The measurements below were taken from commit `077ca482f` with Node `v26.2.0` and npm `12.0.1`. Synthetic measurements
invoke the production source functions directly; they are reproducible workload indicators, not substitutes for a
browser trace on target mobile and desktop hardware.

| Workload | Observed result |
| --- | ---: |
| `npm run build:textwarp:web` | 36.0 s wall time |
| Scripts referenced by `build/index.html` | 5 files, 7.46 MiB raw, 1.83 MiB gzip |
| Complete `build/` artifact | 538 files, 40.39 MiB |
| Copied Monaco tree in `build/static/monaco/` | 138 files, 14.89 MiB |
| Monaco `editor.api` asset | 3.49 MiB raw, approximately 0.88 MiB gzip |
| 81 indexes of an 84,185-character source | 8.07 s total, 312.8 MiB retained heap after GC |
| Search for `a` in five 100,000-character modules | 500,000 results, 87.5 ms, 39.2 MiB retained heap |
| 30 history copies of a 100,000-character source | 3,001,851 JSON characters; 9.57 ms to stringify |

The production build completed successfully, but Webpack reported oversized entrypoint/assets. The build warning is
informational and does not enforce a project-specific performance budget.

## Resolution measurements

The fixes below were validated on the same host and Node runtime. The production build and the new
`npm run perf:textwarp` hard-budget check produced:

| Workload | Resolved result |
| --- | ---: |
| `npm run build:textwarp:web` | successful, 34.6 s wall time |
| Scripts referenced by `build/index.html` | 7 cacheable files, 6.86 MiB raw, 1.68 MiB gzip |
| Complete `build/` artifact | 439 files, 23.41 MiB |
| Allowlisted Monaco runtime | 17 files, 4.26 MiB |
| 81 revisions of a 105,616-character model | 4.12 s, one retained index, +4.14 MiB heap after GC |
| Search across 2.16 million characters | capped at 500 results in 1.9 ms |
| 30 compact 100,000-character history revisions | 302,184 JSON characters; 604,368 estimated bytes |

This reduces the complete artifact by 42%, the Monaco artifact by 71%, and initial compressed JavaScript by 8% while
moving optional feature code out of the first route. `index.html` and `editor.html` now reference the same canonical
entry assets.

## Highest-impact runtime problems

### Resolved P1 — The language index cache retained 80 complete source revisions

`src/lib/textwarp/language-service.js:18-19` creates a process-wide cache with 80 entries. The cache key contains the
complete source, and each cached value retains the normalized source, split lines, AST, diagnostics, symbols, and a
second token collection (`language-service.js:181-187`, `332-343`). A normal edit creates a new key on every source
revision. The cache therefore behaves like an 80-revision history rather than a reusable model cache.

The audit generated 81 revisions of one valid 84,185-character module and called `getOutline()` for each revision. The
process retained **312.8 MiB after forced garbage collection**, and indexing took **8.07 seconds** in total. The exact
browser figure will differ, but the retained object topology is the same.

Consequences:

- sustained typing in a large file can retain hundreds of megabytes;
- two editor panes and multiple project modules compete for the same global 80-entry allowance;
- source text is duplicated in the key and in the cached index;
- FIFO eviction is based on entry count, not retained bytes or model ownership.

Required fix:

1. Key the cache by workspace/model identity and store only the current revision plus, at most, a very small previous
   revision needed for an in-flight request.
2. Bound the cache by estimated bytes as well as entry count and clear a workspace when its Monaco models are disposed.
3. Reuse the index token list instead of calling `scanSource()` again in identifier helpers.
4. Add a heap regression test that indexes at least 80 revisions of a 100 KiB source and asserts that old revisions are
   collectible.

Expected gain: the audit workload should retain the current index rather than approximately 313 MiB of historical
indexes, while repeat requests for the same model revision should remain cached.

Resolution: the cache is now keyed by model identity, replaces the previous revision, enforces a 16 MiB estimated-byte
budget, reuses indexed tokens, and clears disposed Monaco model entries. The 81-revision regression retains one
2.83 MiB estimated index and only 4.14 MiB additional measured heap after GC.

### Resolved P1 — Typing destroyed the conversion worker instead of cancelling work logically

`TextEditor.handleChange()` increments a generation and calls `conversionWorker.cancelPending()` on every Monaco change
before the 120 ms analysis debounce (`src/containers/textwarp-editor.jsx:2098-2128`). `cancelPending()` rejects requests
**and terminates the worker** (`src/lib/textwarp/conversion-worker-client.js:83-89`). The next analysis creates a new
worker and loads the 101,918-byte worker script again (`conversion-worker-client.js:23-27`).

This throws away parser/compiler warm state on every typing burst. It also makes cancellation more expensive when no
request is pending: a completed, idle worker is still terminated by the next keystroke.

Required fix:

- split `cancelPending()` from `dispose()`;
- keep one worker alive for the editor lifetime;
- send a generation/request ID and ignore stale responses without terminating the worker;
- optionally coalesce queued compile requests so only the newest source is processed;
- terminate only on unmount, fatal worker error, or an explicit recovery action.

Regression coverage should count worker constructions across repeated edits. A typing burst followed by several pauses
should construct one worker, and stale responses must never update diagnostics or blocks.

Resolution: logical cancellation now rejects and forgets stale request IDs without terminating the worker. The worker
is terminated only by `dispose()`, fatal worker failure, or editor unmount. Regression coverage proves cancellation and
subsequent compilation reuse one worker and that stale responses have no pending request to update.

### Resolved P1 — Draft text changes entered the block-change synchronization pipeline

Every keystroke calls `saveTextSource()` (`src/containers/textwarp-editor.jsx:2104`). That function updates the hidden
draft comment and emits the generic VM `PROJECT_CHANGED` event (`src/lib/textwarp/vm-adapter.js:306-328`). The editor
listens to that event as if blocks or resources changed (`textwarp-editor.jsx:377`, `1318-1410`).

After the 220 ms block debounce, even a text-only edit:

- rebuilds the whole project workspace;
- searches it again when a query is active;
- calls `setState()` with the rebuilt workspace;
- sorts and serializes every block and variable to calculate `blockFingerprint()`
  (`src/lib/textwarp/vm-adapter.js:104-133`);
- may enter the more expensive decompile and three-compilation merge path if the fingerprint changed.

The 120 ms text analysis, 220 ms block synchronization, 300 ms auto-compile, and 1,200 ms history timers can consequently
all fire for one typing pause.

Required fix: distinguish project-change origins. A draft-source update should mark the project dirty and update the
active workspace module without scheduling a block fingerprint/decompile. Block synchronization should subscribe to a
block/resource-specific signal, or `saveTextSource()` should emit metadata that lets `handleProjectChanged()` ignore its
own draft write. Add a regression test proving that text-only input never calls `blockFingerprint()` or
`decompileTarget()`.

Resolution: draft persistence suppresses the generic VM project-change event and marks the Redux project dirty
directly. Text input therefore does not enter `handleProjectChanged()` or its block fingerprint/decompile path. A
regression test verifies that draft writes emit no block-change event.

### Resolved P1 — Project search computed and retained every match on every input event

The Search input invokes `onSearch` for every character
(`src/components/textwarp-editor/ide-sidebar.jsx:296-306`). `handleSearch()` rebuilds the project workspace and runs a
synchronous scan immediately (`src/containers/textwarp-editor.jsx:1766-1770`). `searchWorkspace()` creates one result
object per match with no computation or result cap (`src/lib/textwarp/workspace-service.js:83-105`).

UI pagination does not protect this path: it limits rendered rows only after all results have already been allocated.
In the audit, a deliberately broad one-character search over only 500,000 source characters created 500,000 objects,
retained **39.2 MiB**, and took **87.5 ms** in Node. A larger project can produce a much longer main-thread task.

Required fix:

- debounce search input and reuse the current workspace snapshot;
- cap collected matches per module and globally, returning a `truncated` count/state;
- stop scanning as soon as the cap is reached unless the user explicitly requests all results;
- move large-project search to a worker or maintain a revisioned line index;
- add broad-query and rapid-input benchmarks.

Resolution: input is debounced by 160 ms, searches reuse the current workspace and a WeakMap-backed per-module line
index, and collection stops at 200 matches per module and 500 globally. The result array exposes a non-enumerable
`truncated` state shown in the UI. The 2.16-million-character broad-query regression completes in under 2 ms on the
audit host and allocates only the capped 500 result objects.

### Resolved P1 — History stored synchronous full-source snapshots in `localStorage`

`saveHistorySnapshot()` reads, copies, and synchronously stringifies up to 30 complete source snapshots per target
(`src/lib/textwarp/workspace-service.js:5`, `170-183`). Typing schedules this operation after 1.2 seconds of inactivity
and then rebuilds the workspace again (`src/containers/textwarp-editor.jsx:2112-2124`).

For the supported 100,000-character automatic-analysis boundary, 30 snapshots produced **3,001,851 JSON characters**
before storage overhead. The audit stringify alone took **9.57 ms** on a fast desktop Node process. The browser must do
that work on the UI thread, and several targets can approach browser storage quotas quickly. Failure is caught, but the
history silently stops advancing.

Required fix:

- store history asynchronously in IndexedDB;
- use deltas between revisions with periodic full checkpoints;
- enforce per-project and global byte budgets rather than only a snapshot count;
- skip autosave when the source has not materially changed since the last queued revision;
- expose quota/failure state instead of returning the old history silently.

Add tests for multiple 100 KiB targets, quota failure, pruning, reload, and restoration.

Resolution: history is queued without synchronous serialization, stored asynchronously in IndexedDB, delta-encoded
with a full checkpoint every ten revisions, and bounded to 1 MiB per target and 16 MiB globally. A compact
`localStorage` fallback preserves recovery when IndexedDB is unavailable, while quota failures reject the persistence
promise and surface an editor status. Tests cover delta restoration, checkpoints, boundary fitting, fallback reload,
and quota failure.

### Resolved P1 — Debug snapshots could rebuild and rerender the whole IDE at frame rate

The editor subscribes with `debugSnapshot => this.setState({debugSnapshot})`
(`src/containers/textwarp-editor.jsx:367-370`). When debugging is enabled, every primitive calls `notify()`
(`src/lib/textwarp/debug-controller.js:254-262`), which coalesces updates to 16 ms
(`debug-controller.js:507-513`). A separate 80 ms poll also requests snapshots (`debug-controller.js:157-178`).

Each snapshot walks every runtime thread and call stack, resolves source locations, and calls `inspectTarget()` for each
thread (`debug-controller.js:437-498`). The resulting parent state update rerenders the 4,000-line `TextEditor`
composition, including the activity bar, sidebar, both Monaco wrappers, blocks pane, documentation pane, and bottom
panel. Breakpoints keep debugging enabled even when the Debugger panel is not visible
(`src/containers/textwarp-editor.jsx:2003-2013`).

Required fix:

1. Separate the debugger store from the editor layout state and subscribe only the debugger panel and active-line
   decoration consumers.
2. Do not inspect variables/call stacks unless the debugger panel is visible or execution is paused.
3. Use one sampling schedule, with a lower rate while running and an immediate update for pause/step/error.
4. Compare the lightweight active-thread state before publishing a new snapshot.

Validate runtime throughput with debugging disabled, enabled with a hidden panel, visible while running, and paused.

Resolution: debugger state is no longer React state on the parent editor. Hidden consumers subscribe to lightweight
snapshots without inspector or call-stack construction; active-line decorations update Monaco directly; runtime status
and the visible debugger/console own small subscriptions. Running sampling is 5 Hz, primitive execution no longer
publishes at frame rate, and identical snapshots are suppressed before delivery.

## Startup and delivery problems

### Resolved P1 — The default web page eagerly loaded a 7.46 MiB JavaScript entry set

The production `/textwarp/` page references five initial scripts totaling **7.46 MiB raw / 1.83 MiB gzip**, before
Monaco is requested. `splitChunks` is limited to five initial requests (`webpack.config.js:195-201`), and the page's
shared vendor and player chunks are approximately 5.31 MiB and 2.25 MiB raw.

Large optional surfaces are statically reachable:

- GUI imports costume/sound tabs, libraries, cards, connection UI, and every modal at module load
  (`src/components/gui/gui.jsx:12-38`);
- TextWarp imports Blocks, Documentation, and Backpack eagerly
  (`src/containers/textwarp-editor.jsx:5-18`) and merely hides inactive panes in the rendered tree;
- Documentation imports both locales of all ten Markdown files plus `marked` and DOMPurify
  (`src/components/textwarp-editor/documentation-pane.jsx:4-18`).

The Markdown sources alone contain 103,987 characters; the unminified `marked` and DOMPurify ESM sources add roughly
210 KiB. Users pay parse/compile cost even if they never open Documentation, Blocks, Backpack, costume/sound editing, or
most modals.

Required fix:

- lazy-load the TextWarp documentation renderer and Markdown by active locale;
- split Blocks, Backpack, costume/sound editors, libraries, and rarely opened modals by feature boundary;
- replace the fixed five-request constraint with measured cache groups and an HTTP/2-appropriate request budget;
- keep a small editor shell and load secondary surfaces after first interaction or during browser idle time.

The acceptance target should be based on compressed transfer and main-thread parse/execute time on a mid-range mobile
device, not only raw asset size.

Resolution: Blocks, Backpack, Documentation, Markdown locales, costume/sound editors, libraries, cards, connection UI,
and rarely opened modals now load at their feature boundaries. The request allowance is 12 initial and 20 asynchronous
chunks. Initial JavaScript is 6.86 MiB raw / 1.68 MiB gzip, while the full build fell from 40.39 MiB to 23.41 MiB.

### Resolved P2 — The build published the complete Monaco distribution

`webpack.config.js:118-121` copies `node_modules/monaco-editor/min/vs` wholesale. The current result is **14.89 MiB in 138
files**, including unrelated language definitions, workers, and locale messages. These files are not all part of the
initial page request, so this is primarily a deployment, cache-invalidation, and cold-feature payload problem rather
than 14.89 MiB of immediate transfer.

Required fix: capture the real Monaco network dependency graph for TextWarp in English and Portuguese, then publish an
allowlisted editor-core build with only required workers/locales. Do not hand-delete files without that trace because
Monaco resolves some chunks dynamically. Add a production smoke test for the resulting asset set and a maximum Monaco
artifact budget.

Resolution: Webpack now copies the editor API, editor worker, AMD loader, English/Portuguese messages, and the
dependencies referenced by `editor.main` from an explicit allowlist. The production dependency set is 17 files /
4.26 MiB and CI enforces a 20-file / 4.6 MiB ceiling.

### Resolved P2 — Equivalent editor and player pages emitted duplicate route chunks

`src/playground/editor.jsx` and `src/playground/player.jsx` both render the same `Interface`, while the production build
emits separate approximately 2.25 MiB `editor` and `player` route chunks. Only one is loaded per page, but the deployment
stores and invalidates both, and navigation between the URLs cannot reuse one content-hashed route asset.

Required fix: point both HTML outputs at one canonical editor entry or make the default page a redirect/alias that
shares the same chunk. Preserve the distinct fullscreen and embed entry behavior.

Resolution: the redundant `player` entry was removed and both `index.html` and `editor.html` use the `editor` entry.
The budget script compares their emitted script lists and rejects any reintroduced `player.*.js` route asset.

## Render and interaction inefficiencies

### Resolved P2 — Cursor movement and pointer resizing rerendered the complete editor

Both Monaco instances call parent `setState({cursorPosition})` for every cursor event
(`src/containers/textwarp-editor.jsx:4111-4142`, `4167-4200`). Sidebar, bottom-panel, and split resizing also call parent
`setState()` for every raw pointer event after forcing layout reads (`textwarp-editor.jsx:684-704`). `TextEditor`,
`ActivityBar`, and `IdeSidebar` are not pure/memoized, and render creates new callbacks, arrays, and style objects.

Required fix:

- keep cursor position in a small status-bar subscriber or instance field and update only its display;
- throttle resize commits with `requestAnimationFrame`, cache bounds at resize start, and use CSS custom properties or a
  small layout component for the live preview;
- split stable panes into memoized components with stable callbacks and derived-data memoization;
- record React Profiler commits for cursor movement, dragging, typing, and runtime execution.

Resolution: cursor position lives in a small pure status component and an instance field used by problem navigation.
Drag bounds are cached at pointer-down; CSS properties update at most once per animation frame; one parent state commit
occurs at pointer-up. ActivityBar and IdeSidebar are memoized, callbacks are stable, and outline derivation is cached by
source revision.

### Resolved P2 — Status changes deliberately caused a second full render

Most operations set `status`, and `componentDidUpdate()` then calls `setState()` again to copy it into `announcement`
(`src/containers/textwarp-editor.jsx:401-405`). Typing, analysis, compile, conversion, file operations, and errors all
pay for a second parent render solely to update the live region.

Required fix: update status and announcement in the original transaction, or move live announcements into a small
component/store that can deduplicate messages without rerendering the editor tree.

Resolution: the duplicate `announcement` state and `componentDidUpdate()` copy were removed. The live region reads the
original status transaction directly, so a status change causes one parent render.

### Resolved P2 — Monaco recalculated adaptive options on every content event

Every Monaco content change calls `updateAdaptiveOptions()` (`src/components/textwarp-editor/monaco-editor.jsx:90-100`).
That method reads `container.clientWidth` and calls `editor.updateOptions()` with minimap, sticky-scroll, and word-wrap
objects even when width/threshold state is unchanged (`monaco-editor.jsx:562-572`). A `ResizeObserver` already covers
width changes.

Required fix: update adaptive options only on resize or when the model crosses the 500/1,000-line thresholds. Cache the
last compact/minimap/sticky state and skip identical `updateOptions()` calls.

Resolution: Monaco caches compact/line-band options. Content events reconfigure only when a model crosses the 500- or
1,000-line bands; resize remains observer-driven; identical option objects are skipped.

## Missing performance safeguards

### Resolved P2 — CI had no performance budgets or large-project regression workload

The current scripts validate correctness, docs, layout, and production compilation, but oversized assets remain warnings
and the TextWarp suite does not guard heap retention, typing latency, worker reuse, result explosion, or debugger
throughput.

Required fix: add reproducible checks for:

- initial compressed JavaScript and Monaco artifact bytes;
- warm versus cold conversion-worker compile latency;
- retained heap after repeated 100 KiB revisions;
- project search with broad and no-match queries;
- history write/prune behavior at its size boundary;
- React commit counts during cursor movement and resize;
- VM throughput with the debugger off, hidden, visible, and paused.

Record hardware/runtime details and keep noisy browser timings as tracked benchmark output until stable thresholds can be
enforced. Byte counts, worker construction counts, result caps, and retained-revision counts can be hard CI failures
immediately.

Resolution: `test/textwarp/performance.test.js` guards 81 large model revisions, search caps, history deltas/budgets,
quota behavior, draft event isolation, lightweight debugger snapshots, and worker reuse. `npm run perf:textwarp`
enforces initial raw/gzip, Monaco, route-deduplication, complete artifact byte, and file-count budgets after the
production build; the publish workflow runs it before deployment.

## Completed implementation order

1. Replace the 80-revision language cache and add the heap regression test.
2. Keep the conversion worker alive and prevent draft edits from entering block synchronization.
3. Cap/debounce project search and move history out of synchronous `localStorage`.
4. Isolate debugger updates and remove full-editor cursor/resize/status rerenders.
5. Lazy-load optional editor surfaces and establish startup byte/parse budgets.
6. Trim the verified Monaco dependency graph and deduplicate the editor/player route entry.

The implementation followed this order. The normal TextWarp correctness suite, documentation check, production build,
and workload-specific budgets are required together. The fixes preserve stale-result rejection, text/block
synchronization, history recovery, cross-file language intelligence, debugger correctness, and the shared
browser/Electron source boundary.
