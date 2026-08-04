import './style.css'

const state = {
  apiBase: localStorage.getItem('pango_admin_api') || '/dbServ',
  adminKey: sessionStorage.getItem('pango_admin_key') || '',
  tab: 'dashboard',
  days: 30,
  eventPage: 1,
  feedbackPage: 1,
  licensePage: 1,
  eventName: '',
  clientType: '',
  feedbackStatus: '',
  licenseStatus: '',
}

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">P</span><div><strong>Pango 运营中控台</strong><small>访问、反馈与 License 管理</small></div></div>
    <div class="connection"><span id="connectionDot"></span><span id="connectionText">未连接</span><button id="settingsButton">连接设置</button></div>
  </header>
  <div class="shell">
    <aside>
      <nav>
        <button data-tab="dashboard" class="active">数据概览</button>
        <button data-tab="events">访问明细</button>
        <button data-tab="feedback">问题反馈</button>
        <button data-tab="licenses">License 申请</button>
      </nav>
      <p>仅供内部管理员本地使用</p>
    </aside>
    <main id="content"></main>
  </div>
  <dialog id="settingsDialog">
    <form method="dialog" id="settingsForm">
      <h2>连接设置</h2>
      <label>后端接口地址<input id="apiBase" placeholder="/dbServ" /></label>
      <label>管理密钥<input id="adminKey" type="password" autocomplete="current-password" placeholder="ADMIN_CONSOLE_KEY" /></label>
      <p>密钥只保存在当前浏览器会话中，不会写入项目文件。</p>
      <div><button value="cancel" class="secondary">取消</button><button value="default" id="saveSettings">保存并连接</button></div>
    </form>
  </dialog>
`

const content = document.querySelector('#content')
const dialog = document.querySelector('#settingsDialog')

document.querySelector('#settingsButton').addEventListener('click', () => {
  document.querySelector('#apiBase').value = state.apiBase
  document.querySelector('#adminKey').value = state.adminKey
  dialog.showModal()
})

document.querySelector('#saveSettings').addEventListener('click', (event) => {
  event.preventDefault()
  state.apiBase = document.querySelector('#apiBase').value.trim().replace(/\/$/, '') || '/dbServ'
  state.adminKey = document.querySelector('#adminKey').value.trim()
  localStorage.setItem('pango_admin_api', state.apiBase)
  sessionStorage.setItem('pango_admin_key', state.adminKey)
  dialog.close()
  loadCurrentTab()
})

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab
    document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button))
    loadCurrentTab()
  })
})

async function request(path, options = {}) {
  if (!state.adminKey) throw new Error('请先配置管理密钥')
  const response = await fetch(`${state.apiBase}/admin/console${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': state.adminKey,
      ...(options.headers || {}),
    },
  })
  const result = await response.json()
  if (!response.ok || result.code !== 2000) throw new Error(result.message || `HTTP ${response.status}`)
  setConnected(true)
  return result.data
}

function setConnected(connected, message = '') {
  document.querySelector('#connectionDot').className = connected ? 'online' : 'offline'
  document.querySelector('#connectionText').textContent = connected ? '已连接' : message || '连接失败'
}

function showLoading() {
  content.innerHTML = '<div class="loading">正在读取数据…</div>'
}

function showError(error) {
  setConnected(false, '连接失败')
  content.innerHTML = ''
  const box = element('div', 'error-panel')
  box.append(element('h2', '', '无法读取管理数据'), element('p', '', error.message || String(error)))
  const button = element('button', '', '检查连接设置')
  button.addEventListener('click', () => document.querySelector('#settingsButton').click())
  box.append(button)
  content.append(box)
}

async function loadCurrentTab() {
  showLoading()
  try {
    if (state.tab === 'dashboard') await loadDashboard()
    if (state.tab === 'events') await loadEvents()
    if (state.tab === 'feedback') await loadFeedback()
    if (state.tab === 'licenses') await loadLicenses()
  } catch (error) {
    showError(error)
  }
}

