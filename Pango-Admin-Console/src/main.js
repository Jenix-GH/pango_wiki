import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { normalizeMarkdownBlockSpacing, placeMediaAfterCitations } from './answerRendering.js'
import './style.css'
import { renderLicenseDelivery } from './licenseDelivery.js'
import { renderLicenseApplications } from './licenseApplications.js'

marked.setOptions({ gfm: true, breaks: false })

const state = {
  tab: 'dashboard', startDate: localDate(-29), endDate: localDate(0), eventPage: 1, conversationPage: 1, feedbackPage: 1, licensePage: 1,
  eventName: '', clientType: '', feedbackStatus: '', licenseStatus: '', username: '',
}

const app = document.querySelector('#app')
let content

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark">P</span><div><strong>Pango 运营中控台</strong><small>访问、反馈与 License 管理</small></div></div>
      <div class="connection"><span id="connectionDot" class="online"></span><span id="connectionText">已登录：${escapeHtml(state.username)}</span><button id="logoutButton" class="logout-button">退出登录</button></div>
    </header>
    <div class="shell"><aside><nav>
      <button data-tab="dashboard">数据概览</button>
      <button data-tab="events">访问明细</button>
      <button data-tab="conversations">问答记录</button>
      <button data-tab="feedback">问题反馈</button>
      <button data-tab="licenses">License 申请</button>
      <button data-tab="delivery">License 发放</button>
    </nav><p>仅限授权人员使用</p></aside><main id="content"></main></div>`
  content = document.querySelector('#content')
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === state.tab)
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab
      document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button))
      loadCurrentTab()
    })
  })
  document.querySelector('#logoutButton').addEventListener('click', async () => {
    try { await fetch('/local-api/auth/logout', { method: 'POST', credentials: 'same-origin' }) } finally { state.username = ''; renderLogin() }
  })
  loadCurrentTab()
}

function renderLogin(message = '') {
  app.innerHTML = `<main class="login-page"><form id="loginForm" class="login-card">
    <div class="brand-mark login-mark">P</div><p>PANGO OPERATIONS</p><h1>运营中控台登录</h1><span>请输入管理员账号和密码</span>
    <label>账号<input id="loginUsername" name="username" autocomplete="username" required autofocus></label>
    <label>密码<input id="loginPassword" name="password" type="password" autocomplete="current-password" required></label>
    <div id="loginError" class="login-error">${escapeHtml(message)}</div><button id="loginButton" type="submit">登录</button>
  </form></main>`
  document.querySelector('#loginForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = document.querySelector('#loginButton'), error = document.querySelector('#loginError')
    button.disabled = true; button.textContent = '正在登录…'; error.textContent = ''
    try {
      const response = await fetch('/local-api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#loginUsername').value.trim(), password: document.querySelector('#loginPassword').value }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || '登录失败')
      state.username = result.data.username
      renderShell()
    } catch (loginError) {
      error.textContent = loginError.message || '登录失败，请重试'
      button.disabled = false; button.textContent = '登录'
    }
  })
}

async function request(path, options = {}) {
  const response = await fetch(`/local-api${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const result = await response.json()
  if (response.status === 401) {
    state.username = ''
    renderLogin(result.message)
    const error = new Error(result.message || '请重新登录'); error.authentication = true; throw error
  }
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`)
  setConnected(true)
  return result.data
}

function setConnected(connected, message = '') {
  document.querySelector('#connectionDot').className = connected ? 'online' : 'offline'
  document.querySelector('#connectionText').textContent = connected ? `已登录：${state.username}` : message || '连接失败'
}
function showLoading() { content.innerHTML = '<div class="loading">正在读取数据库…</div>' }
function showError(error) {
  setConnected(false, '本地数据库连接失败')
  content.innerHTML = ''
  const box = element('div', 'error-panel')
  box.append(element('h2', '', '无法读取管理数据'), element('p', '', error.message || String(error)), element('p', '', '请检查启动终端中的 PANGO_DB_* 环境变量及数据库网络。'))
  content.append(box)
}
async function loadCurrentTab() {
  showLoading()
  try {
    if (state.tab === 'dashboard') await loadDashboard()
    if (state.tab === 'events') await loadEvents()
    if (state.tab === 'conversations') await loadConversations()
    if (state.tab === 'feedback') await loadFeedback()
    if (state.tab === 'licenses') await loadLicenses()
    if (state.tab === 'delivery') await renderLicenseDelivery(content, request)
  } catch (error) { if (!error.authentication) showError(error) }
}

async function loadDashboard() {
  const data = await request(`/dashboard?startDate=${encodeURIComponent(state.startDate)}&endDate=${encodeURIComponent(state.endDate)}`)
  state.startDate = data.startDate || state.startDate
  state.endDate = data.endDate || state.endDate
  const summary = data.summary || {}
  content.innerHTML = `
    <section class="page-heading"><div><p>OPERATIONS OVERVIEW</p><h1>数据概览</h1><span>访问与用户增长核心指标</span></div><div class="date-range"><label>开始日期<input id="startDate" type="date" value="${state.startDate}"></label><span>至</span><label>结束日期<input id="endDate" type="date" value="${state.endDate}"></label><button id="applyDateRange">查询</button></div></section>
    <section class="metrics overview-metrics" id="metrics"></section>
    <section class="grid dashboard-grid"><article class="panel"><h2>浏览、注册与提问趋势</h2><div class="chart-legend"><span class="visit-dot">浏览量</span><span class="register-dot">新注册用户</span><span class="question-dot">提问数</span></div><div id="trend" class="trend-chart"></div></article><article class="panel"><h2>所选时段页面浏览</h2><div id="pageSplit" class="question-split page-split"></div><h2 class="split-section-title">所选时段提问终端</h2><div id="questionSplit" class="question-split"></div></article></section>
    <section class="panel pending-panel"><h2>待处理事项</h2><div class="pending"><button data-go="feedback"><strong>${number(data.pendingFeedback)}</strong><span>待处理反馈</span></button><button data-go="licenses"><strong>${number(data.pendingLicense)}</strong><span>待处理 License</span></button></div></section>`
  const cards = [
    ['所选时段浏览量', summary.period_pv, `${state.startDate} 至 ${state.endDate}`],
    ['所选时段提问量', summary.period_questions, `Web ${number(summary.period_web_questions)} · 小程序 ${number(summary.period_miniprogram_questions)}`],
    ['所选时段新用户注册', summary.period_registered, `${state.startDate} 至 ${state.endDate}`],
    ['累计注册用户', summary.total_registered, '不受所选时间段影响'],
  ]
  cards.forEach(([label, value, hint]) => {
    const card = element('article', 'metric'); card.append(element('span', '', label), element('strong', '', number(value).toLocaleString()), element('small', '', hint)); document.querySelector('#metrics').append(card)
  })
  document.querySelector('#applyDateRange').addEventListener('click', () => {
    const startDate = document.querySelector('#startDate').value
    const endDate = document.querySelector('#endDate').value
    const days = Math.floor((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000) + 1
    if (!startDate || !endDate || days < 1 || days > 366) return alert('请选择1到366天内的有效起止日期')
    state.startDate = startDate; state.endDate = endDate; loadDashboard()
  })
  renderTrend(data.trend || [])
  renderPageSplit(summary)
  renderQuestionSplit(summary)
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.go)))
}

function renderTrend(rows) {
  const host = document.querySelector('#trend')
  const visible = rows.length > 90 ? rows.filter((_, index) => index % Math.ceil(rows.length / 90) === 0 || index === rows.length - 1) : rows
  const max = Math.max(1, ...visible.flatMap(row => [number(row.pv), number(row.registrations), number(row.questions)]))
  visible.forEach((row, index) => {
    const column = element('div', 'trend-column')
    column.dataset.tooltip = `${date(row.stat_date)}\n浏览量：${number(row.pv)}\n新注册用户：${number(row.registrations)}\n提问数：${number(row.questions)}`
    const bars = element('div', 'trend-bars')
    const visit = element('i', 'trend-bar visit-bar'); visit.style.height = `${Math.max(2, number(row.pv) / max * 100)}%`; visit.title = `浏览量 ${number(row.pv)}`
    const register = element('i', 'trend-bar register-bar'); register.style.height = `${Math.max(2, number(row.registrations) / max * 100)}%`; register.title = `新注册 ${number(row.registrations)}`
    const question = element('i', 'trend-bar question-bar'); question.style.height = `${Math.max(2, number(row.questions) / max * 100)}%`; question.title = `提问数 ${number(row.questions)}`
    bars.append(visit, register, question)
    const showDate = visible.length <= 31 || index % Math.ceil(visible.length / 12) === 0 || index === visible.length - 1
    column.append(bars, element('small', '', showDate ? date(row.stat_date).slice(5) : ''))
    host.append(column)
  })
  if (!rows.length) host.append(element('p', 'empty', '暂无趋势数据'))
}
function renderPageSplit(summary) {
  const host = document.querySelector('#pageSplit')
  const rows = [
    ['Pango慧答', number(summary.pango_pv), 'pango'],
    ['文档中心', number(summary.docs_pv), 'docs'],
    ['License申请', number(summary.license_pv), 'license'],
  ]
  const total = Math.max(1, rows.reduce((sum, row) => sum + number(row[1]), 0))
  rows.forEach(([label, pv, type]) => {
    const item = element('div', 'split-item')
    const bar = element('div', 'split-track')
    const fill = element('i', `split-fill ${type}`)
    fill.style.width = `${number(pv) / total * 100}%`
    bar.append(fill)
    item.append(element('span', '', label), element('strong', '', number(pv).toLocaleString()), bar)
    host.append(item)
  })
}
function renderQuestionSplit(summary) {
  const host = document.querySelector('#questionSplit')
  const web = number(summary.period_web_questions), mini = number(summary.period_miniprogram_questions), total = Math.max(1, web + mini)
  ;[['Web', web, 'web'], ['小程序', mini, 'mini']].forEach(([label, value, type]) => {
    const item = element('div', 'split-item'); const bar = element('div', 'split-track'); const fill = element('i', `split-fill ${type}`); fill.style.width = `${number(value) / total * 100}%`; bar.append(fill); item.append(element('span', '', label), element('strong', '', number(value).toLocaleString()), bar); host.append(item)
  })
}
async function loadEvents() {
  const data = await request(`/events?page=${state.eventPage}&pageSize=50&eventName=${encodeURIComponent(state.eventName)}&clientType=${encodeURIComponent(state.clientType)}`)
  renderListPage('访问明细', `共 ${number(data.total)} 条事件`, `<select id="eventFilter"><option value="">全部事件</option>${eventOptions()}</select><select id="clientFilter"><option value="">全部终端</option><option>WEB</option><option>MINIPROGRAM</option></select>`)
  document.querySelector('#eventFilter').value = state.eventName; document.querySelector('#clientFilter').value = state.clientType
  const table = createTable(['时间','事件','终端','页面','用户','会话 / 文档'])
  ;(data.records || []).forEach(row => appendRow(table, [dateTime(row.event_time),eventLabel(row.event_name),row.client_type,row.page_path,row.visitor_id,row.document_id || row.session_id || '—']))
  content.querySelector('.panel').append(table)
  document.querySelector('#eventFilter').addEventListener('change', event => { state.eventName=event.target.value; state.eventPage=1; loadEvents() }); document.querySelector('#clientFilter').addEventListener('change', event => { state.clientType=event.target.value; state.eventPage=1; loadEvents() }); appendPager(data,state.eventPage,page=>{state.eventPage=page;loadEvents()})
}

async function loadConversations() {
  const data = await request(`/conversations?page=${state.conversationPage}&pageSize=30&startDate=${encodeURIComponent(state.startDate)}&endDate=${encodeURIComponent(state.endDate)}`)
  state.startDate = data.startDate || state.startDate
  state.endDate = data.endDate || state.endDate
  renderListPage('问答记录', `所选时段共 ${number(data.total)} 个会话`, dateRangeFilter())
  bindDateRangeFilter(() => { state.conversationPage = 1; loadConversations() })
  const exportButton=element('button','export-button','导出所选时段')
  exportButton.addEventListener('click',exportConversations)
  document.querySelector('.filters').append(exportButton)
  const table = createTable(['最近提问时间','终端','用户','会话首问','问题数','操作'])
  ;(data.records || []).forEach(row => {
    const openButton = element('button','feedback-detail-link','还原问答现场')
    openButton.addEventListener('click',()=>showConversationDetail(row.conversation_key))
    appendRow(table,[dateTime(row.last_question_at),row.platform,row.user_name || `用户#${row.userinfo_id || '—'}`,truncate(row.first_question,100),number(row.question_count),openButton])
  })
  content.querySelector('.panel').append(table)
  appendPager(data,state.conversationPage,page=>{state.conversationPage=page;loadConversations()})
}

