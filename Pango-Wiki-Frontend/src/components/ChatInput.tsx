import { useState, useRef, useEffect } from 'react'
import VoiceInput from './VoiceInput'
import ImageLightbox from './ImageLightbox'
import type { UploadImage } from '../api/types'
import './ChatInput.css'

interface Props {
  onSend: (text: string) => Promise<boolean> | boolean | void
  onStop: () => void
  isStreaming: boolean
  uploadImages: UploadImage[]
  onImageUpload: () => void
  onPasteImages: (files: File[]) => void
  onRemoveImage: (index: number) => void
}

export default function ChatInput({ onSend, onStop, isStreaming, uploadImages, onImageUpload, onPasteImages, onRemoveImage }: Props) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)

  useEffect(() => {
    if (textareaRef.current && !isStreaming) {
      textareaRef.current.focus()
    }
  }, [isStreaming, mode])

  const handleSend = async () => {
    const hasContent = text.trim() || uploadImages.length > 0
    if (!hasContent || isStreaming || sendingRef.current) return
    sendingRef.current = true
    try {
      const accepted = await onSend(text.trim())
      if (accepted !== false) setText(current => current === text ? '' : current)
    } finally { sendingRef.current = false }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isStreaming) return
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    e.preventDefault()
    onPasteImages(files)
  }

  const handleVoiceResult = (transcribed: string) => {
    if (transcribed.trim()) {
      setText(transcribed.trim())
    }
    setMode('text')
  }

  return (
    <div className="chat-input-area">
      {uploadImages.length > 0 && (
        <div className="image-preview-bar">
          {uploadImages.map((img, i) => (
            <div key={i} className="image-preview-item">
              <button type="button" className="image-preview-open" title="查看原图" onClick={() => setPreviewSrc(img.original_data_url || `data:${img.mime_type};base64,${img.data_base64}`)}>
                <img src={`data:${img.mime_type};base64,${img.data_base64}`} alt={`待上传图片 ${i + 1}`} />
              </button>
              <button className="image-remove-btn" onClick={() => onRemoveImage(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      {mode === 'voice' ? (
        <VoiceInput onResult={handleVoiceResult} onCancel={() => setMode('text')} />
      ) : (
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder="发消息..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={isStreaming}
          />
          <div className="chat-input-actions">
            <button
              className="input-action-btn"
              onClick={() => setMode('voice')}
              disabled={isStreaming}
              title="语音输入"
              aria-label="切换到语音输入"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
              </svg>
            </button>
            <button
              className="input-action-btn"
              onClick={onImageUpload}
              disabled={isStreaming}
              title="上传图片"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            {isStreaming ? (
              <button className="input-action-btn stop-btn" onClick={onStop} title="停止">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className={`input-action-btn ${text.trim() ? 'ready' : ''}`}
                onClick={handleSend}
                disabled={!text.trim() && uploadImages.length === 0}
                title="发送"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  )
}
