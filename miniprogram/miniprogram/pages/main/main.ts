// pages/main/main.ts
import { formatTime } from '../../utils/util'
import streamUtils from "./stream"
import { copyToClipboard, extractText, showError, showSuccess, persistUserInfo } from '../../utils/tools'
import {
    advanceAgentProgress,
    createAgentProgress,
    INITIAL_AGENT_PROGRESS,
} from '../../utils/agent-progress'
// import marked from "../../utils/marked.min.js"

let isScrolling = false;
let pendingScroll = false;
let ignoreScrollUntil = 0;
let lastChunkTime = 0; // 记录最近一次收到流式数据的时间，用于检测后台断连
let streamTimeoutId: any = null;
const FIRST_STREAM_FRAME_TIMEOUT_MS = 60000; // 第一条状态或回答分片应当很快到达
const STREAM_IDLE_TIMEOUT_MS = 90000; // 已开始响应后，90s无新数据判定断连
const STREAM_RENDER_INTERVAL_MS = 32;
const STREAM_RENDER_MAX_TAIL_MS = 6000;
const STREAM_RENDER_MAX_BATCH = 12;
const GUEST_ANSWER_LIMIT = 10;
const LOGIN_ANSWER_LIMIT = 50;
let streamDisplayQueue: string[] = [];
let streamDisplayTimer: any = null;
let streamDisplayRendering = false;
let streamDisplayCompleteRequested = false;
let streamDisplayDeadline = 0;
let streamDisplayGeneration = 0;

function setStreamTimeout(that: any, phase: 'first-frame' | 'idle' = 'idle') {
    if (streamTimeoutId) clearTimeout(streamTimeoutId)
    streamTimeoutId = setTimeout(() => {
        that.handleStreamTimeout(phase)
    }, phase === 'first-frame' ? FIRST_STREAM_FRAME_TIMEOUT_MS : STREAM_IDLE_TIMEOUT_MS)
}

function clearStreamTimeout() {
    if (streamTimeoutId) {
        clearTimeout(streamTimeoutId)
        streamTimeoutId = null
    }
}

function resetStreamDisplayQueue() {
    if (streamDisplayTimer !== null) {
        clearTimeout(streamDisplayTimer)
    }
    streamDisplayQueue = []
    streamDisplayTimer = null
    streamDisplayRendering = false
    streamDisplayCompleteRequested = false
    streamDisplayDeadline = 0
    streamDisplayGeneration++
}
// 获取全局录音管理器
const recorderManager = wx.getRecorderManager()
let activeRecorderPage: any = null
let recorderState: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle'
let recorderFormat: 'aac' | 'mp3' = 'aac'
let recorderPreferredFormat: 'aac' | 'mp3' = 'aac'
let recorderAttemptStartedAt = 0
let recorderStopFallbackTimer: any = null
let recorderIntentVersion = 0
let recordAuthorizationPending = false
const MAX_UPLOAD_IMAGE_BYTES = 15 * 1024 * 1024

function clearRecorderStopFallback() {
    if (recorderStopFallbackTimer !== null) {
        clearTimeout(recorderStopFallbackTimer)
        recorderStopFallbackTimer = null
    }
}

// RecorderManager is a global singleton. Register its callbacks only once;
// registering onStop inside startRecord would accumulate one listener per
// recording and trigger duplicate uploads after the second recording.
recorderManager.onStop((res: WechatMiniprogram.OnStopCallbackResult) => {
    clearRecorderStopFallback()
    recorderState = 'idle'
    const page = activeRecorderPage
    activeRecorderPage = null
    if (page) page.handleRecorderStopped(res)
})
recorderManager.onError((error: any) => {
    clearRecorderStopFallback()
    const failedState = recorderState
    const failedFormat = recorderFormat
    recorderState = 'idle'
    const page = activeRecorderPage
    activeRecorderPage = null
    if (!page) return
    const failedDuringStartup = failedState === 'starting' || Date.now() - recorderAttemptStartedAt < 1500
    if (failedDuringStartup && failedFormat === 'aac') {
        page.retryRecordingWithMp3(error)
        return
    }
    page.handleRecorderError(error)
})
recorderManager.onStart(() => {
    recorderState = 'recording'
    const page = activeRecorderPage
    // A touch-cancel may arrive while RecorderManager is still starting.
    // Stop immediately once the delayed onStart arrives instead of leaving
    // an invisible recorder alive and blocking every later recording.
    if (!page || !page.data.flagLuyuning || page.data.flagTalkOver || page.data.flagCancel) {
        if (page) page.stopRecorderManager()
        else {
            recorderState = 'stopping'
            recorderManager.stop()
        }
    }
})
const app = getApp();

interface ApiResponse<T> {
    code: number
    message: string
    data: T
}

interface questionList {
    todayQuestion: [],
    weekQuestion: [],
    count: number,
    flagCompanyInfo: boolean
}

interface SessionData {
    answer: string
    text: string
    reference: Record<string, unknown>
    param: unknown[]
    id: string
    session_id: string  // 关键字段定义
}

interface ReferencePageLink {
    page: number
    pdf_page?: number
    document_page_url?: string
    citation_indices?: number[]
    citation_label?: string
    page_key?: string
}

interface ReferenceChunk {
    chunk_id?: string
    reference_index?: number
    citation_label?: string
    display_name?: string
    document_preview_url?: string
    document_page_url?: string
    document_name?: string
    title?: string
    page?: number
    pages?: number[]
    page_links?: ReferencePageLink[]
    reference_key?: string
    dataset_id?: string
    document_id?: string
    [key: string]: unknown
}

interface ReferencePayload {
    chunks: ReferenceChunk[]
    total: number
    [key: string]: unknown
}

interface AnswerMedia {
    asset_id: string
    url: string
    absoluteUrl: string
    caption?: string
    citation_label?: string
    page?: number
    document_page_url?: string
}

interface AnswerContentSection {
    section_key: string
    content: string
    media: AnswerMedia[]
}

interface QuestionImage {
    mime_type: string
    data_base64: string
    filename: string
    local_url?: string
}

function emptyReference(): ReferencePayload {
    return { chunks: [], total: 0 }
}

function createRuntimeState() {
    return {
        currentPhase: INITIAL_AGENT_PROGRESS.phase,
        currentStatusText: INITIAL_AGENT_PROGRESS.title,
        currentStatusDetail: INITIAL_AGENT_PROGRESS.detail,
        hasReceivedAgentProgress: false,
        currentReference: emptyReference(),
        currentAnswerMedia: [] as AnswerMedia[],
        currentStructuredCitations: [] as unknown[],
        currentQuestionTrace: null as unknown
    }
}

function toPositivePage(value: unknown): number | null {
    const page = Number(value)
    return Number.isInteger(page) && page > 0 ? page : null
}

function normalizePages(values: unknown[]): number[] {
    const pages = values
        .map(toPositivePage)
        .filter((page): page is number => page !== null)
    return Array.from(new Set(pages))
}

function normalizePageLinks(chunk: ReferenceChunk): ReferencePageLink[] {
    const linksByPage = new Map<number, ReferencePageLink>()
    const addLink = (value: Partial<ReferencePageLink>) => {
        const page = toPositivePage(value.page)
        if (page === null || linksByPage.has(page)) return
        const documentPageUrl = String(value.document_page_url || '').trim()
        linksByPage.set(page, {
            ...value,
            page,
            document_page_url: documentPageUrl || undefined,
            citation_indices: Array.isArray(value.citation_indices)
                ? value.citation_indices.map(Number).filter(Number.isInteger)
                : undefined,
            citation_label: value.citation_label ? String(value.citation_label) : undefined,
        })
    }

    if (Array.isArray(chunk.page_links)) {
        chunk.page_links.forEach(link => addLink(link || {}))
    }
    addLink({ page: toPositivePage(chunk.page) || undefined, document_page_url: chunk.document_page_url })

    return Array.from(linksByPage.values())
        .map((link, index) => ({
            ...link,
            page_key: link.page_key || `page_${link.page}_${index}`
        }))
}

function parseStoredJson(value: unknown): any {
    if (typeof value !== 'string') return value
    const text = value.trim()
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch (_) {
        return null
    }
}

function normalizeReference(reference: any, citations?: any[]): ReferencePayload {
    const parsedReference = parseStoredJson(reference)
    const parsedCitations = parseStoredJson(citations)
    const hasReferencePayload = Array.isArray(parsedReference?.chunks)
    let chunks: ReferenceChunk[] = hasReferencePayload
        ? [...parsedReference.chunks]
        : []
    // An explicit empty reference payload means the answer used no citations.
    if (!hasReferencePayload && Array.isArray(parsedCitations)) {
        chunks = parsedCitations.map((c: any, i: number) => ({
            ...c,
            reference_index: i,
            citation_label: c.citation_label || '',
            display_name: c.display_name || c.document_name || c.title || '',
            document_preview_url: c.document_preview_url || c.url || '',
            document_page_url: c.document_page_url || '',
            document_name: c.document_name || c.title || '',
            title: c.title || c.document_name || '',
            page: c.page,
            pages: c.pages || [],
            page_links: c.page_links || [],
        }))
    }
    chunks.sort((a, b) => (a.reference_index ?? 0) - (b.reference_index ?? 0))
    chunks.forEach((chunk, i) => {
        chunk.reference_key = `ref_${i}_${chunk.chunk_id || chunk.document_name || i}`
        const directPage = toPositivePage(chunk.page)
        const pages = normalizePages([
            ...(Array.isArray(chunk.pages) ? chunk.pages : []),
            ...(directPage === null ? [] : [directPage])
        ])
        const pageLinks = normalizePageLinks(chunk)
        chunk.pages = normalizePages([...pageLinks.map(link => link.page), ...pages])
        chunk.page_links = pageLinks
        if (pageLinks.length > 0) {
            chunk.page = pageLinks[0].page
            chunk.document_page_url = pageLinks[0].document_page_url
        }
    })
    return {
        ...(parsedReference || {}),
        chunks,
        total: chunks.length
    }
}

