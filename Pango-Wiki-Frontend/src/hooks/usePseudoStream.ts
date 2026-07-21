import { useCallback, useEffect, useRef, useState } from 'react'

type StreamMode = 'append' | 'replace'

const TICK_INTERVAL_MS = 26

function longestCommonPrefix(left: string, right: string): string {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return left.slice(0, index)
}

function revealStep(remaining: number): number {
  if (remaining > 600) return 18
  if (remaining > 200) return 8
  if (remaining > 60) return 4
  return 2
}

export function usePseudoStream() {
  const [visibleText, setVisibleText] = useState('')
  const targetTextRef = useRef('')
  const visibleTextRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const reducedMotionRef = useRef(false)
  const drainResolversRef = useRef<Array<() => void>>([])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const resolveDrain = useCallback(() => {
    if (visibleTextRef.current !== targetTextRef.current) return
    const resolvers = drainResolversRef.current.splice(0)
    resolvers.forEach((resolve) => resolve())
  }, [])

  const revealAll = useCallback(() => {
    clearTimer()
    visibleTextRef.current = targetTextRef.current
    setVisibleText(targetTextRef.current)
    resolveDrain()
  }, [clearTimer, resolveDrain])

  const scheduleTickRef = useRef<() => void>(() => {})

  const runTick = useCallback(() => {
    timerRef.current = undefined

    if (reducedMotionRef.current) {
      revealAll()
      return
    }

    const target = targetTextRef.current
    let visible = visibleTextRef.current
    if (!target.startsWith(visible)) {
      visible = longestCommonPrefix(visible, target)
    }

    const remaining = target.length - visible.length
    if (remaining <= 0) {
      resolveDrain()
      return
    }

    const next = target.slice(0, visible.length + revealStep(remaining))
    visibleTextRef.current = next
    setVisibleText(next)

    if (next === targetTextRef.current) resolveDrain()
    else scheduleTickRef.current()
  }, [resolveDrain, revealAll])

  const scheduleTick = useCallback(() => {
    if (timerRef.current || visibleTextRef.current === targetTextRef.current) {
      resolveDrain()
      return
    }
    if (reducedMotionRef.current) {
      revealAll()
      return
    }
    timerRef.current = setTimeout(runTick, TICK_INTERVAL_MS)
  }, [resolveDrain, revealAll, runTick])

  scheduleTickRef.current = scheduleTick

  const push = useCallback((text: string, mode: StreamMode) => {
    const nextTarget = mode === 'replace'
      ? text
      : targetTextRef.current + text

    if (mode === 'replace' && !nextTarget.startsWith(visibleTextRef.current)) {
      const sharedPrefix = longestCommonPrefix(visibleTextRef.current, nextTarget)
      visibleTextRef.current = sharedPrefix
      setVisibleText(sharedPrefix)
    }

    targetTextRef.current = nextTarget
    scheduleTick()
  }, [scheduleTick])

  const finish = useCallback((authoritativeText?: string): Promise<void> => {
    if (authoritativeText && authoritativeText !== targetTextRef.current) {
      const sharedPrefix = longestCommonPrefix(visibleTextRef.current, authoritativeText)
      if (!authoritativeText.startsWith(visibleTextRef.current)) {
        visibleTextRef.current = sharedPrefix
        setVisibleText(sharedPrefix)
      }
      targetTextRef.current = authoritativeText
    }

    if (visibleTextRef.current === targetTextRef.current) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      drainResolversRef.current.push(resolve)
      scheduleTick()
    })
  }, [scheduleTick])

  const reset = useCallback(() => {
    clearTimer()
    targetTextRef.current = ''
    visibleTextRef.current = ''
    setVisibleText('')
    const resolvers = drainResolversRef.current.splice(0)
    resolvers.forEach((resolve) => resolve())
  }, [clearTimer])

  const getTargetText = useCallback(() => targetTextRef.current, [])
  const getVisibleText = useCallback(() => visibleTextRef.current, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => {
      reducedMotionRef.current = media.matches
      if (media.matches) revealAll()
    }

    syncPreference()
    media.addEventListener('change', syncPreference)
    return () => {
      media.removeEventListener('change', syncPreference)
      clearTimer()
      const resolvers = drainResolversRef.current.splice(0)
      resolvers.forEach((resolve) => resolve())
    }
  }, [clearTimer, revealAll])

  return {
    visibleText,
    push,
    finish,
    reset,
    revealAll,
    getTargetText,
    getVisibleText,
  }
}
