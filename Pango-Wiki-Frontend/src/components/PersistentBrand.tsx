import { useLocation } from 'react-router-dom'
import { isMiniProgramEntry } from '../utils/miniProgramBridge'
import './TopBar.css'

const visiblePaths = new Set(['/', '/docs', '/docs/reader', '/license-application'])

export default function PersistentBrand() {
  const { pathname } = useLocation()

  // In a Mini Program WebView the native security banner changes the page's
  // visual top edge. Render the brand inside TopBar there instead of fixing it
  // to the WebView viewport. The regular web app keeps this persistent brand
  // so route switches do not remount or flash the logo.
  if (!visiblePaths.has(pathname) || isMiniProgramEntry()) return null

  return (
    <div className={`persistent-topbar-brand ${pathname === '/' ? 'is-chat' : ''}`}>
      <img src="/Logo.png" alt="Pango" width="48" height="48" decoding="sync" />
      <span>Pango 智能技术平台</span>
    </div>
  )
}
