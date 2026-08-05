import { useCallback, useEffect, useState } from 'react'
import { returnToMiniProgramQa } from '../utils/miniProgramBridge'

export default function MiniProgramQaReturn() {
  const [message, setMessage] = useState('正在返回小程序智能问答…')
  const [retryVisible, setRetryVisible] = useState(false)

  const returnToQa = useCallback(async () => {
    setMessage('正在返回小程序智能问答…')
    setRetryVisible(false)
    const result = await returnToMiniProgramQa()
    if (result === 'bridge-unavailable') {
      setMessage('暂时无法连接小程序，请点击微信左上角返回按钮。')
      setRetryVisible(true)
    } else if (result === 'navigation-failed') {
      setMessage('返回小程序失败，请重试或点击微信左上角返回按钮。')
      setRetryVisible(true)
    }
  }, [])

  useEffect(() => {
    void returnToQa()
  }, [returnToQa])

  return (
    <main className="app-route-loading" aria-live="polite">
      <p>{message}</p>
      {retryVisible ? <button type="button" onClick={() => void returnToQa()}>重新返回</button> : null}
    </main>
  )
}
