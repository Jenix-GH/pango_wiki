import { useLocation } from 'react-router-dom'
import './TopBar.css'

const visiblePaths = new Set(['/', '/wiki', '/wiki/reader', '/license-application'])

export default function PersistentBrand() {
  const { pathname } = useLocation()

  if (!visiblePaths.has(pathname)) return null

  return (
    <div className={`persistent-topbar-brand ${pathname === '/' ? 'is-chat' : ''}`}>
      <img src="/Logo.png" alt="Pango" width="48" height="48" decoding="sync" />
      <span>Pango 智能技术平台</span>
    </div>
  )
}
