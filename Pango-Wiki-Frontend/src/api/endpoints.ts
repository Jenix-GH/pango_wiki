const CHAT_HOST = import.meta.env.VITE_CHAT_BASE_URL || '/chat'
const CHAT_STREAM_URL = import.meta.env.VITE_CHAT_API_URL || `${CHAT_HOST}/ragflow-compatible`
const DB_HOST = import.meta.env.VITE_DB_BASE_URL || '/dbServ'

export const API_CONFIG = {
  baseHost: DB_HOST,
  sessionUrl: CHAT_STREAM_URL,
  sessionUrlChoose: CHAT_STREAM_URL,
  referenceHost: import.meta.env.VITE_REFERENCE_ORIGIN || '',
  conversationId: 'bdc39a5e6ce011f0904caecf82960528',
  conversationIdChoose: 'e1e6b710fdc511f0ab0372b9cdc2d76f',
  authToken: 'Bearer test',
} as const

export const ENDPOINTS = {
  getPhone: `${DB_HOST}/wx/getPhone`,
  transcribe: `${DB_HOST}/wx/transcribe`,
  questionAdd: `${DB_HOST}/question/doAdd`,
  answerAdd: `${DB_HOST}/answer/doAdd`,
  answerByQuestionId: `${DB_HOST}/answer/getByQuestionId`,
  historyByUserId: `${DB_HOST}/question/findHisByUserId`,
  answerEvaluate: `${DB_HOST}/answer/doEvaluate`,
  upFlagUseData: `${DB_HOST}/set/upFlagUseData`,
  deleteHistory: `${DB_HOST}/question/doDelHis`,
  updateUserInfo: `${DB_HOST}/userinfo/doUpdate`,
  chatCompletions: CHAT_STREAM_URL,
  chatCompletionsChoose: CHAT_STREAM_URL,
} as const
