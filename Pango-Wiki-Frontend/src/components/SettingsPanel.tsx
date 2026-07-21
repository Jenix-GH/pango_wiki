import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../api/client'
import './SettingsPanel.css'

type Page = 'menu' | 'userinfo' | 'dataManager' | 'company' | 'contactUs'

interface Props {
  open: boolean
  onClose: () => void
  onDeleteHistory: () => void
}

export default function SettingsPanel({ open, onClose, onDeleteHistory }: Props) {
  const { user, updateUser, setFlagCompanyInfo } = useAuth()
  const [page, setPage] = useState<Page>('menu')
  const [nickName, setNickName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [jobName, setJobName] = useState('')
  const [mailAddress, setMailAddress] = useState('')
  const [flagUseData, setFlagUseData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const handleChangeDataFlag = async () => {
    if (!user) return
    const newVal = flagUseData ? 0 : 1
    const res = await api.updateDataFlag({ id: user.id, flagUseData: newVal as 0 | 1 })
    if (res.code === 2000) {
      setFlagUseData(!flagUseData)
      toast('设置成功')
    }
  }

  const handleDeleteHistory = async () => {
    if (!user || !confirm('确定要删除所有历史对话吗？')) return
    setDeleting(true)
    const res = await api.deleteHistory({ userinfoId: user.id })
    if (res.code === 2000) {
      onDeleteHistory()
      toast('已删除')
    }
    setDeleting(false)
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
             page === 'dataManager' ? '数据管理' :
             page === 'company' ? '紫光同创' : '联系我们'}
          </span>
        </div>

        {page === 'menu' && (
          <div className="settings-list">
            <div className="settings-group">
              <div className="settings-label">账户</div>
              <button className="settings-item" onClick={() => { setPage('userinfo'); setNickName(user?.nickName || ''); setCompanyName(user?.companyName || ''); setJobName(user?.jobName || ''); setMailAddress(user?.mailAddress || ''); }}>个人信息</button>
              <button className="settings-item" onClick={() => setPage('dataManager')}>数据管理</button>
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

        {page === 'dataManager' && (
          <div className="settings-form">
            <div className="data-option">
              <div className="data-option-info">
                <div className="data-option-title">数据用于训练优化</div>
                <div className="data-option-desc">允许我们将您的对话内容用于大模型的优化训练</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={flagUseData} onChange={handleChangeDataFlag} />
                <span className="toggle-slider" />
              </label>
            </div>
            <button className="delete-btn" onClick={handleDeleteHistory} disabled={deleting}>
              {deleting ? '删除中...' : '删除所有历史对话'}
            </button>
          </div>
        )}

        {page === 'company' && (
          <div className="settings-content">
            <h3>深圳市紫光同创电子股份有限公司</h3>
            <p>紫光同创是中国领先的FPGA芯片及解决方案提供商，专注于可编程逻辑器件（FPGA）的研发、生产和销售。</p>
            <p>公司拥有完整的FPGA产品线，覆盖从低密度到高密度的各类应用场景，产品广泛应用于通信、工业控制、数据中心、人工智能等领域。</p>
            <p>紫光同创致力于打造自主可控的FPGA核心技术，推动国产芯片的持续创新与发展。</p>
          </div>
        )}

        {page === 'contactUs' && (
          <div className="settings-content">
            {[
              { title: '深圳总部', phone: '0755-26908911', fax: '0755-26908900', email: 'info@pangomicro.com', addr: '深圳市南山区粤海街道高新区社区高新南一道002号飞亚达科技大厦' },
              { title: '上海分公司', phone: '021-50805678', fax: '021-50805679', email: 'sh@pangomicro.com', addr: '上海市浦东新区张江高科技园区祖冲之路1077号' },
              { title: '成都分公司', phone: '028-85336789', fax: '028-85336780', email: 'cd@pangomicro.com', addr: '成都市高新区天府大道中段1366号天府软件园' },
              { title: '北京办事处', phone: '010-82607890', fax: '010-82607891', email: 'bj@pangomicro.com', addr: '北京市海淀区中关村东路1号清华科技园' },
            ].map((c, i) => (
              <div key={i} className="contact-card">
                <h4>{c.title}</h4>
                <p>电话：{c.phone}</p>
                <p>传真：{c.fax}</p>
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
