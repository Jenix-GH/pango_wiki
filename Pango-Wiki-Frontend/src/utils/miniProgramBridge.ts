const WEIXIN_JSSDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
const WEIXIN_JSSDK_ID = 'pango-weixin-jssdk'

export const MINI_PROGRAM_CLIENT_PARAM = 'client'
export const MINI_PROGRAM_CLIENT_VALUE = 'miniprogram'
export const MINI_PROGRAM_QA_PAGE = '/pages/main/main'

type MiniProgramCallback = () => void
type MiniProgramFailureCallback = (error?: unknown) => void

interface MiniProgramRouteOptions {
  success?: MiniProgramCallback
  fail?: MiniProgramFailureCallback
}

export interface MiniProgramApi {
  navigateBack: (options: MiniProgramRouteOptions & { delta: number }) => void
  reLaunch: (options: MiniProgramRouteOptions & { url: string }) => void
}

interface WeixinJssdk {
  miniProgram?: MiniProgramApi
}

declare global {
  interface Window {
    wx?: WeixinJssdk
    __wxjs_environment?: string
  }
}

export type MiniProgramNavigationResult =
  | 'navigated-back'
  | 'relaunched'
  | 'bridge-unavailable'
  | 'navigation-failed'

let bridgeLoadPromise: Promise<MiniProgramApi | null> | null = null

function currentMiniProgramApi(): MiniProgramApi | null {
  if (typeof window === 'undefined') return null
  return window.wx?.miniProgram || null
}

export function hasMiniProgramClientHint(search: string): boolean {
  const client = new URLSearchParams(search).get(MINI_PROGRAM_CLIENT_PARAM)
  return client?.trim().toLowerCase() === MINI_PROGRAM_CLIENT_VALUE
}

export function isMiniProgramEntry(): boolean {
  if (typeof window === 'undefined') return false
  if (currentMiniProgramApi()) return true
  if (hasMiniProgramClientHint(window.location.search)) return true
  if (window.__wxjs_environment === MINI_PROGRAM_CLIENT_VALUE) return true
  return /miniprogram/i.test(window.navigator.userAgent)
}

export async function detectMiniProgramEntry(): Promise<boolean> {
  if (isMiniProgramEntry()) return true
  if (typeof window === 'undefined' || !/MicroMessenger/i.test(window.navigator.userAgent)) return false
  return Boolean(await loadMiniProgramApi(1_500))
}

async function loadMiniProgramApi(timeoutMs = 4_000): Promise<MiniProgramApi | null> {
  const availableApi = currentMiniProgramApi()
  if (availableApi) return availableApi
  if (typeof document === 'undefined') return null
  if (bridgeLoadPromise) return bridgeLoadPromise

  bridgeLoadPromise = new Promise<MiniProgramApi | null>((resolve) => {
    let settled = false
    let pollTimer = 0
    let timeoutTimer = 0

    const finish = (api: MiniProgramApi | null) => {
      if (settled) return
      settled = true
      window.clearInterval(pollTimer)
      window.clearTimeout(timeoutTimer)
      resolve(api)
    }

    const checkBridge = () => {
      const api = currentMiniProgramApi()
      if (api) finish(api)
    }

    let script = document.getElementById(WEIXIN_JSSDK_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = WEIXIN_JSSDK_ID
      script.src = WEIXIN_JSSDK_URL
      script.async = true
      document.head.appendChild(script)
    }

    script.addEventListener('load', checkBridge, { once: true })
    script.addEventListener('error', () => finish(null), { once: true })
    pollTimer = window.setInterval(checkBridge, 50)
    timeoutTimer = window.setTimeout(() => finish(null), timeoutMs)
    checkBridge()
  })

  const api = await bridgeLoadPromise
  if (!api) bridgeLoadPromise = null
  return api
}

function invokeRoute(
  invoke: (callbacks: MiniProgramRouteOptions) => void,
  timeoutMs = 1_500,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (succeeded: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutTimer)
      resolve(succeeded)
    }
    const timeoutTimer = window.setTimeout(() => finish(false), timeoutMs)

    try {
      invoke({
        success: () => finish(true),
        fail: () => finish(false),
      })
    } catch {
      finish(false)
    }
  })
}

export async function returnToMiniProgramQa(): Promise<MiniProgramNavigationResult> {
  const api = await loadMiniProgramApi()
  if (!api) return 'bridge-unavailable'

  return navigateWithMiniProgramApi(api)
}

export async function navigateWithMiniProgramApi(
  api: MiniProgramApi,
): Promise<Exclude<MiniProgramNavigationResult, 'bridge-unavailable'>> {
  const navigatedBack = await invokeRoute((callbacks) => {
    api.navigateBack({ delta: 1, ...callbacks })
  })
  if (navigatedBack) return 'navigated-back'

  const relaunched = await invokeRoute((callbacks) => {
    api.reLaunch({ url: MINI_PROGRAM_QA_PAGE, ...callbacks })
  })
  return relaunched ? 'relaunched' : 'navigation-failed'
}
