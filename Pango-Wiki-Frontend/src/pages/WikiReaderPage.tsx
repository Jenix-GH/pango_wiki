import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { resolveReferenceUrl } from '../utils/referenceUrl'
import TopBar from '../components/TopBar'
import WikiAssistant from '../components/WikiAssistant'
import './WikiReaderPage.css'

const PINCH_IN_THRESHOLD = 1.12
const PINCH_OUT_THRESHOLD = 0.9
const READER_ASSET_VERSION = '20260728-reader-shell1'

function loadScript(src: string): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.dataset.wikiReaderAsset = 'true'
    script.onload = () => resolve(script)
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.body.appendChild(script)
  })
}

export default function WikiReaderPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState('')
  const viewerUrl = useMemo(
    () => resolveReferenceUrl(searchParams.get('url') || ''),
    [searchParams],
  )
  const miniProgramClient = searchParams.get('client') === 'miniprogram'

  const handleFrameLoad = () => {
    const frame = frameRef.current
    if (!frame) return
    try {
      const frameLocation = frame.contentWindow?.location
      if (!frameLocation || frameLocation.origin !== window.location.origin) return
      if (frameLocation.pathname === '/docs' || frameLocation.pathname === '/') {
        navigate(`${frameLocation.pathname}${frameLocation.search}${frameLocation.hash}`, { replace: true })
        return
      }
      setError('')
    } catch {
      // The configured reader may be cross-origin in some deployments.
      setError('')
    }
  }

  useEffect(() => {
    if (!miniProgramClient || !viewerUrl || !hostRef.current) return
    const controller = new AbortController()
    const host = hostRef.current
    const appRoot = document.getElementById('root')
    const previousRootDisplay = appRoot?.style.display || ''
    if (appRoot) appRoot.style.display = 'contents'
    const bodyDatasetKeys = ['pdfUrl', 'initialPage', 'initialDisplayPage', 'documentId'] as const
    let removePinchListeners = () => {}
    let stopRemovingWebBack = () => {}

    const initialize = async () => {
      try {
        const response = await fetch(viewerUrl, { signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const viewerDocument = new DOMParser().parseFromString(await response.text(), 'text/html')
        const sourceBody = viewerDocument.body
        const pdfUrl = sourceBody.dataset.pdfUrl
        if (!pdfUrl) throw new Error('Missing PDF URL')

        sourceBody.querySelectorAll('script').forEach((script) => script.remove())
        sourceBody.querySelectorAll('.back-link, .identity-divider').forEach((element) => element.remove())
        host.innerHTML = sourceBody.innerHTML
        const removeWebBack = () => {
          host.querySelectorAll([
            '.back-link',
            '.identity-divider',
            '.document-identity a[href="/docs"]',
            '.document-identity a[href$="/docs"]',
            '.document-identity a[href*="/docs?"]',
          ].join(',')).forEach((element) => element.remove())
        }
        removeWebBack()
        const backObserver = new MutationObserver(removeWebBack)
        backObserver.observe(host, { childList: true, subtree: true })
        stopRemovingWebBack = () => backObserver.disconnect()
        bodyDatasetKeys.forEach((key) => {
          const value = sourceBody.dataset[key]
          if (value) document.body.dataset[key] = value
        })

        const stylesheet = document.createElement('link')
        stylesheet.rel = 'stylesheet'
        stylesheet.href = `/references/assets/viewer.css?v=${READER_ASSET_VERSION}`
        stylesheet.dataset.wikiReaderAsset = 'true'
        document.head.appendChild(stylesheet)

        await loadScript('/references/assets/pdf.min.js')
        await loadScript(`/references/assets/viewer.js?v=${READER_ASSET_VERSION}`)
        if (controller.signal.aborted) return

        const surface = document.getElementById('documentSurface')
        if (surface) surface.style.touchAction = 'pan-x pan-y pinch-zoom'
        let previousDistance = 0
        const distance = (touches: TouchList) => Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY,
        )
        const handleTouchStart = (event: TouchEvent) => {
          if (event.touches.length === 2) previousDistance = distance(event.touches)
        }
        const handleTouchMove = (event: TouchEvent) => {
          if (event.touches.length !== 2 || previousDistance <= 0) return
          const nextDistance = distance(event.touches)
          const ratio = nextDistance / previousDistance
          if (ratio >= PINCH_IN_THRESHOLD) {
            document.getElementById('zoomIn')?.click()
            previousDistance = nextDistance
          } else if (ratio <= PINCH_OUT_THRESHOLD) {
            document.getElementById('zoomOut')?.click()
            previousDistance = nextDistance
          }
        }
        const handleTouchEnd = (event: TouchEvent) => {
          if (event.touches.length < 2) previousDistance = 0
        }
        document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true })
        document.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true })
        document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true })
        document.addEventListener('touchcancel', handleTouchEnd, { passive: true, capture: true })
        removePinchListeners = () => {
          document.removeEventListener('touchstart', handleTouchStart, true)
          document.removeEventListener('touchmove', handleTouchMove, true)
          document.removeEventListener('touchend', handleTouchEnd, true)
          document.removeEventListener('touchcancel', handleTouchEnd, true)
        }
        setError('')
      } catch (loadError) {
        if (!controller.signal.aborted) {
          console.error('文档阅读器初始化失败', loadError)
          setError('文档阅读器加载失败，请返回后重试')
        }
      }
    }

    void initialize()
    return () => {
      controller.abort()
      removePinchListeners()
      stopRemovingWebBack()
      document.querySelectorAll('[data-wiki-reader-asset="true"]').forEach((asset) => asset.remove())
      bodyDatasetKeys.forEach((key) => delete document.body.dataset[key])
      if (appRoot) appRoot.style.display = previousRootDisplay
      host.innerHTML = ''
    }
  }, [miniProgramClient, viewerUrl])

  if (!viewerUrl) {
    return (
      <main className="wiki-reader-error">
        <p>文档阅读链接无效</p>
        {miniProgramClient
          ? <span>请使用左上角返回文档中心</span>
          : <button type="button" onClick={() => navigate('/docs')}>返回文档中心</button>}
      </main>
    )
  }

  return (
    <div className={`wiki-reader-page ${miniProgramClient ? 'is-miniprogram' : ''}`}>
      {!miniProgramClient ? (
        <TopBar
          active="wiki"
          userLabel={user?.nickName || '访客'}
          onOpenChat={() => navigate('/')}
          onOpenWiki={() => navigate('/docs')}
          onOpenLicense={() => navigate('/license-application')}
          onOpenUser={() => navigate(user ? '/' : '/login')}
        />
      ) : null}
      <main className="wiki-reader-content">
        {error && <div className="wiki-reader-notice">{error}</div>}
        {miniProgramClient ? (
          <div ref={hostRef} className="wiki-reader-host">
            <p className="wiki-reader-loading">正在加载文档阅读器...</p>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            className="wiki-reader-frame"
            src={viewerUrl}
            title="在线文档阅读"
            onLoad={handleFrameLoad}
          />
        )}
      </main>
      {!miniProgramClient ? <WikiAssistant /> : null}
    </div>
  )
}
