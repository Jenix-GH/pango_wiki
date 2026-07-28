import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import pangoLogo from '../../Logo.png'
import './LoginPage.css'

export default function LoginPage() {
  const { login, isLoggedIn, user } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    setLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch {
      setError('登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src={pangoLogo} alt="Pango" />
        </div>
        <h1 className="login-title">Pango慧答</h1>
        <p className="login-subtitle">
          FPGA芯片选型，应用智能问答
        </p>
        {isLoggedIn ? (
          <div className="login-logged">
            <p>您已登录：{user?.nickName}</p>
            <button className="login-btn" onClick={() => navigate('/')}>进入聊天</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <input
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                autoFocus
              />
            </div>
            <div className="form-group">
              <input
                type="password"
                placeholder="请输入密码（可留空）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? '登录中...' : '开始体验'}
            </button>
          </form>
        )}
        <p className="login-footer">Supported by Pango Marketing Center</p>
      </div>
    </div>
  )
}
