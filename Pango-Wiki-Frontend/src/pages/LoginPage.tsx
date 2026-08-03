import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import pangoLogo from '../../Logo.png'
import './LoginPage.css'

type Mode = 'login' | 'register' | 'reset'

export default function LoginPage() {
  const { login, register, sendSmsCode, resetPassword, isLoggedIn, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickName, setNickName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [jobName, setJobName] = useState('')
  const [mailAddress, setMailAddress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError('')
    setNotice('')
    setCode('')
    setPassword('')
    setConfirmPassword('')
    setNickName('')
    setCompanyName('')
    setJobName('')
    setMailAddress('')
    setCountdown(0)
  }

  const validatePhone = () => /^1[3-9]\d{9}$/.test(phone)

  const sendCode = async () => {
    setError('')
    setNotice('')
    if (!validatePhone()) {
      setError('请输入正确的中国大陆手机号')
      return
    }
    try {
      setLoading(true)
      await sendSmsCode(phone, mode === 'reset' ? 'RESET_PASSWORD' : 'REGISTER')
      setCountdown(60)
      setNotice('验证码已发送，5分钟内有效')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '验证码发送失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!validatePhone()) {
      setError('请输入正确的中国大陆手机号')
      return
    }
    if (password.length < 8) {
      setError('密码至少需要8位')
      return
    }
    if (mode !== 'login' && !/^\d{6}$/.test(code)) {
      setError('请输入6位短信验证码')
      return
    }
    if (mode !== 'login' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (mode === 'register' && mailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailAddress)) {
      setError('请输入正确的邮箱地址')
      return
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        await login(phone, password)
        navigate('/')
      } else if (mode === 'register') {
        await register(phone, code, password, { nickName, companyName, jobName, mailAddress })
        navigate('/')
      } else {
        await resetPassword(phone, code, password)
        changeMode('login')
        setNotice('密码修改成功，请使用新密码登录')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className={`login-card ${mode === 'register' ? 'register-card' : ''}`}>
        <button type="button" className="login-home-link" onClick={() => navigate('/')} aria-label="返回主页">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回主页
        </button>
        <div className="login-logo"><img src={pangoLogo} alt="Pango" /></div>
        <h1 className="login-title">Pango慧答</h1>
        <p className="login-subtitle">一个手机号连接网页与小程序的问答记录</p>
        {isLoggedIn ? (
          <div className="login-logged">
            <p>您已登录：{user?.nickName || user?.phoneNumber}</p>
            <button className="login-btn" onClick={() => navigate('/')}>进入聊天</button>
          </div>
        ) : (
          <>
            <div className="auth-tabs">
              <button className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>密码登录</button>
              <button className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>手机注册</button>
            </div>
            <form onSubmit={handleSubmit} className={`login-form ${mode === 'register' ? 'register-form' : ''}`}>
              {mode === 'login' ? <input type="tel" inputMode="numeric" maxLength={11} placeholder="请输入手机号" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} className="form-input" autoFocus /> : null}
              {mode === 'register' ? (
                <div className="register-profile-fields">
                  <input maxLength={30} placeholder="昵称（选填）" value={nickName} onChange={(event) => setNickName(event.target.value)} className="form-input" />
                  <input maxLength={200} placeholder="公司名称（选填）" value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="form-input" />
                  <input maxLength={100} placeholder="职位（选填）" value={jobName} onChange={(event) => setJobName(event.target.value)} className="form-input" />
                  <input type="email" maxLength={200} placeholder="电子邮箱（选填）" value={mailAddress} onChange={(event) => setMailAddress(event.target.value)} className="form-input" />
                </div>
              ) : null}
              <input type="password" maxLength={64} placeholder={mode === 'reset' ? '设置新密码（至少8位）' : '请输入密码（至少8位）'} value={password} onChange={(event) => setPassword(event.target.value)} className="form-input" />
              {mode !== 'login' ? <input type="password" maxLength={64} placeholder="再次输入密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="form-input" /> : null}
              {mode !== 'login' ? (
                <>
                  <input type="tel" inputMode="numeric" maxLength={11} placeholder="请输入手机号" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} className="form-input" autoFocus />
                  <div className="code-row">
                    <input inputMode="numeric" maxLength={6} placeholder="6位验证码" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className="form-input" />
                    <button type="button" disabled={loading || countdown > 0} onClick={() => void sendCode()}>{countdown > 0 ? `${countdown}秒` : '获取验证码'}</button>
                  </div>
                </>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-notice">{notice}</p> : null}
              <button type="submit" className="login-btn" disabled={loading}>{loading ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '确认修改密码'}</button>
              <button type="button" className="auth-link" onClick={() => changeMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? '返回密码登录' : '忘记密码？通过手机验证修改'}</button>
            </form>
          </>
        )}
        <p className="login-footer">Supported by Pango Marketing Center</p>
      </div>
    </div>
  )
}
