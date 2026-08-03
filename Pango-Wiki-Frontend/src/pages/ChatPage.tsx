import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSSE } from '../hooks/useSSE'
import { usePseudoStream } from '../hooks/usePseudoStream'
import { api } from '../api/client'
import { formatTime } from '../utils/formatTime'
import { copyToClipboard } from '../utils/clipboard'
import { openReferenceUrl } from '../utils/referenceUrl'
import { normalizeReference } from '../api/types'
import type { ChatMessage, FeedbackPayload, QuestionItem, UploadImage } from '../api/types'
import TopBar from '../components/TopBar'
import LeftDrawer from '../components/LeftDrawer'
import SettingsPanel from '../components/SettingsPanel'
import ChatBubble from '../components/ChatBubble'
import ChatInput from '../components/ChatInput'
import FeedbackModal from '../components/FeedbackModal'
import pangoLogo from '../../Logo.png'
import './ChatPage.css'

const ANSWER_LIMIT = 50

export default function ChatPage() {
  const navigate = useNavigate()
  const {
    user, isLoggedIn, isGuest, loading,
    flagCompanyInfo, answerCount,
    incrementAnswerCount, login,
  } = useAuth()
  const { start, abort } = useSSE()
  const {
    visibleText: streamContent,
    push: pushStreamContent,
    finish: finishStreamContent,
    reset: resetStreamContent,
    getTargetText,
    getVisibleText,
  } = usePseudoStream()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [progressEmoji, setProgressEmoji] = useState('')
  const isTestVersion = true
  const [sessionId, setSessionId] = useState('')
  const [showLeft, setShowLeft] = useState(() => window.matchMedia('(min-width: 769px)').matches)
  const [showSettings, setShowSettings] = useState(false)
  const [dayQuestions, setDayQuestions] = useState<QuestionItem[]>([])
  const [weekQuestions, setWeekQuestions] = useState<QuestionItem[]>([])
  const [showTips, setShowTips] = useState(true)
  const [dotsPhase, setDotsPhase] = useState(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [uploadImages, setUploadImages] = useState<UploadImage[]>([])
  const [feedbackMessageIndex, setFeedbackMessageIndex] = useState<number | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const dotsTimer = useRef<ReturnType<typeof setInterval>>()
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const ignoreScrollUntil = useRef(0)
  const activeRunRef = useRef(0)
  const streamingRef = useRef(false)

  // Guest usage is temporarily unlimited.
  const isLimitReached = isLoggedIn && !flagCompanyInfo && answerCount >= ANSWER_LIMIT

  useEffect(() => {
    if (loading) return
    const init = async () => {
      if (user) {
        await loadHistory()
      }
      const id = api.createSession(user?.id || 'guest')
      setSessionId(id)
    }
    init()
  }, [loading, isLoggedIn])

  const loadHistory = async () => {
    if (!user) return
    const res = await api.getHistory({ userinfoId: user.id })
    if (res.code === 2000) {
      setDayQuestions(res.data.todayQuestion || [])
      setWeekQuestions(res.data.weekQuestion || [])
    }
  }

  useEffect(() => {
    if (isStreaming) {
      dotsTimer.current = setInterval(() => setDotsPhase((p) => (p + 1) % 4), 100)
    } else {
      clearInterval(dotsTimer.current)
    }
    return () => clearInterval(dotsTimer.current)
  }, [isStreaming])

  const clearStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = undefined
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  const smartScroll = useCallback(() => {
    if (userScrolledUp) return
    scrollToBottom()
  }, [userScrolledUp, scrollToBottom])

  const showToast = useCallback((msg: string, duration = 1500) => {
    const el = document.createElement('div')
    el.className = 'toast-temp'
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(() => el.remove(), duration)
  }, [])

  const setStreamingActive = useCallback((active: boolean) => {
    streamingRef.current = active
    setIsStreaming(active)
  }, [])

  const clearLiveStreamUi = useCallback(() => {
    resetStreamContent()
    setProgressText('')
    setProgressEmoji('')
  }, [resetStreamContent])

  const commitAiMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => [...previous, message])
    incrementAnswerCount()
  }, [incrementAnswerCount])

  const commitPartialAnswer = useCallback((content: string) => {
    if (!content.trim()) return
    commitAiMessage({
      flagAi: 1,
      content,
      contentData: content,
      time: formatTime(new Date()),
      flagEvaluate: 0,
    })
  }, [commitAiMessage])

  const armStreamTimeout = useCallback((runId: number) => {
    clearStreamTimeout()
    streamTimeoutRef.current = setTimeout(() => {
      if (activeRunRef.current !== runId || !streamingRef.current) return

      activeRunRef.current += 1
      abort()
      setStreamingActive(false)
      commitPartialAnswer(getTargetText() || getVisibleText())
      clearLiveStreamUi()
      showToast('网络已断开，请重新发送')
    }, 90000)
  }, [abort, clearLiveStreamUi, clearStreamTimeout, commitPartialAnswer, getTargetText, getVisibleText, setStreamingActive, showToast])

  useEffect(() => () => {
    activeRunRef.current += 1
    streamingRef.current = false
    clearStreamTimeout()
  }, [clearStreamTimeout])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    if (Date.now() < ignoreScrollUntil.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const distFromBottom = scrollHeight - clientHeight - scrollTop
    const atBottom = distFromBottom < 50
    if (userScrolledUp === atBottom) {
      setUserScrolledUp(!atBottom)
    }
  }, [userScrolledUp])

  useEffect(() => {
    if (streamContent) smartScroll()
  }, [smartScroll, streamContent])

  const handleSend = async (question: string) => {
    if (isStreaming) return

    if (isLimitReached) {
      setShowLoginPrompt(true)
      return
    }

    if (!question && uploadImages.length === 0) return

    setShowTips(false)
    setUserScrolledUp(false)
    ignoreScrollUntil.current = Date.now() + 500

    const imagesToSend = uploadImages.length > 0 ? [...uploadImages] : null

    const userMsg: ChatMessage = {
      flagAi: 0,
      content: question,
      images: uploadImages.length > 0 ? [...uploadImages] : undefined,
      time: formatTime(new Date()),
    }
    setMessages((prev) => [...prev, userMsg])
    setUploadImages([])
    const textToSearch = question || ''
    scrollToBottom()

    let currentSessionId = sessionId
    if (!currentSessionId) {
      currentSessionId = api.createSession(user?.id || 'guest')
      setSessionId(currentSessionId)
    }

    const runId = ++activeRunRef.current
    setStreamingActive(true)
    resetStreamContent()
    setProgressText('')
    setProgressEmoji('')
    armStreamTimeout(runId)

    start(
      textToSearch,
      currentSessionId,
      isTestVersion,
      imagesToSend,
      (statusText, emoji) => {
        if (activeRunRef.current !== runId) return
        setProgressText(statusText)
        setProgressEmoji(emoji)
        armStreamTimeout(runId)
      },
      (text, mode) => {
        if (activeRunRef.current !== runId) return
        pushStreamContent(text, mode)
        armStreamTimeout(runId)
      },
      (finalAnswer, reference, citations, trace) => {
        if (activeRunRef.current !== runId) return
        clearStreamTimeout()
        setProgressText('')
        setProgressEmoji('')
        const answerContent = finalAnswer || getTargetText()
        const normalizedRef = normalizeReference(reference)
        void finishStreamContent(answerContent).then(() => {
          if (activeRunRef.current !== runId) return

          const completedContent = getTargetText() || answerContent
          setStreamingActive(false)
          if (completedContent.trim()) {
            commitAiMessage({
              flagAi: 1,
              content: completedContent,
              contentData: completedContent,
              time: formatTime(new Date()),
              flagEvaluate: 0,
              reference: normalizedRef.chunks.length > 0 ? normalizedRef : undefined,
              structuredCitations: citations.length > 0 ? citations : undefined,
              questionTrace: trace || undefined,
            })
          }
          clearLiveStreamUi()

        })
      },
      (err) => {
        if (activeRunRef.current !== runId) return
        clearStreamTimeout()
        activeRunRef.current += 1
        setStreamingActive(false)
        commitPartialAnswer(getTargetText() || getVisibleText())
        clearLiveStreamUi()
        showToast('请求失败: ' + err.message)
      },
    )
  }

  const handleStop = () => {
    clearStreamTimeout()
    activeRunRef.current += 1
    abort()
    setStreamingActive(false)
    commitPartialAnswer(getVisibleText())
    clearLiveStreamUi()
  }

  const handleCopy = async (content: string) => {
    const ok = await copyToClipboard(content)
    showToast(ok ? '复制成功' : '复制失败')
  }

  const handleEvaluate = async (index: number, evaluate: number, time: string) => {
    if (!user || evaluate === 0) return
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, flagEvaluate: evaluate } : m))
    )
    api.evaluateAnswer({
      userinfoId: user.id,
      flagEvaluate: evaluate,
      answerTime: time,
    }).catch(() => {})
  }

  const handleSubmitFeedback = async (form: Pick<FeedbackPayload, 'feedbackType' | 'detail' | 'contactName' | 'companyName' | 'email' | 'phone'>) => {
    if (feedbackMessageIndex === null) return
    const answer = messages[feedbackMessageIndex]
    const question = [...messages.slice(0, feedbackMessageIndex)].reverse().find((message) => message.flagAi === 0)
    if (!answer || !question) {
      showToast('无法关联本次问答，请稍后重试')
      return
    }

    setFeedbackSubmitting(true)
    try {
      const response = await api.submitFeedback({
        ...form,
        userinfoId: user?.id,
        sessionId,
        platform: 'web',
        questionContent: question.content,
        answerContent: answer.contentData || answer.content,
      })
      if (response.code !== 2000) throw new Error(response.message || '提交失败')
      setFeedbackMessageIndex(null)
      showToast('感谢反馈，我们会认真核查')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '反馈提交失败，请稍后重试')
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  const handleSelectHistory = async (questionId: number, content: string) => {
    if (!user) return
    const res = await api.getAnswerByQuestionId({
      userinfoId: user.id,
      questionId,
    })
    if (res.code === 2000) {
      setShowLeft(false)
      setShowTips(false)
      const qMsg: ChatMessage = { flagAi: 0, content, time: '' }
      const aMsg: ChatMessage = {
        flagAi: 1,
        content: res.data.content,
        contentData: res.data.content,
        time: res.data.dotime,
        flagEvaluate: res.data.flagEvaluate,
      }
      setMessages([qMsg, aMsg])
    }
  }

  const handleNewSession = async () => {
    clearStreamTimeout()
    activeRunRef.current += 1
    abort()
    setStreamingActive(false)
    clearLiveStreamUi()
    setMessages([])
    setShowTips(true)
    const id = api.createSession(user?.id || 'guest', true)
    setSessionId(id)
    showToast('已切换新对话')
  }

  const handleRefresh = () => {
    if (user) loadHistory()
  }

  const handleOpenReference = useCallback((relUrl: string) => {
    if (!openReferenceUrl(relUrl)) {
      showToast('参考文档链接无效')
    }
  }, [showToast])

  const handleLoginFromPrompt = async () => {
    if (!loginUsername.trim()) {
      showToast('请输入用户名')
      return
    }
    await login(loginUsername, loginPassword)
    setShowLoginPrompt(false)
    setLoginUsername('')
    setLoginPassword('')
    showToast('登录成功')
  }

  const addImageFiles = async (files: File[]) => {
    if (uploadImages.length >= 3) {
      showToast('最多上传3张图片')
      return
    }
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      showToast('请选择图片文件')
      return
    }
    const available = 3 - uploadImages.length
    if (imageFiles.length > available) {
      showToast(`最多上传3张图片，已添加前${available}张`)
    }
    try {
      const newImages = await Promise.all(imageFiles.slice(0, available).map(prepareImage))
      setUploadImages((prev) => [...prev, ...newImages].slice(0, 3))
    } catch (error) {
      console.error('图片处理失败', error)
      showToast('图片读取失败，请更换图片后重试')
    }
  }

  const handleImageUpload = () => {
    if (uploadImages.length >= 3) {
      showToast('最多上传3张图片')
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => void addImageFiles(Array.from(input.files || []))
    input.click()
  }

  const renderDots = () => {
    const dots = [
      { opacity: 0.3, scale: 0.5 },
      { opacity: 0.5, scale: 0.7 },
      { opacity: 0.7, scale: 0.9 },
      { opacity: 1, scale: 1 },
    ]
    const shifted = [...dots.slice(dotsPhase), ...dots.slice(0, dotsPhase)]
    return (
      <div className="loading-dots">
        {shifted.map((d, i) => (
          <span
            key={i}
            className="loading-dot"
            style={{ opacity: d.opacity, transform: `scale(${d.scale})` }}
          />
        ))}
      </div>
    )
  }

  const tips = [
    { content: '紫光同创FPGA芯片有哪些?' },
    { content: '介绍一下PG2T390器件' },
  ]
  const conversationStarted = messages.length > 0 || isStreaming
  const chatInput = (
    <ChatInput
      onSend={handleSend}
      onStop={handleStop}
      isStreaming={isStreaming}
      uploadImages={uploadImages}
      onImageUpload={handleImageUpload}
      onPasteImages={(files) => void addImageFiles(files)}
      onRemoveImage={(i) => setUploadImages((prev) => prev.filter((_, idx) => idx !== i))}
    />
  )

  if (loading) {
    return (
      <div className="chat-page">
        <div className="chat-loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="chat-page">
      <div className={`chat-shell ${showLeft ? 'sidebar-open' : 'sidebar-collapsed'}`}>
        <TopBar
          active="chat"
          userLabel={user?.nickName || '访客'}
          onOpenChat={() => {}}
          onOpenWiki={() => navigate('/wiki')}
          onOpenUser={() => user ? setShowSettings(true) : navigate('/login')}
          onOpenMenu={() => setShowLeft(true)}
        />

        <div className="chat-body">
        <LeftDrawer
          open={showLeft}
          onClose={() => setShowLeft((open) => !open)}
          onNewSession={handleNewSession}
          onOpenLogin={() => navigate('/login')}
          dayQuestions={dayQuestions}
          weekQuestions={weekQuestions}
          onSelectHistory={handleSelectHistory}
          onOpenSettings={() => { if (isLoggedIn) setShowSettings(true) }}
          onRefresh={handleRefresh}
        />

        <div className="chat-workspace">
        <SettingsPanel
          open={showSettings}
          onClose={() => setShowSettings(false)}
          onDeleteHistory={() => { setDayQuestions([]); setWeekQuestions([]); setShowTips(true); setMessages([]) }}
        />

        <div className={`chat-main ${conversationStarted ? 'has-conversation' : 'is-empty'}`}>
          {!conversationStarted ? (
            <div className="chat-welcome">
              {isGuest && (
                <div className="guest-banner">
                  访客模式
                  <button onClick={() => navigate('/login')}>登录</button>
                </div>
              )}
              <img className="welcome-mark" src={pangoLogo} alt="Pango" />
              <h1>你好，我是 Pango 慧答</h1>
              <p className="welcome-subtitle">有什么可以帮你的吗？</p>
              <div className="tips-panel">
                {tips.map((t, i) => (
                  <button key={i} className="tips-item" onClick={() => handleSend(t.content)}>
                    {t.content}
                  </button>
                ))}
              </div>
              <div className="welcome-composer">{chatInput}</div>
              <div className="chat-disclaimer">内容由 AI 生成，仅供参考</div>
            </div>
          ) : (
            <>
          <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
            {isGuest && (
              <div className="guest-banner">
                访客模式
                <button onClick={() => navigate('/login')}>登录</button>
              </div>
            )}

            {messages.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                index={i}
                onCopy={handleCopy}
                onEvaluate={handleEvaluate}
                onCopyQuestion={handleCopy}
                onOpenReference={handleOpenReference}
                onFeedback={setFeedbackMessageIndex}
              />
            ))}

            {isStreaming && !streamContent && (
              <div className="bubble bubble-ai">
                <div className="bubble-ai-header">
                  <img className="bubble-ai-avatar" src={pangoLogo} alt="Pango" />
                  <span className="bubble-ai-name">智能助手</span>
                </div>
                <div className="bubble-ai-content">
                  {progressText ? (
                    <div className="stream-progress">
                      <span className="progress-emoji">{progressEmoji}</span>
                      <span>{progressText}</span>
                    </div>
                  ) : null}
                  {renderDots()}
                </div>
              </div>
            )}

            {isStreaming && streamContent && (
              <div className="bubble bubble-ai">
                <div className="bubble-ai-header">
                  <img className="bubble-ai-avatar" src={pangoLogo} alt="Pango" />
                  <span className="bubble-ai-name">智能助手</span>
                </div>
                <div className="bubble-ai-content">
                  {progressText && (
                    <div className="stream-progress">
                      <span className="progress-emoji">{progressEmoji}</span>
                      <span>{progressText}</span>
                    </div>
                  )}
                  <div className="markdown-body">
                    <p className="pseudo-stream-text">
                      {streamContent}
                      <span className="pseudo-stream-cursor" aria-hidden="true" />
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bottom-composer">{chatInput}</div>

          <div className="chat-disclaimer">
            内容由AI生成，仅供参考
          </div>
            </>
          )}
        </div>
        </div>
        </div>
      </div>

      {showLoginPrompt && (
        <div className="login-overlay">
          <div className="login-prompt-card">
            <h3>登录以继续使用</h3>
            <p>体验次数已用完，登录后可获取更多对话次数</p>
            <input
              className="drawer-input"
              placeholder="用户名"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              autoFocus
            />
            <input
              className="drawer-input"
              type="password"
              placeholder="密码（可留空）"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoginFromPrompt()}
            />
            <div className="login-prompt-actions">
              <button className="prompt-btn secondary" onClick={() => setShowLoginPrompt(false)}>稍后再说</button>
              <button className="prompt-btn primary" onClick={handleLoginFromPrompt}>登录</button>
            </div>
          </div>
        </div>
      )}
      <FeedbackModal
        open={feedbackMessageIndex !== null}
        submitting={feedbackSubmitting}
        onClose={() => !feedbackSubmitting && setFeedbackMessageIndex(null)}
        onSubmit={handleSubmitFeedback}
      />
    </div>
  )
}

const MAX_IMAGE_EDGE = 1920
const JPEG_QUALITY = 0.85

async function prepareImage(file: File): Promise<UploadImage> {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const compressedDataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? JPEG_QUALITY : undefined)
  const baseName = (file.name || `pasted-image-${Date.now()}`).replace(/\.[^.]+$/, '')
  return {
    mime_type: mimeType,
    data_base64: compressedDataUrl.split(',')[1],
    filename: `${baseName}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
    original_data_url: dataUrl,
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unsupported image format'))
    image.src = src
  })
}
