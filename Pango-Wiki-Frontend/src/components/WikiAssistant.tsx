import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { normalizeReference, type AnswerMedia, type ReferencePayload, type UploadImage } from '../api/types'
import { usePseudoStream } from '../hooks/usePseudoStream'
import { openReferenceReaderUrl, primaryReferenceUrl } from '../utils/referenceUrl'
import MarkdownContent from './MarkdownContent'
import ImageLightbox from './ImageLightbox'
import pangoLogo from '../../Logo.png'
import './WikiAssistant.css'
import { useAuth } from '../contexts/AuthContext'
import { placeMediaAfterCitations } from '../utils/answerRendering'
import AgentProgress from './AgentProgress'
import { advanceAgentProgress, INITIAL_AGENT_PROGRESS } from '../utils/agentProgress'
import type { AgentProgressState } from '../utils/agentProgress'

interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  images?: UploadImage[]
  reference?: ReferencePayload
  answerMedia?: AnswerMedia[]
}

export default function WikiAssistant() {
  const { user, guestUserId, incrementAnswerCount } = useAuth()
  const recordUserId = user?.id || guestUserId
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<AgentProgressState | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [uploadImages, setUploadImages] = useState<UploadImage[]>([])
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [panelSize, setPanelSize] = useState(() => ({
    width: 420,
    height: Math.max(480, Math.min(720, window.innerHeight - 104)),
  }))
  const {
    visibleText: streamText,
    push: pushStreamText,
    finish: finishStreamText,
    reset: resetStreamText,
    getTargetText,
    getVisibleText,
  } = usePseudoStream()
  const controllerRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [messages, open, progress, status, streamText])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    const resizePanel = (event: PointerEvent) => {
      const start = resizeRef.current
      if (!start) return
      setPanelSize({
        width: Math.max(340, Math.min(window.innerWidth - 24, start.width - (event.clientX - start.x))),
        height: Math.max(420, Math.min(window.innerHeight - 88, start.height - (event.clientY - start.y))),
      })
    }
    const stopResize = () => {
      resizeRef.current = null
      document.body.classList.remove('is-resizing-wiki-assistant')
    }
    window.addEventListener('pointermove', resizePanel)
    window.addEventListener('pointerup', stopResize)
    return () => {
      window.removeEventListener('pointermove', resizePanel)
      window.removeEventListener('pointerup', stopResize)
      document.body.classList.remove('is-resizing-wiki-assistant')
    }
  }, [])

  const addImages = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) return
    if (uploadImages.length >= 1) {
      window.alert('每次提问只能上传 1 张图片，请删除已有图片后再添加。')
      return
    }
    if (imageFiles.length > 1) {
      window.alert('每次提问只能上传 1 张图片，本次将只添加第一张符合大小要求的图片。')
    }
    const acceptableImages = imageFiles.filter((file) => file.size <= MAX_IMAGE_FILE_BYTES)
    if (acceptableImages.length !== imageFiles.length) {
      window.alert('单张图片不能超过 15MB，请压缩图片后重试。')
    }
    if (!acceptableImages.length) return
    try {
      const prepared = await prepareImage(acceptableImages[0])
      setUploadImages([prepared])
    } catch {
      setStatus('图片读取失败，请更换图片后重试')
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (streaming) return
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (!files.length) return
    event.preventDefault()
    void addImages(files)
  }

  const send = () => {
    const question = text.trim()
    if (streaming) return
    if (!question) {
      if (uploadImages.length > 0) {
        window.alert('请先输入问题文字，图片需要配合文字一起发送')
      }
      return
    }
    if (!recordUserId) {
      setStatus('访客信息初始化中，请稍后重试')
      return
    }
    const imagesToSend = [...uploadImages]
    setText('')
    setUploadImages([])
    setMessages((current) => [
      ...current,
      {
        role: 'user',
        content: question,
        images: imagesToSend.length ? imagesToSend : undefined,
      },
    ])
    resetStreamText()
    setStatus('')
    setProgress(INITIAL_AGENT_PROGRESS)
    setStreaming(true)
    const requestId = ++requestIdRef.current
    let answerBuffer = ''
    let finalized = false

    const isCurrentRequest = () => requestId === requestIdRef.current && !finalized
    const finalize = (content: string, reference?: ReferencePayload, answerMedia: AnswerMedia[] = []) => {
      if (!isCurrentRequest()) return
      finalized = true
      setStatus('')
      setProgress(null)
      controllerRef.current = null
      const authoritativeAnswer = content.trim()
      const normalizedReference = normalizeReference(reference)
      void finishStreamText(authoritativeAnswer).then(() => {
        if (requestId !== requestIdRef.current) return
        const completedAnswer = getTargetText().trim()
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: completedAnswer || '回答生成中断，请重新提问。',
            reference: normalizedReference.chunks.length ? normalizedReference : undefined,
            answerMedia: answerMedia.length ? answerMedia : undefined,
          },
        ])
        resetStreamText()
        setStreaming(false)
      })
    }

    if (!sessionIdRef.current) {
      sessionIdRef.current = api.createSession(recordUserId)
    }
    controllerRef.current = api.startStream(
      recordUserId,
      question,
      sessionIdRef.current,
      true,
      imagesToSend.length ? imagesToSend : null,
      {
        onProgress: (nextProgress) => {
          if (isCurrentRequest()) {
            setProgress((current) => advanceAgentProgress(current, nextProgress))
          }
        },
        onChunk: (chunk, mode) => {
          if (!isCurrentRequest()) return
          setStatus('')
          setProgress(null)
          answerBuffer = mode === 'replace' ? chunk : answerBuffer + chunk
          pushStreamText(chunk, mode)
        },
        onDone: (answer, reference, _citations, _trace, answerMedia) => {
          incrementAnswerCount()
          finalize(answer || answerBuffer, reference, answerMedia)
        },
        onError: (error) => {
          finalize(answerBuffer || `请求失败：${error.message}`)
        },
      },
    )
  }

  const stop = () => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    const visibleAnswer = getVisibleText()
    if (visibleAnswer) {
      setMessages((current) => [...current, { role: 'assistant', content: visibleAnswer }])
    }
    resetStreamText()
    setStatus('')
    setProgress(null)
    setStreaming(false)
  }

  return (
    <>
      <button
        type="button"
        className={`wiki-assistant-launcher ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="wikiAssistantPanel"
        title="打开边看边问浮窗（不会离开当前文档页）"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
        <span><strong>边看边问</strong><small>浮窗问答</small></span>
      </button>

      <section
        id="wikiAssistantPanel"
        className={`wiki-assistant-panel ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        style={{ width: panelSize.width, height: panelSize.height }}
      >
        <button
          type="button"
          className="wiki-assistant-resize"
          aria-label="拖动调整问答窗口大小"
          title="拖动调整窗口大小"
          onPointerDown={(event) => {
            event.preventDefault()
            resizeRef.current = {
              x: event.clientX,
              y: event.clientY,
              width: panelSize.width,
              height: panelSize.height,
            }
            document.body.classList.add('is-resizing-wiki-assistant')
          }}
        />
        <header>
          <div>
            <img src={pangoLogo} alt="" />
            <span><strong>边看边问</strong><small>无需离开 Wiki 页面</small></span>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="关闭问答浮窗">×</button>
        </header>
        <div className="wiki-assistant-messages" ref={scrollRef}>
          {messages.length === 0 && !streaming ? (
            <div className="wiki-assistant-empty">
              <h2>阅读时遇到问题？</h2>
              <p>在这里提问，当前 Wiki 页面会继续保留。</p>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div key={index} className={`wiki-assistant-message is-${message.role}`}>
              {message.images?.length ? (
                <div className="wiki-assistant-sent-images">
                  {message.images.map((image, imageIndex) => {
                    const thumbnail = `data:${image.mime_type};base64,${image.data_base64}`
                    return (
                      <button
                        type="button"
                        key={`${image.filename}-${imageIndex}`}
                        onClick={() => setPreviewSrc(image.original_data_url || thumbnail)}
                        title="查看原图"
                      >
                        <img src={thumbnail} alt={`已发送图片 ${imageIndex + 1}`} />
                      </button>
                    )
                  })}
                </div>
              ) : null}
              {message.content
                ? message.role === 'assistant'
                  ? <AssistantAnswer content={message.content} media={message.answerMedia || []} onPreview={setPreviewSrc} />
                  : <p>{message.content}</p>
                : null}
              {message.role === 'assistant' && message.reference ? (
                <AssistantReferences reference={message.reference} />
              ) : null}
            </div>
          ))}
          {streaming && (streamText || progress) ? (
            <div className={`wiki-assistant-message is-assistant${streamText ? '' : ' is-progress'}`}>
              {streamText
                ? <MarkdownContent content={streamText} />
                : progress ? <AgentProgress progress={progress} compact /> : null}
            </div>
          ) : null}
        </div>
        {uploadImages.length > 0 ? (
          <div className="wiki-assistant-previews">
            {uploadImages.map((image, index) => {
              const thumbnail = `data:${image.mime_type};base64,${image.data_base64}`
              return (
                <div className="wiki-assistant-preview" key={`${image.filename}-${index}`}>
                  <button type="button" onClick={() => setPreviewSrc(image.original_data_url || thumbnail)} title="查看原图">
                    <img src={thumbnail} alt={`待上传图片 ${index + 1}`} />
                  </button>
                  <button
                    type="button"
                    className="wiki-assistant-preview-remove"
                    onClick={() => setUploadImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label={`删除图片 ${index + 1}`}
                  >×</button>
                </div>
              )
            })}
          </div>
        ) : null}
        <div className="wiki-assistant-composer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addImages(Array.from(event.target.files || []))
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="wiki-assistant-upload"
            onClick={() => {
              if (uploadImages.length >= 1) {
                window.alert('每次提问只能上传 1 张图片，请删除已有图片后再添加。')
                return
              }
              fileInputRef.current?.click()
            }}
            disabled={streaming}
            title="上传图片（限 1 张，最大 15MB）"
            aria-label="上传图片"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </button>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={handlePaste}
            placeholder="询问器件或文档问题…"
            rows={2}
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" className="is-stop" onClick={stop}>停止</button>
          ) : (
            <button type="button" onClick={send} disabled={!text.trim() && uploadImages.length === 0}>发送</button>
          )}
        </div>
        <p className="wiki-assistant-note">AI 生成内容仅供参考</p>
      </section>
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </>
  )
}

