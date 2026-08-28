import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../api/client'
import './SettingsPanel.css'

type Page = 'menu' | 'userinfo' | 'company' | 'contactUs'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SettingsPanel({ open, onClose }: Props) {
  const { user, updateUser, setFlagCompanyInfo } = useAuth()
  const [page, setPage] = useState<Page>('menu')
  const [nickName, setNickName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [jobName, setJobName] = useState('')
  const [mailAddress, setMailAddress] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setPage('menu')
  }, [open])

  const handleSaveUserInfo = async () => {
    if (!user) return
    setLoading(true)
    const data = { ...user, nickName, companyName, jobName, mailAddress }
    const res = await api.updateUserInfo(data)
    if (res.code === 2000) {
      updateUser({ nickName, companyName, jobName, mailAddress })
      if (companyName.trim()) setFlagCompanyInfo(true)
      else setFlagCompanyInfo(false)
      toast('保存成功')
    } else {
      toast('保存失败')
    }
    setLoading(false)
  }

  if (!open) return null

  return (
    <>
      <div className="settings-mask" onClick={onClose} />
      <div className="settings-panel">
        <div className="settings-header">
          {page !== 'menu' && (
            <button className="settings-back" onClick={() => setPage('menu')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <span className="settings-title">
            {page === 'menu' ? '设置' :
             page === 'userinfo' ? '个人信息' :
             page === 'company' ? '紫光同创' : '联系我们'}
          </span>
        </div>

        {page === 'menu' && (
          <div className="settings-list">
            <div className="settings-group">
              <div className="settings-label">账户</div>
              <button className="settings-item" onClick={() => { setPage('userinfo'); setNickName(user?.nickName || ''); setCompanyName(user?.companyName || ''); setJobName(user?.jobName || ''); setMailAddress(user?.mailAddress || ''); }}>个人信息</button>
            </div>
            <div className="settings-group">
              <div className="settings-label">关于</div>
              <button className="settings-item" onClick={() => setPage('company')}>紫光同创</button>
              <button className="settings-item" onClick={() => setPage('contactUs')}>联系我们</button>
            </div>
          </div>
        )}

        {page === 'userinfo' && (
          <div className="settings-form">
            <div className="form-field">
              <label>昵称</label>
              <input value={nickName} onChange={(e) => setNickName(e.target.value)} placeholder="请输入昵称" />
            </div>
            <div className="form-field">
              <label>邮箱</label>
              <input value={mailAddress} onChange={(e) => setMailAddress(e.target.value)} placeholder="请输入邮箱" />
            </div>
            <div className="form-field">
              <label>公司名称</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="请输入公司名称（完善后解除次数限制）" />
            </div>
            <div className="form-field">
              <label>职位</label>
              <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="请输入职位" />
            </div>
            <button className="settings-save-btn" onClick={handleSaveUserInfo} disabled={loading}>
              {loading ? '保存中...' : '保存信息'}
            </button>
          </div>
        )}

        {page === 'company' && (
          <div className="settings-content">
            <p>深圳市紫光同创电子股份有限公司，专业从事可编程系统平台芯片及其配套EDA开发工具的研发与销售，致力于为客户提供完善的、具有自主知识产权的可编程逻辑器件平台和系统解决方案。公司是国家高新技术企业，拥有高中低端全系列产品，产品覆盖通信、工业控制、图像视频、消费电子等应用领域。</p>
            <p>紫光同创秉承“客户至上、奋斗为本、集成创新、至臻致远”核心价值观，立足中国大陆本土，以全球化思维布局，总部设在深圳，拥有上海、北京、成都等研发中心。</p>
          </div>
        )}

        {page === 'contactUs' && (
          <div className="settings-content">
            {[
              { title: '深圳总公司', phone: '86-755-66886188', fax: '86-755-86363368', code: '518000', email: 'marketing@pangomicro.com', addr: '深圳市南山区高新技术产业园高新南一道15号' },
              { title: '上海子公司', phone: '021-54652018', fax: '021-64856887', code: '200233', email: 'marketing@pangomicro.com', addr: '上海市漕河泾开发区桂平路391号新漕河泾国际商务中心A座901-902室' },
              { title: '成都子公司', phone: '028-86736086', code: '610095', email: 'marketing@pangomicro.com', addr: '成都高新区益州大道中段2555号紫光芯云中心B座25楼' },
              { title: '北京分公司', code: '100191', email: 'marketing@pangomicro.com', addr: '北京市朝阳区光华路众秀大厦37层3707' },
            ].map((c, i) => (
              <div key={i} className="contact-card">
                <h4>{c.title}</h4>
                {c.phone && <p>电话：{c.phone}</p>}
                {c.fax && <p>传真：{c.fax}</p>}
                <p>邮编：{c.code}</p>
                <p>邮箱：{c.email}</p>
                <p>地址：{c.addr}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function toast(msg: string) {
  const el = document.createElement('div')
  el.className = 'toast-temp'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1500)
}