async function exportConversations() {
  const button=document.querySelector('.export-button')
  button.disabled=true;button.textContent='正在生成压缩包…'
  try {
    const query=`startDate=${encodeURIComponent(state.startDate)}&endDate=${encodeURIComponent(state.endDate)}`
    const response=await fetch(`/local-api/conversations-export?${query}`,{cache:'no-store',credentials:'same-origin'})
    if (!response.ok) {
      let message=`导出失败（HTTP ${response.status}）`
      try { const result=await response.json();message=result.message||message } catch {}
      if (response.status===401) { state.username='';renderLogin(message);const error=new Error(message);error.authentication=true;throw error }
      throw new Error(message)
    }
    const blob=await response.blob()
    const disposition=response.headers.get('content-disposition')||''
    const fileName=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`Pango_conversations_${state.startDate}_${state.endDate}.zip`
    const url=URL.createObjectURL(blob),link=document.createElement('a')
    link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  } catch(error) {
    if (!error.authentication) alert(error.message||'导出失败')
  } finally {
    if (button.isConnected) { button.disabled=false;button.textContent='导出所选时段' }
  }
}

async function showConversationDetail(conversationKey) {
  const overlay=element('div','detail-overlay')
  const panel=element('section','feedback-detail-panel conversation-detail-panel')
  panel.append(element('p','detail-loading','正在还原完整问答现场…'))
  overlay.append(panel); document.body.append(overlay)
  overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.remove()})
  try {
    const data=await request(`/conversation?conversationKey=${encodeURIComponent(conversationKey)}&startDate=${encodeURIComponent(state.startDate)}&endDate=${encodeURIComponent(state.endDate)}`)
    panel.innerHTML=''
    const header=element('header','detail-header'),titles=element('div')
    titles.append(element('small','',`${data.startDate} 至 ${data.endDate} · ${data.records.length} 轮问答`),element('h2','','会话问答现场'))
    const close=element('button','','关闭'); close.addEventListener('click',()=>overlay.remove()); header.append(titles,close); panel.append(header)
    if (!data.records.length) panel.append(element('p','empty','所选时段内暂无问答记录'))
    data.records.forEach((record,index) => {
      const round=element('section','conversation-round')
      round.append(element('div','conversation-round-label',`第 ${index + 1} 轮 · ${dateTime(record.question_time)}`))
      round.append(conversationBlock('用户提问',record.question,'question'))
      renderMedia(round,record.question_images || [],data.public_origin,'用户上传图片')
      if (record.answer_content) {
        round.append(answerConversationBlock(record.answer_content,record.answer_media || [],data.public_origin))
        renderReferences(round,record.reference,data.public_origin)
      } else {
        round.append(element('article','conversation-block answer empty-answer','该问题没有已保存的模型回答'))
      }
      panel.append(round)
    })
  } catch(error) { panel.innerHTML=''; panel.append(element('p','error-panel',error.message||'问答现场读取失败')) }
}

