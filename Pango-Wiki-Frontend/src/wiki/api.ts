import type { WikiCatalog } from './types'

const CATALOG_URL = import.meta.env.VITE_WIKI_CATALOG_URL || '/wiki/api/catalog'

interface LoadCatalogOptions {
  signal?: AbortSignal
  refresh?: boolean
}

export async function loadWikiCatalog(options: LoadCatalogOptions = {}): Promise<WikiCatalog> {
  const separator = CATALOG_URL.includes('?') ? '&' : '?'
  const url = options.refresh ? `${CATALOG_URL}${separator}refresh=true` : CATALOG_URL
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.refresh ? { 'Cache-Control': 'no-cache' } : {}),
    },
    cache: options.refresh ? 'no-store' : 'default',
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Wiki catalog request failed: HTTP ${response.status}`)
  }
  return response.json() as Promise<WikiCatalog>
}