function withSessionId(url: string, sessionId: string): string {
    if (!sessionId || url.includes("session_id=")) return url
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}session_id=${encodeURIComponent(sessionId)}`
}

function absoluteReferenceUrl(urlValue: unknown): string {
    const rawUrl = String(urlValue || '').trim()
    if (!rawUrl) return ''
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl

    const host = String(app.globalData.referenceHost || '').trim().replace(/\/$/, '')
    if (!host) return ''
    return `${host}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`
}

function withMiniProgramClient(url: string): string {
    if (!url || /[?&]client=miniprogram(?:&|$)/i.test(url)) return url
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}client=miniprogram`
}

function normalizeQuestionImages(value: unknown): QuestionImage[] {
    const parsed = parseStoredJson(value)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 3).reduce((result: QuestionImage[], item: any) => {
        if (!item || typeof item !== 'object') return result
        const mimeType = String(item.mime_type || '').trim().toLowerCase()
        const dataBase64 = String(item.data_base64 || '').trim()
        if (!mimeType.startsWith('image/') || !dataBase64) return result
        result.push({
            mime_type: mimeType,
            data_base64: dataBase64,
            filename: String(item.filename || `question-image-${result.length + 1}`)
        })
        return result
    }, [])
}

function normalizeAnswerMedia(value: unknown): AnswerMedia[] {
    const parsed = parseStoredJson(value)
    if (!Array.isArray(parsed)) return []
    const configuredHost = String(app.globalData.referenceHost || '').trim().replace(/\/$/, '')
    return parsed.slice(0, 10).reduce((result: AnswerMedia[], item: any, index: number) => {
        if (!item || typeof item !== 'object') return result
        const rawUrl = String(item.url || item.image_url || item.absolute_url || item.absoluteUrl || '').trim()
        const absoluteUrl = absoluteReferenceUrl(rawUrl)
        if (!absoluteUrl || !absoluteUrl.startsWith(`${configuredHost}/references/figures/`) || !/^https:\/\//i.test(absoluteUrl)) return result
        const page = toPositivePage(item.page)
        result.push({
            asset_id: String(item.asset_id || `answer_media_${index}`),
            url: rawUrl,
            absoluteUrl,
            caption: item.caption ? String(item.caption) : undefined,
            citation_label: item.citation_label ? String(item.citation_label) : undefined,
            page: page || undefined,
            document_page_url: item.document_page_url ? String(item.document_page_url) : undefined
        })
        return result
    }, [])
}

function placeMediaAfterCitations(content: string, media: AnswerMedia[]): AnswerContentSection[] {
    if (media.length === 0) {
        return [{ section_key: 'answer_section_0', content, media: [] }]
    }

    const mediaByOffset = new Map<number, AnswerMedia[]>()
    const unplaced: AnswerMedia[] = []
    media.forEach(item => {
        const label = item.citation_label?.trim()
        const bracketLabel = label?.match(/\[[^\]]+\]/)?.[0]
        const candidates = Array.from(new Set([label, bracketLabel].filter((value): value is string => Boolean(value))))
        let matchIndex = -1
        let matchedLabel = ''

        for (const candidate of candidates) {
            matchIndex = content.indexOf(candidate)
            if (matchIndex >= 0) {
                matchedLabel = candidate
                break
            }
        }

        if (matchIndex < 0) {
            unplaced.push(item)
            return
        }

        let insertionOffset = matchIndex + matchedLabel.length
        const openingSup = content.lastIndexOf('<sup', matchIndex)
        const closingSupBeforeLabel = content.lastIndexOf('</sup>', matchIndex)
        const closingSupAfterLabel = content.indexOf('</sup>', insertionOffset)
        if (openingSup > closingSupBeforeLabel && closingSupAfterLabel >= insertionOffset) {
            insertionOffset = closingSupAfterLabel + '</sup>'.length
            const trailingPunctuation = content.slice(insertionOffset).match(/^[ \t]*[。！？.!?；;：:]?/)
            insertionOffset += trailingPunctuation?.[0].length || 0
        }
        mediaByOffset.set(insertionOffset, [...(mediaByOffset.get(insertionOffset) || []), item])
    })

    const sections: AnswerContentSection[] = []
    let contentOffset = 0
    Array.from(mediaByOffset.keys()).sort((a, b) => a - b).forEach(insertionOffset => {
        sections.push({
            section_key: `answer_section_${sections.length}_${insertionOffset}`,
            content: content.slice(contentOffset, insertionOffset),
            media: mediaByOffset.get(insertionOffset) || []
        })
        contentOffset = insertionOffset
    })

    const trailingContent = content.slice(contentOffset)
    if (trailingContent || unplaced.length || sections.length === 0) {
        sections.push({
            section_key: `answer_section_${sections.length}_tail`,
            content: trailingContent,
            media: unplaced
        })
    }
    return sections
}