async function loadFeedback() {
  const data = await request(`/feedback?page=${state.feedbackPage}&pageSize=30&status=${state.feedbackStatus}`)
  renderListPage('问题反馈', `共 ${number(data.total)} 条反馈`, statusFilter()); document.querySelector('#statusFilter').value=state.feedbackStatus
  const exportButton=element('button','export-button','导出当前状态'); exportButton.addEventListener('click',exportFeedback); document.querySelector('.filters').append(exportButton)
  const table=createTable(['提交时间','平台','类型','反馈问题','模型回复','补充说明','联系人','处理进展','状态'])
  ;(data.records||[]).forEach(row=>{
    const questionButton=element('button','feedback-detail-link',truncate(row.question_content,90)); questionButton.addEventListener('click',()=>showFeedbackDetail(row.id))
    const answerButton=element('button','feedback-answer-preview',truncate(row.answer_content,120)); answerButton.addEventListener('click',()=>showFeedbackDetail(row.id))
    const progressEditor=createProgressEditor(row)
    const statusSelect=createStatusSelect(row.status,feedbackStatuses,value=>updateStatus('feedback',row.id,value,loadFeedback))
    appendRow(table,[dateTime(row.dotime),row.platform,row.feedback_type,questionButton,answerButton,row.detail||'—',row.contact_name||row.email||row.phone||'—',progressEditor,statusSelect])
  })
  content.querySelector('.panel').append(table); document.querySelector('#statusFilter').addEventListener('change',event=>{state.feedbackStatus=event.target.value;state.feedbackPage=1;loadFeedback()}); appendPager(data,state.feedbackPage,page=>{state.feedbackPage=page;loadFeedback()})
}

