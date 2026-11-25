const app = getApp()

function viewerUrlFrom(value: unknown): string {
    let raw = String(value || '').trim()
    if (!raw) return ''
    if (!/^https?:\/\//i.test(raw)) {
        try {
            raw = decodeURIComponent(raw)
        } catch (_) {
            return ''
        }
    }
    // 分享参数来自外部，只接受已配置服务的阅读页面。
    const match = raw.match(/^(https?:\/\/[^/?#]+)(\/[^?#]*)/i)
    if (!match) return ''
    const origins = [app.globalData.qaHost, app.globalData.referenceHost]
        .map(host => String(host || '').trim().replace(/\/$/, '').toLowerCase())
    const paths = ['/docs/reader', '/references/viewer', '/references/document',
        '/references/cloud/viewer', '/references/cloud/document']
    return origins.includes(match[1].toLowerCase()) && paths.includes(match[2]) ? raw : ''
}

function titleFrom(value: string | undefined): string {
    try {
        return decodeURIComponent(value || '').trim()
    } catch (_) {
        return ''
    }
}

Page({
    data: {
        viewerUrl: '',
        lastViewerUrl: '',
        shareTitle: '紫光同创 · 文档在线阅读',
        errorMessage: ''
    },

    onLoad(options: Record<string, string | undefined> = {}) {
        // 有分享参数时不回退到上一次文档；无参数时兼容站内打开入口。
        const viewerUrl = viewerUrlFrom(options.url !== undefined ? options.url : app.globalData._refViewerUrl)
        delete app.globalData._refViewerUrl
        wx.showShareMenu({ menus: ['shareAppMessage'] })

        if (!viewerUrl) {
            this.setData({ errorMessage: '参考文档地址无效' })
            return
        }

        this.setData({
            viewerUrl,
            lastViewerUrl: viewerUrl,
            shareTitle: titleFrom(options.title) || '紫光同创 · 文档在线阅读',
            errorMessage: ''
        })
    },

    onShareAppMessage(options: { webViewUrl?: string } = {}) {
        const viewerUrl = viewerUrlFrom(options.webViewUrl) || this.data.lastViewerUrl
        if (!viewerUrl) {
            return { title: '紫光同创 · 器件技术文档中心', path: '/pages/wiki/wiki' }
        }
        const title = viewerUrl === this.data.lastViewerUrl ? this.data.shareTitle : '紫光同创 · 文档在线阅读'
        return {
            title,
            path: `/pages/reference-viewer/reference-viewer?url=${encodeURIComponent(viewerUrl)}&title=${encodeURIComponent(title)}`
        }
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
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wiki/wiki' }) })
    }
})
