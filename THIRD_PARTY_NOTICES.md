# Third-Party Notices

This project is released under the MIT License. It depends on upstream open-source packages that keep their own copyright notices and license terms.

The npm package does not vendor these dependencies. When installed through npm, dependency packages are installed separately and include their own license files and package metadata. This notice is provided to make the direct and currently locked transitive dependency licenses easy to audit.

Generated handout output may copy KaTeX font files into `dist/assets/katex-fonts/`. Those font assets are part of the KaTeX package and remain under the KaTeX upstream license.

## Direct Runtime Dependencies

| Package | Locked version | License |
|---|---:|---|
| `@vscode/markdown-it-katex` | 1.1.2 | MIT |
| `katex` | 0.16.47 | MIT |
| `markdown-it` | 14.3.0 | MIT |
| `markdown-it-anchor` | 9.2.0 | Unlicense |
| `markdown-it-footnote` | 4.0.0 | MIT |
| `markdown-it-mark` | 4.0.0 | MIT |
| `pdf-lib` | 1.17.1 | MIT |
| `pdfjs-dist` | 6.1.200 | Apache-2.0 |
| `playwright` | 1.61.1 | Apache-2.0 |
| `yaml` | 2.9.0 | ISC |

## Locked Transitive Dependencies

| Package | Locked version | License |
|---|---:|---|
| `@napi-rs/canvas` | 1.0.2 | MIT |
| `@napi-rs/canvas-darwin-arm64` | 1.0.2 | MIT |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT |
| `@pdf-lib/upng` | 1.0.1 | MIT |
| `@types/linkify-it` | 5.0.0 | MIT |
| `@types/markdown-it` | 14.1.2 | MIT |
| `@types/mdurl` | 2.0.0 | MIT |
| `argparse` | 2.0.1 | Python-2.0 |
| `commander` | 8.3.0 | MIT |
| `entities` | 4.5.0 | BSD-2-Clause |
| `fsevents` | 2.3.2 | MIT |
| `linkify-it` | 5.0.2 | MIT |
| `mdurl` | 2.0.0 | MIT |
| `pako` | 1.0.11 | MIT AND Zlib |
| `playwright-core` | 1.61.1 | Apache-2.0 |
| `punycode.js` | 2.3.1 | MIT |
| `tslib` | 1.14.1 | 0BSD |
| `uc.micro` | 2.1.0 | MIT |

## Browser Binaries

Playwright browser binaries are not bundled in this npm package. They are downloaded only when a user runs `mhb install-browser` or `npx markdown-handout-builder install-browser`.

Downloaded browsers, including Chromium builds, are governed by their upstream browser project licenses and notices. Review the browser distribution installed by Playwright for those terms.