function createProgressEditor(row) {
  const wrapper=element('div','progress-editor'),textarea=document.createElement('textarea'),button=element('button','','保存')
  textarea.maxLength=5000; textarea.value=row.processing_progress||''; textarea.placeholder='填写处理进展'
  button.addEventListener('click',async()=>{
    button.disabled=true; button.textContent='保存中…'
    try {
      await request(`/feedback/${row.id}/progress`,{method:'POST',body:JSON.stringify({processingProgress:textarea.value})})
      row.processing_progress=textarea.value.trim(); button.textContent='已保存'
      setTimeout(()=>{button.textContent='保存';button.disabled=false},1000)
    } catch(error) { button.disabled=false;button.textContent='保存';alert(error.message) }
  })
  wrapper.append(textarea,button);return wrapper
}

async function exportFeedback() {
  const button=document.querySelector('.export-button');button.disabled=true;button.textContent='正在导出…'
  try {
    const data=await request(`/feedback-export?status=${encodeURIComponent(state.feedbackStatus)}`)
    const {default:ExcelJS}=await import('exceljs')
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('问题反馈')
    sheet.columns=[
      ['反馈编号','id',10],['提交时间','dotime',20],['平台','platform',14],['问题类型','feedback_type',16],
      ['反馈问题','question_content',42],['模型回复','answer_content',55],['补充说明','detail',36],
      ['联系人','contact_name',16],['公司名称','company_name',22],['电子邮箱','email',26],['联系电话','phone',18],
      ['处理状态','status_label',14],['处理进展','processing_progress',42],['最后更新时间','uptime',20],
    ].map(([header,key,width])=>({header,key,width}))
    ;(data.records||[]).forEach(row=>sheet.addRow({...row,dotime:dateTime(row.dotime),uptime:dateTime(row.uptime),status_label:feedbackStatuses[Number(row.status)]||''}))
    sheet.getRow(1).font={bold:true};sheet.getRow(1).alignment={vertical:'middle'}
    sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true}})
    sheet.autoFilter={from:'A1',to:'N1'};sheet.views=[{state:'frozen',ySplit:1}]
    const statusName=state.feedbackStatus===''?'全部':feedbackStatuses[Number(state.feedbackStatus)]
    const buffer=await workbook.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
    const link=document.createElement('a');link.href=url;link.download=`Pango问题反馈_${statusName}_${localDate(0)}.xlsx`;link.click();URL.revokeObjectURL(url)
  } catch(error) { alert(error.message||'导出失败') }
  finally { button.disabled=false;button.textContent='导出当前状态' }
}

