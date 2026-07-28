import type { ReferenceChunk } from '../api/types'

const ALLOWED_REFERENCE_PATHS = new Set([
  '/references/viewer',
  '/references/document',
  '/references/cloud/viewer',
  '/references/cloud/document',
  '/references/cloud/download',
])

function referenceBaseUrl(): URL {
  const configuredOrigin = String(import.meta.env.VITE_REFERENCE_ORIGIN || '').trim()
  return configuredOrigin
    ? new URL(configuredOrigin, window.location.origin)
    : new URL(window.location.origin)
}

export function resolveReferenceUrl(rawUrl: string): string | null {
  const candidate = String(rawUrl || '').trim()
  if (!candidate) return null

  try {
    const base = referenceBaseUrl()
    const resolved = new URL(candidate, base)
    if (resolved.origin !== base.origin) return null
    if (!ALLOWED_REFERENCE_PATHS.has(resolved.pathname)) return null
    return resolved.toString()
  } catch {
    return null
  }
}

export function openReferenceUrl(rawUrl: string): boolean {
  const resolved = resolveReferenceUrl(rawUrl)
  if (!resolved) return false
  const opened = window.open(resolved, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
  return true
}

function viewerUrlForDocument(rawUrl: string): string {
  if (!rawUrl) return ''
  try {
    const base = referenceBaseUrl()
    const resolved = new URL(rawUrl, base)
    if (resolved.origin !== base.origin || resolved.pathname !== '/references/document') {
      return rawUrl
    }
    resolved.pathname = '/references/viewer'
    if (!resolved.searchParams.has('page')) resolved.searchParams.set('page', '1')
    if (!resolved.searchParams.has('display_page')) resolved.searchParams.set('display_page', '1')
    return resolved.toString()
  } catch {
    return rawUrl
  }
}

export function primaryReferenceUrl(chunk: ReferenceChunk): string {
  if (chunk.document_page_url) return chunk.document_page_url
  const pageLink = (chunk.page_links || []).find((item) => item.document_page_url)
  if (pageLink?.document_page_url) return pageLink.document_page_url
  return viewerUrlForDocument(chunk.document_preview_url || '')
}
