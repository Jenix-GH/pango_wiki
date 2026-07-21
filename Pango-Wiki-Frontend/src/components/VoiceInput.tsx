import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import './VoiceInput.css'

interface Props {
  onResult: (text: string) => void
  onCancel: () => void
}

type VoiceState = 'idle' | 'recording' | 'processing'

export default function VoiceInput({ onResult, onCancel }: Props) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startYRef = useRef(0)
  const startedAtRef = useRef(0)
  const cancelledRef = useRef(false)

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    releaseStream()
  }, [releaseStream])

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return
    setError('')
    cancelledRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      })
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 36000 }) : new MediaRecorder(stream)
      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []
      startedAtRef.current = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        releaseStream()
        if (cancelledRef.current) {
          setState('idle')
          return
        }
        if (Date.now() - startedAtRef.current < 1000) {
          setError('录音时间太短，请至少录制 1 秒')
          setState('idle')
          return
        }
        setState('processing')
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const result = await api.transcribe(blob)
          if (result?.text?.trim()) onResult(result.text.trim())
          else {
            setError('语音识别失败，请重试')
            setState('idle')
          }
        } catch {
          setError('语音识别失败，请检查网络后重试')
          setState('idle')
        }
      }
      recorder.start()
      setState('recording')
    } catch {
      releaseStream()
      setError('无法访问麦克风，请在浏览器设置中允许麦克风权限')
      setState('idle')
    }
  }, [onResult, releaseStream, state])

  const stopRecording = (cancel = false) => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    cancelledRef.current = cancel
    recorder.stop()
    if (cancel) setError('已取消录音')
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    startYRef.current = event.clientY
    void startRecording()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (state === 'recording' && startYRef.current - event.clientY > 50) stopRecording(true)
  }

  return (
    <div className="voice-input">
      <div className="voice-main">
        {error && <div className="voice-error">{error}</div>}
        {state === 'processing' ? (
          <div className="voice-processing">转换文字中...</div>
        ) : (
          <button
            type="button"
            className={`voice-btn ${state === 'recording' ? 'recording' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => state === 'recording' && stopRecording()}
            onPointerCancel={() => state === 'recording' && stopRecording(true)}
          >
            <div className="voice-ripple" />
            <span>{state === 'recording' ? '松开 结束 · 上滑取消' : '按住 说话'}</span>
          </button>
        )}
      </div>
      <button type="button" className="voice-cancel-btn" onClick={onCancel} disabled={state !== 'idle'} aria-label="切换到文字输入">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
    </div>
  )
}
