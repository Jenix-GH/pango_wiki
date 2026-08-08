# Mini Program Guidelines

## Project overview

This is the native WeChat Mini Program client for Pango intelligent Q&A. It is written in TypeScript and compiled by WeChat DevTools. The client calls the Java business backend under `/dbServ`; the backend authenticates users, enforces the guest quota, persists conversations, and proxies streaming model requests. The Mini Program does not call a model server directly.

## Build and development workflow

- There is no npm build script. Open this directory in WeChat DevTools to compile, preview, and upload the application.
- Run `npm install`, then use **Tools → Build npm** in DevTools. This populates `miniprogram/miniprogram_npm/`; do not hand-edit that generated directory.
- `project.config.json` sets `miniprogram/` as `miniprogramRoot`, so runtime source is under `miniprogram/miniprogram/` when viewed from the repository root and under `miniprogram/` from this directory.
- Production hosts are currently configured in `miniprogram/app.ts`. Any new HTTPS host used by requests, downloads, images, or WebViews must also be added to the corresponding WeChat legal-domain configuration.

## Running tests

```bash
npx tsx tests/stream_parser.test.mts
```

The test uses Node's native `assert` and imports `miniprogram/pages/main/stream.ts` directly. A local `tsx` installation is not committed, so `npx` may need to download it.

## Streaming protocol and request path

`pages/main/main.ts` sends chunked requests with `wx.request`, `enableChunked: true`, and `responseType: 'arraybuffer'` to `/dbServ/dialogue/stream-answer`. The Java backend validates `session_id`, enforces the server-side guest quota, adds the trusted `X-Session-Id` header, and proxies the request to the configured model endpoint. Nginx may consistently hash that header so one session remains on one model server.

The active parser is `pages/main/stream.ts`:

- It manually decodes UTF-8 because `TextDecoder` is not guaranteed in the Mini Program runtime.
- It accepts newline-delimited/SSE-like frames, strips an optional `data:` prefix, and JSON-parses each frame.
- Progress frames update the waiting status.
- Incremental `data.answer` and RAGFlow Agent `event: "message"` frames feed the buffered streaming renderer.
- The final frame may contain references, structured citations, trace data, and `answer_media` at the JSON top level.
- `[DONE]` and terminal frames complete the response; plain non-JSON text is handled as replacement content.

## Architecture

```text
miniprogram/
  app.ts / app.json / app.wxss        App entry, production hosts, session state
  pages/
    index/                            Login/welcome flow
    main/                             Q&A, streaming, history, media, voice input
      main.ts                         Main page state and request orchestration
      stream.ts                       Active chunk/SSE parser
    wiki/                             Wiki WebView entry
    reference-viewer/                 Reference document WebView
  components/
    mp-html/                          Markdown/HTML renderer
    left-menu/                        History sidebar
    set-menu/                         Settings panel
    set-userinfo/ set-company/ ...    Profile/settings components
  utils/
    stream.ts                         Legacy parser; not used by the main page
    tools.ts                          Clipboard, text extraction, toast helpers
    util.ts                           Date formatting
tests/
  stream_parser.test.mts
```

## Current behavior and important details

- Questions and answers are persisted by the Java `/dialogue/stream-answer` proxy. The question is written before the model request and the completed answer, reference JSON, and `answer_media` are written after the terminal frame; the Mini Program must not issue a separate `/answer/doAdd` request. History is grouped and reloaded by `session_id`.
- Session IDs are generated client-side by `getSessionId()`. Starting a new conversation forces a new ID, while opening history restores that historical session ID.
- Guest identity is initialized through `/userinfo/guest`. The authoritative 50-question guest quota is enforced by the Java backend, not by client state alone.
- Answer media URLs must resolve under the configured HTTPS `referenceHost` and `/references/figures/`. Images are associated with citation labels, inserted between multiple `mp-html` fragments after the matching `<sup>...</sup>` marker, and can be previewed with `wx.previewImage`.
- References open through `pages/reference-viewer/`; Wiki opens through `pages/wiki/`. Both depend on approved WebView/business domains and should be tested on a real device.
- Markdown preprocessing inserts table spacing and preserves line breaks after citation markers. Do not bypass `fixMarkdownTableSpacing()` when restoring historical answers.
- Image upload uses `wx.chooseMedia`, reads base64 data through the file-system manager, and sends it with the question.
- Voice input uploads audio to `{baseHost}/wx/transcribe`.
- The main page reports `page_view`, Wiki entry, reference opening, and answer-image viewing to `/analytics/track` with `clientType: MINIPROGRAM`. Chat submit/success/failure is recorded authoritatively by Java. Analytics failures must never block the primary Q&A interaction.
- Most state lives in the page/component `data` object; components communicate with `triggerEvent`. There is no external state-management library.
- `componentFramework` is `glass-easel`, Skyline is enabled, and TypeScript uses strict unused-variable checks.
- `project.private.config.json` and `._*` files are machine-specific artifacts; avoid intentionally committing new ones.
