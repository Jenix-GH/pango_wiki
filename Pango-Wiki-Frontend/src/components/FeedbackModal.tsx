import { useEffect, useState } from 'react'
import type { FeedbackPayload } from '../api/types'
import './FeedbackModal.css'

type FeedbackForm = Pick<FeedbackPayload, 'feedbackType' | 'detail' | 'contactName' | 'companyName' | 'email' | 'phone'>

interface Props {
  open: boolean
  submitting: boolean
  onClose: () => void
  onSubmit: (form: FeedbackForm) => void
}

const feedbackTypes = ['回答不准确', '没有解决问题', '内容过时', '引用资料有误', '其他问题']

export default function FeedbackModal({ open, submitting, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FeedbackForm>({ feedbackType: '回答不准确', detail: '' })

  useEffect(() => {
    if (open) setForm({ feedbackType: '回答不准确', detail: '' })
  }, [open])

  if (!open) return null

  const update = (key: keyof FeedbackForm, value: string) => setForm((previous) => ({ ...previous, [key]: value }))

  return (
    <div className="feedback-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <button className="feedback-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <div className="feedback-kicker">回答质量反馈</div>
        <h2 id="feedback-title">告诉我们哪里需要改进</h2>
        <p className="feedback-intro">你的反馈将与本次问题和 AI 回答一起提交，帮助我们核查并持续改进回答质量。</p>

        <label className="feedback-label">问题类型</label>
        <div className="feedback-types">
          {feedbackTypes.map((type) => (
            <button key={type} type="button" className={form.feedbackType === type ? 'selected' : ''} onClick={() => update('feedbackType', type)}>{type}</button>
          ))}
        </div>

        <label className="feedback-label" htmlFor="feedback-detail">详细说明 <span>选填</span></label>
        <textarea id="feedback-detail" maxLength={2000} value={form.detail} onChange={(event) => update('detail', event.target.value)} placeholder="例如：器件参数不准确，正确值应为……" />

        <div className="feedback-contact-title">联系方式 <span>选填，方便工程师进一步联系</span></div>
        <div className="feedback-grid">
          <input maxLength={100} value={form.contactName || ''} onChange={(event) => update('contactName', event.target.value)} placeholder="姓名" />
          <input maxLength={200} value={form.companyName || ''} onChange={(event) => update('companyName', event.target.value)} placeholder="公司名称" />
          <input maxLength={200} type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} placeholder="电子邮箱" />
          <input maxLength={50} type="tel" value={form.phone || ''} onChange={(event) => update('phone', event.target.value)} placeholder="联系电话" />
        </div>

        <div className="feedback-actions">
          <button type="button" className="feedback-cancel" onClick={onClose}>暂不反馈</button>
          <button type="button" className="feedback-submit" disabled={submitting} onClick={() => onSubmit(form)}>{submitting ? '提交中…' : '提交反馈'}</button>
        </div>
      </section>
    </div>
  )
}
