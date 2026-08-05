import type { AnswerMedia, ReferenceChunk } from '../api/types'

const ALLOWED_REFERENCE_PATHS = new Set([
  '/references/viewer',
  '/references/document',
  '/references/download',
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

export function resolveAnswerMediaUrl(rawUrl: string): string | null {
  const candidate = String(rawUrl || '').trim()
  if (!candidate) return null
  try {
    const base = referenceBaseUrl()
    const resolved = new URL(candidate, base)
    if (resolved.origin !== base.origin) return null
    if (!resolved.pathname.startsWith('/references/figures/')) return null
    return resolved.toString()
  } catch {
    return null
  }
}

export function normalizeAnswerMedia(value: unknown): AnswerMedia[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = parsed.trim() ? JSON.parse(parsed) : []
    } catch {
      parsed = []
    }
  }
  if (!Array.isArray(parsed)) return []

  return parsed.slice(0, 10).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const media = item as Record<string, unknown>
    const rawUrl = String(media.url || media.image_url || media.absolute_url || media.absoluteUrl || '')
    const absoluteUrl = resolveAnswerMediaUrl(rawUrl)
    if (!absoluteUrl) return []
    const rawPage = Number(media.page)
    const documentPageUrl = resolveReferenceUrl(String(media.document_page_url || ''))
    return [{
      asset_id: String(media.asset_id || `answer_media_${index}`),
      url: rawUrl,
      absoluteUrl,
      caption: media.caption ? String(media.caption) : undefined,
      citation_label: media.citation_label ? String(media.citation_label) : undefined,
      page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : undefined,
      document_page_url: documentPageUrl || undefined,
    }]
  })
}

export function serializeAnswerMedia(media: AnswerMedia[]): string {
  return JSON.stringify(media.map(({ absoluteUrl: _absoluteUrl, ...item }) => item))
}

export function openReferenceUrl(rawUrl: string): boolean {
  const resolved = resolveReferenceUrl(rawUrl)
  if (!resolved) return false
  const opened = window.open(resolved, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
  return true
}

export function openReferenceReaderUrl(rawUrl: string): boolean {
  const resolved = resolveReferenceUrl(rawUrl)
  if (!resolved) return false
  const readerUrl = new URL('/docs/reader', window.location.origin)
  readerUrl.searchParams.set('url', resolved)
  const opened = window.open(readerUrl.toString(), '_blank', 'noopener,noreferrer')
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
