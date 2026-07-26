# P0 Problems — scratch-gui

Status: audit performed 2026-07-26 on `develop`.

This document records only currently reproducible problems that can block a
release, prevent the repository's declared validation gate from completing, or
allow a critical feature to ship without validation. It is intentionally
separate from the broader Monaco and interface backlogs.

## P0-001 — The declared full test gate is permanently red

- **Evidence:** `package.json` defines `npm test` as lint, unit tests, build,
  and integration tests. `npm run test:lint` currently exits 1 with **1,566
  errors**. `npm run test:integration` also fails repeatedly with
  `Error: Server terminated early with status 1` while starting the test
  server.
- **Impact:** A developer cannot use the documented full test command as a
  release signal. A green unit/build result can coexist with a broken lint or
  browser-integration gate.
- **Reproduction:** Run `npm test`, or run `npm run test:lint` and
  `npm run test:integration` independently from a clean checkout.
- **Required fix / acceptance:** Either repair the reported lint and
  integration-server failures, or make the commands deterministic and update
  the gate to the supported Node/browser versions. `npm test` must complete
  with exit code 0 in CI and locally using the documented toolchain.

## P0-002 — Source translation generation is broken by a duplicate message ID

- **Evidence:** `npm run i18n:src` exits 1 with
  `Error: Duplicate message id: gui.prompt.cancel` from
  `@turbowarp/scratch-l10n/scripts/build-i18n-src.js`.
- **Impact:** Translation source artifacts cannot be regenerated. Changes to
  localized UI text cannot reliably enter the release workflow and may leave
  generated translations stale or inconsistent with source code.
- **Reproduction:** Run `npm run i18n:src`.
- **Required fix / acceptance:** Remove or intentionally rename the duplicate
  message declaration, regenerate the source catalog, and add a CI check so
  `npm run i18n:src` exits 0.

## P0-003 — CI does not execute TextWarp's dedicated tests

- **Evidence:** `.github/workflows/node.js.yml` runs only `npm run build` and
  `npm run test:unit`. The TextWarp suite is a separate script,
  `npm run test:textwarp`, and is not included in the CI job. The publish
  workflow runs documentation validation and a build, but also omits the
  TextWarp tests.
- **Impact:** Regressions in the TextWarp editor, compiler bridge, package
  import/export, and Monaco integration can be merged and published while all
  required CI checks remain green.
- **Required fix / acceptance:** Add `npm run test:textwarp` (and the relevant
  TextWarp documentation check) to the required CI job before build/publish.
  A deliberate TextWarp regression must make CI fail.

## P0-004 — The publish workflow can ship an artifact without product-level tests

- **Evidence:** `.github/workflows/publish-web.yml` performs `npm ci`,
  `npm run docs:textwarp:check`, and `npm run build:textwarp:web`, then
  publishes `./build` to `gui-deploy-web`. It does not run unit, TextWarp, or
  browser smoke/integration tests before publishing.
- **Impact:** A source change can be deployed to the `/textwarp/` artifact
  branch even when runtime behavior is broken; the workflow validates that the
  bundle can be produced, not that the published editor works.
- **Required fix / acceptance:** Make publishing depend on the same required
  test job as CI, including TextWarp tests and a supported browser smoke test.
  The publish step must be unreachable when those checks fail.

## Triage order

1. Restore a deterministic, green full validation command (P0-001).
2. Repair the translation catalog generator (P0-002).
3. Add TextWarp tests to required CI and gate publishing on them (P0-003 and
   P0-004).

