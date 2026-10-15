import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import AnalyticsTracker from './components/AnalyticsTracker'
import MiniProgramQaReturn from './components/MiniProgramQaReturn'
import { detectMiniProgramEntry, isMiniProgramEntry } from './utils/miniProgramBridge'

const MyLicensesPage = lazy(() => import('./pages/MyLicensesPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const WikiPage = lazy(() => import('./pages/WikiPage'))
const WikiReaderPage = lazy(() => import('./pages/WikiReaderPage'))
const LicenseApplicationPage = lazy(() => import('./pages/LicenseApplicationPage'))
const UserGuidePage = lazy(() => import('./pages/UserGuidePage'))

function ChatEntry() {
  const [entry, setEntry] = useState<'checking' | 'miniprogram' | 'web'>(() => {
    if (isMiniProgramEntry()) return 'miniprogram'
    return /MicroMessenger/i.test(window.navigator.userAgent) ? 'checking' : 'web'
  })

  useEffect(() => {
    if (entry !== 'checking') return
    let active = true
    void detectMiniProgramEntry().then((detected) => {
      if (active) setEntry(detected ? 'miniprogram' : 'web')
    })
    return () => { active = false }
  }, [entry])

  if (entry === 'checking') return <div className="app-route-loading">正在识别访问环境…</div>
  return entry === 'miniprogram' ? <MiniProgramQaReturn /> : <ChatPage />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AnalyticsTracker />
        <Suspense fallback={<div className="app-route-loading">正在加载…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ChatEntry />} />
            <Route path="/docs" element={<WikiPage />} />
            <Route path="/docs/reader" element={<WikiReaderPage />} />
            <Route path="/my-licenses" element={<MyLicensesPage />} />
            <Route path="/license-application" element={<LicenseApplicationPage />} />
            <Route path="/user-guide" element={<UserGuidePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