async function loadDashboard() {
  const data = await request(`/dashboard?days=${state.days}`)
  const summary = data.summary || {}
  content.innerHTML = `
    <section class="page-heading"><div><p>OPERATIONS OVERVIEW</p><h1>数据概览</h1><span>最近 ${state.days} 天</span></div><select id="days"><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option></select></section>
    <section class="metrics" id="metrics"></section>
    <section class="grid"><article class="panel"><h2>访问趋势</h2><div id="trend" class="trend"></div></article><article class="panel"><h2>事件分布</h2><div id="breakdown"></div></article></section>
    <section class="grid small"><article class="panel"><h2>热门文档</h2><div id="documents"></div></article><article class="panel"><h2>待处理事项</h2><div class="pending"><button data-go="feedback"><strong>${number(data.pendingFeedback)}</strong><span>待处理反馈</span></button><button data-go="licenses"><strong>${number(data.pendingLicense)}</strong><span>待处理 License</span></button></div></article></section>
  `
  document.querySelector('#days').value = String(state.days)
  document.querySelector('#days').addEventListener('change', (event) => { state.days = Number(event.target.value); loadDashboard() })
  const successRate = Number(summary.chat_submit) ? `${Math.round(number(summary.chat_success) / number(summary.chat_submit) * 100)}%` : '--'
  const cards = [
    ['PV', summary.pv, '页面访问次数'], ['UV', summary.uv, '独立访客'], ['提问', summary.chat_submit, '模型请求'],
    ['成功率', successRate, '完成回答'], ['文档阅读', summary.document_read, '在线阅读'], ['下载', summary.document_download, '文件下载'],
  ]
  cards.forEach(([label, value, hint]) => {
    const card = element('article', 'metric')
    card.append(element('span', '', label), element('strong', '', typeof value === 'string' ? value : number(value).toLocaleString()), element('small', '', hint))
    document.querySelector('#metrics').append(card)
  })
  renderTrend(data.trend || [])
  renderBreakdown(data.eventBreakdown || [])
  renderDocuments(data.popularDocuments || [])
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.go)))
}

function renderTrend(rows) {
  const host = document.querySelector('#trend')
  const max = Math.max(1, ...rows.map((row) => number(row.pv)))
  rows.forEach((row) => {
    const item = element('div', 'trend-row')
    item.append(element('span', '', date(row.stat_date)))
    const bar = element('div', 'bar-track')
    const fill = element('i', 'bar-fill')
    fill.style.width = `${Math.max(2, number(row.pv) / max * 100)}%`
    bar.append(fill)
    item.append(bar, element('strong', '', `${number(row.pv)} / ${number(row.uv)}`))
    host.append(item)
  })
  if (!rows.length) host.append(element('p', 'empty', '暂无访问数据'))
}

function renderBreakdown(rows) {
  const host = document.querySelector('#breakdown')
  rows.slice(0, 12).forEach((row) => {
    const item = element('div', 'breakdown-row')
    item.append(element('span', '', eventLabel(row.event_name)), element('small', '', row.client_type), element('strong', '', number(row.event_count).toLocaleString()))
    host.append(item)
  })
  if (!rows.length) host.append(element('p', 'empty', '暂无事件数据'))
}

function renderDocuments(rows) {
  const host = document.querySelector('#documents')
  rows.forEach((row, index) => {
    const item = element('div', 'document-row')
    item.append(element('b', '', String(index + 1)), element('span', '', row.document_id || '未知文档'), element('strong', '', `${number(row.read_count)} 次`))
    host.append(item)
  })
  if (!rows.length) host.append(element('p', 'empty', '暂无文档阅读数据'))
}

async function loadEvents() {
  const data = await request(`/events?page=${state.eventPage}&pageSize=50&eventName=${encodeURIComponent(state.eventName)}&clientType=${encodeURIComponent(state.clientType)}`)
  renderListPage('访问明细', `共 ${number(data.total)} 条事件`, `
    <select id="eventFilter"><option value="">全部事件</option>${eventOptions()}</select>
    <select id="clientFilter"><option value="">全部终端</option><option>WEB</option><option>MINIPROGRAM</option></select>
  `)
  document.querySelector('#eventFilter').value = state.eventName
  document.querySelector('#clientFilter').value = state.clientType
  const table = createTable(['时间', '事件', '终端', '页面', '用户', '会话 / 文档'])
  ;(data.records || []).forEach((row) => appendRow(table, [dateTime(row.event_time), eventLabel(row.event_name), row.client_type, row.page_path, row.visitor_id, row.document_id || row.session_id || '—']))
  content.querySelector('.panel').append(table)
  document.querySelector('#eventFilter').addEventListener('change', (event) => { state.eventName = event.target.value; state.eventPage = 1; loadEvents() })
  document.querySelector('#clientFilter').addEventListener('change', (event) => { state.clientType = event.target.value; state.eventPage = 1; loadEvents() })
  appendPager(data, state.eventPage, (page) => { state.eventPage = page; loadEvents() })
}

async function loadFeedback() {
  const data = await request(`/feedback?page=${state.feedbackPage}&pageSize=30&status=${state.feedbackStatus}`)
  renderListPage('问题反馈', `共 ${number(data.total)} 条反馈`, statusFilter())
  document.querySelector('#statusFilter').value = state.feedbackStatus
  const table = createTable(['提交时间', '平台', '类型', '问题', '补充说明', '联系人', '状态'])
  ;(data.records || []).forEach((row) => {
    const statusSelect = createStatusSelect(row.status, feedbackStatuses, (value) => updateStatus('feedback', row.id, value, loadFeedback))
    appendRow(table, [dateTime(row.dotime), row.platform, row.feedback_type, row.question_content, row.detail || '—', row.contact_name || row.email || row.phone || '—', statusSelect])
  })
  content.querySelector('.panel').append(table)
  document.querySelector('#statusFilter').addEventListener('change', (event) => { state.feedbackStatus = event.target.value; state.feedbackPage = 1; loadFeedback() })
  appendPager(data, state.feedbackPage, (page) => { state.feedbackPage = page; loadFeedback() })
}

