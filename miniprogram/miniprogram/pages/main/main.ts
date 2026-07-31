// pages/main/main.ts
import { formatTime } from '../../utils/util'
import streamUtils from "./stream"
import { copyToClipboard, extractText, showError, showSuccess } from '../../utils/tools'
// import marked from "../../utils/marked.min.js"

let isScrolling = false;
let pendingScroll = false;
let ignoreScrollUntil = 0;
let lastChunkTime = 0; // 记录最近一次收到流式数据的时间，用于检测后台断连
let streamTimeoutId: any = null; // 流式数据超时定时器，90s无数据则判定断连
const STREAM_RENDER_INTERVAL_MS = 32;
const STREAM_RENDER_MAX_TAIL_MS = 6000;
const STREAM_RENDER_MAX_BATCH = 12;
let streamDisplayQueue: string[] = [];
let streamDisplayTimer: any = null;
let streamDisplayRendering = false;
let streamDisplayCompleteRequested = false;
let streamDisplayDeadline = 0;
let streamDisplayGeneration = 0;

function setStreamTimeout(that: any) {
    if (streamTimeoutId) clearTimeout(streamTimeoutId)
    streamTimeoutId = setTimeout(() => {
        that.handleStreamTimeout()
    }, 90000) // 90秒无任何数据视为断连
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

interface HistoryAnswer {
    content: string
    dotime: string
    flagEvaluate: string | number
    reference?: unknown
}

interface ReferencePageLink {
    page: number
    document_page_url: string
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

function emptyReference(): ReferencePayload {
    return { chunks: [], total: 0 }
}

function createRuntimeState() {
    return {
        currentStatusText: "",
        currentStatusEmoji: "",
        currentReference: emptyReference(),
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
    return Array.from(new Set(pages)).sort((a, b) => a - b)
}

function normalizePageLinks(chunk: ReferenceChunk, pages: number[]): ReferencePageLink[] {
    const linksByPage = new Map<number, string>()
    const addLink = (pageValue: unknown, urlValue: unknown) => {
        const page = toPositivePage(pageValue)
        const url = String(urlValue || '').trim()
        if (page !== null && url && !linksByPage.has(page)) {
            linksByPage.set(page, url)
        }
    }

    if (Array.isArray(chunk.page_links)) {
        chunk.page_links.forEach(link => addLink(link?.page, link?.document_page_url))
    }
    addLink(chunk.page, chunk.document_page_url)

    return Array.from(linksByPage.entries())
        .sort(([pageA], [pageB]) => pageA - pageB)
        .map(([page, documentPageUrl], index) => ({
            page,
            document_page_url: documentPageUrl,
            page_key: `page_${page}_${index}`
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
        const pageLinks = normalizePageLinks(chunk, pages)
        chunk.pages = normalizePages([...pages, ...pageLinks.map(link => link.page)])
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

function openReferenceViewer(url: string) {
    app.globalData._refViewerUrl = url
    wx.navigateTo({
        url: `/pages/reference-viewer/reference-viewer?url=${encodeURIComponent(url)}`,
        fail: err => {
            console.error('打开参考文档页面失败', err)
            showError('参考文档页面打开失败')
        }
    })
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
            { content: "介绍一下PG2T390器件" },
        ],
        // isTestVersion: true,
        // isWebSearchEnabled: false, //是否开启联网搜索
        userScrolledUp: false, //用户是否手动上滑打断自动滚底
        uploadImages: [] as { mime_type: string; data_base64: string; filename: string }[],
        flagDoReady: false,     //问题内容框是否为空标识
        inputHeight: 70,     //问题框的初始化高度

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
        wx.navigateTo({
            url: '/pages/wiki/wiki',
            fail: err => {
                console.error('打开 Wiki 页面失败', err)
                showError('Wiki 页面打开失败')
            }
        })
    },
    // 开始录音（长按输入框触发）
    startRecord(e: any) {
        if (this.data._inputFocused) return;
        //判断是否登录
        if (!this.checkLogin()) return
        //判断是否未完善公司信息
        if (this.checkAnswerLimit()) return;
        if (!this.data.flagTalkOver) {
            showError("正在录音中,请先等待结束")
            return;
        }
        this.setData({
            audioPath: '', luyunTipText: "松开 结束",
            flagLuyuning: true, flagCancel: false,
            startY: (e.detail?.touches?.[0]?.clientY || e.touches?.[0]?.clientY || 0),
            startTime: Date.now(), flagTalkOver: false
        })
        wx.authorize({
            scope: 'scope.record',
            success: () => {
                recorderManager.start({
                    format: 'aac',
                    sampleRate: 16000,
                    encodeBitRate: 36000,
                    numberOfChannels: 1,
                    frameSize: 1024
                })
                recorderManager.onStop(res => {
                    if (this.data.flagCancel) {
                        return;
                    }
                    this.setData({
                        audioPath: res.tempFilePath,
                        luyunTipText: "按住 说话",
                        flagLuyuning: false
                    })
                    this.uploadAudio(res.tempFilePath)
                })
            },
            fail: () => this.showAuthModal()
        })
    },
    cancelRecord(e: any) {
        const currentY = e.touches[0].clientY
        const moveY = this.data.startY - currentY
        const shouldCancel = moveY > 50
        if (this.data.flagLuyuning && shouldCancel) {
            showSuccess("已取消")
            this.setData({
                luyunTipText: "按住 说话",
                flagLuyuning: false,
                flagVoiceMode: false,
                flagCancel: true,
                flagTalkOver: true
            })
        }
    },
    uploadAudio(filePath: string) {
        wx.showLoading({ title: "转换文字中...", mask: true })
        wx.uploadFile({
            url: app.globalData.baseHost + '/wx/transcribe',
            filePath: filePath,
            name: 'audio',
            timeout: 6000,
            success: (res) => {
                if (res.statusCode === 200 && res.errMsg === "uploadFile:ok") {
                    const data = res.data;
                    const payload: ApiResponse<SessionData | boolean> = JSON.parse(data)
                    const text = typeof payload.data === "object" && payload.data !== null ? payload.data.text : "";
                    if (payload.code === 2000 && "" != text) {
                        this.setData({ questionContent: text })
                        this.changeInMode();//切换到文字模式
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
        const duration = Math.floor((Date.now() - this.data.startTime) / 1000);
        if (duration < 1) {
            showError("录音时间太短")
            this.setData({
                luyunTipText: "按住 说话",
                flagLuyuning: false,
                flagVoiceMode: false,
                flagTalkOver: true,
                flagCancel: true,
            })
            recorderManager.stop()
            return;
        }
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
    showLeftPanel() {
        //调用子组件的方法
        const leftPanel = this.selectComponent('#leftPanel');
        leftPanel.showLeftPanel();
        leftPanel.doClearChoose();
    },
    // 显示底部弹窗
    showSetPanel() {
        //调用子组件的方法
        const setPanel = this.selectComponent('#setPanel');
        setPanel.showSetPanel();
    },
    //删除left-menu中的dataHisTitle记录
    delHisData() {
        this.setData({ dataHisTitle: [], dataDayTitle: [] })
        wx.showToast({ title: "操作完成", icon: "success" })
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
        if ("" === this.data.questionContent && this.data.uploadImages.length === 0) return;
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
        wx.chooseMedia({
            count: 3 - this.data.uploadImages.length,
            mediaType: ['image'],
            sizeType: ['compressed'],
            success: (res) => {
                const files = res.tempFiles;
                const newImages: { mime_type: string; data_base64: string; filename: string }[] = [];
                let loaded = 0;
                files.forEach((file) => {
                    const fs = wx.getFileSystemManager();
                    const base64 = fs.readFileSync(file.tempFilePath, 'base64');
                    const mimeType = file.fileType === 'image' ? `image/${(file.tempFilePath.split('.').pop() || 'png').replace('jpg', 'jpeg')}` : 'image/png';
                    newImages.push({
                        mime_type: mimeType,
                        data_base64: base64,
                        filename: file.tempFilePath.split('/').pop() || 'upload.png'
                    });
                    loaded++;
                    if (loaded === files.length) {
                        const images = [...this.data.uploadImages, ...newImages];
                        this.setData({ uploadImages: images, flagDoReady: true });
                    }
                });
                if (files.length === 0) {
                    this.setData({ flagDoReady: this.data.questionContent !== '' });
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
            flagDoReady: this.data.questionContent !== '' || images.length > 0
        });
    },
    previewChatImage(e: any) {
        const { images, index } = e.currentTarget.dataset;
        if (!images || !images.length) return;
        const urls = images.map((img: { mime_type: string; data_base64: string }) =>
            `data:${img.mime_type};base64,${img.data_base64}`
        );
        wx.previewImage({
            current: urls[index] || urls[0],
            urls
        });
    },
    //执行查询
    doSearch() {
        // add by csj
        //判断是否登录
        if (!this.checkLogin()) return
        //判断是否未完善公司信息
        if (this.checkAnswerLimit()) return;
        //判断是否有正在回答中的
        if (this.data.flagStart) {
            showError("正在回答中，请勿重复")
            return;
        }
        //不能为空值
        if ("" === this.data.questionContent && this.data.uploadImages.length === 0) return;
        //增加到对话列表中
        this.addQuestion();
        //调用问答服务
        this.startStreaming(this.data.questionContent)
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
        // DB持久化
        // add by csj
        wx.request({
            url: app.globalData.baseHost + '/question/doAdd',
            method: 'POST',
            data: {
              userinfoId: this.data.userInfo.id,
              question: content,
              questionType: "1"
              // internetEnable: this.data.isWebSearchEnabled? 1 : 2
            },
            success: (res) => {
                let rs: ApiResponse<questionList> = JSON.parse(JSON.stringify(res.data));
                if (res.errMsg === "request:ok" && rs.code === 2000) {
                    this.setData({ dataDayTitle: rs.data.todayQuestion }) //刷新左侧的列表
                    app.globalData.todayQuestion = rs.data.todayQuestion
                }
            }
        });
    },

    /**
     * 在表格说明和表格体之间补充空行
     */
    fixMarkdownTableSpacing(md: string): string {
      const lines = md.split(/\r?\n/);
      const fixed: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        const next = lines[i + 1] ?? "";

        fixed.push(current);

        // 当前行不是表格行，但下一行是表格行 → 插入空行
        if (!current.trim().startsWith("|") && next.trim().startsWith("|")) {
          if (current.trim() !== "") {
            fixed.push(""); // 插入空行
          }
        }
      }

      return fixed.join("\n");
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
    updateProgress(statusText: string) {
      if (!statusText) return;
      const emojiMap: Record<string, string> = {
        DANGER: '🔍',
        RETRIEVAL: '📚',
        EVIDENCE: '📋',
        ANSWER: '✍️',
        VERIFY: '✅',
        WAIT: '⏳',
      };
      let emoji = '⏳';
      for (const [key, val] of Object.entries(emojiMap)) {
        if (statusText.includes(key) || (key === 'WAIT' && statusText.includes('等待'))) {
          emoji = val;
          break;
        }
      }
      if (!emoji || emoji === '⏳') {
        if (statusText.includes('理解')) emoji = '💭';
        else if (statusText.includes('检索') || statusText.includes('查')) emoji = '📚';
        else if (statusText.includes('整理') || statusText.includes('依据')) emoji = '📋';
        else if (statusText.includes('生成') || statusText.includes('回答')) emoji = '✍️';
        else if (statusText.includes('核') || statusText.includes('来源')) emoji = '🔍';
      }
      this.setData({
        currentStatusText: statusText,
        currentStatusEmoji: emoji,
      }, () => {
        this.smartScroll()
      });
    },
    startStreaming(content: string) {
      resetStreamDisplayQueue()
      const imagesToSend = this.data.uploadImages.length > 0
        ? [...this.data.uploadImages]
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
      setStreamTimeout(this)
      this.startAnimation()

      let url = app.globalData.sessionUrl

      // if (this.data.isTestVersion) {
      //   url = app.globalData.sessionUrl_choose
      // }

      if (app.globalData.sessionId === null || app.globalData.sessionId === '') {
        this.getSessionId()
      }

      const data: Record<string, unknown> = {
        question: content,
        quote: app.globalData.quote,
        session_id: app.globalData.sessionId,
        limit: 5
      }
      if (imagesToSend) {
        data.images = imagesToSend
      }

      const header = {
        'content-type': 'application/json'
      }

      let frameCount = 0
      this.data.requestTask = streamUtils.fetchStream(
        url,
        data,
        header,
        chunk => {
          if (chunk === '') return

          let raw = String(chunk).trim()
          if (!raw) return

          lastChunkTime = Date.now()
          setStreamTimeout(this)
          frameCount++
          const ts = Date.now()
          // const preview = raw.length > 80 ? raw.substring(0, 80) + '...' : raw

          if (raw === '[DONE]') {
            console.log(`[frame] #${frameCount} [DONE]`)
            this.requestStreamDisplayCompletion()
            return
          }

          let payload: any = null

          try {
            payload = JSON.parse(raw)
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
            this.updateProgress(payload.data.status)
            return
          }

          if (payload.data?.answer) {
            this.hideWaitingForAnswer()
            if (this.data.currentStatusText !== "正在生成回答...") {
              this.updateProgress("正在生成回答...")
            }
            this.enqueueStreamChunk(String(payload.data.answer))
            return
          }

          if (payload.data === true || payload.answer_replace) {
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
                currentStructuredCitations: payload.structured_citations || [],
                currentQuestionTrace: payload.question_trace || null
              }, () => {
                this.smartScroll()
                this.stopStreaming()
              })
            } else {
              this.setData({
                currentReference: normalizeReference(payload.reference, payload.structured_citations),
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
            if (this.data.currentStatusText !== '正在生成回答...') {
              this.updateProgress('正在生成回答...')
            }
            this.enqueueStreamChunk(String(text))
            return
          }
        },
        err => {
          console.error('流式请求异常', err)
          resetStreamDisplayQueue()
          if (this.data.timer !== null) {
            clearInterval(this.data.timer)
          }
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
            ...createRuntimeState()
        }, () => {
            // this.smartScroll()
        });
        }
      )
    },
    // 停止接收流式数据
    stopStreaming() {
        resetStreamDisplayQueue()
        lastChunkTime = 0
        clearStreamTimeout()
        if (this.data.timer !== null) {
            clearInterval(this.data.timer)
        }
        if (this.data.requestTask) {
            try {
                this.data.requestTask.offHeadersReceived()
                this.data.requestTask.offChunkReceived()
                this.data.requestTask.abort()
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
            structuredCitations: this.data.currentStructuredCitations,
            questionTrace: this.data.currentQuestionTrace
        };
        let dbRow = {
            userinfoId: this.data.userInfo.id,
            think: extractText(this.data.streamThink),
            content: this.data.streamContentData,
            answerTime: endTime,
            reference: JSON.stringify(this.data.currentReference)
        }
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
        //DB持久化
        wx.request({
            url: app.globalData.baseHost + '/answer/doAdd',
            method: 'POST',
            data: dbRow,
            success: () => console.log("answer")
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
        const url = withSessionId(baseUrl, app.globalData.sessionId)
        const fallbackBaseUrl = absoluteReferenceUrl(e.currentTarget.dataset.fallbackUrl)
        const fallbackUrl = fallbackBaseUrl
            ? withSessionId(fallbackBaseUrl, app.globalData.sessionId)
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
        openReferenceViewer(withSessionId(baseUrl, app.globalData.sessionId))
    },
    //开始新会话
    reloadSession() {
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
        showSuccess("已切换新对话")
    },
    //根据问题ID查询回答对象
    doSearchHisItem(e: any) {
        const id = e.detail.id
        const content = e.detail.content
        wx.request({
            url: app.globalData.baseHost + '/answer/getByQuestionId',
            method: 'POST',
            data: { userinfoId: this.data.userInfo.id, questionId: id },
            success: (res) => {
                let rs: ApiResponse<HistoryAnswer> = JSON.parse(JSON.stringify(res.data));
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
                    let row: any = {
                        flagAi: 0,
                        content: content,
                        time: ''
                    };
                    const questionRow = row
                    //let answerContent = marked.parse(rs.data.content);
                    row = {
                        flagAi: 1,
                        //think: rs.data.think,
                        content: rs.data.content,
                        contentData: rs.data.content,
                        time: rs.data.dotime,
                        flagEvaluate: rs.data.flagEvaluate,
                        reference: normalizeReference(rs.data.reference)
                    };
                    this.setData({
                        // 历史记录是一次会话切换，不追加到当前会话。
                        sessionList: [questionRow, row],
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
        if (!app.globalData.flagCompanyInfo) {
            if (this.data.answerCount > app.globalData.answerLimitMax) {
                wx.showToast({ title: "体验次数已用完，请前往个人信息中心，完善公司信息获取无限对话次数", duration: 7000, icon: "none" })
                return true;
            }
        }
        return false;
    },
    handleRefresh(){
        this.onLoad();
    },
    /**
     * 生命周期函数--监听页面加载
     */
    async onLoad() {
        //判断是否有登录授权
        let info = wx.getStorageSync("userInfo")
        if (null != info && null != info.setId && info.setId > 0) {
            this.setData({userInfo: info})
            //查询历史对话
            const data = await this.getHisData()
            let rs: ApiResponse<questionList> = JSON.parse(JSON.stringify(data));
            if (rs.code === 2000) {
                this.setData({
                    dataDayTitle: rs.data.todayQuestion,
                    dataHisTitle: rs.data.weekQuestion,
                    answerCount: rs.data.count
                })
                app.globalData.flagCompanyInfo = rs.data.flagCompanyInfo;
            }
        }
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
        this.setData({
            questionContent: e.detail.value
        });
        this.setData({
            flagDoReady: this.data.questionContent !== '' || this.data.uploadImages.length > 0
        });
    },

    /**
     * 生命周期函数--监听页面初次渲染完成
     */
    onReady() {
        //获取对话的session
        this.getSessionId()
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
    handleStreamTimeout() {
        if (!this.data.flagStart) return // 已经清理过，防止重复触发
        resetStreamDisplayQueue()
        clearStreamTimeout()
        lastChunkTime = 0
        const task = this.data.requestTask
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
                structuredCitations: this.data.currentStructuredCitations,
                questionTrace: this.data.currentQuestionTrace
            }
            updates.sessionList = [...this.data.sessionList, row]
            updates.answerCount = this.data.answerCount + 1
        } else {
            updates.flagDoReady = false
        }
        this.setData(updates)
        wx.showToast({ title: '网络已断开，请重新发送', icon: 'none' })
    },
    /**
     * 生命周期函数--监听页面显示
     */
    onShow() {
        this.toBottom()
        // 从后台切回时若仍处流式状态且超时，安全退出思考状态
        if (this.data.flagStart && lastChunkTime > 0 && Date.now() - lastChunkTime > 5000) {
            this.handleStreamTimeout()
        }
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
