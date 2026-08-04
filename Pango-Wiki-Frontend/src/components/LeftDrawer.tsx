import { useAuth } from '../contexts/AuthContext'
import type { QuestionItem } from '../api/types'
import { copyToClipboard } from '../utils/clipboard'
import './LeftDrawer.css'

interface Props {
  open: boolean
  onClose: () => void
  onNewSession: () => void
  onOpenLogin: () => void
  dayQuestions: QuestionItem[]
  weekQuestions: QuestionItem[]
  onSelectHistory: (sessionId: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
  onOpenGuide: () => void
}

export default function LeftDrawer({
  open,
  onClose,
  onNewSession,
  onOpenLogin,
  dayQuestions,
  weekQuestions,
  onSelectHistory,
  onOpenSettings,
  onRefresh,
  onOpenGuide,
}: Props) {
  const { user, isLoggedIn, logout } = useAuth()

  const handleCopy = async (content: string) => {
    const ok = await copyToClipboard(content)
    if (ok) showToast('复制成功')
  }

  return (
    <>
      {open && <div className="drawer-mask" onClick={onClose} />}
      <div className={`drawer ${open ? 'drawer-open' : ''}`}>
        <div className="drawer-controls">
          <div className="drawer-resources">
            <button className="drawer-resource-btn" type="button" onClick={onOpenGuide} title="使用说明">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span>使用说明</span>
            </button>
            <div className="drawer-mini-program" tabIndex={0}>
              <button className="drawer-resource-btn" type="button" aria-label="查看小程序二维码" title="小程序">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3" />
                </svg>
                <span>小程序</span>
              </button>
              <div className="drawer-qrcode" role="tooltip">
                <img src="/miniprogram_qrcode.jpg" alt="Pango 慧答小程序二维码" />
                <span>微信扫码进入小程序</span>
              </div>
            </div>
          </div>
          <button className="drawer-collapse-btn" onClick={onClose} title={open ? '收起侧栏' : '展开侧栏'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 5h16M4 12h16M4 19h16" />
            </svg>
          </button>
        </div>

        <nav className="drawer-nav">
          <button className="drawer-nav-item drawer-new-chat" onClick={onNewSession}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>新建对话</span>
          </button>
        </nav>

        <div className="drawer-history">
          <div className="drawer-history-title">
            <span>历史记录</span>
            <button onClick={onRefresh} title="刷新历史记录">↻</button>
          </div>
          {isLoggedIn ? (
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
                  onClick={() => onSelectHistory(q.sessionId)}
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
                  onClick={() => onSelectHistory(q.sessionId)}
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
            </>
          ) : (
            <p className="drawer-empty drawer-history-empty">登录后查看历史对话</p>
          )}
        </div>

        <div className="drawer-footer">
          {!isLoggedIn ? (
            <button className="drawer-login-link" onClick={onOpenLogin}>
              <span className="drawer-login-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                </svg>
              </span>
              <span>
                <strong>登录</strong>
                <small>同步历史记录和个人设置</small>
              </span>
            </button>
          ) : (
            <div className="drawer-account-row">
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
          )}
          <a
            className="drawer-icp-link"
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >
            粤ICP备14029535号-1
          </a>
        </div>
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
