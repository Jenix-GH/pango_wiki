# Repository Guidelines

## Project Structure & Module Organization

This Git repository contains two client projects:

- `Pango-Wiki-Frontend/` is the React 18, TypeScript, and Vite web application. Route pages live in `src/pages/`, reusable UI in `src/components/`, API code in `src/api/`, Wiki domain code in `src/wiki/`, and shared hooks/utilities in `src/hooks/` and `src/utils/`.
- `miniprogram/` is the WeChat Mini Program project opened by WeChat DevTools. Its `project.config.json` sets `miniprogram/` as the source root, so runtime code is under `miniprogram/miniprogram/`. Pages, components, utilities, and generated npm packages are respectively in `pages/`, `components/`, `utils/`, and `miniprogram_npm/` beneath that directory. Tests are in `miniprogram/tests/`, while typings and package configuration remain at `miniprogram/`.

Follow the more specific instructions in `miniprogram/AGENTS.md` when changing that project. Do not hand-edit generated `miniprogram_npm/` files.

## Build, Test, and Development Commands

Run web commands from `Pango-Wiki-Frontend/`:

- `npm ci` installs lockfile-pinned dependencies.
- `npm run dev` starts the Vite development server.
- `npm run build` performs TypeScript checking and writes production assets to `dist/`.
- `npm run preview` serves the production build locally.

Run Mini Program commands from `miniprogram/`:

- `npm install` installs dependencies; then use **Tools → Build npm** in WeChat DevTools.
- `npx tsx tests/stream_parser.test.mts` runs the stream parser assertions.

Compile and preview the native application through WeChat DevTools; no npm build script is configured.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and no semicolons in TypeScript. Name React components/files with `PascalCase`, hooks and functions with `camelCase`, and Mini Program page/component directories with kebab-case. Keep TSX and CSS together; keep Mini Program `.ts`, `.wxml`, `.wxss`, and `.json` files together. Preserve existing generated JavaScript unless intentionally rebuilding it through DevTools.

## Testing Guidelines

Before submitting web changes, run `npm run build` and manually verify affected desktop/mobile routes. For Mini Program changes, run the stream parser test when relevant, compile in DevTools, and test WebView, media, or bridge behavior on a real device.

## Commit & Pull Request Guidelines

Keep commits concise, focused, and explicit about the affected client. Pull requests should describe behavior changes, list verification performed, link related issues, and include screenshots or recordings for UI changes. Highlight API, domain-whitelist, configuration, or deployment impacts.
