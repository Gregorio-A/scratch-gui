# TextWarp problems and priorities

This file records release priorities for the shared web and Desktop editor.

Conversion safety was re-audited on July 29, 2026. Unknown blocks now round-trip through non-executing opaque
syntax; apply/undo is transactional; variable, procedure and unit identities are durable; marker-free package
round trips retain root ownership; synchronization is bidirectional and truthful; and conversion tests are required
by CI and publishing.

## Priority criteria

High priority issues can lose source, generate incompatible blocks, prevent editing, hide the stage or block
keyboard access. Medium priority issues reduce productivity but have a safe workaround. Low priority work is
polish or optional integration.

## High priority

- Keep text, generated blocks and `.textwarp` packages round-trip compatible.
- Keep the dual editor attached to two independent target modules.
- Keep the editor, stage and every primary action reachable at small resolutions.
- Preserve package import limits and extension permission checks.
- Preserve transactional conversion, exact undo, root ownership, comments/layout, coercible inputs and opaque blocks.
- Keep shared behavior in `scratch-gui`; Electron-only code stays in the Desktop fork.

## Medium priority

- Expand translations beyond English and Portuguese through the normal Scratch localization pipeline.
- Improve compiler diagnostic translations while keeping stable error codes.
- Add opt-in automatic watching for external files where the host platform supports it.
- Continue reducing inherited dependency audit warnings through tested dependency upgrades.

## Low priority

- More themes and editor font families.
- Detachable or floating tool panels.
- Workspace protocol integrations for individual external IDE extensions.

## Rule for new regressions

A new feature must not duplicate the shared editor in Desktop, silently discard unsupported blocks, obscure the
stage, or make an existing keyboard workflow inaccessible.

## Validation

Run:

```bash
npm run test:textwarp
npm run docs:textwarp:check
npm run test:unit
npm run build:textwarp:web
```

Then test Code, Blocks, Split, Dual editor, Documentation, panel resizing, font scaling, external `.tw` sync and
the Electron package at desktop, tablet and phone-sized viewports.
