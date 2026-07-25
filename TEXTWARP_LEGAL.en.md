# TextWarp licenses, trademarks and compatibility

This document records the project's current policy. It is not a substitute for professional legal advice.

## Editor code

TextWarp is a modified version of TurboWarp and Scratch GUI. Modifications distributed by this repository remain
under GNU GPL version 3 as stated in `LICENSE`.

When distributing the website, JavaScript package or Desktop application:

- retain copyright, license and warranty notices;
- identify the software visibly as a modified version;
- provide the corresponding source code and the scripts required to build the distribution;
- keep GPLv3 on the derivative work;
- preserve component-specific third-party notices and licenses.

The original Scratch GUI BSD license text remains in `README.md` as required by that license.

## Extensions

Extensions from the TurboWarp catalog may remain available, but they do not share one collective license. Each
extension file declares its own license; the catalog has historically included MIT, MPL-2.0, Apache-2.0, BSD and
multi-license files.

TextWarp policy:

1. Remotely loaded extensions continue to reference the original catalog and display its supplied attribution.
2. Extensions included in an offline distribution retain their license header and expose notices on the
   credits/licenses screen.
3. An extension without a clear license is not copied into a TextWarp-owned bundle until permission is confirmed.
4. Sandboxed extensions remain sandboxed. Unsandboxed extensions require explicit consent and remain third-party
   code with elevated access.
5. Compatibility is derived from `getInfo()` loaded by `scratch-vm`. Commands, reporters, booleans, hats, menus and
   conditional blocks can be adapted automatically; custom interfaces, browser-only APIs or operating-system
   access may require specific work.

## Addons and modifications

Integrated addons derive from Scratch Addons and include patches maintained by TurboWarp. They may remain when
GPLv3, attribution and origin notices are preserved. TextWarp support links should point to TextWarp first; issues
that clearly belong to an original addon may be forwarded upstream.

## Trademarks

Software licenses do not automatically grant trademark rights. Scratch names, logos, characters and other marks
belong to their respective owners and must not imply that TextWarp is official, sponsored or endorsed.

TextWarp:

- uses its own identity, name, support pages, links and icons;
- retains Scratch and TurboWarp references where attribution, compatibility or interoperability requires them;
- states visibly that it is not affiliated with Scratch, Scratch Team, MIT, Scratch Foundation or TurboWarp;
- never removes credits or attributes third-party work to TextWarp.

## Compatibility matrix

| Component | May remain? | Condition |
| --- | --- | --- |
| Derived runtime, GUI and block editor | Yes | GPLv3, corresponding source, notices and modified-version identification |
| Integrated addons | Yes | GPLv3 and Scratch Addons/TurboWarp attribution |
| Catalog-loaded extensions | Yes | Per-extension license and author, permission checks and sandbox preserved |
| Offline bundled extensions | Depends | Verify and distribute the license for every file |
| Scratch APIs and links | Yes, when functional | Do not present TextWarp as an official product |
| TurboWarp APIs, Packager and gallery | Yes, as external services | Identify the provider and apply its privacy policy |
| Scratch/TurboWarp logos and characters | Not as TextWarp identity | Use only with permission or legitimate attribution need |

## Compatibility responsibility

TextWarp guarantees only compatibility covered by compiler tests and the catalog loaded at runtime. It cannot
promise that every third-party extension works without adaptation. Common causes include:

- direct access to DOM, camera, microphone, network, clipboard or File System Access API;
- dependency on a specific URL, CSP or CORS header;
- exclusively unsandboxed execution;
- custom block UI or mutations not represented by `getInfo()`;
- private APIs tied to a specific `scratch-vm` version.

These limitations must produce an explicit diagnostic and must never silently replace blocks or text source.
