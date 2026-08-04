import { useState } from 'react'
import type { AnswerMedia, ChatMessage, UploadImage } from '../api/types'
import { primaryReferenceUrl } from '../utils/referenceUrl'
import MarkdownContent from './MarkdownContent'
import ImageLightbox from './ImageLightbox'
import { api } from '../api/client'
import pangoLogo from '../../Logo.png'
import './ChatBubble.css'

interface Props {
  message: ChatMessage
  index: number
  onCopy: (content: string) => void
  onEvaluate: (index: number, evaluate: number, time: string) => void
  onCopyQuestion: (content: string) => void
  onOpenReference: (url: string) => void
  onFeedback: (index: number) => void
}

export default function ChatBubble({ message, index, onCopy, onEvaluate, onCopyQuestion, onOpenReference, onFeedback }: Props) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  if (message.flagAi === 0) {
    return (
      <div className="bubble bubble-user">
        <div className="bubble-user-content" onContextMenu={(e) => { e.preventDefault(); onCopyQuestion(message.content) }}>
          {message.images && message.images.length > 0 && (
            <div className="bubble-images">
              {message.images.map((img: UploadImage, i: number) => (
                <img
                  key={i}
                  src={`data:${img.mime_type};base64,${img.data_base64}`}
                  alt={`upload-${i}`}
                  className="bubble-image"
                  onClick={() => setPreviewSrc(img.original_data_url || `data:${img.mime_type};base64,${img.data_base64}`)}
                />
              ))}
            </div>
          )}
          {message.content && <p>{message.content}</p>}
          <span className="bubble-time">{message.time}</span>
        </div>
        <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
      </div>
    )
  }

  const ref = message.reference
  const hasReferences = ref && ref.total > 0 && ref.chunks.length > 0

  return (
    <div className="bubble bubble-ai">
      <div className="bubble-ai-header">
        <img className="bubble-ai-avatar" src={pangoLogo} alt="Pango" />
        <span className="bubble-ai-name">智能助手</span>
      </div>
      <div className="bubble-ai-content">
        {placeMediaAfterCitations(message.contentData || message.content, message.answerMedia || []).map((section, sectionIndex) => (
          <div className="answer-content-section" key={`${sectionIndex}-${section.media.map((item) => item.asset_id).join('-')}`}>
            {section.content ? <MarkdownContent content={section.content} /> : null}
            {section.media.length ? (
              <AnswerMediaPanel media={section.media} onPreview={setPreviewSrc} onOpenReference={onOpenReference} />
            ) : null}
          </div>
        ))}

        {hasReferences && (
          <div className="reference-panel">
            <div className="reference-title">参考资料 · {ref!.total}篇</div>
            {ref!.chunks.map((chunk) => {
              const label = chunk.citation_label || ''
              const displayName = chunk.display_name || chunk.document_name || chunk.title || '未知文档'
              const pageLinks = chunk.page_links || []
              const wikiUrl = primaryReferenceUrl(chunk)

              return (
                <div key={chunk.reference_key || chunk.chunk_id || chunk.reference_index} className="reference-card">
                  <div className="reference-card-header">
                    <div className="reference-name">
                      {label && <span className="citation-label">{label}</span>}
                      <span>{displayName}</span>
                    </div>
                    {wikiUrl && (
                      <button
                        type="button"
                        className="reference-full"
                        onClick={() => onOpenReference(wikiUrl)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5z" />
                          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v18a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5z" />
                        </svg>
                        Wiki阅读
                      </button>
                    )}
                  </div>

                  {pageLinks.length > 0 && (
                    <div className="reference-pages">
                      <span className="reference-pages-label">引用页：</span>
                      {pageLinks.map((pl, i) => (
                        <span
                          key={i}
                          className="reference-page-link"
                          onClick={() => {
                            if (pl.document_page_url) {
                              onOpenReference(pl.document_page_url)
                            }
                          }}
                        >
                          第{pl.page}页
                        </span>
                      ))}
                    </div>
                  )}

                  {pageLinks.length === 0 && chunk.pages && chunk.pages.length > 0 && (
                    <div className="reference-pages">
                      <span className="reference-pages-label">引用页：</span>
                      {chunk.pages.map((p, i) => (
                        <span key={i} className="reference-page-link static">
                          第{p}页
                        </span>
                      ))}
                    </div>
                  )}

                  {pageLinks.length === 0 && chunk.page != null && !chunk.pages && (
                    <div className="reference-meta">第 {chunk.page} 页</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="bubble-time">{message.time}</div>
      </div>
      <div className="bubble-actions">
        <button className="bubble-action-btn" onClick={() => onCopy(message.contentData || message.content)} title="复制">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          className={`bubble-action-btn ${message.flagEvaluate === 1 ? 'active-like' : ''}`}
          onClick={() => onEvaluate(index, 1, message.answerTime || message.time)}
          title="赞"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={message.flagEvaluate === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
        </button>
        <button
          className={`bubble-action-btn ${message.flagEvaluate === -1 ? 'active-dislike' : ''}`}
          onClick={() => onEvaluate(index, -1, message.answerTime || message.time)}
          title="踩"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={message.flagEvaluate === -1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
          </svg>
        </button>
        <button className="bubble-action-btn feedback-action-btn" onClick={() => onFeedback(index)} title="反馈此回答">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 15.5A7.5 7.5 0 0 1 11.5 8H18l2-3v11a2 2 0 0 1-2 2h-6.5A7.5 7.5 0 0 1 4 10.5z" />
            <path d="M12 12h4M12 15h3" />
          </svg>
          <span>反馈</span>
        </button>
      </div>
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  )
}

function AnswerMediaPanel({ media, onPreview, onOpenReference }: {
  media: AnswerMedia[]
  onPreview: (url: string) => void
  onOpenReference: (url: string) => void
}) {
  return (
    <div className="answer-media-panel">
      {media.map((item) => (
        <figure className="answer-media-item" key={item.asset_id}>
          <button type="button" className="answer-media-preview" onClick={() => {
            void api.trackEvent({ eventName: 'answer_image_view', pagePath: '/', clientType: 'WEB' }).catch(() => {})
            onPreview(item.absoluteUrl)
          }}>
            <img src={item.absoluteUrl} alt={item.caption || '回答配图'} loading="lazy" />
          </button>
          {(item.caption || item.citation_label) && (
            <figcaption>
              {item.caption}{item.caption && item.citation_label ? ' ' : ''}{item.citation_label}
            </figcaption>
          )}
          {item.document_page_url && item.page ? (
            <button type="button" className="answer-media-source" onClick={() => onOpenReference(item.document_page_url!)}>
              查看原文第{item.page}页
            </button>
          ) : null}
        </figure>
      ))}
    </div>
  )
}

function placeMediaAfterCitations(content: string, media: AnswerMedia[]): Array<{ content: string; media: AnswerMedia[] }> {
  if (media.length === 0) return [{ content, media: [] }]

  const mediaByOffset = new Map<number, AnswerMedia[]>()
  const unplaced: AnswerMedia[] = []

  media.forEach((item) => {
    const label = item.citation_label?.trim()
    const bracketLabel = label?.match(/\[[^\]]+\]/)?.[0]
    const candidates = [...new Set([label, bracketLabel].filter((value): value is string => Boolean(value)))]
    let matchIndex = -1
    let matchedLabel = ''

    for (const candidate of candidates) {
      matchIndex = content.indexOf(candidate)
      if (matchIndex >= 0) {
        matchedLabel = candidate
        break
      }
    }

    if (matchIndex < 0) {
      unplaced.push(item)
      return
    }

    let insertionOffset = matchIndex + matchedLabel.length
    const openingSup = content.lastIndexOf('<sup', matchIndex)
    const closingSupBeforeLabel = content.lastIndexOf('</sup>', matchIndex)
    const closingSupAfterLabel = content.indexOf('</sup>', insertionOffset)
    if (openingSup > closingSupBeforeLabel && closingSupAfterLabel >= insertionOffset) {
      insertionOffset = closingSupAfterLabel + '</sup>'.length
      const trailingPunctuation = content.slice(insertionOffset).match(/^[ \t]*[。！？.!?；;：:]?/)
      insertionOffset += trailingPunctuation?.[0].length || 0
    }

    mediaByOffset.set(insertionOffset, [...(mediaByOffset.get(insertionOffset) || []), item])
  })

  const sections: Array<{ content: string; media: AnswerMedia[] }> = []
  let contentOffset = 0
  const insertionOffsets = [...mediaByOffset.keys()].sort((a, b) => a - b)
  insertionOffsets.forEach((insertionOffset) => {
    sections.push({
      content: content.slice(contentOffset, insertionOffset),
      media: mediaByOffset.get(insertionOffset) || [],
    })
    contentOffset = insertionOffset
  })

  const trailingContent = content.slice(contentOffset)
  if (trailingContent || unplaced.length || sections.length === 0) {
    sections.push({ content: trailingContent, media: unplaced })
  }
  return sections
}
