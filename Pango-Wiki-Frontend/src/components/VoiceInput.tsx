import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import './VoiceInput.css'

interface Props {
  onResult: (text: string) => void
  onCancel: () => void
}

type VoiceState = 'starting' | 'recording' | 'processing' | 'error'

export default function VoiceInput({ onResult, onCancel }: Props) {
  const [state, setState] = useState<VoiceState>('starting')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef(48000)
  const startedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const startingRef = useRef(false)

  const releaseAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null
      processorRef.current.disconnect()
      processorRef.current = null
    }
    sourceRef.current?.disconnect()
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const context = contextRef.current
    contextRef.current = null
    if (context && context.state !== 'closed') void context.close()
  }, [])

  const startRecording = useCallback(async () => {
    if (startingRef.current || streamRef.current) return
    startingRef.current = true
    setState('starting')
    setError('')
    setElapsed(0)
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const AudioContextClass = window.AudioContext
      const context = new AudioContextClass()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      sampleRateRef.current = context.sampleRate
      streamRef.current = stream
      contextRef.current = context
      sourceRef.current = source
      processorRef.current = processor
      processor.onaudioprocess = (event) => {
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(context.destination)
      startedAtRef.current = Date.now()
      setState('recording')
    } catch {
      releaseAudio()
      setError('无法访问麦克风，请在浏览器设置中允许麦克风权限')
      setState('error')
    } finally {
      startingRef.current = false
    }
  }, [releaseAudio])

  useEffect(() => {
    mountedRef.current = true
    void startRecording()
    return () => {
      mountedRef.current = false
      releaseAudio()
    }
  }, [releaseAudio, startRecording])

  useEffect(() => {
    if (state !== 'recording') return
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 250)
    return () => window.clearInterval(timer)
  }, [state])

  const stopRecording = async () => {
    if (state !== 'recording') return
    const duration = Date.now() - startedAtRef.current
    const chunks = chunksRef.current
    const inputSampleRate = sampleRateRef.current
    releaseAudio()
    if (duration < 1000 || chunks.length === 0) {
      setError('录音时间太短，请至少录制 1 秒')
      setState('error')
      return
    }

    setState('processing')
    try {
      const wavBlob = encodeWav(chunks, inputSampleRate, 16000)
      const result = await api.transcribe(wavBlob)
      if (!mountedRef.current) return
      if (!result?.text?.trim()) throw new Error('未识别到有效语音')
      onResult(result.text.trim())
    } catch (cause) {
      if (!mountedRef.current) return
      setError(cause instanceof Error ? cause.message : '语音识别失败，请重试')
      setState('error')
    }
  }

  const retry = () => {
    void startRecording()
  }

  return (
    <div className={`voice-input voice-state-${state}`}>
      <div className="voice-status" aria-live="polite">
        {state === 'starting' && <span className="voice-status-text">正在启动麦克风...</span>}
        {state === 'recording' && (
          <>
            <span className="voice-live-dot" />
            <span className="voice-status-text">正在录音</span>
            <span className="voice-timer">{formatDuration(elapsed)}</span>
            <span className="voice-wave" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
            </span>
          </>
        )}
        {state === 'processing' && (
          <>
            <span className="voice-spinner" />
            <span className="voice-status-text">正在转换文字...</span>
          </>
        )}
        {state === 'error' && <span className="voice-error">{error}</span>}
      </div>

      {state === 'recording' ? (
        <button type="button" className="voice-control-btn stop" onClick={() => void stopRecording()} title="停止录音" aria-label="停止录音">
          <span className="voice-stop-icon" />
        </button>
      ) : state === 'error' ? (
        <button type="button" className="voice-retry-btn" onClick={retry}>重新录音</button>
      ) : null}

      <button type="button" className="voice-cancel-btn" onClick={onCancel} disabled={state === 'processing'} aria-label="返回文字输入" title="返回文字输入">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const rest = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

function encodeWav(chunks: Float32Array[], inputRate: number, outputRate: number): Blob {
  const inputLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const input = new Float32Array(inputLength)
  let inputOffset = 0
  chunks.forEach((chunk) => {
    input.set(chunk, inputOffset)
    inputOffset += chunk.length
  })

  const ratio = inputRate / outputRate
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const samples = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index++) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))
    let sum = 0
    for (let cursor = start; cursor < end; cursor++) sum += input[cursor]
    samples[index] = sum / Math.max(1, end - start)
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, outputRate, true)
  view.setUint32(28, outputRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  })
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
}
