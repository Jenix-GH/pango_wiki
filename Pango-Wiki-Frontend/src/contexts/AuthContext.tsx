import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { UserInfo } from '../api/types'

const GUEST_LIMIT = 50
const GUEST_STORAGE_KEY = 'pango_guest'
const USER_STORAGE_KEY = 'pango_user'

interface GuestData {
  id: string
  count: number
}

interface AuthState {
  user: UserInfo | null
  isLoggedIn: boolean
  isGuest: boolean
  loading: boolean
  flagCompanyInfo: boolean
  answerCount: number
  guestCount: number
  login: (username: string, password: string) => Promise<void>
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
    const stored = localStorage.getItem(USER_STORAGE_KEY)
    if (stored) {
      try {
        const u: UserInfo = JSON.parse(stored)
        setUser(u)
        setFlagCompanyInfo(u.flagCompanyInfo || false)
        setAnswerCount(u.count || 0)
        setLoading(false)
        return
      } catch { /* ignore */ }
    }
    // No stored user → guest mode
    const guest = loadGuest()
    setGuestData(guest)
    setLoading(false)
  }, [])

  const login = useCallback(async (username: string, _password: string) => {
    const mockUser: UserInfo = {
      id: Date.now(),
      nickName: username,
      avatarUrl: '',
      wxCode: '',
      count: guestData?.count || 0,
      flagCompanyInfo: false,
      todayQuestionList: [],
      weekQuestionList: [],
    }
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(mockUser))
    localStorage.removeItem(GUEST_STORAGE_KEY)
    setUser(mockUser)
    setGuestData(null)
    setFlagCompanyInfo(false)
    setAnswerCount(guestData?.count || 0)
  }, [guestData])

  const logout = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY)
    setUser(null)
    setFlagCompanyInfo(false)
    setAnswerCount(0)
    const guest = loadGuest()
    setGuestData(guest)
  }, [])

  const guestLogin = useCallback(() => {
    const guest = loadGuest()
    setGuestData(guest)
    setAnswerCount(guest.count)
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
      login,
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
