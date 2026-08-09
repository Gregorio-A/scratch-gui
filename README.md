# TextWarp scratch-gui
website preview here!!!: [`gregorioalves.com`](https://gregorioalves.com/textwarp)

`scratch-gui` is the shared editor interface for TextWarp. It is used by both
the browser application and the TextWarp Electron desktop application.

This repository is the primary source for shared functionality:

- the React editor shell and TextWarp visual identity;
- the Monaco text editor and the Code, Blocks, Split, and Dual Editor views;
- project navigation, search, symbols, documentation, debugging, and panels;
- TextWarp parsing, compilation, decompilation, and Scratch block
  synchronization;
- responsive layouts, font scaling, accessibility behavior, and localization;
- browser-compatible file handling and the adapter used by Electron.

The Electron-specific implementation remains in
[`TextWarp-Turbowarp`](https://github.com/Gregorio-A/turbowarp-by-text). Keeping
the editor here prevents the web and desktop applications from maintaining two
separate implementations.

TextWarp is derived from [TurboWarp scratch-gui](https://github.com/TurboWarp/scratch-gui)
and [Scratch GUI](https://github.com/scratchfoundation/scratch-gui). TextWarp is
not affiliated with, sponsored by, or endorsed by TurboWarp, Scratch, the
Scratch Foundation, or MIT.

## Documentation

- [TextWarp manual](TEXTWARP.en.md)
- [TextWarp IDE guide](TEXTWARP_IDE.en.md)
- [TextWarp block and extension reference](TEXTWARP_BLOCOS.en.md)
- [Project priorities](TEXTWARP_PRIORIDADES.en.md)
- [Licensing and compatibility policy](TEXTWARP_LEGAL.en.md)

Portuguese documentation is available in the corresponding `.md` files without
the `.en` suffix. The interface uses the selected Portuguese locale when
available and English as the fallback for other locales.

## Development

Requirements: Git, Node.js, and npm. Install the locked dependencies and start
the development server:

```bash
npm ci
npm start
```

The playground is available at <http://localhost:8601/>.

To create a distributable package in `dist/` for another application to
consume:

```bash
BUILD_MODE=dist npm run build
```

To build the static web application for `/textwarp/`:

```bash
npm run build:textwarp:web
```

The resulting site is written to `build/`. Generated directories such as
`build/`, `dist/`, and `node_modules/` are not source files and should not be
committed.

## Hostinger deployment

The `Publish TextWarp Web` workflow runs on every push to `develop` and can
also be started manually from the GitHub Actions page. It builds the static
site and publishes only the contents of `build/` to the orphan
`gui-deploy-web` branch.

Configure Hostinger's Git deployment to use this repository and
`gui-deploy-web` as its deployment branch. The deploy branch contains only
website artifacts; source code, tests, dependencies, and Desktop files remain
on `develop`.

The generated site is configured for the `/textwarp/` path. If the domain uses
a different subpath, update `ROOT` and `STATIC_PATH` in
`build:textwarp:web` before publishing.

## Developing with TextWarp Desktop

Link the shared package into a sibling Desktop checkout:

```bash
npm link

cd ../TextWarp-Turbowarp
npm link --no-save scratch-gui
npm run webpack:compile
npm run electron:start
```

For production, the Desktop package points to the `develop` branch of the
TextWarp fork on GitHub. When changing shared code, rebuild `scratch-gui`
before compiling Desktop.

## Tests and validation

Run the TextWarp compiler, IDE, documentation, and runtime tests:

```bash
npm run test:textwarp
npm run docs:textwarp:check
npx jest --runInBand test/unit/components/textwarp-monaco-editor.test.jsx
```

Before committing, also validate the source, production Monaco assets, and browser integration:

```bash
git diff --check
npm run build:textwarp:web
npx jest --runInBand test/integration/textwarp-monaco.test.js
```

The browser smoke test uses the npm-managed ChromeDriver when available and otherwise reads
`CHROMEDRIVER_PATH` (falling back to `/usr/bin/chromedriver` on Linux).

## License and attribution

TextWarp is distributed under the GNU GPL version 3; see [LICENSE](LICENSE).
TextWarp-specific code, documentation, and modifications must retain the
corresponding notices when redistributed.

This repository also contains upstream components and assets with their own
licenses. Preserve their copyright, license, attribution, and warranty notices.
In particular, the original Scratch GUI BSD license notice is retained here as
required. Extensions and bundled assets may have different licenses; consult
[TEXTWARP_LEGAL.en.md](TEXTWARP_LEGAL.en.md) before redistributing a bundle.

The default Dango project asset is based on
[Twemoji](https://twemoji.twitter.com/) and is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
