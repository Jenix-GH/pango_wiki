import { persistUserInfo } from '../../utils/tools'
const app = getApp()
interface LoginUser { id: number; accessToken: string; userType?: string; nickName?: string }
Page({
  data: { loading: false, error: '' },
  onGetPhoneNumber(event: { detail: { code?: string } }) {
    if (this.data.loading) return
    const code = event.detail.code
    if (!code) { this.setData({ error: '需要授权手机号才能登录，您可重新尝试。' }); return }
    wx.showModal({
      title: '免责与隐私保护声明',
      content: 'AI回答内容由大模型自动生成，仅供参考。回答内容可能存在误差或不完整，请勿完全依赖，重要决策前请务必核实。使用本服务即表示您理解并同意自行承担相关风险。为持续提升服务质量，我们可能会将您的问答数据用于模型优化与提升。我们承诺采取必要的安全措施，保障您的数据隐私安全。',
      confirmText: '同意',
      success: result => { if (result.confirm) this.login(code) },
    })
  },
  login(code: string) {
    this.setData({ loading: true, error: '' })
    wx.request<{ code: number; message?: string; data?: LoginUser }>({
      url: `${app.globalData.baseHost}/wx/getPhone`, method: 'POST', data: { code, nickName: '微信用户' },
      success: result => {
        const user = result.data.data
        if (result.statusCode !== 200 || result.data.code !== 2000 || !user?.id || !user.accessToken || user.userType === 'GUEST') {
          this.setData({ error: result.data.message || '登录失败，请重试' }); return
        }
        wx.setStorageSync('pangoAccessToken', user.accessToken)
        persistUserInfo(user)
        app.globalData.flagLogin = true
        app.globalData.licenseLoginChanged = true
        wx.navigateBack({ delta: 1 })
      },
      fail: () => this.setData({ error: '网络连接失败，请重试' }),
      complete: () => this.setData({ loading: false }),
    })
  },
})
