
import { RequestTask } from 'miniprogram-api-typings'

type StreamCallback = (chunk: string) => void
type ErrorCallback = (err: any) => void

class StreamService {
    private static instance: StreamService

    static getInstance() {
        return this.instance || (this.instance = new StreamService())
    }

    fetchStream(url: string, params: any,
        onData: StreamCallback,
        onError?: ErrorCallback): RequestTask {
        const task = wx.request({
            url,
            method: 'POST',
            responseType: 'arraybuffer',
            enableChunked: true,
            data: JSON.stringify(params)
        }) as RequestTask

        let buffer = ''
        task.onChunkReceived(res => {
            try {
                const bytes = new Uint8Array(res.data)
                const chunk = this.decodeSSE(bytes)
                buffer = this.processChunk(buffer + chunk, onData)
            } catch (e) {
                onError?.(e)
            }
        })
        return task
    }

    private decodeSSE(bytes: Uint8Array): string {
        return new TextDecoder('utf-8').decode(bytes)
    }

    private processChunk(raw: string, callback: StreamCallback): string {
        const events = raw.split('\n\n')
        events.slice(0, -1).forEach(event => {
            if (event.startsWith('data:')) {
                callback(event.substring(5).trim())
            }
        })
        return events.pop() || ''
    }
    
}

export default StreamService.getInstance()