async function showFeedbackDetail(id) {
  const overlay=element('div','detail-overlay'); const panel=element('section','feedback-detail-panel'); panel.append(element('p','detail-loading','正在还原问答现场…')); overlay.append(panel); document.body.append(overlay); overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.remove()})
  try {
    const data=await request(`/feedback/${id}`); panel.innerHTML=''
    const header=element('header','detail-header'); const titles=element('div'); titles.append(element('small','',`${data.platform} · ${dateTime(data.dotime)} · ${data.feedback_type}`),element('h2','','反馈问答详情')); const close=element('button','','关闭'); close.addEventListener('click',()=>overlay.remove()); header.append(titles,close); panel.append(header)
    const meta=element('div','feedback-meta'); meta.append(metaItem('补充说明',data.detail||'—'),metaItem('联系人',data.contact_name||data.email||data.phone||'—'),metaItem('处理进展',data.processing_progress||'—')); panel.append(meta)
    panel.append(conversationBlock('用户提问',data.question_content,'question'))
    panel.append(answerConversationBlock(data.answer_content,data.answer_media||[],data.public_origin))
    renderMedia(panel,data.feedback_images||[],data.public_origin,'用户反馈图片')
    renderReferences(panel,data.reference,data.public_origin)
  } catch(error) { panel.innerHTML=''; panel.append(element('p','error-panel',error.message||'详情读取失败')) }
}
function conversationBlock(label,text,type,markdown=false){const block=element('article',`conversation-block ${type}`);block.append(element('h3','',label));const body=element('div',markdown?'markdown-body':'question-text');if(markdown)body.innerHTML=safeMarkdown(text||'');else body.textContent=text||'—';block.append(body);return block}
function answerConversationBlock(content,media,origin){const block=element('article','conversation-block answer');block.append(element('h3','','模型回复'));placeMediaAfterCitations(String(content||''),Array.isArray(media)?media:[]).forEach(section=>{if(section.content){const body=element('div','markdown-body');body.innerHTML=safeMarkdown(section.content);block.append(body)}if(section.media.length)block.append(mediaGrid(section.media,origin,'模型回复图片'))});return block}
function mediaGrid(media,origin,title){const grid=element('div','detail-media-grid');media.forEach(item=>{const img=document.createElement('img');img.src=item.data_base64?`data:${item.mime_type};base64,${item.data_base64}`:absoluteUrl(item.absoluteUrl||item.url||item.image_url,origin);img.alt=item.caption||title;img.addEventListener('click',()=>showImage(img.src));grid.append(img)});return grid}
function renderMedia(panel,media,origin,title){if(!Array.isArray(media)||!media.length)return;const section=element('section','detail-media');section.append(element('h3','',title),mediaGrid(media,origin,title));panel.append(section)}
function renderReferences(panel,reference,origin){const chunks=reference?.chunks||[];if(!chunks.length)return;const section=element('section','detail-references');section.append(element('h3','',`参考资料 · ${chunks.length}`));chunks.forEach((chunk,index)=>{const card=element('article','reference-card');card.append(element('strong','',chunk.citation_label||`[${index+1}]`),element('span','',chunk.display_name||chunk.document_name||chunk.title||'未命名文档'));const url=absoluteUrl(chunk.document_page_url||chunk.document_preview_url,origin);if(url){const link=element('a','','在线阅读');link.href=url;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}section.append(card)});panel.append(section)}
function showImage(src){const overlay=element('div','image-overlay');const img=document.createElement('img');img.src=src;overlay.append(img);overlay.addEventListener('click',()=>overlay.remove());document.body.append(overlay)}

