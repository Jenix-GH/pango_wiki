import { useRef, useState, useCallback } from 'react'
import { api } from '../api/client'
import './VoiceInput.css'

interface Props {
  onResult: (text: string) => void
  onCancel: () => void
}

export default function VoiceInput({ onResult, onCancel }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle')
  const [error, setError] = useState('')
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const startY = useRef(0)

  const startRecording = useCallback(async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorder.current = recorder
      chunks.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('processing')
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        const result = await api.transcribe(blob)
        if (result?.text) {
          onResult(result.text)
        } else {
          setError('语音识别失败，请重试')
          setState('idle')
        }
      }

      recorder.start()
      setState('recording')
    } catch {
      setError('无法访问麦克风，请在浏览器设置中允许麦克风权限')
    }
  }, [onResult])

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop()
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
    startRecording()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (state !== 'recording') return
    if (startY.current - e.clientY > 50) {
      stopRecording()
      setState('idle')
      setError('已取消')
    }
  }

  const handlePointerUp = () => {
    if (state === 'recording') {
      stopRecording()
    }
  }

  if (state === 'processing') {
    return (
      <div className="voice-input">
        <div className="voice-processing">转换文字中...</div>
      </div>
    )
  }

  return (
    <div className="voice-input">
      {error && <div className="voice-error">{error}</div>}
      <button
        className={`voice-btn ${state === 'recording' ? 'recording' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="voice-ripple" />
        <span>{state === 'recording' ? '松开 结束' : '按住 说话'}</span>
      </button>
      <button className="voice-cancel-btn" onClick={onCancel}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 1l4 4m0 0l-4 4m4-4H7a6 6 0 0 0 0 12h10" />
        </svg>
      </button>
    </div>
  )
}
