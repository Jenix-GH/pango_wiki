export {}
const app = getApp()
interface LicenseRecord {
  emailType: string | null; contactPerson: string | null; maxUsers: number | null
  id: number; submittedAt: string; operatingSystem: string; softwareVersion: string
  licenseType: string; durationYears: number; macAddress: string; officialSubmitted: boolean | null
  status: number; rejectionReason: string | null; mail?: { state: string; label: string; note: string }
}
interface LicensePage { records: LicenseRecord[]; total: number; page: number; pageSize: number }
const statusNames = ['待处理', '处理中', '已处理', '已拒绝']
Page({
  data: {
    records: [] as Array<LicenseRecord & { statusLabel: string; dateLabel: string; officialLabel: string }>,
    page: 1, pages: 1, total: 0, loading: false, loggedIn: false, error: '',
  },
  requestVersion: 0,
  currentOwner: 0,
  pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  visible: false,
  stopPolling() { if (this.pollTimer !== undefined) clearTimeout(this.pollTimer); this.pollTimer = undefined },
  onShow() { this.visible = true; this.load() },
  onHide() { this.visible = false; this.requestVersion++; this.stopPolling() },
  onUnload() { this.visible = false; this.requestVersion++; this.stopPolling() },
  login() { wx.navigateTo({ url: '/pages/license-login/license-login' }) },
  apply() { wx.switchTab({ url: '/pages/license/license' }) },
  refresh() { this.setData({ page: 1 }); this.load() },
  previous() { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); this.load() } },
  next() { if (this.data.page < this.data.pages) { this.setData({ page: this.data.page + 1 }); this.load() } },
  load(background = false) {
    this.stopPolling()
    const version = ++this.requestVersion
    const user = wx.getStorageSync('userInfo')
    const token = wx.getStorageSync('pangoAccessToken')
    if (this.currentOwner !== Number(user?.id || 0)) {
      background = false
      this.setData({ page: 1 })
      this.currentOwner = Number(user?.id || 0)
    }
    const loggedIn = Boolean(user?.id && user.userType !== 'GUEST' && token)
    if (!loggedIn) { this.setData({ loggedIn, records: [], error: '', loading: false }); return }
    if (!background) this.setData({ loggedIn, records: [], error: '', loading: true })
    wx.request<{ code: number; message?: string; data: LicensePage }>({
      url: `${app.globalData.baseHost}/license/application/mine?page=${this.data.page}`,
      header: { Authorization: `Bearer ${token}` },
      success: result => {
        if (version !== this.requestVersion) return
        if (result.statusCode === 401 || result.data.code === 401) { this.setData({ loggedIn: false, records: [] }); return }
        if (result.statusCode !== 200 || result.data.code !== 2000 || !result.data.data) {
          this.setData({ error: result.data.message || '加载失败，请重试' }); return
        }
        const data = result.data.data
        this.setData({ error: '', total: data.total, pages: Math.max(1, Math.ceil(data.total / data.pageSize)), records: data.records.map(row => ({
          ...row, statusLabel: statusNames[row.status] || '状态待确认',
          dateLabel: row.submittedAt.slice(0, 19).replace('T', ' '),
          officialLabel: row.officialSubmitted == null ? '未记录' : row.officialSubmitted ? '是' : '否',
        })) })
      },
      fail: () => { if (version === this.requestVersion) this.setData({ error: '网络连接失败，请重试' }) },
      complete: () => {
        if (version !== this.requestVersion) return
        this.setData({ loading: false })
        if (this.visible && this.data.loggedIn) this.pollTimer = setTimeout(() => this.load(true), 30000)
      },
    })
  },
})