async function loadLicenses() {
  const data = await request(`/licenses?page=${state.licensePage}&pageSize=30&status=${state.licenseStatus}`)
  renderListPage('License 申请', `共 ${number(data.total)} 条申请`, statusFilter())
  document.querySelector('#statusFilter').value = state.licenseStatus
  const table = createTable(['提交时间', '申请人', '公司', '系统 / 版本', '类型 / 年限', 'MAC 地址', '联系方式', '状态'])
  ;(data.records || []).forEach((row) => {
    const statusSelect = createStatusSelect(row.status, licenseStatuses, (value) => updateStatus('licenses', row.id, value, loadLicenses))
    appendRow(table, [dateTime(row.dotime), row.applicant_name, row.company_name, `${row.operating_system} / ${row.software_version}`, `${row.license_type} / ${row.duration_years}年`, row.mac_address, `${row.email || ''}\n${row.phone || ''}`, statusSelect])
  })
  content.querySelector('.panel').append(table)
  document.querySelector('#statusFilter').addEventListener('change', (event) => { state.licenseStatus = event.target.value; state.licensePage = 1; loadLicenses() })
  appendPager(data, state.licensePage, (page) => { state.licensePage = page; loadLicenses() })
}

function renderListPage(title, subtitle, filters) {
  content.innerHTML = `<section class="page-heading"><div><p>DATA MANAGEMENT</p><h1>${title}</h1><span>${subtitle}</span></div><div class="filters">${filters}</div></section><section class="panel table-panel"></section>`
}

function createTable(headers) {
  const wrap = element('div', 'table-wrap')
  const table = document.createElement('table')
  const head = document.createElement('thead')
  const row = document.createElement('tr')
  headers.forEach((header) => row.append(element('th', '', header)))
  head.append(row)
  table.append(head, document.createElement('tbody'))
  wrap.append(table)
  return wrap
}

function appendRow(wrap, values) {
  const row = document.createElement('tr')
  values.forEach((value) => {
    const cell = document.createElement('td')
    if (value instanceof Node) cell.append(value)
    else cell.textContent = value == null ? '—' : String(value)
    row.append(cell)
  })
  wrap.querySelector('tbody').append(row)
}

function createStatusSelect(current, options, onChange) {
  const select = document.createElement('select')
  select.className = `status status-${current}`
  options.forEach((label, value) => {
    const option = document.createElement('option')
    option.value = String(value); option.textContent = label; option.selected = Number(current) === value
    select.append(option)
  })
  select.addEventListener('change', () => onChange(Number(select.value)))
  return select
}

async function updateStatus(type, id, status, reload) {
  try {
    await request(`/${type}/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
    await reload()
  } catch (error) { alert(error.message) }
}

function appendPager(data, current, change) {
  const pages = Math.max(1, Math.ceil(number(data.total) / number(data.pageSize || 30)))
  const pager = element('div', 'pager')
  const previous = element('button', '', '上一页'); previous.disabled = current <= 1
  const next = element('button', '', '下一页'); next.disabled = current >= pages
  previous.addEventListener('click', () => change(current - 1)); next.addEventListener('click', () => change(current + 1))
  pager.append(previous, element('span', '', `${current} / ${pages}`), next)
  content.querySelector('.panel').append(pager)
}

function switchTab(tab) { document.querySelector(`[data-tab="${tab}"]`).click() }
function statusFilter() { return '<select id="statusFilter"><option value="">全部状态</option><option value="0">待处理</option><option value="1">处理中</option><option value="2">已处理/通过</option><option value="3">已关闭/拒绝</option></select>' }
function eventOptions() { return ['page_view','chat_submit','chat_success','chat_failed','wiki_view','document_read','document_download','reference_open','answer_image_view','user_guide_view'].map((name) => `<option value="${name}">${eventLabel(name)}</option>`).join('') }
function eventLabel(name) { return ({ page_view:'页面访问',chat_submit:'提交问题',chat_success:'回答成功',chat_failed:'回答失败',wiki_view:'进入 Wiki',document_read:'阅读文档',document_download:'下载文档',reference_open:'打开参考资料',answer_image_view:'查看回答图片',user_guide_view:'查看说明' })[name] || name }
function element(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = text; return node }
function number(value) { return Number(value || 0) }
function date(value) { return value ? String(value).slice(0, 10) : '—' }
function dateTime(value) { return value ? String(value).replace('T', ' ').slice(0, 19) : '—' }
const feedbackStatuses = ['待处理', '处理中', '已处理', '已关闭']
const licenseStatuses = ['待处理', '处理中', '已通过', '已拒绝']

if (state.adminKey) loadCurrentTab()
else document.querySelector('#settingsButton').click()