async function loadLicenses() {
  await renderLicenseApplications(content, request, () => switchTab('delivery'))
}

function renderListPage(title,subtitle,filters){content.innerHTML=`<section class="page-heading"><div><p>DATA MANAGEMENT</p><h1>${title}</h1><span>${subtitle}</span></div><div class="filters">${filters}</div></section><section class="panel table-panel"></section>`}
function dateRangeFilter(){return `<div class="date-range compact"><label>开始日期<input id="listStartDate" type="date" value="${state.startDate}"></label><span>至</span><label>结束日期<input id="listEndDate" type="date" value="${state.endDate}"></label><button id="applyListDateRange">查询</button></div>`}
function bindDateRangeFilter(reload){document.querySelector('#applyListDateRange').addEventListener('click',()=>{const startDate=document.querySelector('#listStartDate').value,endDate=document.querySelector('#listEndDate').value,days=Math.floor((new Date(`${endDate}T00:00:00`)-new Date(`${startDate}T00:00:00`))/86400000)+1;if(!startDate||!endDate||days<1||days>366)return alert('请选择1到366天内的有效起止日期');state.startDate=startDate;state.endDate=endDate;reload()})}
function createTable(headers){const wrap=element('div','table-wrap'),table=document.createElement('table'),head=document.createElement('thead'),row=document.createElement('tr');headers.forEach(header=>row.append(element('th','',header)));head.append(row);table.append(head,document.createElement('tbody'));wrap.append(table);return wrap}
function appendRow(wrap,values){const row=document.createElement('tr');values.forEach(value=>{const cell=document.createElement('td');if(value instanceof Node)cell.append(value);else cell.textContent=value==null?'—':String(value);row.append(cell)});wrap.querySelector('tbody').append(row)}
function createStatusSelect(current,options,onChange){const select=element('select',`status status-${current}`);options.forEach((label,value)=>{const option=document.createElement('option');option.value=String(value);option.textContent=label;option.selected=Number(current)===value;select.append(option)});select.addEventListener('change',()=>onChange(Number(select.value)));return select}
async function updateStatus(type,id,status,reload){try{await request(`/${type}/${id}/status`,{method:'POST',body:JSON.stringify({status})});await reload()}catch(error){alert(error.message)}}
function appendPager(data,current,change){const pages=Math.max(1,Math.ceil(number(data.total)/number(data.pageSize||30))),pager=element('div','pager'),previous=element('button','','上一页'),next=element('button','','下一页');previous.disabled=current<=1;next.disabled=current>=pages;previous.addEventListener('click',()=>change(current-1));next.addEventListener('click',()=>change(current+1));pager.append(previous,element('span','',`${current} / ${pages}`),next);content.querySelector('.panel').append(pager)}
function metaItem(label,value){const item=element('div');item.append(element('small','',label),element('span','',value));return item}
function safeMarkdown(value){return DOMPurify.sanitize(marked.parse(normalizeMarkdownBlockSpacing(String(value||''))),{USE_PROFILES:{html:true}})}
function absoluteUrl(value,origin){if(!value)return'';try{return new URL(value,origin).toString()}catch{return''}}
function switchTab(tab){document.querySelector(`[data-tab="${tab}"]`).click()}
function statusFilter(){return'<select id="statusFilter"><option value="">全部状态</option><option value="0">待处理</option><option value="1">处理中</option><option value="2">已处理/通过</option><option value="3">已关闭/拒绝</option></select>'}
function eventOptions(){return['page_view','chat_submit','chat_success','chat_failed','wiki_view','document_read','document_download','reference_open','answer_image_view','user_guide_view'].map(name=>`<option value="${name}">${eventLabel(name)}</option>`).join('')}
function eventLabel(name){return({page_view:'页面访问',chat_submit:'提交问题',chat_success:'回答成功',chat_failed:'回答失败',wiki_view:'进入文档中心',document_read:'阅读文档',document_download:'下载文档',reference_open:'打开参考资料',answer_image_view:'查看回答图片',user_guide_view:'查看说明'})[name]||name}
function element(tag,className='',text=''){const node=document.createElement(tag);if(className)node.className=className;if(text!=='')node.textContent=text;return node}
function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
function truncate(value,length){const text=String(value||'—');return text.length>length?`${text.slice(0,length)}…`:text}
function number(value){return Number(value||0)}
function date(value){return value?String(value).slice(0,10):'—'}
function dateTime(value){return value?String(value).replace('T',' ').slice(0,19):'—'}
function localDate(offsetDays){const value=new Date(Date.now()+offsetDays*86400000);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value)}
const feedbackStatuses=['待处理','处理中','已处理','已关闭']

async function initialize(){
  try {
    const response=await fetch('/local-api/auth/session',{cache:'no-store',credentials:'same-origin'})
    const result=await response.json()
    if(!response.ok)throw new Error(result.message||'请登录')
    state.username=result.data.username
    renderShell()
  }catch(error){renderLogin(error.message==='登录状态已失效，请重新登录'?'':error.message)}
}

initialize()