function AssistantAnswer({ content, media, onPreview }: {
  content: string
  media: AnswerMedia[]
  onPreview: (url: string) => void
}) {
  return placeMediaAfterCitations(content, media).map((section, index) => (
    <div className="wiki-assistant-answer-section" key={`${index}-${section.media.map((item) => item.asset_id).join('-')}`}>
      {section.content ? <MarkdownContent content={section.content} /> : null}
      {section.media.length ? <AssistantMedia media={section.media} onPreview={onPreview} /> : null}
    </div>
  ))
}

function AssistantMedia({ media, onPreview }: { media: AnswerMedia[]; onPreview: (url: string) => void }) {
  return (
    <div className="wiki-assistant-answer-media">
      {media.map((item) => (
        <figure key={item.asset_id}>
          <button type="button" onClick={() => {
            const clientType = new URLSearchParams(window.location.search).get('client') === 'miniprogram' ? 'MINIPROGRAM' : 'WEB'
            void api.trackEvent({ eventName: 'answer_image_view', pagePath: '/docs/reader', clientType }).catch(() => {})
            onPreview(item.absoluteUrl)
          }}>
            <img src={item.absoluteUrl} alt={item.caption || '回答配图'} loading="lazy" />
          </button>
          {(item.caption || item.citation_label) ? <figcaption>{item.caption} {item.citation_label}</figcaption> : null}
          {item.document_page_url && item.page ? (
            <button type="button" className="wiki-assistant-media-source" onClick={() => openReferenceReaderUrl(item.document_page_url!)}>
              查看原文第{item.page}页
            </button>
          ) : null}
        </figure>
      ))}
    </div>
  )
}

