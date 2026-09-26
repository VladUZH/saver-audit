# Third-party notices

Besides saver-audit's own code, `dist/cli.js` bundles code from two npm packages:
gpt-tokenizer (MIT) and @resvg/resvg-wasm (MPL-2.0). Both are described below.

`dist/cli.js` bundles the o200k_base encoder from gpt-tokenizer 4.0.0
(https://github.com/niieani/gpt-tokenizer), used under the MIT License:

```
MIT License

Copyright (c) 2023-2024 Bazyli Brzoska

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`data/prices.json` is derived from models.dev (https://github.com/anomalyco/models.dev, MIT)
and, for models models.dev lacks and for Claude's >200k-token rates, LiteLLM's model price
list (https://github.com/BerriAI/litellm, MIT). The fast-mode multipliers in `dist/cli.js`
come from the same LiteLLM list.

`dist/resvg.wasm` and the JavaScript bindings bundled into `dist/cli.js` (from
`@resvg/resvg-wasm/index.mjs`) come from @resvg/resvg-wasm 2.6.2
(https://github.com/thx/resvg-js). Both are used only by `--card`. They are licensed
under the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The WebAssembly
file is unmodified; esbuild merges the bindings into `dist/cli.js` at build time. Their
source code is available at that repository.

`dist/fonts/JetBrainsMono-Regular.ttf` and `dist/fonts/JetBrainsMono-Bold.ttf` are
JetBrains Mono 2.304 (https://github.com/JetBrains/JetBrainsMono), licensed under the SIL
Open Font License 1.1; the licence text ships as `dist/fonts/OFL.txt`.
