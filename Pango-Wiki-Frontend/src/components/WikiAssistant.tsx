import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { UploadImage } from '../api/types'
import { usePseudoStream } from '../hooks/usePseudoStream'
import MarkdownContent from './MarkdownContent'
import ImageLightbox from './ImageLightbox'
import pangoLogo from '../../Logo.png'
import './WikiAssistant.css'

interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  images?: UploadImage[]
}

export default function WikiAssistant() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [status, setStatus] = useState('')
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [messages, open, status, streamText])

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
    const available = 3 - uploadImages.length
    if (!imageFiles.length || available <= 0) return
    try {
      const prepared = await Promise.all(imageFiles.slice(0, available).map(prepareImage))
      setUploadImages((current) => [...current, ...prepared].slice(0, 3))
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
    if ((!question && uploadImages.length === 0) || streaming) return
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
    setStatus('正在理解问题…')
    setStreaming(true)
    const requestId = ++requestIdRef.current
    let answerBuffer = ''
    let finalized = false

    const isCurrentRequest = () => requestId === requestIdRef.current && !finalized
    const finalize = (content: string) => {
      if (!isCurrentRequest()) return
      finalized = true
      setStatus('')
      controllerRef.current = null
      const authoritativeAnswer = content.trim()
      void finishStreamText(authoritativeAnswer).then(() => {
        if (requestId !== requestIdRef.current) return
        const completedAnswer = getTargetText().trim()
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: completedAnswer || '回答生成中断，请重新提问。',
          },
        ])
        resetStreamText()
        setStreaming(false)
      })
    }

    controllerRef.current = api.startStream(
      question,
      api.createSession('wiki_guest'),
      true,
      imagesToSend.length ? imagesToSend : null,
      {
        onProgress: (nextStatus) => {
          if (isCurrentRequest()) setStatus(nextStatus)
        },
        onChunk: (chunk, mode) => {
          if (!isCurrentRequest()) return
          setStatus('')
          answerBuffer = mode === 'replace' ? chunk : answerBuffer + chunk
          pushStreamText(chunk, mode)
        },
        onDone: (answer) => {
          finalize(answer || answerBuffer)
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
                  ? <MarkdownContent content={message.content} />
                  : <p>{message.content}</p>
                : null}
            </div>
          ))}
          {streaming ? (
            <div className="wiki-assistant-message is-assistant">
              {streamText ? <MarkdownContent content={streamText} /> : <span className="wiki-assistant-status">{status || '正在生成回答…'}</span>}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploadImages.length >= 3}
            title="上传图片（最多 3 张）"
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

const MAX_IMAGE_EDGE = 1920
const JPEG_QUALITY = 0.85

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
