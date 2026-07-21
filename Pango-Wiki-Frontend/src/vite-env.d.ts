/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_BASE_URL?: string
  readonly VITE_CHAT_API_URL?: string
  readonly VITE_DB_BASE_URL?: string
  readonly VITE_WIKI_CATALOG_URL?: string
  readonly VITE_REFERENCE_ORIGIN?: string
  readonly VITE_DEV_BACKEND_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