function AssistantReferences({ reference }: { reference: ReferencePayload }) {
  return (
    <div className="wiki-assistant-references">
      <div className="wiki-assistant-reference-title">参考资料 · {reference.total}篇</div>
      {reference.chunks.map((chunk) => {
        const pageLinks = chunk.page_links || []
        const wikiUrl = primaryReferenceUrl(chunk)
        const displayName = chunk.display_name || chunk.document_name || chunk.title || '未知文档'

        return (
          <div
            className="wiki-assistant-reference-card"
            key={chunk.reference_key || chunk.chunk_id || chunk.reference_index}
          >
            <div className="wiki-assistant-reference-header">
              <span>
                {chunk.citation_label ? <strong>{chunk.citation_label}</strong> : null}
                {displayName}
              </span>
              {wikiUrl ? (
                <button type="button" onClick={() => openReferenceReaderUrl(wikiUrl)}>Wiki阅读</button>
              ) : null}
            </div>
            {pageLinks.length ? (
              <div className="wiki-assistant-reference-pages">
                <span>引用页：</span>
                {pageLinks.map((pageLink, index) => (
                  <button
                    type="button"
                    key={pageLink.page_key || `${pageLink.page}-${index}`}
                    onClick={() => pageLink.document_page_url && openReferenceReaderUrl(pageLink.document_page_url)}
                    disabled={!pageLink.document_page_url}
                  >
                    {pageLink.citation_label ? <span>{pageLink.citation_label} </span> : null}
                    第{pageLink.page}页
                  </button>
                ))}
              </div>
            ) : chunk.pages?.length ? (
              <div className="wiki-assistant-reference-pages">
                <span>引用页：</span>
                <span>{chunk.pages.map((page) => `第${page}页`).join('、')}</span>
              </div>
            ) : chunk.page != null ? (
              <div className="wiki-assistant-reference-pages">第{chunk.page}页</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const MAX_IMAGE_EDGE = 1920
const JPEG_QUALITY = 0.85
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024

async function prepareImage(file: File): Promise<UploadImage> {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const compressedDataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? JPEG_QUALITY : undefined)
  const baseName = (file.name || `pasted-image-${Date.now()}`).replace(/\.[^.]+$/, '')
  return {
    mime_type: mimeType,
    data_base64: compressedDataUrl.split(',')[1],
    filename: `${baseName}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
    original_data_url: dataUrl,
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unsupported image format'))
    image.src = src
  })
}
