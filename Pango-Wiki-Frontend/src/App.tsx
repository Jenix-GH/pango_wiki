import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import PersistentBrand from './components/PersistentBrand'
import AnalyticsTracker from './components/AnalyticsTracker'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const WikiPage = lazy(() => import('./pages/WikiPage'))
const WikiReaderPage = lazy(() => import('./pages/WikiReaderPage'))
const LicenseApplicationPage = lazy(() => import('./pages/LicenseApplicationPage'))
const UserGuidePage = lazy(() => import('./pages/UserGuidePage'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PersistentBrand />
        <AnalyticsTracker />
        <Suspense fallback={<div className="app-route-loading">正在加载…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ChatPage />} />
            <Route path="/wiki" element={<WikiPage />} />
            <Route path="/wiki/reader" element={<WikiReaderPage />} />
            <Route path="/wiki/preview" element={<Navigate to="/wiki" replace />} />
            <Route path="/license-application" element={<LicenseApplicationPage />} />
            <Route path="/user-guide" element={<UserGuidePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