function openReferenceViewer(url: string) {
    const referenceUrl = absoluteReferenceUrl(url).replace(
        /\/references\/(cloud\/)?document(?=[?#]|$)/,
        '/references/$1viewer'
    )
    const webHost = String(app.globalData.qaHost || app.globalData.referenceHost || '').trim().replace(/\/$/, '')
    if (!referenceUrl || !/^https?:\/\//i.test(webHost)) {
        showError('参考文档阅读服务地址无效')
        return
    }
    const readerUrl = `${webHost}/docs/reader?client=miniprogram&entry=${Date.now()}&url=${encodeURIComponent(referenceUrl)}`
    app.globalData._refViewerUrl = readerUrl
    wx.navigateTo({
        url: '/pages/reference-viewer/reference-viewer',
        fail: err => {
            console.error('打开参考文档页面失败', err)
            showError('参考文档页面打开失败')
        }
    })
}

function trackAnalyticsEvent(eventName: string, pagePath: string, documentId?: string) {
    const token = wx.getStorageSync('pangoAccessToken') || ''
    if (!token) return
    wx.request({
        url: app.globalData.baseHost + '/analytics/track',
        method: 'POST',
        header: {
            'content-type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        data: {
            eventName,
            pagePath,
            clientType: 'MINIPROGRAM',
            sessionId: app.globalData.sessionId || undefined,
            documentId
        }
    })
}

function isGuestUser(user: any): boolean {
    return Boolean(user && String(user.userType || '').toUpperCase() === 'GUEST')
}

function isAuthenticatedUser(user: any): boolean {
    return Boolean(user && Number(user.setId) > 0 && !isGuestUser(user))
}

Page({
    /**
     * 页面的初始数据
     */
    data: {
        userInfo: wx.getStorageSync("userInfo"),
        pageTitle: "Pango慧答",           //标题名称
        aiName: "智能助手",
        pageLeftIconName: "gengduo",        //标题左侧的图标
        flagShowSetPanel: false,            //底部菜单是否显示
        dataDayTitle: [],                    //历史对话问题列表
        dataHisTitle: [],                     //历史对话问题列表
        bottomText: '内容由AI生成，仅供参考',                  //底部文字
        questionContent: '',                                   //问题
        sessionList: [] as any,                                 //会话列表
        scrollToId: '',                                          //底部锚点ID
        flagShowAnwser: true,                                   //显示回答面板
        flagStart: false,                                        //开始回答标识
        answerContent: "",                                        //实时的回答内容
        requestTask: null as any,
        streamThink: '' as string,
        streamContent: '' as string,
        streamContentData: '' as string, //原始数据不带markdown格式
        scrollTop: 999,
        dots: [
            { opacity: 0.3, scale: 0.5 },
            { opacity: 0.5, scale: 0.7 },
            { opacity: 0.7, scale: 0.9 },
            { opacity: 1, scale: 1 }
        ],
        timer: null as any,
        flagShowWait: false,
        ...createRuntimeState(),
        flagShowTip: true,
        tipData: [
            { content: "紫光同创FPGA芯片有哪些?" },
            { content: "在 PDS 中如何查看时序分析报告？" },
        ],
        // isTestVersion: true,
        // isWebSearchEnabled: false, //是否开启联网搜索
        userScrolledUp: false, //用户是否手动上滑打断自动滚底
        uploadImages: [] as QuestionImage[],
        flagDoReady: false,     //问题内容框是否为空标识
        inputHeight: 40,     //问题框的初始化高度

        keyboardPadding: 0,
        cursorPos: 0,
        _inputFocused: false,
        flagVoiceMode: false,
        inputPlaceholder: '发消息或按住说话...',
        isRecording: false, //录音相关
        audioPath: '',        //录音相关
        luyunTipText: "按住 说话",
        flagLuyuning: false,
        startY: 0,
        startTime: 0,
        flagCancel: false,
        flagTalkOver: true,
        answerCount: 0, //当前用户的总数量
        feedbackVisible: false,
        feedbackSubmitting: false,
        feedbackMessageIndex: -1,
        feedbackTypeOptions: ['回答不准确', '没有解决问题', '内容过时', '引用资料有误', '其他问题'],
        feedbackType: '回答不准确',
        feedbackDetail: '',
        feedbackContactName: '',
        feedbackCompanyName: '',
        feedbackEmail: '',
        feedbackPhone: '',
        feedbackImage: null as QuestionImage | null,
        tagStyle: {
            // 标题样式
            'h1': 'font-size:36rpx;line-height:1.8;margin:24rpx 0;',
            'h2': 'font-size:32rpx;line-height:1.6;margin:20rpx 0;',
            // 段落样式
            'p': 'font-size:28rpx;color:#333;line-height:1.6;',
            // 列表样式
            'ul': 'padding-left:30rpx;',
            'ol': 'padding-left:30rpx;',
            'li': 'margin:5rpx 0rpx 5rpx 10rpx;',
            // 强调样式
            'strong': 'color:black;',
            'em': 'font-style:italic;',
            'pre': 'background:#f5f5f5;padding:12rpx;border-radius:8rpx;',
            'code': 'color:#121212;font-family:Consolas;',
            'table': 'border-collapse:collapse;width:100%;',
            'td': 'border:1px solid #eee;padding:8rpx;',
            'th': 'background:#f5f5f5;padding:12rpx;',
            'a': 'color:#07c160;text-decoration:underline;',
            'a:hover': 'color:#059e5c;',
            'del': 'text-decoration:none;',
        },
        latexOptions: {
            katex: {
                src: 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js',
                css: 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css'
            },
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
            ]
        },
    },

    openWiki() {
        trackAnalyticsEvent('wiki_view', '/pages/wiki/wiki')
        wx.switchTab({
            url: '/pages/wiki/wiki',
            fail: err => {
                console.error('打开文档中心页面失败', err)
                showError('文档中心页面打开失败')
            }
        })
    },

    openLicense() {
        wx.switchTab({
            url: '/pages/license/license',
            fail: err => {
                console.error('打开 License 申请页面失败', err)
                showError('License 申请页面打开失败')
            }
        })
    },

    noop() {},

    openFeedback(e: any) {
        this.setData({
            feedbackVisible: true,
            feedbackMessageIndex: Number(e.currentTarget.dataset.index),
            feedbackType: '回答不准确',
            feedbackDetail: '',
            feedbackContactName: '',
            feedbackCompanyName: '',
            feedbackEmail: '',
            feedbackPhone: '',
            feedbackImage: null
        })
    },

    closeFeedback() {
        if (this.data.feedbackSubmitting) return
        this.setData({ feedbackVisible: false, feedbackMessageIndex: -1 })
    },

    stopPropagation() {},

    chooseFeedbackType(e: any) {
        this.setData({ feedbackType: String(e.currentTarget.dataset.type || '') })
    },

    inputFeedbackField(e: any) {
        const field = String(e.currentTarget.dataset.field || '')
        if (!field) return
        this.setData({ [field]: e.detail.value })
    },

    chooseFeedbackImage() {
        if (this.data.feedbackImage) {
            wx.showModal({ title: '图片数量已达上限', content: '问题反馈最多上传 1 张图片。', showCancel: false })
            return
        }
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sizeType: ['compressed'],
            success: res => {
                const file = res.tempFiles?.[0]
                if (!file) return
                if (Number(file.size || 0) > MAX_UPLOAD_IMAGE_BYTES) {
                    wx.showModal({ title: '图片过大', content: '反馈图片不能超过 15MB，请压缩后重试。', showCancel: false })
                    return
                }
                const extension = (file.tempFilePath.split('.').pop() || 'png').toLowerCase()
                const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
                    wx.showModal({ title: '图片格式不支持', content: '反馈图片仅支持 JPEG、PNG 或 WebP。', showCancel: false })
                    return
                }
                try {
                    const base64 = wx.getFileSystemManager().readFileSync(file.tempFilePath, 'base64') as string
                    this.setData({
                        feedbackImage: {
                            mime_type: mimeType,
                            data_base64: base64,
                            filename: file.tempFilePath.split('/').pop() || `feedback.${extension}`,
                            local_url: file.tempFilePath
                        }
                    })
                } catch (_) {
                    wx.showToast({ title: '图片读取失败，请重试', icon: 'none' })
                }
            }
        })
    },

    previewFeedbackImage() {
        const url = this.data.feedbackImage?.local_url
        if (url) wx.previewImage({ current: url, urls: [url] })
    },

    removeFeedbackImage() {
        if (this.data.feedbackSubmitting) return
        this.setData({ feedbackImage: null })
    },

    submitFeedback() {
        if (this.data.feedbackSubmitting) return
        const detail = String(this.data.feedbackDetail || '').trim()
        if (!detail) {
            wx.showToast({ title: '请填写补充说明', icon: 'none' })
            return
        }
        const contactName = String(this.data.feedbackContactName || '').trim()
        if (!contactName) {
            wx.showToast({ title: '请填写联系人', icon: 'none' })
            return
        }
        const answerIndex = this.data.feedbackMessageIndex
        const answer = this.data.sessionList[answerIndex]
        let question: any = null
        for (let index = answerIndex - 1; index >= 0; index -= 1) {
            if (this.data.sessionList[index].flagAi === 0) {
                question = this.data.sessionList[index]
                break
            }
        }
        if (!answer || !question) {
            wx.showToast({ title: '无法关联本次问答', icon: 'none' })
            return
        }

        this.setData({ feedbackSubmitting: true })
        const userinfoId = this.data.userInfo && this.data.userInfo.id
        wx.request({
            url: app.globalData.baseHost + '/feedback/submit',
            method: 'POST',
            data: {
                userinfoId: userinfoId || null,
                sessionId: app.globalData.sessionId || '',
                platform: 'miniprogram',
                feedbackType: this.data.feedbackType,
                detail,
                questionContent: question.content || '',
                answerContent: answer.contentData || answer.content || '',
                feedbackImages: this.data.feedbackImage ? JSON.stringify([{
                    mime_type: this.data.feedbackImage.mime_type,
                    data_base64: this.data.feedbackImage.data_base64,
                    filename: this.data.feedbackImage.filename
                }]) : null,
                contactName,
                companyName: this.data.feedbackCompanyName,
                email: this.data.feedbackEmail,
                phone: this.data.feedbackPhone
            },
            success: (res: any) => {
                const result = res.data as { code?: number; message?: string }
                if (result && result.code === 2000) {
                    this.setData({ feedbackVisible: false, feedbackMessageIndex: -1, feedbackImage: null })
                    wx.showToast({ title: '感谢您的反馈', icon: 'success' })
                    return
                }
                wx.showToast({ title: result.message || '提交失败，请稍后重试', icon: 'none' })
            },
            fail: () => wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' }),
            complete: () => this.setData({ feedbackSubmitting: false })
        })
    },
    // 开始录音（长按输入框触发）
    startRecord(e: any) {
        if (this.data._inputFocused) return;
        if (!this.data.userInfo?.id) {
            showError("访客信息初始化中，请稍后重试")
            return
        }
        //判断是否未完善公司信息
        if (this.checkAnswerLimit()) return;
        if (!this.data.flagTalkOver) {
            showError(this.data.flagLuyuning ? "正在录音中，请先松开录音按钮" : "录音正在转文字，请稍后再试")
            return;
        }
        if (recorderState !== 'idle') {
            showError("录音组件正在恢复，请稍后再试")
            return
        }
        const intentVersion = ++recorderIntentVersion
        recordAuthorizationPending = true
        this.setData({
            audioPath: '', luyunTipText: "松开 结束",
            flagLuyuning: true, flagCancel: false,
            startY: (e.detail?.touches?.[0]?.clientY || e.touches?.[0]?.clientY || 0),
            startTime: Date.now(), flagTalkOver: false
        })
        wx.authorize({
            scope: 'scope.record',
            success: () => {
                if (intentVersion !== recorderIntentVersion) return
                recordAuthorizationPending = false
                // The press may already have been cancelled while waiting for
                // the asynchronous authorization result.
                if (!this.data.flagLuyuning || this.data.flagTalkOver) {
                    this.setData({ flagLuyuning: false, flagCancel: false, flagTalkOver: true })
                    return
                }
                this.startRecorderManager(recorderPreferredFormat)
            },
            fail: () => {
                if (intentVersion !== recorderIntentVersion) return
                recordAuthorizationPending = false
                recorderState = 'idle'
                this.setData({
                    luyunTipText: "按住 说话",
                    flagLuyuning: false,
                    flagTalkOver: true
                })
                this.showAuthModal()
            }
        })
    },
    startRecorderManager(format: 'aac' | 'mp3') {
        activeRecorderPage = this
        recorderState = 'starting'
        recorderFormat = format
        recorderAttemptStartedAt = Date.now()
        const encodeBitRate = format === 'aac' ? 48000 : 64000
        recorderManager.start({
            format,
            sampleRate: 16000,
            encodeBitRate,
            numberOfChannels: 1
        })
    },
    retryRecordingWithMp3(error: any) {
        console.warn('AAC录音启动失败，自动降级为MP3', error)
        if (!this.data.flagLuyuning || this.data.flagTalkOver) {
            this.setData({ flagCancel: false, flagTalkOver: true })
            return
        }
        // Keep the same press-to-talk interaction and retry once. MP3 is used
        // only on clients whose recorder cannot initialize AAC reliably.
        recorderPreferredFormat = 'mp3'
        this.startRecorderManager('mp3')
    },
    handleRecorderStopped(res: WechatMiniprogram.OnStopCallbackResult) {
        if (this.data.flagCancel) {
            this.setData({ flagCancel: false, flagTalkOver: true })
            return
        }
        if (!res.tempFilePath) {
            this.handleRecorderError({ errMsg: '未生成录音文件' })
            return
        }
        this.setData({
            audioPath: res.tempFilePath,
            luyunTipText: "按住 说话",
            flagLuyuning: false
        })
        this.uploadAudio(res.tempFilePath)
    },
    handleRecorderError(error: any) {
        console.error('录音失败', error)
        this.setData({
            audioPath: '',
            luyunTipText: "按住 说话",
            flagLuyuning: false,
            flagCancel: false,
            flagTalkOver: true
        })
        showError('录音失败，请重试')
    },
    cancelRecord(e: any) {
        const touch = e.touches?.[0] || e.changedTouches?.[0]
        if (!touch || !this.data.flagLuyuning || this.data.flagTalkOver) return
        const currentY = touch.clientY
        const moveY = this.data.startY - currentY
        const shouldCancel = moveY > 50
        if (shouldCancel) {
            recorderIntentVersion++
            recordAuthorizationPending = false
            showSuccess("已取消")
            this.setData({
                luyunTipText: "按住 说话",
                flagLuyuning: false,
                flagVoiceMode: false,
                flagCancel: true,
                flagTalkOver: true
            })
            this.stopRecorderManager()
        }
    },
    cancelRecordBySystem() {
        if (!this.data.flagLuyuning || this.data.flagTalkOver) return
        recorderIntentVersion++
        recordAuthorizationPending = false
        this.setData({
            luyunTipText: "按住 说话",
            flagLuyuning: false,
            flagCancel: true,
            flagTalkOver: true
        })
        this.stopRecorderManager()
    },
    uploadAudio(filePath: string) {
        wx.showLoading({ title: "转换文字中...", mask: true })
        wx.uploadFile({
            url: app.globalData.baseHost + '/wx/transcribe',
            filePath: filePath,
            name: 'audio',
            timeout: 90000,
            success: (res) => {
                if (res.statusCode === 200 && res.errMsg === "uploadFile:ok") {
                    try {
                        const payload: ApiResponse<SessionData | boolean | string> = JSON.parse(res.data)
                        const text = typeof payload.data === "object" && payload.data !== null
                            ? payload.data.text
                            : "";
                        if (payload.code === 2000 && text !== "") {
                            this.setData({
                                questionContent: text,
                                flagVoiceMode: false,
                                flagDoReady: text.trim() !== ''
                            })
                        } else if (payload.code !== 2000) {
                            const errorMessage = typeof payload.data === "string" && payload.data !== ""
                                ? payload.data
                                : payload.message || "录音解析失败";
                            showError(errorMessage)
                        } else {
                            showError("未识别到有效语音")
                        }
                    } catch {
                        showError("服务器返回数据格式错误")
                    }
                } else {
                    showError("录音解析失败")
                }
                wx.hideLoading()
                this.setData({
                    luyunTipText: "按住 说话",
                    flagLuyuning: false,
                    flagVoiceMode: false,
                    flagTalkOver: true
                })
            },
            fail: () => {
                wx.hideLoading()
                this.setData({
                    luyunTipText: "按住 说话",
                    flagLuyuning: false,
                    flagVoiceMode: false,
                    flagTalkOver: true
                })
                showError("超时,请检查网络连接")
            },
        })
    },
    // 停止录音
    stopRecord() {
        if (!this.data.flagLuyuning || this.data.flagTalkOver) return
        if (recordAuthorizationPending && recorderState === 'idle') {
            recorderIntentVersion++
            recordAuthorizationPending = false
            this.setData({
                luyunTipText: "按住 说话",
                flagLuyuning: false,
                flagCancel: false,
                flagTalkOver: true
            })
            return
        }
        const duration = Date.now() - this.data.startTime
        if (duration < 1000) {
            recorderIntentVersion++
            showError("录音时间太短")
            this.setData({
                luyunTipText: "按住 说话",
                flagLuyuning: false,
                flagVoiceMode: false,
                flagTalkOver: true,
                flagCancel: true,
            })
            this.stopRecorderManager()
            return;
        }
        // Do not wait for onStop before dismissing the recording overlay.
        // Keep flagTalkOver=false until transcription completes to prevent a
        // second recording from starting during upload.
        this.setData({
            luyunTipText: "按住 说话",
            flagLuyuning: false
        })
        this.stopRecorderManager()
    },
    stopRecorderManager() {
        if (recorderState === 'idle' || recorderState === 'stopping') return
        recorderState = 'stopping'
        clearRecorderStopFallback()
        recorderStopFallbackTimer = setTimeout(() => {
            if (recorderState !== 'stopping') return
            recorderState = 'idle'
            const page = activeRecorderPage
            activeRecorderPage = null
            if (!page) return
            if (page.data.flagCancel || page.data.flagTalkOver) {
                page.setData({ flagCancel: false, flagTalkOver: true })
                return
            }
            page.handleRecorderError({ errMsg: '停止录音超时' })
        }, 3000)
        recorderManager.stop()
    },
    // 录音权限引导
    showAuthModal() {
        wx.showModal({
            title: '权限申请',
            content: '需要麦克风权限才能录音',
            success(res) {
                if (res.confirm) wx.openSetting()
            }
        })
    },
    deleteHistoryItem(e: any) {
        const sessionId = String(e.detail?.sessionId || '').trim()
        const userId = this.data.userInfo?.id
        if (!sessionId || !userId) return

        wx.showModal({
            title: '删除历史对话',
            content: '确定删除这条历史对话吗？',
            confirmText: '删除',
            success: (res) => {
                if (!res.confirm) return
                const token = String(wx.getStorageSync('pangoAccessToken') || '').trim()
                if (!token) {
                    showError('登录状态已失效，请重新登录')
                    return
                }
                wx.showLoading({ title: '删除中...', mask: true })
                wx.request({
                    url: app.globalData.baseHost + '/question/hideHistory',
                    method: 'POST',
                    header: {
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    data: { userinfoId: userId, sessionId },
                    success: async (response) => {
                        const result = response.data as ApiResponse<unknown>
                        if (response.errMsg !== 'request:ok' || result?.code !== 2000) {
                            showError(result?.message || '删除历史记录失败')
                            return
                        }
                        await this.refreshHistoryList()
                        if (String(app.globalData.sessionId || '') === sessionId) {
                            this.reloadSession({ silent: true })
                        }
                        wx.showToast({ title: '历史对话已删除', icon: 'success' })
                    },
                    fail: () => showError('删除历史记录失败'),
                    complete: () => wx.hideLoading()
                })
            }
        })
    },
    showLeftPanel() {
        //调用子组件的方法
        const leftPanel = this.selectComponent('#leftPanel');
        leftPanel.showLeftPanel();
        leftPanel.doClearChoose();
        void this.refreshHistoryList()
    },
    async refreshHistoryList() {
        if (!this.data.userInfo?.id) return
        const data = await this.getHisData()
        const rs: ApiResponse<questionList> | null = data ? JSON.parse(JSON.stringify(data)) : null
        if (!rs || rs.code !== 2000) return
        this.setData({
            dataDayTitle: rs.data.todayQuestion || [],
            dataHisTitle: rs.data.weekQuestion || [],
            answerCount: rs.data.count || 0
        })
        app.globalData.flagCompanyInfo = rs.data.flagCompanyInfo
    },
    // 显示底部弹窗
    showSetPanel() {
        const setPanel = this.selectComponent('#setPanel') as any
        if (setPanel?.showSetPanel) setPanel.showSetPanel()
    },
    syncUserInfoFromStorage() {
        const stored = wx.getStorageSync('userInfo')
        if (stored && stored.id && Number(stored.id) !== Number(this.data.userInfo?.id)) {
            this.setData({ userInfo: stored })
        }
    },
    logout() {
        const token = String(wx.getStorageSync('pangoAccessToken') || '').trim()
        if (token) {
            wx.request({
                url: app.globalData.baseHost + '/auth/logout',
                method: 'POST',
                header: { 'Authorization': `Bearer ${token}` },
                complete: () => {}
            })
        }

        wx.removeStorageSync('pangoAccessToken')
        wx.removeStorageSync('userInfo')
        wx.removeStorageSync('userImg')
        app.globalData.flagLogin = false

        this.setData({
            userInfo: null,
            dataDayTitle: [],
            dataHisTitle: [],
            answerCount: 0
        })

        const leftPanel = this.selectComponent('#leftPanel') as any
        if (leftPanel?.resetAuthentication) leftPanel.resetAuthentication()

        const setPanel = this.selectComponent('#setPanel') as any
        if (setPanel?.hideSetPanel) setPanel.hideSetPanel()

        wx.showToast({ title: '已退出登录', icon: 'success' })
        void this.refreshUserAndHistory()
    },
    //快速提问
    fastSearch(e: any) {
        let content = e.currentTarget.dataset.content;
        this.setData({ questionContent: content })
        this.doSearch()
    },
    changeInMode() {
        //判断是否有正在回答中的
        if (this.data.flagStart) {
            showError("正在回答中，请勿重复")
        }
        //不能为空值
        const ready = this.data.questionContent.trim() !== ''
        this.setData({ flagVoiceMode: false, flagDoReady: ready })
    },
    onInputFocus() {
        this.setData({ _inputFocused: true, inputPlaceholder: '发消息...' });
    },
    onInputBlur() {
        this.setData({ _inputFocused: false, inputPlaceholder: '发消息或按住说话...' });
    },
    toggleVoiceMode() {
        if (this.data.flagStart) return;
        const next = !this.data.flagVoiceMode;
        this.setData({
            flagVoiceMode: next,
            luyunTipText: next ? '按下 说话' : '按住 说话',
            flagLuyuning: false,
        });
    },
    chooseImage() {
        if (this.data.uploadImages.length >= 1) {
            wx.showModal({
                title: '图片数量已达上限',
                content: '每次提问只能上传 1 张图片，请删除已有图片后再添加。',
                showCancel: false,
                confirmText: '我知道了'
            })
            return
        }
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sizeType: ['compressed'],
            success: (res) => {
                const files = res.tempFiles;
                if (files.some(file => Number(file.size || 0) > MAX_UPLOAD_IMAGE_BYTES)) {
                    wx.showModal({
                        title: '图片过大',
                        content: '单张图片不能超过 15MB，请压缩图片后重试。',
                        showCancel: false,
                        confirmText: '我知道了'
                    })
                    return
                }
                const newImages: QuestionImage[] = [];
                let loaded = 0;
                files.forEach((file) => {
                    const fs = wx.getFileSystemManager();
                    const base64 = fs.readFileSync(file.tempFilePath, 'base64');
                    const mimeType = file.fileType === 'image' ? `image/${(file.tempFilePath.split('.').pop() || 'png').replace('jpg', 'jpeg')}` : 'image/png';
                    newImages.push({
                        mime_type: mimeType,
                        data_base64: base64,
                        filename: file.tempFilePath.split('/').pop() || 'upload.png',
                        local_url: file.tempFilePath
                    });
                    loaded++;
                    if (loaded === files.length) {
                        const images = [...this.data.uploadImages, ...newImages];
                        this.setData({
                            uploadImages: images,
                            flagDoReady: this.data.questionContent.trim() !== ''
                        });
                    }
                });
                if (files.length === 0) {
                    this.setData({ flagDoReady: this.data.questionContent.trim() !== '' });
                }
            }
        });
    },
    removeImage(e: any) {
        const index = e.currentTarget.dataset.index;
        const images = [...this.data.uploadImages];
        images.splice(index, 1);
        this.setData({
            uploadImages: images,
            flagDoReady: this.data.questionContent.trim() !== ''
        });
    },
    previewChatImage(e: any) {
        const { images, index } = e.currentTarget.dataset;
        if (!images || !images.length) return;
        const urls = images.map((img: { mime_type: string; data_base64: string; local_url?: string }) =>
            img.local_url || `data:${img.mime_type};base64,${img.data_base64}`
        );
        wx.previewImage({
            current: urls[index] || urls[0],
            urls
        });
    },
    previewReferenceFigure(e: any) {
        trackAnalyticsEvent('answer_image_view', '/pages/main/main')
        const messageIndex = Number(e.currentTarget.dataset.messageIndex)
        const media = this.data.sessionList?.[messageIndex]?.answerMedia || []
        const urls = media.map((item: AnswerMedia) => item.absoluteUrl).filter(Boolean)
        if (!urls.length) return
        const currentUrl = String(e.currentTarget.dataset.url || '')
        wx.previewImage({
            current: urls.includes(currentUrl) ? currentUrl : urls[0],
            urls
        })
    },
    //执行查询
    doSearch() {
        this.syncUserInfoFromStorage()
        if (!this.data.userInfo?.id) {
            showError("访客信息初始化中，请稍后重试")
            return
        }
        const content = String(this.data.questionContent || '').trim()
        if (!content) {
            showError(this.data.uploadImages.length > 0
                ? "请先输入问题文字，图片需要配合文字一起发送"
                : "请输入问题内容")
            return
        }
        //判断是否未完善公司信息
        if (this.checkAnswerLimit()) return;
        //判断是否有正在回答中的
        if (this.data.flagStart) {
            showError("正在回答中，请勿重复")
            return;
        }
        this.addQuestion()
        this.startStreaming(content)
        //移动到最底部
        this.toBottom();
    },
    addQuestion() {
        let content = this.data.questionContent || '';
        let row = {
            flagAi: 0,
            content: content,
            images: this.data.uploadImages.length > 0 ? [...this.data.uploadImages] : [],
            time: formatTime(new Date())
        };
        let tmpList = [...this.data.sessionList, row]; // 创建新数组
        //let his = { question: content }
        //let hisList = [his, ...this.data.dataDayTitle];
        //this.setData({ sessionList: tmpList, dataDayTitle: hisList })
        this.setData({ sessionList: tmpList })
        // 问题由 /dialogue/stream-answer 在后端统一持久化，避免重复写入。
    },

    /**
     * 统一模型回答中的 Markdown 块级间距，保持与 Web 端一致。
     */
    fixMarkdownTableSpacing(md: string): string {
      const lines = md.split(/\r?\n/);
      const fixed: string[] = [];
      let inCodeFence = false;

      for (let i = 0; i < lines.length; i++) {
        let current = lines[i];
        const currentTrimmed = current.trim();

        if (/^(```|~~~)/.test(currentTrimmed)) {
          inCodeFence = !inCodeFence;
          fixed.push(current);
          continue;
        }

        if (inCodeFence) {
          fixed.push(current);
          continue;
        }

        // CommonMark 标题标记后必须有空格，兼容模型返回的“###标题”。
        current = current.replace(/^(\s{0,3}#{1,6})(?=[^\s#])/, '$1 ');

        const normalizedTrimmed = current.trim();
        const nextTrimmed = (lines[i + 1] ?? '').trim();
        const currentIsTable = normalizedTrimmed.startsWith('|');
        const previousIsTable = fixed.length > 0
          && fixed[fixed.length - 1].trim().startsWith('|');
        const nextIsTable = nextTrimmed.startsWith('|');
        const currentIsHeading = /^#{1,6}(?:\s+|$)/.test(normalizedTrimmed);
        const currentIsEmphasisHeading = /^(\*{2,3}|_{2,3})\S(?:.*?\S)?\1(?:<sup\b[^>]*>.*?<\/sup>)?[：:]?$/.test(normalizedTrimmed);
        const currentStartsWithEmphasis = /^(\*{2,3}|_{2,3})\S.*?\1(?=<sup\b|[：:\s（(]|$)/.test(normalizedTrimmed);
        const currentIsThematicBreak = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(normalizedTrimmed);
        const currentNeedsLeadingSpacing = currentIsTable
          || currentIsHeading
          || currentStartsWithEmphasis
          || currentIsThematicBreak;
        const currentNeedsTrailingSpacing = currentIsTable
          || currentIsHeading
          || currentIsEmphasisHeading
          || currentIsThematicBreak;

        if (currentNeedsLeadingSpacing && fixed.length > 0) {
          const previous = fixed[fixed.length - 1] ?? '';
          if (previous.trim() !== '' && !(currentIsTable && previousIsTable)) fixed.push('');
        }

        // 普通 Markdown 换行会折叠为空格；将代码块外的所有软换行转成硬换行。
        const shouldForceHardBreak = i < lines.length - 1
          && normalizedTrimmed !== ''
          && nextTrimmed !== '';
        fixed.push(shouldForceHardBreak ? `${current.trimEnd()}  ` : current);

        if (
          currentNeedsTrailingSpacing
          && nextTrimmed !== ''
          && !(currentIsTable && nextIsTable)
        ) fixed.push('');
      }

      return fixed.join('\n');
    },

    // 流式显示内容
    onReceiveChunk(
      text: string,
      mode: 'append' | 'replace' = 'append',
      onRendered?: () => void
    ) {
        if (!text || (mode === 'replace' && text === this.data.streamContentData)) {
          if (onRendered) onRendered()
          return
        }
        // let accumulatedAnswer = '';
        if (mode === 'replace') {
          this.data.streamContentData = text
        } else {
          this.data.streamContentData += text
        }
        //const content = marked.parse(chunk);
        this.data.streamContentData = this.fixMarkdownTableSpacing(this.data.streamContentData)
        this.setData({
            // streamContent: chunk, // 覆盖内容
            streamContent: this.data.streamContentData
        }, () => {
            if (!pendingScroll) {
                pendingScroll = true;
                setTimeout(() => {
                    this.smartScroll();
                    pendingScroll = false;
                }, 50); // 控制滚动更新频率
            }
            if (onRendered) onRendered()
        });
        return;
    },
    enqueueStreamChunk(text: string) {
      if (!text) return
      streamDisplayQueue.push(text)
      this.scheduleStreamDisplayDrain()
    },
    scheduleStreamDisplayDrain() {
      if (streamDisplayTimer !== null || streamDisplayRendering) return
      if (streamDisplayQueue.length === 0) {
        this.finishStreamDisplayIfReady()
        return
      }
      const generation = streamDisplayGeneration
      streamDisplayTimer = setTimeout(() => {
        if (generation !== streamDisplayGeneration) return
        streamDisplayTimer = null
        this.drainStreamDisplayQueue(generation)
      }, STREAM_RENDER_INTERVAL_MS)
    },
    drainStreamDisplayQueue(generation: number) {
      if (generation !== streamDisplayGeneration || streamDisplayRendering) return
      if (streamDisplayQueue.length === 0) {
        this.finishStreamDisplayIfReady()
        return
      }

      let batchSize = 1
      if (streamDisplayCompleteRequested && streamDisplayDeadline > 0) {
        const remainingMs = Math.max(
          STREAM_RENDER_INTERVAL_MS,
          streamDisplayDeadline - Date.now()
        )
        const remainingTicks = Math.max(
          1,
          Math.floor(remainingMs / STREAM_RENDER_INTERVAL_MS)
        )
        batchSize = Math.ceil(streamDisplayQueue.length / remainingTicks)
      }
      batchSize = Math.max(1, Math.min(STREAM_RENDER_MAX_BATCH, batchSize))

      const displayText = streamDisplayQueue.splice(0, batchSize).join('')
      streamDisplayRendering = true
      this.onReceiveChunk(displayText, 'append', () => {
        if (generation !== streamDisplayGeneration) return
        streamDisplayRendering = false
        if (streamDisplayQueue.length > 0) {
          this.scheduleStreamDisplayDrain()
        } else {
          this.finishStreamDisplayIfReady()
        }
      })
    },
    requestStreamDisplayCompletion() {
      streamDisplayCompleteRequested = true
      streamDisplayDeadline = Date.now() + STREAM_RENDER_MAX_TAIL_MS
      if (!streamDisplayRendering && streamDisplayQueue.length === 0) {
        this.finishStreamDisplayIfReady()
        return
      }
      this.scheduleStreamDisplayDrain()
    },
    finishStreamDisplayIfReady() {
      if (!streamDisplayCompleteRequested || streamDisplayRendering || streamDisplayQueue.length > 0) {
        return
      }
      streamDisplayCompleteRequested = false
      streamDisplayDeadline = 0
      this.stopStreaming()
    },
    hideWaitingForAnswer() {
      if (!this.data.flagShowWait) return;
      if (this.data.timer !== null) {
        clearInterval(this.data.timer)
      }
      this.setData({
        flagShowWait: false,
        timer: null
      })
    },
    updateProgress(statusText: string, phase?: unknown) {
      if (!statusText) return;
      const incoming = createAgentProgress(statusText, phase)
      const current = createAgentProgress(this.data.currentStatusText, this.data.currentPhase)
      const next = advanceAgentProgress(current, incoming)
      this.setData({
        currentPhase: next.phase,
        currentStatusText: next.title,
        currentStatusDetail: next.detail,
        hasReceivedAgentProgress: true,
      }, () => {
        this.smartScroll()
      });
    },
    startStreaming(content: string) {
      resetStreamDisplayQueue()
      const imagesToSend = this.data.uploadImages.length > 0
        ? this.data.uploadImages.map(image => ({
            mime_type: image.mime_type,
            data_base64: image.data_base64,
            filename: image.filename
          }))
        : null

      this.setData({
        flagStart: true,
        flagShowAnwser: true,
        flagShowWait: true,
        userScrolledUp: false,
        uploadImages: [],
        questionContent: '',
        streamThink: "",
        streamContent: "",
        streamContentData: "",
        ...createRuntimeState()
      })

      ignoreScrollUntil = Date.now() + 500;

      lastChunkTime = Date.now()
      setStreamTimeout(this, 'first-frame')

      let url = app.globalData.sessionUrl

      // if (this.data.isTestVersion) {
      //   url = app.globalData.sessionUrl_choose
      // }

      if (app.globalData.sessionId === null || app.globalData.sessionId === '') {
        this.getSessionId()
      }

      const activeUser = wx.getStorageSync('userInfo') || this.data.userInfo
      const data: Record<string, unknown> = {
        userinfoId: activeUser ? activeUser.id : null,
        question: content,
        quote: app.globalData.quote,
        conversation_id: this.data.isTestVersion
          ? app.globalData.conversationId_choose
          : app.globalData.conversationId,
        session_id: app.globalData.sessionId,
        client_type: 'MINIPROGRAM',
        limit: 5
      }
      if (imagesToSend) {
        data.images = imagesToSend
      }

      const header = {
        'content-type': 'application/json',
        'Authorization': `Bearer ${wx.getStorageSync('pangoAccessToken') || ''}`
      }

      let frameCount = 0
      let terminalReceived = false
      this.data.requestTask = streamUtils.fetchStream(
        url,
        data,
        header,
        chunk => {
          if (chunk === '') return

          let raw = String(chunk).trim()
          if (!raw) return

          lastChunkTime = Date.now()
          setStreamTimeout(this, 'idle')
          frameCount++
          // const preview = raw.length > 80 ? raw.substring(0, 80) + '...' : raw

          if (raw === '[DONE]') {
            terminalReceived = true
            console.log(`[frame] #${frameCount} [DONE]`)
            this.requestStreamDisplayCompletion()
            return
          }

          let payload: any = null

          try {
            payload = JSON.parse(raw)
            if (payload.code === 4290) {
              resetStreamDisplayQueue()
              this.stopStreaming(true)
              showError(payload.message || '访客体验次数已用完，请登录后继续使用')
              return
            }
            if (typeof payload.code === 'number' && payload.code !== 0) {
              const message = String(payload.message || '请求失败，请稍后重试')
              const shouldReauthenticate = /登录状态|访问令牌|身份不匹配|未登录|token/i.test(message)
              this.handleStreamFailure(message, shouldReauthenticate ? 'reauthenticate' : null)
              return
            }
            if (payload.data?.status) {
              console.log(`[frame] #${frameCount} status: ${payload.data.status}`)
            } else if (payload.data?.answer) {
              console.log(`[frame] #${frameCount} answer: ${payload.data.answer}`)
            } else if (payload.data === true) {
              console.log(`[frame] #${frameCount} terminal`)
            } else if (payload.event === 'message') {
              const text = payload.data?.content || ''
              console.log(`[frame] #${frameCount} agent-message: len=${text.length}`)
            } else {
              console.log(`[frame] #${frameCount} other: ${payload.data.answer}`)
            }
          } catch (e) {
            // 纯文本 stream-answer：通常是累计文本，直接替换显示
            this.hideWaitingForAnswer()
            this.onReceiveChunk(raw, 'replace')
            return
          }

          if (payload.data?.status) {
            this.hideWaitingForAnswer()
            this.updateProgress(payload.data.status, payload.data.phase)
            return
          }

          if (payload.data?.answer) {
            this.hideWaitingForAnswer()
            if (this.data.currentPhase !== 'answer') {
              this.updateProgress("正在生成回答...", 'answer')
            }
            this.enqueueStreamChunk(String(payload.data.answer))
            return
          }

          if (payload.data === true || payload.answer_replace) {
            terminalReceived = true
            const finalAnswer = String(payload.answer || '')
          
            if (payload.answer_replace && finalAnswer) {
              resetStreamDisplayQueue()
              const fixedAnswer = this.fixMarkdownTableSpacing(finalAnswer)
          
              this.data.streamContentData = fixedAnswer
              this.data.streamContent = fixedAnswer
          
              this.setData({
                streamContentData: fixedAnswer,
                streamContent: fixedAnswer,
                currentReference: normalizeReference(payload.reference, payload.structured_citations),
                currentAnswerMedia: normalizeAnswerMedia(payload.answer_media),
                currentStructuredCitations: payload.structured_citations || [],
                currentQuestionTrace: payload.question_trace || null
              }, () => {
                this.smartScroll()
                this.stopStreaming()
              })
            } else {
              this.setData({
                currentReference: normalizeReference(payload.reference, payload.structured_citations),
                currentAnswerMedia: normalizeAnswerMedia(payload.answer_media),
                currentStructuredCitations: payload.structured_citations || [],
                currentQuestionTrace: payload.question_trace || null
              }, () => {
                this.requestStreamDisplayCompletion()
              })
            }
            return
          }

          // RAGFlow Agent event 格式
          if (payload.event === 'message') {
            const text = payload.data?.content || ''
            this.hideWaitingForAnswer()
            if (this.data.currentPhase !== 'answer') {
              this.updateProgress('正在生成回答...', 'answer')
            }
            this.enqueueStreamChunk(String(text))
            return
          }
        },
        err => {
          if (terminalReceived) {
            // The answer is already complete. Some WeChat clients still report
            // a transport failure while the final UI batch is being rendered.
            this.requestStreamDisplayCompletion()
            return
          }
          console.error('流式请求异常', err)
          const message = String(err?.message || '请求失败，请稍后重试')
          const shouldReauthenticate = err?.statusCode === 401 || err?.statusCode === 403 ||
            /登录状态|访问令牌|身份不匹配|未登录|token/i.test(message)
          this.handleStreamFailure(message, shouldReauthenticate ? 'reauthenticate' : null)
        },
        () => {
          // A transport can close cleanly without delivering the terminal frame.
          // Finish already received plain-text content, otherwise recover the
          // answer persisted by Java instead of leaving the UI waiting forever.
          if (!terminalReceived && this.data.flagStart) {
            if (this.data.streamContentData || streamDisplayQueue.length > 0) {
              this.requestStreamDisplayCompletion()
            } else {
              this.handleStreamFailure('连接提前结束，正在尝试恢复回答')
            }
          }
        }
      )
    },
    showReenterMiniProgramGuide(message?: string) {
        wx.showModal({
            title: '连接状态异常',
            content: message || '长时间未收到服务响应，登录状态或连接可能已失效。请点击右上角“…”菜单，选择“重新进入小程序”后再试。',
            showCancel: false,
            confirmText: '我知道了'
        })
    },
    showReauthenticateGuide(message: string) {
        // 旧 token 与本地 userInfo 会让左侧菜单继续显示为“已登录”，从而隐藏
        // 授权按钮。这里只清理失效的登录态，保留 pangoGuestKey 和访客额度。
        wx.removeStorageSync('pangoAccessToken')
        wx.removeStorageSync('userInfo')
        app.globalData.flagLogin = false
        this.setData({
            userInfo: null,
            dataDayTitle: [],
            dataHisTitle: [],
            answerCount: 0
        })
        const leftPanel = this.selectComponent('#leftPanel') as any
        if (leftPanel?.resetAuthentication) leftPanel.resetAuthentication()

        wx.showModal({
            title: '账号状态异常',
            content: `${message}。已清除失效的登录状态，点击确定后请在左侧重新授权登录。`,
            showCancel: false,
            confirmText: '重新授权',
            success: () => {
                if (leftPanel?.showLeftPanel) leftPanel.showLeftPanel()
            }
        })
    },
    handleStreamFailure(message: string, recovery: 'reauthenticate' | null = null) {
        if (!this.data.flagStart && !this.data.requestTask) return
        resetStreamDisplayQueue()
        clearStreamTimeout()
        lastChunkTime = 0
        const task = this.data.requestTask
        // abort() may synchronously trigger the request fail callback. Mark the
        // stream inactive first so cleanup and the recovery prompt only run once.
        this.data.requestTask = null
        this.data.flagStart = false
        if (task) {
            try { task.offHeadersReceived() } catch (_) {}
            try { task.offChunkReceived() } catch (_) {}
            try { task.abort() } catch (_) {}
        }
        if (this.data.timer !== null) clearInterval(this.data.timer)
        this.setData({
            flagCai: false,
            flagZan: false,
            flagDoReady: false,
            flagStart: false,
            flagShowAnwser: false,
            flagShowWait: false,
            userScrolledUp: false,
            requestTask: null,
            timer: null,
            streamThink: '',
            streamContent: '',
            streamContentData: '',
            ...createRuntimeState()
        }, () => {
            if (recovery === 'reauthenticate') {
                this.showReauthenticateGuide(message)
            } else {
                void this.recoverCurrentSessionAnswer().then((recovered: boolean) => {
                    if (recovered) {
                        wx.showToast({ title: '已恢复本次回答', icon: 'success' })
                    } else {
                        showError(message)
                    }
                })
            }
        })
    },
    // 停止接收流式数据
    stopStreaming(abortRequest = false) {
        resetStreamDisplayQueue()
        lastChunkTime = 0
        clearStreamTimeout()
        if (this.data.timer !== null) {
            clearInterval(this.data.timer)
        }
        const task = this.data.requestTask
        // Mark the request finished before aborting it. Some WeChat versions
        // synchronously invoke the fail callback from abort(), which otherwise
        // clears the answer that has just been appended to the conversation.
        this.data.requestTask = null
        this.data.flagStart = false
        if (task) {
            try {
                task.offHeadersReceived()
                task.offChunkReceived()
                if (abortRequest) task.abort()
            } catch (_) {
                // 小程序从后台切回时 requestTask 可能已被系统回收
            }
            this.setData({ requestTask: null })
        }
        if ((null === this.data.streamContentData || "" === this.data.streamContentData) &&
            (null === this.data.streamThink || "" === this.data.streamThink)) {
            this.setData({
              flagCai: false,
              flagZan: false,
              flagDoReady: false,
              flagStart: false,
              flagShowAnwser: false,
              flagShowWait: false,
              userScrolledUp: false,
              timer: null,
              ...createRuntimeState()
            });
            return;
        }
        let endDatetime = new Date()
        let endTime = formatTime(endDatetime) //定义结束时间，用于与用户iD作为入参，进行赞和踩
        let row = {
            flagAi: 1,
            think: this.data.streamThink,
            content: this.data.streamContent,
            contentData: this.data.streamContentData,
            time: endTime,
            flagEvaluate: 0,
            reference: this.data.currentReference,
            answerMedia: this.data.currentAnswerMedia,
            answerSections: placeMediaAfterCitations(this.data.streamContent, this.data.currentAnswerMedia),
            structuredCitations: this.data.currentStructuredCitations,
            questionTrace: this.data.currentQuestionTrace
        };
        let newList = [...this.data.sessionList, row]; // 创建新数组
        let newCount = this.data.answerCount + 1;
        this.setData({
            flagCai: false,
            flagZan: false,
            flagDoReady: false,
            flagStart: false,
            flagShowAnwser: false,
            flagShowWait: false,
            userScrolledUp: false,
            timer: null,
            streamThink: "",
            streamContent: "",
            streamContentData: "",
            sessionList: newList,
            answerCount: newCount,
            ...createRuntimeState()
        }, () => {
            // this.smartScroll() //移动到最底部
        });
    },
    toBottom() {
        ignoreScrollUntil = Date.now() + 500;
        this.setData({
            scrollToId: 'bottomAnchor',
            userScrolledUp: false
        }, () => {
            setTimeout(() => {
                this.setData({ scrollToId: '' })
            }, 50)
        })
    },
    onScroll(e: any) {
        if (Date.now() < ignoreScrollUntil) return;
        const { scrollTop, scrollHeight } = e.detail;
        const query = wx.createSelectorQuery().in(this);
        query.select('.scrollarea').boundingClientRect(rect => {
            if (!rect) return;
            const clientHeight = rect.height;
            const maxScroll = scrollHeight - clientHeight;
            const distFromBottom = maxScroll - scrollTop;
            const atBottom = distFromBottom < 50;
            if (this.data.userScrolledUp === atBottom) {
                this.setData({ userScrolledUp: !atBottom });
            }
        }).exec();
    },
    // 自动滚动
    smartScroll() {
        if (this.data.userScrolledUp) return;
        if (isScrolling) return;
        isScrolling = true;
        const query = wx.createSelectorQuery().in(this);
        query.select('.scrollarea').boundingClientRect(rect => {
            if (rect) {
                this.setData({
                    scrollTop: rect.height * 100
                });
            }
            isScrolling = false;
        }).exec();
    },
    startAnimation() {
        if (this.data.timer) clearInterval(this.data.timer);
        let timer = setInterval(() => {
            const newDots = [...this.data.dots];
            const lastDot = newDots.pop()
            if (lastDot) {
                newDots.unshift(lastDot)
            }
            this.setData({ dots: newDots })
        }, 100)
        this.setData({ timer: timer })
    },
    //复制正文内容
    doCopy(e: any) {
        let content = e.currentTarget.dataset.contentdata;
        if (content === null || content === "") {
            wx.showToast({ title: "暂无正文内容复制", icon: "none" })
            return;
        }
        copyToClipboard(content)
    },
    openReference(e: any) {
        const relUrl = e.currentTarget.dataset.url
        if (!relUrl) {
            showError("暂无可打开的参考文档")
            return
        }

        const baseUrl = absoluteReferenceUrl(relUrl)
        if (!baseUrl) {
            showError('参考文档地址未配置')
            return
        }
        const url = withMiniProgramClient(withSessionId(baseUrl, app.globalData.sessionId))
        const fallbackBaseUrl = absoluteReferenceUrl(e.currentTarget.dataset.fallbackUrl)
        const fallbackUrl = fallbackBaseUrl
            ? withMiniProgramClient(withSessionId(fallbackBaseUrl, app.globalData.sessionId))
            : ''

        // Prefer the backend viewer so large PDFs support paging and continuous reading.
        if (fallbackUrl) {
            openReferenceViewer(fallbackUrl)
            return
        }

        wx.showLoading({ title: "打开文档中...", mask: true })
        wx.downloadFile({
            url,
            success: res => {
                wx.hideLoading()
                if (res.statusCode === 200) {
                    wx.openDocument({
                        filePath: res.tempFilePath,
                        fileType: "pdf",
                        fail: () => {
                            showError('当前文档无法打开')
                        }
                    })
                } else {
                    showError("文档下载失败")
                }
            },
            fail: () => {
                wx.hideLoading()
                showError("文档下载失败")
            }
        })
    },
    openPageReference(e: any) {
        const relUrl = e.currentTarget.dataset.url
        if (!relUrl) {
            showError("暂无可打开的页面")
            return
        }
        const baseUrl = absoluteReferenceUrl(relUrl)
        if (!baseUrl) {
            showError('参考文档地址未配置')
            return
        }
        trackAnalyticsEvent('reference_open', '/pages/main/main')
        openReferenceViewer(withMiniProgramClient(withSessionId(baseUrl, app.globalData.sessionId)))
    },
    //开始新会话
    reloadSession(options?: { silent?: boolean }) {
        resetStreamDisplayQueue()
        lastChunkTime = 0
        clearStreamTimeout()
        //清除正在进行中的会话
        if (this.data.requestTask) {
            try {
                this.data.requestTask.offHeadersReceived()
                this.data.requestTask.offChunkReceived()
                this.data.requestTask.abort()
            } catch (_) {}
            this.setData({
                requestTask: null,
                flagDoReady: false,
                flagStart: false,
                flagShowAnwser: false,
                userScrolledUp: false,
                streamThink: "",
                streamContent: "",
                streamContentData: "",
                ...createRuntimeState()
            })
        }
        //清除sessionList
        this.setData({
            sessionList: [],
            ...createRuntimeState()
        })
        //刷新session
        this.getSessionId(true)
        if (!options?.silent) showSuccess("已切换新对话")
    },
    //根据问题ID查询回答对象
    doSearchHisItem(e: any) {
        const sessionId = e.detail.sessionId
        wx.request({
            url: app.globalData.baseHost + '/question/findBySessionId',
            method: 'POST',
            data: { userinfoId: this.data.userInfo.id, sessionId },
            success: (res) => {
                let rs: ApiResponse<any[]> = JSON.parse(JSON.stringify(res.data));
                if (res.errMsg === "request:ok" && rs.code === 2000) {
                    // 切换历史记录时终止当前流，避免后续分片混入历史会话。
                    resetStreamDisplayQueue()
                    lastChunkTime = 0
                    clearStreamTimeout()
                    if (this.data.requestTask) {
                        try {
                            this.data.requestTask.offHeadersReceived()
                            this.data.requestTask.offChunkReceived()
                            this.data.requestTask.abort()
                        } catch (_) {}
                    }
                    //隐藏侧面板
                    const leftPanel = this.selectComponent('#leftPanel');
                    leftPanel.hideLeftPanel();
                    //填充问题与答案
                    app.globalData.sessionId = sessionId
                    const historyRows = this.buildSessionHistoryRows(rs.data || [])
                    this.setData({
                        // 历史记录是一次会话切换，不追加到当前会话。
                        sessionList: historyRows,
                        requestTask: null,
                        flagDoReady: false,
                        flagStart: false,
                        flagShowAnwser: false,
                        userScrolledUp: false,
                        streamThink: "",
                        streamContent: "",
                        streamContentData: "",
                        ...createRuntimeState()
                    }, () => {
                        this.smartScroll() //移动到最底部
                    });
                }
            }
        });
    },
    // 判断当前用户的使用条数是否>最大免费条数
    checkAnswerLimit() {
        const isGuest = isGuestUser(this.data.userInfo)
        const limit = isGuest ? GUEST_ANSWER_LIMIT : LOGIN_ANSWER_LIMIT

        if (isGuest && this.data.answerCount >= limit) {
            wx.showToast({
                title: "访客体验次数已用完，请登录后继续使用",
                duration: 5000,
                icon: "none"
            })
            return true
        }

        if (!isGuest && !app.globalData.flagCompanyInfo && this.data.answerCount >= limit) {
            wx.showToast({
                title: "免费提问次数已用完，请完善公司信息后继续使用",
                duration: 5000,
                icon: "none"
            })
            return true
        }
        return false;
    },
    async refreshUserAndHistory() {
        //判断是否有登录授权
        let info = wx.getStorageSync("userInfo")
        info = await this.resolveAuthenticatedUser(info)
        if (isAuthenticatedUser(info)) {
            this.setData({userInfo: info})
            //查询历史对话
            const data = await this.getHisData()
            let rs: ApiResponse<questionList> = JSON.parse(JSON.stringify(data));
            if (rs.code === 2000) {
                this.setData({
                    dataDayTitle: rs.data.todayQuestion || [],
                    dataHisTitle: rs.data.weekQuestion || [],
                    answerCount: rs.data.count
                })
                app.globalData.flagCompanyInfo = rs.data.flagCompanyInfo;
            }
        } else {
            info = await this.getOrCreateGuestUser()
            if (info?.id) {
                this.setData({ userInfo: info })
                const data = await this.getHisData()
                const rs: ApiResponse<questionList> = JSON.parse(JSON.stringify(data))
                if (rs && rs.code === 2000) {
                    this.setData({
                        dataDayTitle: rs.data.todayQuestion || [],
                        dataHisTitle: rs.data.weekQuestion || [],
                        answerCount: rs.data.count || 0
                    })
                }
            }
        }
    },
    handleRefresh(){
        void this.refreshUserAndHistory()
    },
    /**
     * 生命周期函数--监听页面加载
     */
    async onLoad() {
        // A newly created Q&A page always starts a new conversation. The page
        // remains alive while opening Wiki/reference pages, so navigateBack()
        // keeps the current conversation. Selecting history explicitly replaces
        // this id in doSearchHisItem(), allowing follow-up questions there.
        this.getSessionId(true)
        await this.refreshUserAndHistory()
        const EXTRA_OFFSET = 0; // 键盘顶部与输入框之间的额外间距
        wx.onKeyboardHeightChange(res => {
            const newPadding = res.height > 0 ? res.height + EXTRA_OFFSET : 0
            this.setData({ keyboardPadding: newPadding }, () => {
                // 键盘弹出时自动滚到底，使最新消息始终在输入框上方可见
                if (newPadding > 0) {
                    this.toBottom()
                }
            })
        })
        trackAnalyticsEvent('page_view', '/pages/main/main')
    },
    buildSessionHistoryRows(items: any[]) {
        const historyRows: any[] = []
        ;(items || []).forEach((item: any) => {
            historyRows.push({
                flagAi: 0,
                content: item.question,
                time: item.dotime || '',
                images: normalizeQuestionImages(item.questionImages || item.question_images)
            })
            if (item.answer) {
                const answerContent = this.fixMarkdownTableSpacing(item.answer.content || '')
                const answerMedia = normalizeAnswerMedia(item.answer.answerMedia || item.answer.answer_media)
                historyRows.push({
                    flagAi: 1,
                    content: answerContent,
                    contentData: answerContent,
                    time: item.answer.dotime,
                    answerTime: item.answer.answerTime || item.answer.dotime,
                    flagEvaluate: item.answer.flagEvaluate,
                    reference: normalizeReference(item.answer.reference),
                    answerMedia,
                    answerSections: placeMediaAfterCitations(answerContent, answerMedia)
                })
            }
        })
        return historyRows
    },
    async recoverCurrentSessionAnswer() {
        const sessionId = String(app.globalData.sessionId || '')
        const userId = this.data.userInfo?.id
        if (!sessionId || !userId) return false

        for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000))
            }
            try {
                const res: any = await new Promise((resolve, reject) => {
                    wx.request({
                        url: app.globalData.baseHost + '/question/findBySessionId',
                        method: 'POST',
                        data: { userinfoId: userId, sessionId },
                        success: resolve,
                        fail: reject
                    })
                })
                const result = res.data as ApiResponse<any[]>
                const rows = result?.code === 2000 ? (result.data || []) : []
                const latestQuestion = rows.length > 0 ? rows[rows.length - 1] : null
                // A multi-turn session may contain older answers. Recovery is
                // successful only when the latest question has its own answer.
                if (!latestQuestion?.answer) continue
                // Do not let a late recovery overwrite a newly opened session
                // or a new request that the user has already submitted.
                if (String(app.globalData.sessionId || '') !== sessionId || this.data.flagStart) return false
                const historyRows = this.buildSessionHistoryRows(rows)
                this.setData({ sessionList: historyRows }, () => this.toBottom())
                const history = await this.getHisData()
                if (history?.code === 2000) {
                    this.setData({ answerCount: history.data.count || 0 })
                }
                return true
            } catch (error) {
                console.warn('自动恢复当前会话失败', error)
            }
        }
        return false
    },
    async resolveAuthenticatedUser(localUser: any) {
        if (isGuestUser(localUser)) {
            wx.removeStorageSync('userInfo')
            return null
        }
        const storedToken = String(wx.getStorageSync('pangoAccessToken') || '').trim()
        const embeddedToken = String(localUser?.accessToken || '').trim()
        const candidates = Array.from(new Set([storedToken, embeddedToken].filter(Boolean)))
        if (candidates.length === 0) return localUser

        let firstValid: { user: any, token: string } | null = null
        for (const token of candidates) {
            try {
                const res: any = await new Promise((resolve, reject) => {
                    wx.request({
                        url: app.globalData.baseHost + '/auth/me',
                        method: 'GET',
                        header: { 'Authorization': `Bearer ${token}` },
                        success: resolve,
                        fail: reject
                    })
                })
                const result = res.data as ApiResponse<any>
                if (result?.code !== 2000 || !result.data?.id || isGuestUser(result.data)) continue
                const authenticated = {
                    ...result.data,
                    avatarUrl: result.data.avatarUrl || localUser?.avatarUrl || '',
                    accessToken: token
                }
                if (!firstValid) firstValid = { user: authenticated, token }
                if (!localUser?.id || Number(result.data.id) === Number(localUser.id)) {
                    firstValid = { user: authenticated, token }
                    break
                }
            } catch (error) {
                console.warn('校验登录状态失败', error)
            }
        }

        if (!firstValid) return localUser
        wx.setStorageSync('pangoAccessToken', firstValid.token)
        persistUserInfo(firstValid.user)
        return firstValid.user
    },
    async getOrCreateGuestUser() {
        let guestKey = wx.getStorageSync("pangoGuestKey") as string
        if (!guestKey) {
            guestKey = `mini_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
            wx.setStorageSync("pangoGuestKey", guestKey)
        }
        try {
            const res: any = await new Promise((resolve, reject) => {
                wx.request({
                    url: app.globalData.baseHost + '/userinfo/guest',
                    method: 'POST',
                    data: { guestKey, platform: 'miniprogram' },
                    success: resolve,
                    fail: reject
                })
            })
            const result = res.data as ApiResponse<any>
            if (result.code === 2000 && result.data?.id) {
                if (result.data.accessToken) wx.setStorageSync('pangoAccessToken', result.data.accessToken)
                return result.data
            }
        } catch (error) {
            console.error('初始化访客信息失败', error)
        }
        showError("访客信息初始化失败，请检查网络后重试")
        return null
    },
    async getHisData() {
        try {
            const res: any = await new Promise((resolve, reject) => {
                wx.request({
                    url: app.globalData.baseHost + '/question/findHisByUserId',
                    method: 'POST',
                    data: { userinfoId: this.data.userInfo.id },
                    success: resolve,
                    fail: reject
                });
            });
            return res.data;
        } catch (error) {
            wx.showToast({ title: '预加载历史记录失败' });
            return null; // 返回空数据
        }
    },
    doReady(e: any) {
        const value = String(e.detail.value || '')
        this.setData({
            questionContent: value,
            flagDoReady: value.trim() !== ''
        });
    },

    /**
     * 生命周期函数--监听页面初次渲染完成
     */
    onReady() {
        // session_id is initialized in onLoad. Do not reuse the process-global
        // value here, because it may belong to the previously opened Q&A page.
    },
    getSessionId(forceNew = false) {
        if (!forceNew && app.globalData.sessionId) {
            return app.globalData.sessionId
        }

        const userId = this.data.userInfo?.id || "guest"
        const rand = Math.random().toString(36).slice(2, 10)
        app.globalData.sessionId = `mini_${userId}_${Date.now()}_${rand}`
        return app.globalData.sessionId
    },
    doCopyQuestion(e: any) {
        const { content } = e.currentTarget.dataset
        wx.showActionSheet({
            itemList: ["复制内容"],
            success: (res) => {
                if (res.tapIndex === 0) {
                    copyToClipboard(content);
                }
            }
        });
    },

    chooseType() {
      const currentStatus = this.data.isTestVersion;
      const newStatus = !currentStatus;
      this.setData({
        isTestVersion: newStatus
      });
      this.getSessionId(true) //切换sessionId
    },
    // 选择请求类型：智能问答/芯片选择
    // enableWebSearch() {
    //     const currentStatus = this.data.isWebSearchEnabled;
    //     const newStatus = !currentStatus;
    //     this.setData({
    //       isWebSearchEnabled: newStatus
    //     });
    //     this.getSessionId(true) //切换sessionId
    // },
    //评价回答
    doEvaluate(e: any) {
        const { evaluate, dotime, index } = e.currentTarget.dataset
        //判断是否重复操作
        let tmpList = this.data.sessionList;
        if (tmpList[index].flagEvaluate == evaluate) {
            return;
        }
        wx.request({
            url: app.globalData.baseHost + "/answer/doEvaluate",
            method: 'POST',
            header: { 'content-type': 'application/json' },
            data: { userinfoId: this.data.userInfo.id, flagEvaluate: evaluate, answerTime: dotime },
            complete: () => {
                let tmpList = this.data.sessionList;
                tmpList[index].flagEvaluate = evaluate;
                this.setData({ sessionList: tmpList })
            }
        })
    },
    //检查登录
    checkLogin() {
        if (app.globalData.flagLogin) {
            return true;
        }
        showError("请先授权信息以获得最佳使用体验")
        this.showLeftPanel()
        return false
    },
    // 从后台切回或数据超时时，若流式连接已断连，安全清理状态
    handleStreamTimeout(phase: 'first-frame' | 'idle' = 'idle') {
        if (!this.data.flagStart) return // 已经清理过，防止重复触发
        resetStreamDisplayQueue()
        clearStreamTimeout()
        lastChunkTime = 0
        const task = this.data.requestTask
        this.data.requestTask = null
        this.data.flagStart = false
        if (task) {
            try { task.offHeadersReceived() } catch (_) {}
            try { task.offChunkReceived() } catch (_) {}
            try { task.abort() } catch (_) {}
        }
        if (this.data.timer !== null) {
            clearInterval(this.data.timer)
        }
        const hasContent = !!(this.data.streamContentData || this.data.streamThink)
        const updates: Record<string, any> = {
            requestTask: null,
            timer: null,
            flagStart: false,
            flagShowAnwser: false,
            flagShowWait: false,
            userScrolledUp: false,
            streamThink: '',
            streamContent: '',
            streamContentData: '',
            ...createRuntimeState()
        }
        if (hasContent) {
            const row = {
                flagAi: 1,
                think: this.data.streamThink,
                content: this.data.streamContent,
                contentData: this.data.streamContentData,
                time: formatTime(new Date()),
                flagEvaluate: 0,
                reference: this.data.currentReference,
                answerMedia: this.data.currentAnswerMedia,
                answerSections: placeMediaAfterCitations(this.data.streamContent, this.data.currentAnswerMedia),
                structuredCitations: this.data.currentStructuredCitations,
                questionTrace: this.data.currentQuestionTrace
            }
            updates.sessionList = [...this.data.sessionList, row]
            updates.answerCount = this.data.answerCount + 1
        } else {
            updates.flagDoReady = false
        }
        const hasReceivedResponse = !!(
            this.data.hasReceivedAgentProgress || this.data.streamContentData || this.data.streamThink
        )
        this.setData(updates, () => {
            void this.recoverCurrentSessionAnswer().then((recovered: boolean) => {
                if (recovered) {
                    wx.showToast({ title: '已恢复本次回答', icon: 'success' })
                } else if (phase === 'first-frame' || !hasReceivedResponse) {
                    this.showReenterMiniProgramGuide('长时间未收到服务响应，已尝试刷新当前会话。请检查网络后重试；若仍无法使用，请从右上角“…”菜单重新进入小程序。')
                } else {
                    wx.showToast({ title: '网络已断开，请重新发送', icon: 'none' })
                }
            })
        })
    },
    /**
     * 生命周期函数--监听页面显示
     */
    onShow() {
        if (recordAuthorizationPending && this.data.flagLuyuning) {
            recorderIntentVersion++
            recordAuthorizationPending = false
            recorderState = 'idle'
            activeRecorderPage = null
            this.setData({ flagLuyuning: false, flagCancel: false, flagTalkOver: true })
        }
        this.toBottom()
        // Do not infer a broken stream merely because the Mini Program spent a
        // few seconds in the background. The request timeout and stream idle
        // timer own connection recovery; aborting here used to discard replies.
    },

    /**
     * 生命周期函数--监听页面隐藏
     */
    onHide() {

    },

    /**
     * 生命周期函数--监听页面卸载
     */
    onUnload() {
        resetStreamDisplayQueue()
        // Invalidate a pending wx.authorize callback so an unloaded page can
        // never start the global recorder later.
        recorderIntentVersion++
        recordAuthorizationPending = false
        if (activeRecorderPage === this) {
            activeRecorderPage = null
            try { this.stopRecorderManager() } catch (_) {}
        }
    },

    /**
     * 页面相关事件处理函数--监听用户下拉动作
     */
    onPullDownRefresh() {

    },

    /**
     * 页面上拉触底事件的处理函数
     */
    onReachBottom() {

    },

    /**
     * 用户点击右上角分享
     */
    onShareAppMessage() {

    }
})
