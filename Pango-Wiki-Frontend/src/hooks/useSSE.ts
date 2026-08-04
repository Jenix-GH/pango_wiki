import { useRef, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import type { AnswerMedia, ReferencePayload, UploadImage } from '../api/types'

export function useSSE() {
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const start = useCallback((
    userinfoId: number,
    question: string,
    sessionId: string,
    isTestVersion: boolean,
    images: UploadImage[] | null,
    onProgress: (statusText: string, emoji: string) => void,
    onChunk: (text: string, mode: 'append' | 'replace') => void,
    onDone: (finalAnswer: string, reference: ReferencePayload, citations: unknown[], trace: unknown, answerMedia: AnswerMedia[]) => void,
    onError: (err: Error) => void,
  ) => {
    controllerRef.current?.abort()
    const generation = ++generationRef.current

    const ctrl = api.startStream(
      userinfoId,
      question,
      sessionId,
      isTestVersion,
      images,
      {
        onProgress: (statusText, emoji) => {
          if (generation === generationRef.current) onProgress(statusText, emoji)
        },
        onChunk: (text, mode) => {
          if (generation === generationRef.current) onChunk(text, mode)
        },
        onDone: (finalAnswer, reference, citations, trace, answerMedia) => {
          if (generation !== generationRef.current) return
          controllerRef.current = null
          onDone(finalAnswer, reference, citations, trace, answerMedia)
        },
        onError: (error) => {
          if (generation !== generationRef.current) return
          controllerRef.current = null
          onError(error)
        },
      },
    )
    controllerRef.current = ctrl
  }, [])

  const abort = useCallback(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => abort, [abort])

  return { start, abort }
}
