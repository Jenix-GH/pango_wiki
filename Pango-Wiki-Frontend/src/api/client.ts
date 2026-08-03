import { API_CONFIG, ENDPOINTS } from './endpoints'
import type { ApiResponse, FeedbackPayload, HistoryData, QuestionItem, ReferencePayload, UploadImage } from './types'
import { emptyReference } from './types'
import { normalizeReference } from './types'

function getHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: API_CONFIG.authToken,
    ...extra,
  }
}

async function post<T>(url: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

function generateSessionId(userId: string | number = 'guest'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `web_${userId}_${Date.now()}_${rand}`
}

function splitStreamFrames(raw: string): { frames: string[]; rest: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const rest = lines.pop() || ''
  const frames: string[] = []

  lines.forEach((line) => {
    let text = line.trim()
    if (!text) return
    if (text.startsWith('event:')) return
    if (text.startsWith('data:')) {
      text = text.substring(5).trim()
    }
    if (text) frames.push(text)
  })

  return { frames, rest }
}

export const api = {
  getPhone: (data: { code: string; nickName: string }) =>
    post<{ nickName: string; avatarUrl: string; wxCode: string; count: number; flagCompanyInfo: boolean; todayQuestionList: unknown[]; weekQuestionList: unknown[] }>(ENDPOINTS.getPhone, data),

  transcribe: async (audioBlob: Blob): Promise<{ text: string } | null> => {
    const formData = new FormData()
    const extension = audioBlob.type.includes('wav') ? 'wav' : audioBlob.type.includes('mp4') ? 'm4a' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
    formData.append('audio', audioBlob, `recording.${extension}`)
    const res = await fetch(ENDPOINTS.transcribe, {
      method: 'POST',
      headers: { Authorization: API_CONFIG.authToken },
      body: formData,
    })
    const json: ApiResponse<{ text: string }> = await res.json()
    if (json.code === 2000 && json.data?.text) return { text: json.data.text }
    const errorData = json.data as unknown
    throw new Error(typeof errorData === 'string' && errorData ? errorData : json.message || '语音识别失败')
  },

  addQuestion: (data: { userinfoId: number; question: string; questionType: string; internetEnable: number }) =>
    post<{ todayQuestion: QuestionItem[] }>(ENDPOINTS.questionAdd, data),

  addAnswer: (data: { userinfoId: number; think: string; content: string; answerTime: string }) =>
    post(ENDPOINTS.answerAdd, data),

  getAnswerByQuestionId: (data: { userinfoId: number; questionId: number }) =>
    post<{ content: string; dotime: string; flagEvaluate: number }>(ENDPOINTS.answerByQuestionId, data),

  getHistory: (data: { userinfoId: number }) =>
    post<HistoryData>(ENDPOINTS.historyByUserId, data),

  evaluateAnswer: (data: { userinfoId: number; flagEvaluate: number; answerTime: string }) =>
    post(ENDPOINTS.answerEvaluate, data),

  updateDataFlag: (data: { id: number; flagUseData: 0 | 1 }) =>
    post(ENDPOINTS.upFlagUseData, data),

  deleteHistory: (data: { userinfoId: number }) =>
    post(ENDPOINTS.deleteHistory, data),

  updateUserInfo: (data: Record<string, unknown>) =>
    post<{ companyName?: string } & Record<string, unknown>>(ENDPOINTS.updateUserInfo, data),

  submitFeedback: (data: FeedbackPayload) =>
    post<{ id: number; status: number }>(ENDPOINTS.feedbackSubmit, data),

  createSession: (userId: string | number = 'guest', forceNew = false): string => {
    const key = 'pango_session_id'
    if (!forceNew) {
      const existing = localStorage.getItem(key)
      if (existing) return existing
    }
    const id = generateSessionId(userId)
    localStorage.setItem(key, id)
    return id
  },

  startStream: (
    question: string,
    sessionId: string,
    isTestVersion: boolean,
    images: UploadImage[] | null,
    callbacks: {
      onProgress: (statusText: string, emoji: string) => void
      onChunk: (text: string, mode: 'append' | 'replace') => void
      onDone: (finalAnswer: string, reference: ReferencePayload, citations: unknown[], trace: unknown) => void
      onError: (err: Error) => void
    },
  ): AbortController => {
    const controller = new AbortController()
    const url = isTestVersion ? ENDPOINTS.chatCompletionsChoose : ENDPOINTS.chatCompletions

    const bodyObj: Record<string, unknown> = {
      question,
      quote: true,
      session_id: sessionId,
      limit: 5,
    }
    if (images) {
      bodyObj.images = images.map(({ mime_type, data_base64, filename }) => ({
        mime_type,
        data_base64,
        filename,
      }))
    }

    const body = JSON.stringify(bodyObj)

    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        callbacks.onError(new Error(`HTTP ${response.status}`))
        return
      }
      const reader = response.body?.getReader()
      if (!reader) {
        callbacks.onError(new Error('No response body'))
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      const readLoop = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk
          const result = splitStreamFrames(buffer)
          buffer = result.rest

          for (const frame of result.frames) {
            let raw = frame
            if (!raw) continue

            if (raw === '[DONE]') {
              callbacks.onDone('', emptyReference(), [], null)
              return
            }

            let payload: unknown = null
            try {
              payload = JSON.parse(raw)
            } catch {
              callbacks.onChunk(raw, 'replace')
              continue
            }

            const p = payload as Record<string, unknown> & { data?: unknown; answer?: string; answer_replace?: boolean; event?: string; reference?: unknown; structured_citations?: unknown[]; question_trace?: unknown }
            const d = (p.data as Record<string, unknown> | null) ?? {}

            if (d.status) {
              callbacks.onProgress(String(d.status), getEmoji(String(d.status)))
              continue
            }

            // The terminal frame can carry both `data.answer` and
            // `answer_replace`. Handle it first so the authoritative answer
            // replaces the buffered text and the stream always completes.
            if (p.data === true || p.answer_replace) {
              const finalAnswer = String(p.answer || d.answer || '')
              const rawRef = p.reference || d.reference || null
              const ref = normalizeReference(rawRef)
              const citations = (p.structured_citations as unknown[]) || []
              const trace = p.question_trace || null
              callbacks.onDone(finalAnswer, ref, citations, trace)
              return
            }

            if (d.answer) {
              callbacks.onProgress('正在生成回答...', '✍️')
              callbacks.onChunk(String(d.answer), 'append')
              continue
            }

            if (p.event === 'message') {
              const text = String(d.content || '')
              callbacks.onProgress('正在生成回答...', '✍️')
              callbacks.onChunk(text, 'append')
              continue
            }
          }
        }
        callbacks.onDone('', emptyReference(), [], null)
      }

      readLoop().catch((err) => {
        if (err.name !== 'AbortError') {
          callbacks.onError(err)
        }
      })
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err)
      }
    })

    return controller
  },
}

function getEmoji(statusText: string): string {
  const emojiMap: Record<string, string> = {
    DANGER: '🔍',
    RETRIEVAL: '📚',
    EVIDENCE: '📋',
    ANSWER: '✍️',
    VERIFY: '✅',
    WAIT: '⏳',
  }
  for (const [key, val] of Object.entries(emojiMap)) {
    if (statusText.includes(key) || (key === 'WAIT' && statusText.includes('等待'))) return val
  }
  if (statusText.includes('理解')) return '💭'
  if (statusText.includes('检索') || statusText.includes('查')) return '📚'
  if (statusText.includes('整理') || statusText.includes('依据')) return '📋'
  if (statusText.includes('生成') || statusText.includes('回答')) return '✍️'
  if (statusText.includes('核') || statusText.includes('来源')) return '🔍'
  return '⏳'
}
