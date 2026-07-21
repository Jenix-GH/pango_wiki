import './TopBar.css'

interface Props {
  title: string
  onOpenLeft: () => void
  onNewSession: () => void
  onOpenWiki: () => void
}

export default function TopBar({ title, onOpenLeft, onNewSession, onOpenWiki }: Props) {
  return (
    <div className="topbar">
      <button className="topbar-btn" onClick={onOpenLeft} title="菜单">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <span className="topbar-title">{title}</span>
      <div className="topbar-actions">
        <button className="topbar-wiki-btn" onClick={onOpenWiki} title="打开器件 Wiki">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5z" />
            <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v18a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5z" />
          </svg>
          <span>器件 Wiki</span>
        </button>
        <button className="topbar-btn" onClick={onNewSession} title="新会话">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  )
}
