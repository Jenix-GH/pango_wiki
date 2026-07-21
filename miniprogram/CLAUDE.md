# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

WeChat Mini Program (微信小程序) — "PangoAI", an AI-powered Q&A assistant for FPGA chip selection and smart Q&A. Backed by a RAGFlow-compatible server with SSE streaming. Written in TypeScript, compiled by the WeChat Developer Tools IDE.

- **App ID:** wxafd59b2bb3a66e06
- **Miniprogram root:** `miniprogram/`
- **Lib version:** 3.9.1
- **Component framework:** glass-easel (set in `app.json`), not the default `exparser`
- **Renderer:** Skyline renderer enabled
- **TSConfig:** Strict mode, `noUnusedLocals` + `noUnusedParameters` enabled

## Build & dev workflow

- **No npm build scripts.** The WeChat Developer Tools IDE compiles TypeScript via its built-in plugin. Open the project root in the IDE to get TS compilation and mini program preview.
- **npm packages must be "built"** via the IDE's "Tools → Build npm" after `npm install`. This populates `miniprogram/miniprogram_npm/`. If components like `mp-html` don't render, run this step.
- **Tab width:** 2 spaces (set in `project.config.json`).

## Running tests

```bash
npx tsx tests/stream_parser.test.mts
```

Tests use Node.js native `assert` and import source directly from `miniprogram/pages/main/stream`. No test framework — the file exits non-zero on failure.

## Architecture

```
miniprogram/
  app.ts / app.json / app.wxss     — App entry, globalData (hosts, sessionId, toggles)
  app.json                         — Registers pages ["index", "main"], global window config
  app.wxss                         — CSS variables for theming (--bg-primary, --text-dark, etc.)
  pages/
    index/                          — Welcome page (user authorization, phone binding via wx.getUserProfile)
    main/                           — Core chat page (streaming Q&A, voice input, image upload, markdown)
      main.ts                       — ~1130 lines: all page logic (no subcomponents extracted)
      main.wxml                     — Chat UI template (session bubbles, streaming display, input bar)
      main.wxss                     — Styles (icons via inline SVG data URIs, collapsible progress panel)
      stream.ts                     — SSE stream parser with manual UTF-8 decoding (ACTIVE)
  components/
    mp-html/                        — Rich text / markdown renderer (npm cp., with latex+highlight plugins)
    top-menu/                       — Top navigation bar (hamburger menu + new session button)
    left-menu/                      — Slide-out history sidebar (login, history list, settings access)
    set-menu/                       — Bottom settings panel (navigates to sub-panels)
    set-userinfo/                   — User profile settings sub-panel
    set-company/                    — Company info sub-panel
    set-contact-us/                 — Contact sub-panel
    set-data-manager/               — Data management sub-panel
    set-list/                       — List settings sub-panel
    user-protocol/                  — Privacy/user agreement popup
  iconfont/                         — Custom iconfont component (SVG icon set)
  utils/
    stream.ts                       — Alternate stream parser using TextDecoder (STALE, NOT used)
    tools.ts                        — Clipboard, toast helpers (copyToClipboard, showSuccess, showError)
    util.ts                         — Date formatting (formatTime)
tests/
  stream_parser.test.mts            — Tests for splitStreamFrames in pages/main/stream.ts
typings/                            — Global type declarations (miniprogram-api-typings)
```

## Streaming protocol (RAGFlow SSE)

The app calls the RAGFlow chat endpoint with `wx.request` + `enableChunked: true` + `responseType: 'arraybuffer'`. The stream parser in `miniprogram/pages/main/stream.ts` handles:

- **SSE frames** split by `\n` (single newline, not `\n\n`). The `splitStreamFrames()` function is what production code uses.
- **Content format:** Each frame is trimmed; `data:` prefix is stripped if present; the remainder is JSON-parsed.
- **Manual UTF-8 decoding** (`decodeSSE`) is used instead of `TextDecoder` because the miniprogram environment may lack it.
- **Message types handled in `main.ts:startStreaming`:**
  - `{"code":0,"data":{"status":"...","phase":"..."}}` — progress indicator (calls `updateProgress`)
  - `{"code":0,"data":{"answer":"..."}}` — incremental answer text (appended)
  - `{"event":"message","data":{"content":"..."}}` — RAGFlow Agent message format
  - `{"code":0,"data":true}` or `{"answer_replace":...}` — terminal signal (stop streaming, attach references)
  - `[DONE]` — stop streaming
  - Plain text (non-JSON) — treated as cumulative answer, replaces display (not append)
- **Session IDs** are generated client-side in `getSessionId()` (`main.ts:1021`), not returned by the server.
- **Two toggle modes:** `isTestVersion` and `isWebSearchEnabled` both call `getSessionId(true)` to force a new session.

## Key quirks and decisions

- **Two stream implementations exist.** Only `miniprogram/pages/main/stream.ts` is used. Do not modify or rely on `miniprogram/utils/stream.ts` — it is dead code.
- **`._*` files** (e.g. `._app.ts`, `._stream.ts`) are macOS resource fork artifacts. The `.gitignore` does not exclude them; add them if you see them staged.
- **`project.private.config.json`** contains IDE-local settings (included in `.gitignore` by WeChat convention but not in the repo's `.gitignore`).
- **Markdown rendering** uses `mp-html` with latex support via KaTeX (CDN-loaded JS/CSS) and code highlighting via Prism. Table formatting needs an explicit empty line before markdown tables — see `fixMarkdownTableSpacing()`.
- **Image upload** uses `wx.chooseMedia` to select images, converts to base64 via `wx.getFileSystemManager().readFileSync`, and sends to the RAGFlow API alongside the question.
- **Voice input** is triggered by long-pressing the textarea (not a dedicated button). A dedicated voice-mode toggle (`flagVoiceMode`) was later added to separate text and voice input. Audio is uploaded to `{baseHost}/wx/transcribe` for ASR.
- **Icons** are typically inline SVG data URIs in wxss (not external image files), so icon changes require editing wxss.
- **Theme** is controlled via CSS variables in `app.wxss` (`--bg-primary: #960c73`).
- **Backend endpoints** are configured in `app.ts` globalData: `baseHost` (main API server), `qaHost` / `sessionUrl` (RAGFlow chat endpoint), `referenceHost` (document downloads).
- **No state management library** — all state is in page/component `data` objects. Communication between components uses `triggerEvent`.
- **Most wx.request calls are commented out** — login, question persistence, answer persistence. The app currently runs without backend persistence and generates session IDs client-side.
