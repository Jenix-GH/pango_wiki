import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { MyLicensePage } from '../api/types'
import { useAuth } from '../contexts/AuthContext'
import TopBar from '../components/TopBar'
import SettingsPanel from '../components/SettingsPanel'
import './LicenseApplicationPage.css'

const statuses = ['待处理', '处理中', '已处理', '已拒绝']

export default function MyLicensesPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, logout } = useAuth()
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<MyLicensePage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    let active = true
    setData(null)
    setError('')
    if (!user) return
    setLoading(true)
    setNeedsLogin(false)
    void api.getMyLicenses(page).then(result => {
      if (!active) return
      if (result.code === 401) { setNeedsLogin(true); logout() }
      if (result.code !== 2000) throw new Error(result.message || '加载失败')
      setData(result.data)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user?.id, page, revision, logout])

  const download = async (id: number, filename: string) => {
    setDownloading(id)
    setError('')
    try {
      const blob = await api.downloadLicense(id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) { setNeedsLogin(true); logout() }
      setError(cause instanceof Error ? cause.message : '下载失败')
    } finally { setDownloading(null) }
  }

  return <div className="license-page">
    <TopBar active="license" userLabel={user?.nickName || '访客'} onOpenChat={() => navigate('/')} onOpenWiki={() => navigate('/docs')} onOpenLicense={() => navigate('/license-application')} onOpenUser={() => setSettings(true)} />
    <main className="license-main">
      <section className="license-card">
        <div className="license-heading"><span>个人中心</span><h1>我的 License 申请</h1><p>查看申请进度，下载已匹配的 License 文件。</p></div>
        <div className="license-portal-links"><button onClick={() => navigate('/license-application')}>申请 License</button><button disabled={loading || !user} onClick={() => setRevision(value => value + 1)}>刷新</button></div>
        {authLoading ? <p role="status">正在验证登录…</p> : !user || needsLogin ? <div className="license-message"><p>请登录后查看自己的申请记录。</p><button onClick={() => navigate('/login?returnTo=/my-licenses')}>登录 / 注册</button></div> : <>
          {loading ? <p role="status">正在加载申请…</p> : null}
          {error ? <p role="alert" className="license-message error">{error}</p> : null}
          {data?.records.length === 0 ? <p className="license-empty">暂无 License 申请</p> : null}
          <div className="my-license-list">{data?.records.map(row => <article className="my-license-item" key={row.id}>
            <div className="my-license-title"><h2>{row.softwareVersion}</h2><span className={`license-status status-${row.status}`}>{statuses[row.status] || '状态待确认'}</span></div>
            <dl><div><dt>提交时间</dt><dd>{new Date(row.submittedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</dd></div><div><dt>MAC 地址</dt><dd>{row.macAddress}</dd></div><div><dt>授权信息</dt><dd>{row.operatingSystem} / {row.licenseType} / {row.durationYears}年</dd></div><div><dt>官网已提交</dt><dd>{row.officialSubmitted == null ? '未记录' : row.officialSubmitted ? '是' : '否'}</dd></div></dl>
            {row.status === 3 ? <p className="license-message error">拒绝理由：{row.rejectionReason || '暂无记录，请联系对接人员'}</p> : null}
            {row.canDownload && row.filename ? <button disabled={downloading !== null} onClick={() => void download(row.id, row.filename!)}>{downloading === row.id ? '下载中…' : '下载 License'}</button> : row.status !== 3 ? <p className="license-file-note">文件暂不可下载，请稍后刷新。</p> : null}
          </article>)}</div>
          {data && data.total > data.pageSize ? <div className="license-portal-links"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} / {Math.ceil(data.total / data.pageSize)} 页</span><button disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页</button></div> : null}
          <p className="license-file-note">历史申请仍由后台处理；尚未核实账户归属的记录不会在此显示。如需关联，请联系对接人员核对。</p>
        </>}
      </section>
    </main>
    <SettingsPanel open={settings} onClose={() => setSettings(false)} />
  </div>
}
