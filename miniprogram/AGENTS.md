# AGENTS.md

## Project overview

WeChat miniprogram (微信小程序) — AI-powered Q&A assistant ("PangoAI") targeting FPGA chip selection and smart Q&A, backed by a RAGFlow server. Written in TypeScript; compiled by the WeChat Developer Tools IDE.

## Build & dev workflow

- **No npm build scripts.** The WeChat Developer Tools IDE compiles TypeScript via its built-in plugin. Open the project root in the IDE to get TS compilation and miniprogram preview.
- **npm packages must be "built"** via the IDE's "Tools → Build npm" after `npm install`. This populates `miniprogram/miniprogram_npm/`. If components like `mp-html` don't render, run this step.
- **Miniprogram root** is `miniprogram/` (set by `project.config.json` → `miniprogramRoot`). All page/component paths in `app.json` are relative to that directory.

## Running tests

```bash
npx tsx tests/stream_parser.test.mts
```

Tests use Node.js native `assert` and import source directly from `miniprogram/pages/main/stream`. No test framework — the file is a plain assertion script that exits non-zero on failure.

## Streaming protocol (RAGFlow SSE)

The app calls the RAGFlow chat endpoint with `wx.request` + `enableChunked: true` + `responseType: 'arraybuffer'`. The stream parser in `miniprogram/pages/main/stream.ts` handles:

- **SSE frames** split by `\n` (not `\n\n`). The `splitStreamFrames()` function is what production code uses.
- **Content format:** Each frame is trimmed; `data:` prefix is stripped if present; the remainder is JSON-parsed.
- **Manual UTF-8 decoding** (`decodeSSE`) is used instead of `TextDecoder` because the miniprogram environment may lack it.
- **Message types** (handled in `main.ts` `startStreaming()` callback):
  - `{"code":0,"data":{"status":"...","phase":"..."}}` — progress indicator
  - `{"code":0,"data":{"answer":"..."}}` — incremental answer text (appended)
  - `{"event":"message","data":{"content":"..."}}` — RAGFlow Agent message format
  - `{"code":0,"data":true}` — terminal signal (stop streaming, attach references)
  - `[DONE]` — stop streaming
  - Plain text (non-JSON) — treated as cumulative answer, replaces display (not append)

## Architecture

```
miniprogram/
  app.ts / app.json / app.wxss     — App entry, globalData (hosts, sessionId, toggles)
  pages/
    index/                          — Welcome/login page (user authorization, phone binding)
    main/                           — Core chat page (streaming Q&A, voice input, markdown rendering)
      main.ts                       — ~1277 lines: all page logic, no subcomponents extracted
      stream.ts                     — SSE stream parser with manual UTF-8 decoding (ACTIVE, imported by main.ts)
  components/
    mp-html/                        — Rich text / markdown renderer (npm component, built into miniprogram_npm)
    left-menu/                      — Slide-out history sidebar
    set-menu/                       — Bottom settings panel
    set-userinfo/ set-company/ ...  — Various settings sub-panels
  utils/
    stream.ts                       — Alternate stream parser using TextDecoder (STALE, NOT used)
    tools.ts                        — Clipboard, toast helpers
    util.ts                         — Date formatting
tests/
  stream_parser.test.mts            — Tests for splitStreamFrames
typings/                            — Global type declarations (miniprogram-api-typings)
```

## Key quirks

- **Two stream implementations exist.** Only `miniprogram/pages/main/stream.ts` is used. Do not modify or rely on `miniprogram/utils/stream.ts` — it is dead code.
- **`._*` files** (e.g. `._app.ts`, `._stream.ts`) are macOS resource fork artifacts. Not excluded by `.gitignore`.
- **`project.private.config.json`** contains IDE-local settings. Not excluded by `.gitignore`.
- **No backend persistence.** Most `wx.request` calls (login, question/answer persistence) are commented out. Session management is entirely client-side.
- **Session IDs** are generated client-side in `getSessionId()`, not returned by the server.
- **Toggle modes** — `isTestVersion` and `isWebSearchEnabled` both trigger `getSessionId(true)` to force a new session. The test toggle switches between `sessionUrl` and `sessionUrl_choose` (different `conversationId`).
- **No state management library** — all state is in page/component `data` objects. Communication between components uses `triggerEvent`.
- **Markdown rendering** uses `mp-html` with latex support via KaTeX and code highlighting via Prism. Table formatting needs an explicit empty line before markdown tables — see `fixMarkdownTableSpacing()`.
- **Image upload** uses `wx.chooseMedia` to select images, converts to base64 via `wx.getFileSystemManager().readFileSync`, and sends to the RAGFlow API alongside the question.
- **Voice input** uses long-press on the textarea, uploads audio to `{baseHost}/wx/transcribe` for ASR. A `flagVoiceMode` toggle exists to separate text and voice modes.
- **Icons** are inline SVG data URIs in wxss, not external image files.
- **Component framework** is `glass-easel` (set in `app.json`), not the default `exparser`. Skyline renderer is enabled.
- **TSConfig** is strict with `noUnusedLocals` and `noUnusedParameters` — unused imports/vars will cause IDE compilation errors.
- **Tab width** is 2 spaces (set in `project.config.json`).
