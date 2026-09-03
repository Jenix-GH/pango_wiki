import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSSE } from '../hooks/useSSE'
import { usePseudoStream } from '../hooks/usePseudoStream'
import { api } from '../api/client'
import { formatTime } from '../utils/formatTime'
import { copyToClipboard } from '../utils/clipboard'
import { normalizeAnswerMedia, openReferenceReaderUrl } from '../utils/referenceUrl'
import { normalizeQuestionImages, normalizeReference } from '../api/types'
import type { ChatMessage, FeedbackPayload, QuestionItem, UploadImage } from '../api/types'
import TopBar from '../components/TopBar'
import LeftDrawer from '../components/LeftDrawer'
import SettingsPanel from '../components/SettingsPanel'
import ChatBubble from '../components/ChatBubble'
import ChatInput from '../components/ChatInput'
import FeedbackModal from '../components/FeedbackModal'
import AgentProgress from '../components/AgentProgress'
import pangoLogo from '../../Logo.png'
import { advanceAgentProgress, INITIAL_AGENT_PROGRESS } from '../utils/agentProgress'
import type { AgentProgressState } from '../utils/agentProgress'
import './ChatPage.css'

const ANSWER_LIMIT = 10

export default function ChatPage() {
  const navigate = useNavigate()
  const {
    user, isLoggedIn, isGuest, loading,
    guestCount, guestUserId,
    incrementAnswerCount,
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
  const [progress, setProgress] = useState<AgentProgressState | null>(null)
  const isTestVersion = true
  const [sessionId, setSessionId] = useState('')
  const [showLeft, setShowLeft] = useState(() => window.matchMedia('(min-width: 769px)').matches)
  const [showSettings, setShowSettings] = useState(false)
  const [dayQuestions, setDayQuestions] = useState<QuestionItem[]>([])
  const [weekQuestions, setWeekQuestions] = useState<QuestionItem[]>([])
  const [showTips, setShowTips] = useState(true)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [uploadImages, setUploadImages] = useState<UploadImage[]>([])
  const [feedbackMessageIndex, setFeedbackMessageIndex] = useState<number | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const ignoreScrollUntil = useRef(0)
  const activeRunRef = useRef(0)
  const streamingRef = useRef(false)

  const isLimitReached = !isLoggedIn && guestCount >= ANSWER_LIMIT
  const recordUserId = user?.id || guestUserId

  useEffect(() => {
    if (loading) return
    const init = async () => {
      if (recordUserId) {
        await loadHistory()
      }
      const id = api.createSession(recordUserId || 'guest', true)
      setSessionId(id)
    }
    init()
  }, [loading, isLoggedIn, recordUserId])

  const loadHistory = async () => {
    if (!recordUserId) return
    const res = await api.getHistory({ userinfoId: recordUserId })
    if (res.code === 2000) {
      setDayQuestions(res.data.todayQuestion || [])
      setWeekQuestions(res.data.weekQuestion || [])
    }
  }

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
    setProgress(null)
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

    let currentSessionId = sessionId
    if (!currentSessionId) {
      currentSessionId = api.createSession(recordUserId || 'guest', true)
      setSessionId(currentSessionId)
    }
    setUploadImages([])
    const textToSearch = question || ''
    scrollToBottom()

    const runId = ++activeRunRef.current
    setStreamingActive(true)
    resetStreamContent()
    setProgress(INITIAL_AGENT_PROGRESS)
    armStreamTimeout(runId)

    start(
      recordUserId!,
      textToSearch,
      currentSessionId,
      isTestVersion,
      imagesToSend,
      (nextProgress) => {
        if (activeRunRef.current !== runId) return
        setProgress((current) => advanceAgentProgress(current, nextProgress))
        armStreamTimeout(runId)
      },
      (text, mode) => {
        if (activeRunRef.current !== runId) return
        setProgress(null)
        pushStreamContent(text, mode)
        armStreamTimeout(runId)
      },
      (finalAnswer, reference, citations, trace, answerMedia) => {
        if (activeRunRef.current !== runId) return
        clearStreamTimeout()
        setProgress(null)
        const answerContent = finalAnswer || getTargetText()
        const normalizedRef = normalizeReference(reference)
        void finishStreamContent(answerContent).then(() => {
          if (activeRunRef.current !== runId) return

          const completedContent = getTargetText() || answerContent
          setStreamingActive(false)
          if (completedContent.trim()) {
            const completedTime = formatTime(new Date())
            commitAiMessage({
              flagAi: 1,
              content: completedContent,
              contentData: completedContent,
              time: completedTime,
              answerTime: completedTime,
              flagEvaluate: 0,
              reference: normalizedRef.chunks.length > 0 ? normalizedRef : undefined,
              answerMedia: answerMedia.length > 0 ? answerMedia : undefined,
              structuredCitations: citations.length > 0 ? citations : undefined,
              questionTrace: trace || undefined,
            })
            void loadHistory()
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
    const nextEvaluate = messages[index]?.flagEvaluate === evaluate ? 0 : evaluate
    if (!recordUserId) {
      setMessages((previous) => previous.map((message, messageIndex) => (
        messageIndex === index ? { ...message, flagEvaluate: nextEvaluate } : message
      )))
      showToast(nextEvaluate === 0 ? '已取消评价' : nextEvaluate === 1 ? '感谢你的认可' : '感谢反馈，我们会继续改进')
      return
    }
    try {
      const response = await api.evaluateAnswer({
        userinfoId: recordUserId,
        flagEvaluate: nextEvaluate,
        answerTime: time,
      })
      if (response.code !== 2000) throw new Error(response.message || '评价失败')
      setMessages((prev) => prev.map((message, messageIndex) => (
        messageIndex === index ? { ...message, flagEvaluate: nextEvaluate } : message
      )))
      if (nextEvaluate === 0) showToast('已取消评价')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '评价失败，请稍后重试')
    }
  }

  const handleSubmitFeedback = async (form: Pick<FeedbackPayload, 'feedbackType' | 'detail' | 'feedbackImages' | 'contactName' | 'companyName' | 'email' | 'phone'>) => {
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
        userinfoId: recordUserId,
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

  const handleSelectHistory = async (historySessionId: string) => {
    if (!recordUserId) return
    const res = await api.getHistoryBySessionId({
      userinfoId: recordUserId,
      sessionId: historySessionId,
    })
    if (res.code === 2000) {
      setShowTips(false)
      setSessionId(historySessionId)
      const historyMessages = res.data.flatMap<ChatMessage>((item) => {
        const questionMessage: ChatMessage = {
          flagAi: 0,
          content: item.question,
          time: item.dotime || '',
          images: normalizeQuestionImages(item.questionImages || item.question_images),
        }
        if (!item.answer) return [questionMessage]
        const answerMessage: ChatMessage = {
          flagAi: 1,
          content: item.answer.content,
          contentData: item.answer.content,
          time: item.answer.dotime,
          answerTime: item.answer.answerTime || item.answer.dotime,
          flagEvaluate: item.answer.flagEvaluate,
          reference: normalizeReference(item.answer.reference),
          answerMedia: normalizeAnswerMedia(item.answer.answerMedia || item.answer.answer_media),
        }
        return [questionMessage, answerMessage]
      })
      setMessages(historyMessages)
    }
  }

  const handleNewSession = async (notify = true) => {
    clearStreamTimeout()
    activeRunRef.current += 1
    abort()
    setStreamingActive(false)
    clearLiveStreamUi()
    setMessages([])
    setShowTips(true)
    const id = api.createSession(recordUserId || 'guest', true)
    setSessionId(id)
    if (notify) showToast('已切换新对话')
  }

  const handleDeleteHistoryItem = async (historySessionId: string) => {
    if (!recordUserId || !historySessionId) return
    if (!window.confirm('确定删除这条历史对话吗？')) return

    try {
      const res = await api.hideHistory({ userinfoId: recordUserId, sessionId: historySessionId })
      if (res.code !== 2000) throw new Error(res.message || '删除失败')
    } catch {
      showToast('删除历史记录失败，请稍后重试')
      return
    }
    await loadHistory()
    if (sessionId === historySessionId) void handleNewSession(false)
    showToast('历史对话已删除')
  }

  const handleRefresh = () => {
    if (user) loadHistory()
  }

  const handleOpenReference = useCallback((relUrl: string) => {
    void api.trackEvent({ eventName: 'reference_open', pagePath: '/', clientType: 'WEB', sessionId }).catch(() => {})
    if (!openReferenceReaderUrl(relUrl)) {
      showToast('参考文档链接无效')
    }
  }, [sessionId, showToast])

  const addImageFiles = async (files: File[]) => {
    if (uploadImages.length >= 1) {
      window.alert('每次提问只能上传 1 张图片，请删除已有图片后再添加。')
      return
    }
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      showToast('请选择图片文件')
      return
    }
    if (imageFiles.length > 1) {
      window.alert('每次提问只能上传 1 张图片，本次将只添加第一张符合大小要求的图片。')
    }
    const acceptableImages = imageFiles.filter((file) => file.size <= MAX_IMAGE_FILE_BYTES)
    if (acceptableImages.length !== imageFiles.length) {
      window.alert('单张图片不能超过 15MB，请压缩图片后重试。')
    }
    if (acceptableImages.length === 0) return
    try {
      const newImage = await prepareImage(acceptableImages[0])
      setUploadImages([newImage])
    } catch (error) {
      console.error('图片处理失败', error)
      showToast('图片读取失败，请更换图片后重试')
    }
  }

  const handleImageUpload = () => {
    if (uploadImages.length >= 1) {
      window.alert('每次提问只能上传 1 张图片，请删除已有图片后再添加。')
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => void addImageFiles(Array.from(input.files || []))
    input.click()
  }

  const tips = [
    { content: '紫光同创FPGA芯片有哪些?' },
    { content: '在 PDS 中如何查看时序分析报告？' },
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
          onOpenWiki={() => navigate('/docs')}
          onOpenLicense={() => navigate('/license-application')}
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
          onDeleteHistory={handleDeleteHistoryItem}
          onOpenSettings={() => { if (isLoggedIn) setShowSettings(true) }}
          onRefresh={handleRefresh}
          onOpenGuide={() => navigate('/user-guide')}
        />

        <div className="chat-workspace">
        <SettingsPanel
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />

        <div className={`chat-main ${conversationStarted ? 'has-conversation' : 'is-empty'}`}>
          {!conversationStarted ? (
            <div className="chat-welcome">
              {isGuest && (
                <div className="guest-banner">
                  <span><strong>访客模式</strong> · 最多可询问 {ANSWER_LIMIT} 次，剩余 {Math.max(0, ANSWER_LIMIT - guestCount)} 次</span>
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
                <span><strong>访客模式</strong> · 最多可询问 {ANSWER_LIMIT} 次，剩余 {Math.max(0, ANSWER_LIMIT - guestCount)} 次</span>
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

            {isStreaming && !streamContent && progress && (
              <div className="bubble bubble-ai">
                <div className="bubble-ai-header">
                  <img className="bubble-ai-avatar" src={pangoLogo} alt="Pango" />
                  <span className="bubble-ai-name">智能助手</span>
                </div>
                <div className="bubble-ai-content">
                  <AgentProgress progress={progress} />
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
            <h3>访客体验次数已用完</h3>
            <p>访客可以免费提问 10 次，注册或登录后可继续使用，并同步小程序历史记录。</p>
            <div className="login-prompt-actions">
              <button className="prompt-btn secondary" onClick={() => setShowLoginPrompt(false)}>稍后再说</button>
              <button className="prompt-btn primary" onClick={() => navigate('/login')}>注册或登录</button>
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
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024

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
