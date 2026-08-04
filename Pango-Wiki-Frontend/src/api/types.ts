export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export interface UserInfo {
  id: number
  setId?: number
  nickName: string
  avatarUrl: string
  wxCode: string
  count: number
  flagCompanyInfo: boolean
  todayQuestionList: QuestionItem[]
  weekQuestionList: QuestionItem[]
  companyName?: string
  jobName?: string
  mailAddress?: string
  flagUseData?: number
  phoneNumber?: string
  userType?: 'USER' | 'GUEST'
  quotaUsed?: number
  quotaLimit?: number
  quotaRemaining?: number
  accessToken?: string
}

export interface AuthData {
  token: string
  user: UserInfo
}

export interface QuestionItem {
  id: number
  question: string
  sessionId: string
  dotime?: string
}

export interface SessionQuestion extends QuestionItem {
  answer?: AnswerData
}

export interface HistoryData {
  todayQuestion: QuestionItem[]
  weekQuestion: QuestionItem[]
  count: number
  flagCompanyInfo: boolean
}

export interface AnswerData {
  id: number
  think?: string
  content: string
  dotime: string
  flagEvaluate: number
  questionId?: number
  answerTime?: string
  reference?: unknown
}

export interface SessionData {
  answer: string
  text: string
  reference: Record<string, unknown>
  param: unknown[]
  id: string
  session_id: string
}

export interface ReferencePageLink {
  page: number
  document_page_url: string
}

export interface ReferenceChunk {
  reference_index?: number
  citation_label?: string
  display_name?: string
  document_preview_url?: string
  document_page_url?: string
  document_name?: string
  title?: string
  page?: number | string
  pages?: number[]
  page_links?: ReferencePageLink[]
  reference_key?: string
  chunk_id?: string
  document_id?: string
  [key: string]: unknown
}

export interface ReferencePayload {
  chunks: ReferenceChunk[]
  total: number
  [key: string]: unknown
}

export interface UploadImage {
  mime_type: string
  data_base64: string
  filename: string
  /** Client-only original image used by the preview lightbox. */
  original_data_url?: string
}

export interface ChatMessage {
  flagAi: 0 | 1
  content: string
  contentData?: string
  time: string
  answerTime?: string
  think?: string
  flagEvaluate?: number
  images?: UploadImage[]
  reference?: ReferencePayload
  structuredCitations?: unknown[]
  questionTrace?: unknown
}

export interface FeedbackPayload {
  userinfoId?: number
  sessionId: string
  platform: 'web' | 'miniprogram'
  feedbackType: string
  detail?: string
  questionContent: string
  answerContent: string
  contactName?: string
  companyName?: string
  email?: string
  phone?: string
}

export interface StreamProgressState {
  currentStatusText: string
  currentStatusEmoji: string
  currentReference: ReferencePayload
  currentStructuredCitations: unknown[]
  currentQuestionTrace: unknown
}

export function emptyReference(): ReferencePayload {
  return { chunks: [], total: 0 }
}

export function createStreamState(): StreamProgressState {
  return {
    currentStatusText: '',
    currentStatusEmoji: '',
    currentReference: emptyReference(),
    currentStructuredCitations: [],
    currentQuestionTrace: null,
  }
}

export function normalizeReference(reference: unknown): ReferencePayload {
  let parsed = reference
  if (typeof parsed === 'string') {
    try {
      parsed = parsed.trim() ? JSON.parse(parsed) : null
    } catch {
      parsed = null
    }
  }
  const ref = parsed as Record<string, unknown> | null
  const rawChunks: ReferenceChunk[] = Array.isArray(ref?.chunks)
    ? (ref!.chunks as ReferenceChunk[])
    : []

  const chunks = rawChunks
    .filter((chunk) => (chunk.page_links && chunk.page_links.length > 0) || chunk.document_page_url || chunk.document_preview_url)
    .map((chunk, index) => {
      const sortedPageLinks = chunk.page_links
        ? [...chunk.page_links].sort((a, b) => (a.page || 0) - (b.page || 0))
        : []

      return {
        ...chunk,
        reference_index: chunk.reference_index ?? index,
        page_links: sortedPageLinks,
        reference_key: chunk.reference_key || `ref_${chunk.reference_index ?? index}`,
        pages: sortedPageLinks.map((l) => l.page),
      }
    })
    .sort((a, b) => (a.reference_index || 0) - (b.reference_index || 0))

  return { ...(ref || {}), chunks, total: chunks.length } as ReferencePayload
}

export interface SSECallbacks {
  onProgress: (statusText: string, emoji: string) => void
  onChunk: (text: string, mode: 'append' | 'replace') => void
  onDone: (finalAnswer: string, reference: ReferencePayload, citations: unknown[], trace: unknown) => void
  onError: (err: Error) => void
}

export interface LicenseApplicationPayload {
  userinfoId?: number
  operatingSystem: 'Windows' | 'Linux'
  softwareVersion: string
  licenseType: 'STANDALONE' | 'SERVER'
  durationYears: 1 | 2 | 3
  macAddress: string
  applicantName: string
  companyName: string
  email: string
  phone: string
  address: string
}
