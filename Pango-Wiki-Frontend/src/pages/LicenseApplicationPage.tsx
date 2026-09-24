import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { LicenseApplicationPayload, UserInfo } from '../api/types'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import './LicenseApplicationPage.css'

const createInitialForm = (user: UserInfo | null): LicenseApplicationPayload => ({
  operatingSystem: 'Windows',
  softwareVersion: '',
  licenseType: 'STANDALONE',
  durationYears: 1,
  macAddress: '',
  address: '',
  officialSubmitted: false,
  applicantName: user?.nickName || '',
  companyName: user?.companyName || '',
  email: user?.mailAddress || '',
  phone: user?.phoneNumber || '',
})

export default function LicenseApplicationPage() {
  const navigate = useNavigate()
  const { user, loading, logout } = useAuth()
  const [form, setForm] = useState<LicenseApplicationPayload>(() => {
    try {
      const raw = sessionStorage.getItem('pango_license_draft')
      if (raw) {
        const draft = JSON.parse(raw)
        if (Date.now() - draft.savedAt < 60 * 60 * 1000) return { ...createInitialForm(user), ...draft.form }
      }
    } catch { /* Ignore an expired or invalid local draft. */ }
    return createInitialForm(user)
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    sessionStorage.removeItem('pango_license_draft')
    if (user) setForm(previous => ({ ...previous,
      applicantName: previous.applicantName || user.nickName || '',
      companyName: previous.companyName || user.companyName || '',
      email: previous.email || user.mailAddress || '',
      phone: previous.phone || user.phoneNumber || '',
    }))
  }, [user])

  const goLogin = () => {
    sessionStorage.setItem('pango_license_draft', JSON.stringify({ form, savedAt: Date.now() }))
    navigate('/login?returnTo=/license-application')
  }

  const update = <K extends keyof LicenseApplicationPayload>(key: K, value: LicenseApplicationPayload[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!user) { goLogin(); return }
    if (!/^[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/.test(form.macAddress)) {
      setError('请输入正确的 MAC 地址，例如：00-1A-2B-3C-4D-5E')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('请输入正确的邮箱地址')
      return
    }
    try {
      setSubmitting(true)
      const response = await api.submitLicenseApplication({
        ...form,
        macAddress: form.macAddress.toUpperCase(),
      })
      if (response.code === 401) { logout(); goLogin(); return }
      if (response.code !== 2000) throw new Error(response.message || '提交失败')
      setForm(createInitialForm(user))
      setSuccess('申请已提交，我们将在审核后与您联系')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="license-page">
      <TopBar
        active="license"
        userLabel={user?.nickName || '访客'}
        onOpenChat={() => navigate('/')}
        onOpenWiki={() => navigate('/docs')}
        onOpenLicense={() => undefined}
        onOpenUser={() => navigate('/my-licenses')}
      />
      <main className="license-main">
        <section className="license-card">
          <div className="license-heading">
            <span>软件授权服务</span>
            <h1>PDS License 申请</h1>
            <p>请准确填写软件运行环境和申请人信息，我们将在审核后与您联系。</p>
          </div>
          <div className="license-portal-links"><button type="button" onClick={() => navigate('/my-licenses')}>查看我的 License 申请</button></div>
          {!loading && !user ? <div className="license-message"><p>登录后才能提交申请，已填写的内容会为您保留。</p><button type="button" onClick={goLogin}>登录 / 注册</button></div> : null}
          <form className="license-form" onSubmit={submit}>
            <fieldset>
              <legend>授权信息</legend>
              <label>是否已在官网提交<select value={String(form.officialSubmitted)} onChange={event => update('officialSubmitted', event.target.value === 'true')}><option value="false">否</option><option value="true">是</option></select></label>
              {form.officialSubmitted ? <p className="license-message" role="status">正在加急处理中，请勿重复提交</p> : null}
              <div className="license-grid">
                <label>操作系统版本<select value={form.operatingSystem} onChange={(event) => update('operatingSystem', event.target.value as 'Windows' | 'Linux')}><option>Windows</option><option>Linux</option></select></label>
                <label>软件版本<input required maxLength={50} value={form.softwareVersion} onChange={(event) => update('softwareVersion', event.target.value)} placeholder="请输入软件版本号" /></label>
              </div>
              <div className="license-label">授权类型</div>
              <div className="license-options">
                <label className={form.licenseType === 'STANDALONE' ? 'selected' : ''}><input type="radio" name="licenseType" checked={form.licenseType === 'STANDALONE'} onChange={() => update('licenseType', 'STANDALONE')} /><strong>单机版</strong><span>支持单一用户使用</span></label>
                <label className={form.licenseType === 'SERVER' ? 'selected' : ''}><input type="radio" name="licenseType" checked={form.licenseType === 'SERVER'} onChange={() => update('licenseType', 'SERVER')} /><strong>服务器版</strong><span>支持多用户使用</span></label>
              </div>
              <div className="license-grid">
                <label>使用时长<select value={form.durationYears} onChange={(event) => update('durationYears', Number(event.target.value) as 1 | 2 | 3)}><option value={1}>1年</option><option value={2}>2年</option><option value={3}>3年</option></select></label>
                <label>MAC 地址<input required maxLength={17} value={form.macAddress} onChange={(event) => update('macAddress', event.target.value.toUpperCase())} placeholder="00-1A-2B-3C-4D-5E" /></label>
              </div>
            </fieldset>
            <fieldset>
              <legend>申请人信息</legend>
              <div className="license-grid">
                <label>申请人<input required maxLength={100} value={form.applicantName} onChange={(event) => update('applicantName', event.target.value)} placeholder="请输入申请人姓名" /></label>
                <label>公司或学校<input required maxLength={200} value={form.companyName} onChange={(event) => update('companyName', event.target.value)} placeholder="请输入公司或学校名称" /></label>
                <label>邮箱<input required type="email" maxLength={200} value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@company.com" /></label>
                <label>电话<input required maxLength={50} value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="请输入联系电话" /></label>
                <label className="full-row">地址<textarea required maxLength={500} value={form.address} onChange={(event) => update('address', event.target.value)} placeholder="请输入详细地址" /></label>
              </div>
            </fieldset>
            {error ? <div className="license-message error" role="alert">{error}</div> : null}
            {success ? <div className="license-message success">{success}</div> : null}
            <div className="license-actions"><button type="submit" disabled={submitting || loading} formNoValidate={!user}>{submitting ? '提交中…' : user ? '提交申请' : '登录后提交申请'}</button></div>
          </form>
        </section>
      </main>
    </div>
  )
}
