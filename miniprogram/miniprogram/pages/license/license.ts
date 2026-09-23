export {}

const app = getApp()

interface LicenseForm {
  userinfoId?: number
  operatingSystem: 'Windows' | 'Linux'
  softwareVersion: string
  licenseType: 'STANDALONE' | 'SERVER'
  durationYears: 1 | 2 | 3
  macAddress: string
  applicantName: string
  companyName: string
  email: string
  phone: string
  address: string
}

interface FieldEvent {
  detail: { value: string | number }
  currentTarget: { dataset: Record<string, unknown> }
}

interface DatasetEvent {
  currentTarget: { dataset: Record<string, unknown> }
}

interface ApiResponse {
  code: number
  message?: string
  data?: { id?: number }
}

interface StoredUserInfo {
  id?: number
  nickName?: string
  companyName?: string
  mailAddress?: string
  phoneNumber?: string
}

const emptyForm = (): LicenseForm => ({
  operatingSystem: 'Windows',
  softwareVersion: '',
  licenseType: 'STANDALONE',
  durationYears: 1,
  macAddress: '',
  applicantName: '',
  companyName: '',
  email: '',
  phone: '',
  address: '',
})

/** 表单初始状态：手填字段留空，申请人信息由登录账号带入。提交成功后复位到该状态。 */
const initialForm = (user: StoredUserInfo = {}): LicenseForm => ({
  ...emptyForm(),
  userinfoId: user.id,
  applicantName: user.nickName || '',
  companyName: user.companyName || '',
  email: user.mailAddress || '',
  phone: user.phoneNumber || '',
})

const readStoredUser = (): StoredUserInfo => (wx.getStorageSync('userInfo') || {}) as StoredUserInfo

Page({
  data: {
    form: emptyForm(),
    operatingSystemOptions: ['Windows', 'Linux'],
    operatingSystemIndex: 0,
    durationOptions: ['1年', '2年', '3年'],
    durationIndex: 0,
    submitting: false,
    error: '',
    success: '',
  },

  onLoad() {
    this.setData({ form: initialForm(readStoredUser()) })
  },

  openChat() {
    wx.switchTab({ url: '/pages/main/main' })
  },

  openWiki() {
    wx.switchTab({ url: '/pages/wiki/wiki' })
  },

  noop() {},

  inputField(event: FieldEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field) return
    const value = field === 'macAddress'
      ? String(event.detail.value || '').toUpperCase()
      : String(event.detail.value || '')
    this.setData({ [`form.${field}`]: value, error: '', success: '' })
  },

  selectOperatingSystem(event: FieldEvent) {
    const index = Number(event.detail.value) || 0
    this.setData({
      operatingSystemIndex: index,
      'form.operatingSystem': this.data.operatingSystemOptions[index] as 'Windows' | 'Linux',
    })
  },

  selectDuration(event: FieldEvent) {
    const index = Number(event.detail.value) || 0
    this.setData({ durationIndex: index, 'form.durationYears': (index + 1) as 1 | 2 | 3 })
  },

  selectLicenseType(event: DatasetEvent) {
    const type = String(event.currentTarget.dataset.type || 'STANDALONE') as 'STANDALONE' | 'SERVER'
    this.setData({ 'form.licenseType': type })
  },

  submitApplication() {
    if (this.data.submitting) return
    const form = this.data.form as LicenseForm
    const required: Array<[keyof LicenseForm, string]> = [
      ['softwareVersion', '软件版本'],
      ['macAddress', 'MAC 地址'],
      ['applicantName', '申请人'],
      ['companyName', '公司'],
      ['email', '邮箱'],
      ['phone', '电话'],
      ['address', '地址'],
    ]
    for (const [key, label] of required) {
      if (!String(form[key] || '').trim()) {
        this.setData({ error: `${label}不能为空`, success: '' })
        return
      }
    }
    if (!/^[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/.test(form.macAddress)) {
      this.setData({ error: '请输入正确的 MAC 地址，例如：00-1A-2B-3C-4D-5E', success: '' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      this.setData({ error: '请输入正确的邮箱地址', success: '' })
      return
    }
    const token = String(wx.getStorageSync('pangoAccessToken') || '').trim()
    this.setData({ submitting: true, error: '', success: '' })
    wx.request<ApiResponse>({
      url: `${app.globalData.baseHost}/license/application/submit`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      data: { ...form, macAddress: form.macAddress.toUpperCase() },
      success: result => {
        const response = result.data
        if (result.statusCode < 200 || result.statusCode >= 300 || response.code !== 2000) {
          this.setData({ error: response.message || '提交失败，请稍后重试' })
          return
        }
        this.setData({
          form: initialForm(readStoredUser()),
          operatingSystemIndex: 0,
          durationIndex: 0,
          success: '申请已提交，我们将在审核后与您联系',
        })
      },
      fail: error => {
        console.error('License 申请提交失败', error)
        this.setData({ error: '提交失败，请检查网络后重试' })
      },
      complete: () => this.setData({ submitting: false }),
    })
  },
})
