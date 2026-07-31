import pangoLogo from '../../Logo.png'
import './TopBar.css'

interface Props {
  active: 'chat' | 'wiki'
  userLabel: string
  onOpenChat: () => void
  onOpenWiki: () => void
  onOpenUser: () => void
  onOpenMenu?: () => void
  userDisabled?: boolean
}

export default function TopBar({
  active,
  userLabel,
  onOpenChat,
  onOpenWiki,
  onOpenUser,
  onOpenMenu,
  userDisabled = false,
}: Props) {
  return (
    <header className="topbar">
      {onOpenMenu ? (
        <button className="topbar-menu" onClick={onOpenMenu} title="打开侧栏" aria-label="打开侧栏">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      ) : null}

      <div className="topbar-brand">
        <img src={pangoLogo} alt="Pango" />
        <span>Pango Wiki</span>
      </div>

      <nav className="topbar-primary-nav" aria-label="主导航">
        <button
          type="button"
          className={active === 'wiki' ? 'active' : ''}
          onClick={onOpenWiki}
          title="器件文档"
          aria-label="器件文档"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v18a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5z" />
          </svg>
          <span>器件文档</span>
        </button>
        <button
          type="button"
          className={active === 'chat' ? 'active' : ''}
          onClick={onOpenChat}
          title="智能问答"
          aria-label="智能问答"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
          <span>智能问答</span>
        </button>
      </nav>

      <button
        type="button"
        className="topbar-user"
        onClick={onOpenUser}
        disabled={userDisabled}
        title={userLabel === '访客' ? '登录' : '用户与设置'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
        <span>{userLabel}</span>
      </button>
    </header>
  )
}
