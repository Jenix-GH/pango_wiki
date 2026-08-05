
type RequestTask = WechatMiniprogram.RequestTask
type StreamCallback = (chunk: string) => void
type ErrorCallback = (err: any) => void

export interface StreamFrameResult {
    frames: string[]
    rest: string
}

export interface Utf8ChunkResult {
    text: string
    rest: Uint8Array
}

export function splitStreamFrames(raw: string): StreamFrameResult {
    const normalized = raw.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    const rest = lines.pop() || ''
    const frames: string[] = []

    lines.forEach(line => {
        let text = line.trim()
        if (!text) return
        if (text.startsWith('event:')) return
        if (text.startsWith('data:')) {
            text = text.substring(5).trim()
        }
        if (text) frames.push(text)
    })

    return { frames, rest }
}

export function decodeUtf8Chunk(carry: Uint8Array, bytes: Uint8Array): Utf8ChunkResult {
    const input = new Uint8Array(carry.length + bytes.length)
    input.set(carry, 0)
    input.set(bytes, carry.length)

    let text = ''
    let cursor = 0
    while (cursor < input.length) {
        const first = input[cursor]
        if (first < 0x80) {
            text += String.fromCharCode(first)
            cursor++
            continue
        }

        let width = 0
        let codePoint = 0
        let minimum = 0
        if ((first & 0xe0) === 0xc0) {
            width = 2
            codePoint = first & 0x1f
            minimum = 0x80
        } else if ((first & 0xf0) === 0xe0) {
            width = 3
            codePoint = first & 0x0f
            minimum = 0x800
        } else if ((first & 0xf8) === 0xf0) {
            width = 4
            codePoint = first & 0x07
            minimum = 0x10000
        } else {
            text += '\ufffd'
            cursor++
            continue
        }

        if (cursor + width > input.length) break

        let valid = true
        for (let offset = 1; offset < width; offset++) {
            const continuation = input[cursor + offset]
            if ((continuation & 0xc0) !== 0x80) {
                valid = false
                break
            }
            codePoint = (codePoint << 6) | (continuation & 0x3f)
        }
        if (!valid) {
            text += '\ufffd'
            cursor++
            continue
        }

        if (
            codePoint < minimum ||
            codePoint > 0x10ffff ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
            text += '\ufffd'
            cursor += width
            continue
        }

        if (codePoint <= 0xffff) {
            text += String.fromCharCode(codePoint)
        } else {
            const normalized = codePoint - 0x10000
            text += String.fromCharCode(
                0xd800 + (normalized >> 10),
                0xdc00 + (normalized & 0x3ff)
            )
        }
        cursor += width
    }

    const rest = new Uint8Array(input.length - cursor)
    rest.set(input.subarray(cursor))
    return { text, rest }
}

class StreamService {
    private static instance: StreamService

    static getInstance() {
        return this.instance || (this.instance = new StreamService())
    }

    fetchStream(url: string, params: any, header: any,
        onData: StreamCallback,
        onError?: ErrorCallback): RequestTask {
        let buffer = ''
        let utf8Carry: Uint8Array = new Uint8Array(0)
        let chunkCount = 0
        const startTime = Date.now()
        const flushPendingFrame = () => {
            let tail = buffer.trim()
            buffer = ''
            if (!tail) return
            if (tail.startsWith('event:')) return
            if (tail.startsWith('data:')) tail = tail.substring(5).trim()
            if (tail) onData(tail)
        }
        const task = wx.request({
            url,
            method: 'POST',
            header: header,
            responseType: 'arraybuffer',
            enableChunked: true,
            data: JSON.stringify(params),
            success: res => {
                if (res.statusCode < 400) {
                    // A normal JSON business error (for example an expired
                    // login token) may be returned without a trailing newline.
                    // Flush it instead of leaving the UI waiting forever.
                    flushPendingFrame()
                    return
                }
                let message = `HTTP ${res.statusCode}`
                try {
                    const bufferedBody = buffer.trim()
                    const bytes = new Uint8Array(res.data as ArrayBuffer)
                    const decoded = bufferedBody || decodeUtf8Chunk(new Uint8Array(0), bytes).text
                    const payload = JSON.parse(decoded)
                    message = payload.message || message
                } catch (_) {
                    // Keep the HTTP status when the error body is not JSON.
                }
                const error = new Error(message) as Error & { statusCode?: number }
                error.statusCode = res.statusCode
                onError && onError(error)
            },
            fail: err => {
                if (onError) onError(err)
            }
        }) as RequestTask

        task.onChunkReceived((res: any) => {
            try {
                chunkCount++
                const bytes = new Uint8Array(res.data)
                const elapsed = Date.now() - startTime
                // console.log(`[stream] chunk #${chunkCount}, size=${bytes.length}B, elapsed=${elapsed}ms`)
                const decoded = decodeUtf8Chunk(utf8Carry, bytes)
                utf8Carry = decoded.rest
                buffer = this.processChunk(buffer + decoded.text, onData)
            } catch (e) {
                onError && onError(e)
            }
        })
        return task
    }

    private processChunk(raw: string, callback: StreamCallback): string {
        const result = splitStreamFrames(raw)
        result.frames.forEach(frame => callback(frame))
        return result.rest
    }

}

export default StreamService.getInstance()
