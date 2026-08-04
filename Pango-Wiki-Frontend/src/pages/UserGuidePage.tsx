import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MarkdownContent from '../components/MarkdownContent'
import './UserGuidePage.css'

const GUIDE_URL = '/pango_huida_user_guide.md'

export default function UserGuidePage() {
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    const loadGuide = async () => {
      try {
        const response = await fetch(GUIDE_URL, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setContent(await response.text())
      } catch (loadError) {
        if (controller.signal.aborted) return
        console.error('使用说明加载失败', loadError)
        setError('使用说明加载失败，请稍后重试')
      }
    }

    void loadGuide()
    return () => controller.abort()
  }, [])

  return (
    <div className="user-guide-page">
      <header className="user-guide-header">
        <button type="button" onClick={() => navigate(-1)} aria-label="返回问答页面">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          返回
        </button>
        <strong>Pango 慧答使用说明</strong>
      </header>
      <main className="user-guide-content">
        {error ? <div className="user-guide-state is-error">{error}</div> : null}
        {!error && !content ? <div className="user-guide-state">正在加载使用说明...</div> : null}
        {content ? <MarkdownContent content={content} /> : null}
      </main>
    </div>
  )
}
