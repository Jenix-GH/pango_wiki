import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { UserInfo } from '../api/types'
import { api } from '../api/client'

const GUEST_STORAGE_KEY = 'pango_guest'
const USER_STORAGE_KEY = 'pango_user'
const TOKEN_STORAGE_KEY = 'pango_auth_token'

interface GuestData {
  id: string
  count: number
  backendUserId?: number
}

interface AuthState {
  user: UserInfo | null
  isLoggedIn: boolean
  isGuest: boolean
  loading: boolean
  flagCompanyInfo: boolean
  answerCount: number
  guestCount: number
  guestUserId?: number
  login: (phone: string, password: string) => Promise<void>
  register: (phone: string, code: string, password: string, profile?: { nickName?: string; companyName?: string; jobName?: string; mailAddress?: string }) => Promise<void>
  sendSmsCode: (phone: string, purpose: 'REGISTER' | 'RESET_PASSWORD') => Promise<void>
  resetPassword: (phone: string, code: string, password: string) => Promise<void>
  logout: () => void
  guestLogin: () => void
  updateUser: (user: Partial<UserInfo>) => void
  setFlagCompanyInfo: (v: boolean) => void
  incrementAnswerCount: () => void
}

const AuthContext = createContext<AuthState | null>(null)

function loadGuest(): GuestData {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const fresh: GuestData = { id: 'guest_' + Date.now().toString(36), count: 0 }
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(fresh))
  return fresh
}

function saveGuest(data: GuestData) {
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(data))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [flagCompanyInfo, setFlagCompanyInfo] = useState(false)
  const [answerCount, setAnswerCount] = useState(0)
  const [guestData, setGuestData] = useState<GuestData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const initialize = async () => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (token) {
        try {
          const response = await api.getCurrentUser()
          if (response.code === 2000 && response.data) {
            const currentUser = response.data
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser))
            setUser(currentUser)
            setFlagCompanyInfo(currentUser.flagCompanyInfo || false)
            setAnswerCount(currentUser.count || 0)
            setLoading(false)
            return
          }
        } catch { /* use guest mode below */ }
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        localStorage.removeItem(USER_STORAGE_KEY)
      }
      const guest = loadGuest()
      try {
        const response = await api.getOrCreateGuest({ guestKey: guest.id, platform: 'web' })
        if (response.code === 2000 && response.data?.id) {
          guest.backendUserId = response.data.id
          guest.count = response.data.count || guest.count
          saveGuest(guest)
        }
      } catch { /* continue in local guest mode */ }
      setGuestData(guest)
      setLoading(false)
    }
    void initialize()
  }, [])

  const applyLogin = useCallback((token: string, currentUser: UserInfo) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser))
    localStorage.removeItem(GUEST_STORAGE_KEY)
    setUser(currentUser)
    setGuestData(null)
    setFlagCompanyInfo(currentUser.flagCompanyInfo || false)
    setAnswerCount(currentUser.count || 0)
  }, [])

  const login = useCallback(async (phone: string, password: string) => {
    const response = await api.login({ phone, password })
    if (response.code !== 2000 || !response.data) throw new Error(response.message || '登录失败')
    applyLogin(response.data.token, response.data.user)
  }, [applyLogin])

  const register = useCallback(async (phone: string, code: string, password: string, profile = {}) => {
    const response = await api.register({ phone, code, password, ...profile })
    if (response.code !== 2000 || !response.data) throw new Error(response.message || '注册失败')
    applyLogin(response.data.token, response.data.user)
  }, [applyLogin])

  const sendSmsCode = useCallback(async (phone: string, purpose: 'REGISTER' | 'RESET_PASSWORD') => {
    const response = await api.sendSmsCode({ phone, purpose })
    if (response.code !== 2000) throw new Error(response.message || '验证码发送失败')
  }, [])

  const resetPassword = useCallback(async (phone: string, code: string, password: string) => {
    const response = await api.resetPassword({ phone, code, password })
    if (response.code !== 2000) throw new Error(response.message || '密码修改失败')
  }, [])

  const logout = useCallback(() => {
    void api.logout().catch(() => {})
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
    setUser(null)
    setFlagCompanyInfo(false)
    setAnswerCount(0)
    const guest = loadGuest()
    setGuestData(guest)
    void api.getOrCreateGuest({ guestKey: guest.id, platform: 'web' }).then((response) => {
      if (response.code !== 2000 || !response.data?.id) return
      const next = { ...guest, backendUserId: response.data.id, count: response.data.count || guest.count }
      saveGuest(next)
      setGuestData(next)
    }).catch(() => {})
  }, [])

  const guestLogin = useCallback(() => {
    const guest = loadGuest()
    setGuestData(guest)
    setAnswerCount(guest.count)
    void api.getOrCreateGuest({ guestKey: guest.id, platform: 'web' }).then((response) => {
      if (response.code !== 2000 || !response.data?.id) return
      const next = { ...guest, backendUserId: response.data.id, count: response.data.count || guest.count }
      saveGuest(next)
      setGuestData(next)
    }).catch(() => {})
  }, [])

  const updateUser = useCallback((updates: Partial<UserInfo>) => {
    setUser((prev) => {
      if (!prev) return null
      const next = { ...prev, ...updates }
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const incrementAnswerCount = useCallback(() => {
    if (user) {
      setAnswerCount((c) => c + 1)
    } else if (guestData) {
      const next = { ...guestData, count: guestData.count + 1 }
      saveGuest(next)
      setGuestData(next)
      setAnswerCount(next.count)
    }
  }, [user, guestData])

  return (
    <AuthContext.Provider value={{
      user,
      isLoggedIn: !!user,
      isGuest: !user && !!guestData,
      loading,
      flagCompanyInfo: user ? flagCompanyInfo : false,
      answerCount,
      guestCount: guestData?.count || 0,
      guestUserId: guestData?.backendUserId,
      login,
      register,
      sendSmsCode,
      resetPassword,
      logout,
      guestLogin,
      updateUser,
      setFlagCompanyInfo,
      incrementAnswerCount,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
