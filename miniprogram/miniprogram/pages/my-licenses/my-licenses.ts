export {}
const app = getApp()
interface LicenseRecord {
  id: number; submittedAt: string; operatingSystem: string; softwareVersion: string
  licenseType: string; durationYears: number; macAddress: string; officialSubmitted: boolean | null
  status: number; rejectionReason: string | null; canDownload: boolean; filename: string | null
}
interface LicensePage { records: LicenseRecord[]; total: number; page: number; pageSize: number }
const statusNames = ['待处理', '处理中', '已处理', '已拒绝']
// Local typings predate this official API; avoid changing generated typings.
const fileShare = wx as typeof wx & {
  shareFileMessage?: (options: { filePath: string; fileName: string; fail: (error: { errMsg: string }) => void }) => void
}
Page({
  data: {
    records: [] as Array<LicenseRecord & { statusLabel: string; dateLabel: string; officialLabel: string }>,
    page: 1, pages: 1, total: 0, loading: false, loggedIn: false, error: '', downloading: false,
    downloadedPath: '', downloadedName: '',
  },
  requestVersion: 0,
  currentOwner: 0,
  alive: true,
  onShow() { this.load() },
  onUnload() { this.alive = false; this.requestVersion++; this.clearFile() },
  login() { wx.navigateTo({ url: '/pages/license-login/license-login' }) },
  apply() { wx.switchTab({ url: '/pages/license/license' }) },
  refresh() { this.setData({ page: 1 }); this.load() },
  previous() { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); this.load() } },
  next() { if (this.data.page < this.data.pages) { this.setData({ page: this.data.page + 1 }); this.load() } },
  load() {
    const version = ++this.requestVersion
    const user = wx.getStorageSync('userInfo')
    const token = wx.getStorageSync('pangoAccessToken')
    if (this.currentOwner !== Number(user?.id || 0)) {
      this.clearFile()
      this.setData({ page: 1 })
      this.currentOwner = Number(user?.id || 0)
    }
    const loggedIn = Boolean(user?.id && user.userType !== 'GUEST' && token)
    this.setData({ loggedIn, records: [], error: '', loading: false })
    if (!loggedIn) { this.clearFile(); return }
    this.setData({ loading: true })
    wx.request<{ code: number; message?: string; data: LicensePage }>({
      url: `${app.globalData.baseHost}/license/application/mine?page=${this.data.page}`,
      header: { Authorization: `Bearer ${token}` },
      success: result => {
        if (version !== this.requestVersion) return
        if (result.statusCode === 401 || result.data.code === 401) { this.setData({ loggedIn: false }); this.clearFile(); return }
        if (result.statusCode !== 200 || result.data.code !== 2000 || !result.data.data) {
          this.setData({ error: result.data.message || '加载失败，请重试' }); return
        }
        const data = result.data.data
        this.setData({ total: data.total, pages: Math.max(1, Math.ceil(data.total / data.pageSize)), records: data.records.map(row => ({
          ...row, statusLabel: statusNames[row.status] || '状态待确认',
          dateLabel: row.submittedAt.slice(0, 19).replace('T', ' '),
          officialLabel: row.officialSubmitted == null ? '未记录' : row.officialSubmitted ? '是' : '否',
        })) })
      },
      fail: () => { if (version === this.requestVersion) this.setData({ error: '网络连接失败，请重试' }) },
      complete: () => { if (version === this.requestVersion) this.setData({ loading: false }) },
    })
  },
  clearFile() {
    if (this.data.downloadedPath) wx.getFileSystemManager().unlink({ filePath: this.data.downloadedPath, fail: () => {} })
    this.setData({ downloadedPath: '', downloadedName: '' })
  },
  download(event: { currentTarget: { dataset: { id: number } } }) {
    if (this.data.downloading) return
    const row = this.data.records.find(item => String(item.id) === String(event.currentTarget.dataset.id))
    if (!row?.canDownload || !row.filename || !/^new_pds_[0-9a-f]{12}\.lic$/i.test(row.filename)) return
    const token = wx.getStorageSync('pangoAccessToken')
    const filename = row.filename
    const owner = this.currentOwner
    this.clearFile()
    this.setData({ downloading: true, error: '' })
    // Files are limited to 1 MB. Binary request lets us verify the content type before saving.
    wx.request<ArrayBuffer>({
      url: `${app.globalData.baseHost}/license/application/${row.id}/download`,
      header: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer',
      success: result => {
        if (!this.alive || owner !== this.currentOwner) return
        if (result.statusCode === 401) { this.setData({ loggedIn: false }); return }
        const type = String(result.header['Content-Type'] || result.header['content-type'] || '')
        if (result.statusCode !== 200 || !type.includes('application/octet-stream') || !result.data.byteLength) {
          this.setData({ error: '文件暂不可下载，请刷新或联系对接人员。' }); return
        }
        const path = `${wx.env.USER_DATA_PATH}/license-${Date.now()}-${filename}`
        wx.getFileSystemManager().writeFile({
          filePath: path, data: result.data,
          success: () => {
            if (!this.alive || owner !== this.currentOwner) {
              wx.getFileSystemManager().unlink({ filePath: path, fail: () => {} })
              return
            }
            this.setData({ downloadedPath: path, downloadedName: filename })
          },
          fail: () => this.setData({ error: '保存文件失败，请检查存储空间后重试' }),
        })
      },
      fail: () => this.setData({ error: '下载失败，请检查网络后重试' }),
      complete: () => this.setData({ downloading: false }),
    })
  },
  saveFile() {
    if (!this.data.downloadedPath) return
    if (fileShare.shareFileMessage) {
      fileShare.shareFileMessage({ filePath: this.data.downloadedPath, fileName: this.data.downloadedName,
        fail: error => { if (!error.errMsg.includes('cancel')) this.setData({ error: '无法转发文件，请升级微信或通过 Web 个人中心下载。' }) },
      })
    } else if (wx.canIUse('saveFileToDisk')) {
      wx.saveFileToDisk({ filePath: this.data.downloadedPath, fail: () => this.setData({ error: '保存未完成，可通过 Web 个人中心下载。' }) })
    } else { this.setData({ error: '当前微信版本不支持导出文件，请升级微信或通过 Web 个人中心下载。' }) }
  },
})
