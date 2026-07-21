import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import type { QuestionItem } from '../api/types'
import { copyToClipboard } from '../utils/clipboard'
import './LeftDrawer.css'

interface Props {
  open: boolean
  onClose: () => void
  dayQuestions: QuestionItem[]
  weekQuestions: QuestionItem[]
  onSelectHistory: (id: number, content: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
}

export default function LeftDrawer({
  open,
  onClose,
  dayQuestions,
  weekQuestions,
  onSelectHistory,
  onOpenSettings,
  onRefresh,
}: Props) {
  const { user, isLoggedIn, logout, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) setShowLogin(true)
    else setShowLogin(false)
  }, [isLoggedIn, open])

  const handleLogin = async () => {
    if (!username.trim()) return
    await login(username, password)
    onRefresh()
  }

  const handleCopy = async (content: string) => {
    const ok = await copyToClipboard(content)
    if (ok) showToast('复制成功')
  }

  return (
    <>
      {open && <div className="drawer-mask" onClick={onClose} />}
      <div className={`drawer ${open ? 'drawer-open' : ''}`}>
        {!isLoggedIn && showLogin ? (
          <div className="drawer-login">
            <h3 className="drawer-login-title">登录</h3>
            <input
              className="drawer-input"
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="drawer-input"
              type="password"
              placeholder="密码（可留空）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="drawer-login-btn" onClick={handleLogin}>
              登录
            </button>
          </div>
        ) : (
          <>
            <div className="drawer-section">
              <h3 className="drawer-header">今天</h3>
              {dayQuestions.length === 0 && weekQuestions.length === 0 && (
                <p className="drawer-empty">暂无对话</p>
              )}
              {dayQuestions.map((q) => (
                <div
                  key={q.id}
                  className="drawer-item"
                  onClick={() => onSelectHistory(q.id, q.question)}
                >
                  <span className="drawer-item-text" title={q.question}>{q.question}</span>
                  <button
                    className="drawer-copy-btn"
                    onClick={(e) => { e.stopPropagation(); handleCopy(q.question) }}
                    title="复制"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="drawer-section">
              <h3 className="drawer-header">7天内</h3>
              {weekQuestions.map((q) => (
                <div
                  key={q.id}
                  className="drawer-item"
                  onClick={() => onSelectHistory(q.id, q.question)}
                >
                  <span className="drawer-item-text" title={q.question}>{q.question}</span>
                  <button
                    className="drawer-copy-btn"
                    onClick={(e) => { e.stopPropagation(); handleCopy(q.question) }}
                    title="复制"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="drawer-footer">
              <div className="drawer-user">
                <div className="drawer-avatar">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" />
                  ) : (
                    (user?.nickName?.[0] || 'U').toUpperCase()
                  )}
                </div>
                <span className="drawer-nickname">{user?.nickName || '用户'}</span>
              </div>
              <div className="drawer-actions">
                <button className="drawer-action-btn" onClick={onOpenSettings} title="设置">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button className="drawer-action-btn" onClick={logout} title="退出">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function showToast(msg: string) {
  const el = document.createElement('div')
  el.className = 'toast-temp'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1500)
}
