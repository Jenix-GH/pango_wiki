const app = getApp()

function viewerUrlFrom(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    try {
        const decoded = decodeURIComponent(raw)
        return /^https?:\/\//i.test(decoded) ? decoded : ''
    } catch (_) {
        return ''
    }
}

Page({
    data: {
        viewerUrl: '',
        lastViewerUrl: '',
        errorMessage: ''
    },

    onLoad(options: Record<string, string | undefined>) {
        const queryUrl = viewerUrlFrom(options.url)
        const fallbackUrl = viewerUrlFrom(app.globalData._refViewerUrl)
        const viewerUrl = queryUrl || fallbackUrl

        if (!viewerUrl) {
            this.setData({ errorMessage: '参考文档地址无效' })
            return
        }

        this.setData({
            viewerUrl,
            lastViewerUrl: viewerUrl,
            errorMessage: ''
        })
    },

    handleViewerLoad() {
        this.setData({ errorMessage: '' })
    },

    handleViewerError(event: WechatMiniprogram.CustomEvent) {
        console.error('参考文档 WebView 加载失败', event.detail)
        this.setData({
            viewerUrl: '',
            errorMessage: '参考文档加载失败，请检查网络后重试'
        })
    },

    retry() {
        if (!this.data.lastViewerUrl) return
        this.setData({
            viewerUrl: this.data.lastViewerUrl,
            errorMessage: ''
        })
    },

    goBack() {
        wx.navigateBack()
    }
})
