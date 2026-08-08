import { useEffect, useRef, useState } from 'react'
import type { FeedbackPayload, UploadImage } from '../api/types'
import './FeedbackModal.css'

type FeedbackForm = Pick<FeedbackPayload, 'feedbackType' | 'detail' | 'feedbackImages' | 'contactName' | 'companyName' | 'email' | 'phone'>

interface Props {
  open: boolean
  submitting: boolean
  onClose: () => void
  onSubmit: (form: FeedbackForm) => void
}

const feedbackTypes = ['回答不准确', '没有解决问题', '内容过时', '引用资料有误', '其他问题']

export default function FeedbackModal({ open, submitting, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FeedbackForm>({ feedbackType: '回答不准确', detail: '' })
  const [image, setImage] = useState<UploadImage | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    if (open) {
      setForm({ feedbackType: '回答不准确', detail: '' })
      setImage(null)
      setPosition({ x: 0, y: 0 })
      dragRef.current = null
    }
  }, [open])

  if (!open) return null

  const update = (key: keyof FeedbackForm, value: string) => setForm((previous) => ({ ...previous, [key]: value }))
  const chooseImage = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      window.alert('反馈图片仅支持 JPEG、PNG 或 WebP 格式。')
      return
    }
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
      window.alert('反馈图片不能超过 15MB，请压缩后重试。')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setImage({ mime_type: file.type, data_base64: dataUrl.split(',')[1] || '', filename: file.name })
    } catch {
      window.alert('反馈图片读取失败，请更换图片后重试。')
    }
  }
  const submit = () => onSubmit({
    ...form,
    feedbackImages: image ? JSON.stringify([image]) : undefined,
  })
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 600 || event.button !== 0 || !modalRef.current) return
    const rect = modalRef.current.getBoundingClientRect()
    const baseLeft = rect.left - position.x
    const baseTop = rect.top - position.y
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      minX: 8 - baseLeft,
      maxX: window.innerWidth - rect.width - 8 - baseLeft,
      minY: 8 - baseTop,
      maxY: window.innerHeight - rect.height - 8 - baseTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition({
      x: clamp(drag.originX + event.clientX - drag.startX, drag.minX, drag.maxX),
      y: clamp(drag.originY + event.clientY - drag.startY, drag.minY, drag.maxY),
    })
  }
  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="feedback-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={modalRef}
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      >
        <button className="feedback-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <div
          className="feedback-drag-handle"
          title="按住拖动窗口；拖动右下角可调整大小"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div className="feedback-kicker">回答质量反馈</div>
          <h2 id="feedback-title">告诉我们哪里需要改进</h2>
        </div>
        <p className="feedback-intro">你的反馈将与本次问题和 AI 回答一起提交，帮助我们核查并持续改进回答质量。</p>

        <label className="feedback-label">问题类型</label>
        <div className="feedback-types">
          {feedbackTypes.map((type) => (
            <button key={type} type="button" className={form.feedbackType === type ? 'selected' : ''} onClick={() => update('feedbackType', type)}>{type}</button>
          ))}
        </div>

        <label className="feedback-label" htmlFor="feedback-detail">详细说明 <span>选填</span></label>
        <textarea id="feedback-detail" maxLength={2000} value={form.detail} onChange={(event) => update('detail', event.target.value)} placeholder="例如：器件参数不准确，正确值应为……" />

        <div className="feedback-contact-title">补充图片 <span>选填，限 1 张，最大 15MB</span></div>
        <input
          ref={fileInputRef}
          className="feedback-image-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            void chooseImage(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {image ? (
          <div className="feedback-image-preview">
            <img src={`data:${image.mime_type};base64,${image.data_base64}`} alt="反馈图片预览" />
            <button type="button" onClick={() => setImage(null)}>删除图片</button>
          </div>
        ) : (
          <button type="button" className="feedback-image-add" onClick={() => fileInputRef.current?.click()}>上传截图或照片</button>
        )}

        <div className="feedback-contact-title">联系方式 <span>选填，方便工程师进一步联系</span></div>
        <div className="feedback-grid">
          <input maxLength={100} value={form.contactName || ''} onChange={(event) => update('contactName', event.target.value)} placeholder="姓名" />
          <input maxLength={200} value={form.companyName || ''} onChange={(event) => update('companyName', event.target.value)} placeholder="公司名称" />
          <input maxLength={200} type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} placeholder="电子邮箱" />
          <input maxLength={50} type="tel" value={form.phone || ''} onChange={(event) => update('phone', event.target.value)} placeholder="联系电话" />
        </div>

        <div className="feedback-actions">
          <button type="button" className="feedback-cancel" onClick={onClose}>暂不反馈</button>
          <button type="button" className="feedback-submit" disabled={submitting} onClick={submit}>{submitting ? '提交中…' : '提交反馈'}</button>
        </div>
      </section>
    </div>
  )
}

const MAX_FEEDBACK_IMAGE_BYTES = 15 * 1024 * 1024

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
