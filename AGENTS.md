# Repository Guidelines

## Project Structure & Module Organization

This repository contains two client applications:

- `miniprogram/` is the native WeChat Mini Program. Page bundles live in `pages/`, reusable components in `components/`, shared TypeScript helpers in `utils/`, and global configuration/styles in `app.json`, `app.ts`, and `app.wxss`.
- `Pango-Wiki-Frontend/` is a React 18, TypeScript, and Vite web client. Application code is under `src/`: route-level views in `pages/`, reusable UI in `components/`, API contracts in `api/`, Wiki domain logic in `wiki/`, and shared hooks/utilities in `hooks/` and `utils/`. Static images and deployment notes are kept at the package root.

Keep changes within the relevant client. Do not edit generated/vendor code under `miniprogram/miniprogram_npm/` or `miniprogram/components/mp-html/` unless intentionally updating that dependency.

## Build, Test, and Development Commands

Run web commands from `Pango-Wiki-Frontend/`:

- `npm ci` installs the lockfile-pinned dependencies.
- `npm run dev` starts the Vite development server.
- `npm run build` runs TypeScript checks and creates production output in `dist/`.
- `npm run preview` serves the built bundle for local verification.

Open the repository's Mini Program project in WeChat DevTools to compile and exercise `miniprogram/`. Backend proxy expectations and deployment checks are documented in `Pango-Wiki-Frontend/README.md` and `MINIPROGRAM_WIKI_INTEGRATION.md`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline objects. Use `PascalCase` for React components and their files (`WikiPage.tsx`), `camelCase` for functions/hooks (`useSSE.ts`), and kebab-case for Mini Program component/page folders (`reference-viewer/`). Keep component CSS beside its TSX file and Mini Program `.ts`, `.wxml`, `.wxss`, and `.json` files together.

## Testing Guidelines

No automated test framework or coverage threshold is currently configured. Before submitting, run `npm run build`, inspect the affected web routes, and compile the Mini Program in WeChat DevTools. For UI changes, verify desktop and mobile layouts; for bridge or Wiki changes, test the `/wiki?client=miniprogram` flow on a real device when possible.

## Commit & Pull Request Guidelines

Git history is not available in this workspace. Use concise, imperative commits, optionally scoped, such as `fix(wiki): preserve reference page number`. Keep commits focused. Pull requests should explain the behavior change, list verification performed, link related issues, and include screenshots or recordings for visible UI changes. Call out configuration, API-contract, or deployment impacts explicitly.
