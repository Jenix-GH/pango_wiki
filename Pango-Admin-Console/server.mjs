import { applicationFiles, uploadApplicationFile } from './licenseApplicationFiles.mjs'
import { queuedMailPreview } from './licenseQueuedMail.mjs'
import { listNightlyReports, nightlyReportDetail } from './licenseNightlyReport.mjs'
import { mailPreviewHtml } from './licenseMailLogo.mjs'
import http from 'node:http'
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'
import mysql from 'mysql2/promise'
import { uploadFiles, setMailCc, listFiles, fileDetail, fileAction,  MAX_UPLOAD_BODY, problem, listApplications, setApplicationStatus, applicationStatusHistory, listCustomerMail, rejectionDetail, retryRejection, cancelRejection, restoreRejection, resolveWorkflowMail } from './licenseDelivery.mjs'
import { conversationFileName, groupConversationRecords, imageExtension, renderConversationMarkdown } from './conversationExport.mjs'
import { mailSettingsView, saveMailSettings, applySavedMailSettings } from './licenseMailSettings.mjs'
import { createWorkflowMailSender, assertMailConfiguration } from './licenseMail.mjs'
import { sampleMail, publicMailPreview } from './licenseMailPreview.mjs'
import { withDeliveryLock, validEmail, applicationWorkflow, runApplicationStep, previewBatchFae, notifyBatchFae } from './licenseDelivery.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const apiOnly = process.argv.includes('--api-only')
const configPathArgument = argumentValue('--config') || 'config/database.env'
const configPath = isAbsolute(configPathArgument) ? configPathArgument : resolve(root, configPathArgument)
const config = loadConfig(configPath)
const host = config.ADMIN_CONSOLE_HOST || '127.0.0.1'
const port = Number(config.ADMIN_CONSOLE_PORT || (apiOnly ? 3101 : 3100))
const adminUser = requiredConfig('ADMIN_CONSOLE_USER')
const adminPasswordHash = parsePasswordHash(requiredConfig('ADMIN_CONSOLE_PASSWORD_HASH'))
const sessionHours = clampNumber(config.ADMIN_CONSOLE_SESSION_HOURS, 1, 168, 12)
const sessions = new Map()
const loginAttempts = new Map()
const mailTests = new Map()
let mailTestRunning = false
const sessionCookie = 'pango_admin_session'
const databaseOptions = {
  host: requiredConfig('PANGO_DB_HOST'),
  port: Number(config.PANGO_DB_PORT || 3306),
  user: requiredConfig('PANGO_DB_USER'),
  password: requiredConfig('PANGO_DB_PASSWORD'),
  database: requiredConfig('PANGO_DB_NAME'),
  charset: 'utf8mb4',
  timezone: '+08:00',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 60000,
  enableKeepAlive: true,
}
const pool = mysql.createPool(databaseOptions)
const licensePool = mysql.createPool({ ...databaseOptions, supportBigNumbers: true, bigNumberStrings: true, connectionLimit: 2, maxIdle: 1 })

for (const databasePool of [pool, licensePool]) databasePool.on('connection', connection => {
  connection.query("SET time_zone = '+08:00'")
})

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || host}`)
    if (url.pathname.startsWith('/local-api/')) {
      await handleApi(request, response, url)
      return
    }
    if (apiOnly) return json(response, 404, { message: 'Not found' })
    await serveStatic(response, url.pathname)
  } catch (error) {
    console.error(error)
    if (response.headersSent) response.destroy(error)
    else json(response, /^\/local-api\/(?:licenses|license-delivery)(?:[/?]|$)/.test(request.url || '') ? error.statusCode || 500 : 500, { message: safeError(error) })
  }
})

server.listen(port, host, () => {
  console.log(`Pango Admin Console listening on http://${host}:${port}`)
})

async function handleApi(request, response, url) {
  const path = url.pathname.slice('/local-api'.length)
  if (request.method === 'POST' && path === '/auth/login') return login(request, response)
  if (request.method === 'GET' && path === '/auth/session') return authSession(request, response)
  if (request.method === 'POST' && path === '/auth/logout') return logout(request, response)
  if (!authenticated(request)) return json(response, 401, { message: '请先登录中控台' })
  if (path.startsWith('/license-delivery')) return handleLicenseDelivery(request, response, path, url.searchParams)
  if (request.method === 'GET' && path === '/health') { await pool.query('SELECT 1'); return json(response, 200, { data: true }) }
  if (request.method === 'GET' && path === '/dashboard') return dashboard(response, selectedDateRange(url.searchParams))
  if (request.method === 'GET' && path === '/events') return events(response, url.searchParams)
  if (request.method === 'GET' && path === '/conversations') return conversations(response, url.searchParams)
  if (request.method === 'GET' && path === '/conversations-export') return conversationsExport(response, url.searchParams)
  if (request.method === 'GET' && path === '/conversation') return conversationDetail(response, url.searchParams)
  if (request.method === 'GET' && path === '/feedback') return feedback(response, url.searchParams)
  if (request.method === 'GET' && path === '/feedback-export') return feedbackExport(response, url.searchParams)
  if (request.method === 'GET' && /^\/feedback\/\d+$/.test(path)) return feedbackDetail(response, Number(path.split('/')[2]))
  if (request.method === 'POST' && /^\/feedback\/\d+\/status$/.test(path)) return updateStatus(response, 'dto_feedback', Number(path.split('/')[2]), await readJson(request))
  if (request.method === 'POST' && /^\/feedback\/\d+\/progress$/.test(path)) return updateFeedbackProgress(response, Number(path.split('/')[2]), await readJson(request))
  if (request.method === 'GET' && path === '/licenses') return licenses(response, url.searchParams)
  if (request.method === 'POST' && /^\/licenses\/\d+\/status$/.test(path)) {
    if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw problem('仅接受 JSON 请求',415)
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw problem('请求来源不允许',403)
    return updateLicenseStatus(response, path.split('/')[2], await readLicenseJson(request))
  }
  return json(response, 404, { message: '接口不存在' })
}

async function login(request, response) {
  const client = request.socket.remoteAddress || 'unknown'
  const attempt = loginAttempts.get(client)
  const now = Date.now()
  if (attempt?.lockedUntil > now) {
    return json(response, 429, { message: `登录尝试过多，请${Math.ceil((attempt.lockedUntil - now) / 60000)}分钟后再试` })
  }
  const body = await readJson(request)
  const username = String(body.username || '')
  const password = String(body.password || '')
  const usernameMatches = safeTextEqual(username, adminUser)
  const passwordMatches = verifyPassword(password, adminPasswordHash)
  if (!usernameMatches || !passwordMatches) {
    registerLoginFailure(client, now)
    return json(response, 401, { message: '账号或密码错误' })
  }
  loginAttempts.delete(client)
  const token = toBase64Url(randomBytes(32))
  const expiresAt = now + sessionHours * 3600000
  sessions.set(token, expiresAt)
  cleanupSessions(now)
  return json(response, 200, { data: { username: adminUser, expiresAt } }, {
    'Set-Cookie': cookieValue(token, sessionHours * 3600),
  })
}

function authSession(request, response) {
  if (!authenticated(request)) return json(response, 401, { message: '登录状态已失效，请重新登录' })
  return json(response, 200, { data: { username: adminUser } })
}

function logout(request, response) {
  const token = cookies(request)[sessionCookie]
  if (token) sessions.delete(token)
  return json(response, 200, { data: true }, { 'Set-Cookie': cookieValue('', 0) })
}

function authenticated(request) {
  const token = cookies(request)[sessionCookie]
  if (!token) return false
  const expiresAt = sessions.get(token)
  if (!expiresAt || expiresAt <= Date.now()) { sessions.delete(token); return false }
  return true
}

function registerLoginFailure(client, now) {
  const previous = loginAttempts.get(client)
  const withinWindow = previous && now - previous.firstAt < 15 * 60000
  const attempts = withinWindow ? previous.attempts + 1 : 1
  loginAttempts.set(client, { attempts, firstAt: withinWindow ? previous.firstAt : now, lockedUntil: attempts >= 5 ? now + 15 * 60000 : 0 })
}

function cleanupSessions(now) {
  for (const [token, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(token)
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').flatMap(value => {
    const separator = value.indexOf('=')
    if (separator <= 0) return []
    try { return [[value.slice(0, separator).trim(), decodeURIComponent(value.slice(separator + 1).trim())]] } catch { return [] }
  }))
}

function cookieValue(token, maxAge) {
  const secure = String(config.ADMIN_CONSOLE_COOKIE_SECURE || '').toLowerCase() === 'true' ? '; Secure' : ''
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

async function dashboard(response, range) {
  const { startDate, endDate, dayCount } = range
  const [summaryRows] = await pool.query(`
    SELECT
      SUM(event_name='page_view' AND event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND (page_path='/' OR page_path LIKE '/?%' OR page_path LIKE '/pages/main/main%' OR page_path LIKE '/docs%' OR page_path LIKE '/wiki%'
          OR page_path LIKE '/license-application%')) period_pv,
      SUM(event_name='page_view' AND event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND (page_path='/' OR page_path LIKE '/?%' OR page_path LIKE '/pages/main/main%')) pango_pv,
      SUM(event_name='page_view' AND event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND (page_path LIKE '/docs%' OR page_path LIKE '/wiki%')) docs_pv,
      SUM(event_name='page_view' AND event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND page_path LIKE '/license-application%') license_pv
    FROM dto_analytics_event`, [
      startDate, endDate, startDate, endDate,
      startDate, endDate, startDate, endDate,
    ])
  const [userRows] = await pool.query(`
    SELECT
      SUM(user_type='USER') total_registered,
      SUM(user_type='USER' AND dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY)) period_registered
    FROM dto_userinfo`, [startDate, endDate])
  const [questionRows] = await pool.query(`
    SELECT
      SUM(dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY)) period_questions,
      SUM(dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY) AND session_id LIKE 'web\\_%') period_web_questions,
      SUM(dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY) AND session_id LIKE 'mini\\_%') period_miniprogram_questions
    FROM dto_question WHERE COALESCE(flag_del,0)=0`, [startDate, endDate, startDate, endDate, startDate, endDate])
  const [trend] = await pool.query(`
    SELECT dates.stat_date, COALESCE(visits.pv,0) pv, COALESCE(users.registrations,0) registrations,
      COALESCE(questions.question_count,0) questions
    FROM (
      SELECT DATE_ADD(?, INTERVAL seq.n DAY) stat_date
      FROM (${sequenceSql(366)}) seq WHERE seq.n < ?
    ) dates
    LEFT JOIN (
      SELECT DATE(event_time) stat_date, COUNT(*) pv
      FROM dto_analytics_event WHERE event_name='page_view' AND event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND (page_path='/' OR page_path LIKE '/?%' OR page_path LIKE '/pages/main/main%' OR page_path LIKE '/docs%' OR page_path LIKE '/wiki%'
          OR page_path LIKE '/license-application%')
      GROUP BY DATE(event_time)
    ) visits ON visits.stat_date=dates.stat_date
    LEFT JOIN (
      SELECT DATE(dotime) stat_date, COUNT(*) registrations
      FROM dto_userinfo WHERE user_type='USER' AND dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE(dotime)
    ) users ON users.stat_date=dates.stat_date
    LEFT JOIN (
      SELECT DATE(dotime) stat_date, COUNT(*) question_count
      FROM dto_question
      WHERE COALESCE(flag_del,0)=0 AND dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE(dotime)
    ) questions ON questions.stat_date=dates.stat_date
    ORDER BY dates.stat_date`, [startDate, dayCount, startDate, endDate, startDate, endDate, startDate, endDate])
  const [[pendingFeedback]] = await pool.query('SELECT COUNT(*) count FROM dto_feedback WHERE status=0')
  const [[pendingLicense]] = await pool.query('SELECT COUNT(*) count FROM dto_license_application WHERE status=0')
  json(response, 200, { data: {
    summary: { ...summaryRows[0], ...userRows[0], ...questionRows[0] },
    trend,
    startDate,
    endDate,
    pendingFeedback: pendingFeedback.count,
    pendingLicense: pendingLicense.count,
  } })
}

async function events(response, params) {
  const { page, pageSize, offset } = pagination(params, 50)
  const conditions = []
  const args = []
  if (params.get('eventName')) { conditions.push('event_name=?'); args.push(params.get('eventName')) }
  if (params.get('clientType')) { conditions.push('client_type=?'); args.push(params.get('clientType')) }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM dto_analytics_event${where}`, args)
  const [records] = await pool.query(`SELECT * FROM dto_analytics_event${where} ORDER BY event_time DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset])
  json(response, 200, { data: { records, total: count.total, page, pageSize } })
}

async function conversations(response, params) {
  const { startDate, endDate } = selectedDateRange(params)
  const { page, pageSize, offset } = pagination(params, 30)
  const rangeArgs = [startDate, endDate]
  const groupExpression = "COALESCE(NULLIF(session_id,''), CONCAT('question:',id))"
  const joinedGroupExpression = "COALESCE(NULLIF(q.session_id,''), CONCAT('question:',q.id))"
  const [[count]] = await pool.query(`
    SELECT COUNT(*) total FROM (
      SELECT ${groupExpression} conversation_key
      FROM dto_question
      WHERE COALESCE(flag_del,0)=0 AND dotime >= ? AND dotime < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY conversation_key
    ) grouped`, rangeArgs)
  const [records] = await pool.query(`
    SELECT
      ${joinedGroupExpression} conversation_key,
      MAX(NULLIF(session_id,'')) session_id,
      MAX(userinfo_id) userinfo_id,
      COUNT(*) question_count,
      MIN(q.dotime) started_at,
      MAX(q.dotime) last_question_at,
      SUBSTRING_INDEX(GROUP_CONCAT(REPLACE(REPLACE(q.question,'\\r',' '),'\\n',' ') ORDER BY q.dotime,q.id SEPARATOR '|||'),'|||',1) first_question,
      CASE
        WHEN MAX(NULLIF(session_id,'')) LIKE 'web\\_%' THEN 'WEB'
        WHEN MAX(NULLIF(session_id,'')) LIKE 'mini\\_%' THEN 'MINIPROGRAM'
        ELSE 'UNKNOWN'
      END platform,
      MAX(COALESCE(NULLIF(u.nick_name,''),NULLIF(u.phone_number,''),NULLIF(u.mail_address,''),CONCAT('用户#',q.userinfo_id))) user_name
    FROM dto_question q
    LEFT JOIN dto_userinfo u ON u.id=q.userinfo_id
    WHERE COALESCE(q.flag_del,0)=0 AND q.dotime >= ? AND q.dotime < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY conversation_key
    ORDER BY last_question_at DESC
    LIMIT ? OFFSET ?`, [...rangeArgs, pageSize, offset])
  json(response, 200, { data: { records, total: count.total, page, pageSize, startDate, endDate } })
}

async function conversationDetail(response, params) {
  const { startDate, endDate } = selectedDateRange(params)
  const conversationKey = params.get('conversationKey') || ''
  if (!conversationKey) return json(response, 400, { message: '缺少会话标识' })
  const legacyMatch = conversationKey.match(/^question:(\d+)$/)
  const condition = legacyMatch ? 'q.id=?' : "q.session_id=?"
  const keyValue = legacyMatch ? Number(legacyMatch[1]) : conversationKey
  const [records] = await pool.query(`
    SELECT
      q.id question_id,q.userinfo_id,q.session_id,q.question,q.question_images,q.dotime question_time,
      a.id answer_id,a.content answer_content,a.dotime answer_time,a.answer_time answer_elapsed,a.reference,a.answer_media
    FROM dto_question q
    LEFT JOIN dto_answer a ON a.id=(SELECT a2.id FROM dto_answer a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
    WHERE ${condition} AND COALESCE(q.flag_del,0)=0
      AND q.dotime >= ? AND q.dotime < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY q.dotime,q.id`, [keyValue, startDate, endDate])
  json(response, 200, { data: {
    conversation_key: conversationKey,
    startDate,
    endDate,
    public_origin: config.PANGO_PUBLIC_ORIGIN || 'https://aiapp.pangomicro.com',
    records: records.map(row => ({
      ...row,
      question_images: parseJson(row.question_images) || [],
      reference: parseJson(row.reference) || { chunks: [], total: 0 },
      answer_media: parseJson(row.answer_media) || [],
    })),
  } })
}

async function conversationsExport(response, params) {
  const { startDate, endDate } = selectedDateRange(params)
  const [rows] = await pool.query(`
    SELECT
      COALESCE(NULLIF(q.session_id,''), CONCAT('question:',q.id)) conversation_key,
      q.id question_id,q.userinfo_id,q.session_id,q.question,q.question_images,q.dotime question_time,
      a.id answer_id,a.content answer_content,a.dotime answer_time,a.answer_time answer_elapsed,a.reference,a.answer_media,
      CASE
        WHEN q.session_id LIKE 'web\\_%' THEN 'WEB'
        WHEN q.session_id LIKE 'mini\\_%' THEN 'MINIPROGRAM'
        ELSE 'UNKNOWN'
      END platform,
      COALESCE(NULLIF(u.nick_name,''),NULLIF(u.phone_number,''),NULLIF(u.mail_address,''),CONCAT('用户#',q.userinfo_id)) user_name
    FROM dto_question q
    LEFT JOIN dto_userinfo u ON u.id=q.userinfo_id
    LEFT JOIN dto_answer a ON a.id=(SELECT a2.id FROM dto_answer a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
    WHERE COALESCE(q.flag_del,0)=0
      AND q.dotime >= ? AND q.dotime < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY q.dotime,q.id`, [startDate, endDate])
  const conversations = groupConversationRecords(rows.map(row => ({
    ...row,
    question_images: parseJson(row.question_images) || [],
    reference: parseJson(row.reference) || { chunks: [], total: 0 },
    answer_media: parseJson(row.answer_media) || [],
  })))
  const files = conversations.map((conversation, index) => ({ conversation, fileName: conversationFileName(conversation, index) }))
  const archiveName = `Pango_conversations_${startDate}_${endDate}.zip`
  response.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${archiveName}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', error => console.warn('Conversation export warning:', error))
  archive.on('error', error => response.destroy(error))
  response.on('close', () => { if (!response.writableEnded) archive.abort() })
  archive.pipe(response)
  archive.append(exportIndexMarkdown(files, startDate, endDate), { name: 'README.md' })

  const publicOrigin = config.PANGO_PUBLIC_ORIGIN || 'https://aiapp.pangomicro.com'
  for (let index = 0; index < files.length; index++) {
    const { conversation, fileName } = files[index]
    const assetFolder = String(index + 1).padStart(4, '0')
    const markdown = await renderConversationMarkdown(conversation, {
      startDate,
      endDate,
      publicOrigin,
      resolveAsset: archiveAssetResolver(archive, assetFolder, publicOrigin),
    })
    archive.append(markdown, { name: `sessions/${fileName}` })
  }
  await archive.finalize()
}

function exportIndexMarkdown(files, startDate, endDate) {
  const lines = [
    '# Pango慧答问答记录导出',
    '',
    `- 时间范围：${startDate} 至 ${endDate}`,
    `- 会话数量：${files.length}`,
    `- 导出时间：${formatExportDateTime(new Date())}`,
    '',
    '每个会话对应 `sessions/` 目录中的一个 Markdown 文件；会话配图保存在 `assets/` 目录。',
    '',
    '## 会话目录',
    '',
  ]
  if (!files.length) lines.push('所选时间段内没有问答记录。')
  files.forEach(({ conversation, fileName }, index) => {
    const firstQuestion = String(conversation.records[0]?.question || '—').replace(/[\r\n|]/g, ' ').slice(0, 80).replace(/([\\[\]])/g, '\\$1')
    lines.push(`${index + 1}. [${conversation.platform} · ${firstQuestion}](sessions/${encodeURIComponent(fileName)})`)
  })
  return `${lines.join('\n')}\n`
}

function archiveAssetResolver(archive, assetFolder, publicOrigin) {
  return async (media, { kind, round, mediaIndex }) => {
    try {
      const loaded = media?.data_base64
        ? decodeBase64Image(media)
        : await downloadAnswerImage(media, publicOrigin)
      if (!loaded) return null
      const extension = imageExtension(loaded.mimeType, media?.filename || loaded.sourceUrl)
      const assetName = `${kind}-${String(round).padStart(3, '0')}-${String(mediaIndex + 1).padStart(2, '0')}.${extension}`
      const archivePath = `assets/${assetFolder}/${assetName}`
      archive.append(loaded.buffer, { name: archivePath })
      return { relativePath: `../${archivePath}` }
    } catch (error) {
      console.warn(`Conversation export skipped ${kind} image:`, safeError(error))
      return null
    }
  }
}

function decodeBase64Image(media) {
  const mimeType = String(media?.mime_type || '').trim().toLowerCase()
  if (!mimeType.startsWith('image/')) throw new Error('图片 MIME 类型不正确')
  const raw = String(media?.data_base64 || '').replace(/^data:image\/[^;]+;base64,/i, '').replace(/\s/g, '')
  if (!raw || !/^[a-zA-Z0-9+/]*={0,2}$/.test(raw)) throw new Error('图片 Base64 数据不正确')
  const buffer = Buffer.from(raw, 'base64')
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('单张图片超过25MB限制')
  return { buffer, mimeType }
}

async function downloadAnswerImage(media, publicOrigin) {
  const rawUrl = media?.absoluteUrl || media?.absolute_url || media?.url || media?.image_url
  if (!rawUrl) return null
  const origin = new URL(publicOrigin)
  const url = new URL(String(rawUrl), origin)
  if (url.origin !== origin.origin || !url.pathname.startsWith('/references/figures/')) {
    throw new Error('回答图片地址不在允许的同源目录中')
  }
  const assetResponse = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!assetResponse.ok) throw new Error(`图片下载失败：HTTP ${assetResponse.status}`)
  const mimeType = String(assetResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!mimeType.startsWith('image/')) throw new Error('下载内容不是图片')
  const declaredLength = Number(assetResponse.headers.get('content-length') || 0)
  if (declaredLength > 25 * 1024 * 1024) throw new Error('单张图片超过25MB限制')
  const chunks = []
  let total = 0
  for await (const chunk of assetResponse.body) {
    total += chunk.length
    if (total > 25 * 1024 * 1024) throw new Error('单张图片超过25MB限制')
    chunks.push(chunk)
  }
  return { buffer: Buffer.concat(chunks), mimeType, sourceUrl: url.toString() }
}

function formatExportDateTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value)
}

async function feedback(response, params) {
  const { page, pageSize, offset } = pagination(params, 30)
  const status = optionalStatus(params.get('status'))
  const where = status === null ? '' : ' WHERE status=?'
  const args = status === null ? [] : [status]
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM dto_feedback${where}`, args)
  const [records] = await pool.query(`
    SELECT id,userinfo_id,session_id,platform,feedback_type,detail,question_content,answer_content,
      contact_name,company_name,email,phone,status,processing_progress,dotime,uptime,
      (feedback_images IS NOT NULL AND feedback_images<>'') has_feedback_image
    FROM dto_feedback${where} ORDER BY dotime DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset])
  json(response, 200, { data: { records, total: count.total, page, pageSize } })
}

async function feedbackExport(response, params) {
  const status = optionalStatus(params.get('status'))
  const where = status === null ? '' : ' WHERE status=?'
  const args = status === null ? [] : [status]
  const [records] = await pool.query(`
    SELECT id,dotime,platform,feedback_type,question_content,answer_content,detail,
      contact_name,company_name,email,phone,status,processing_progress,uptime
    FROM dto_feedback${where} ORDER BY dotime DESC`, args)
  json(response, 200, { data: { records } })
}

async function feedbackDetail(response, id) {
  const [[feedback]] = await pool.query('SELECT * FROM dto_feedback WHERE id=?', [id])
  if (!feedback) return json(response, 404, { message: '反馈记录不存在' })
  const [questions] = await pool.query(`
    SELECT id FROM dto_question
    WHERE (? IS NULL OR userinfo_id=?) AND (?='' OR session_id=?) AND question=?
    ORDER BY id DESC LIMIT 1`, [feedback.userinfo_id, feedback.userinfo_id, feedback.session_id || '', feedback.session_id || '', feedback.question_content])
  let answer = null
  if (questions[0]) {
    const [answers] = await pool.query('SELECT reference,answer_media FROM dto_answer WHERE question_id=? ORDER BY id DESC LIMIT 1', [questions[0].id])
    answer = answers[0] || null
  }
  json(response, 200, { data: {
    ...feedback,
    feedback_images: parseJson(feedback.feedback_images) || [],
    reference: parseJson(answer?.reference) || { chunks: [], total: 0 },
    answer_media: parseJson(answer?.answer_media) || [],
    public_origin: config.PANGO_PUBLIC_ORIGIN || 'https://aiapp.pangomicro.com',
  } })
}

async function licenses(response, params) {
  const data=await listApplications(licensePool,params,{workflowEnabled:config.LICENSE_DELIVERY_ENABLED==='true'})
  data.sendingEnabled=config.LICENSE_SEND_ENABLED==='true'
  json(response,200,{data})
}

async function updateStatus(response, table, id, body) {
  const status = Number(body.status)
  if (!Number.isInteger(status) || status < 0 || status > 3) return json(response, 400, { message: '状态参数不正确' })
  const [result] = await pool.query(`UPDATE ${table} SET status=?,uptime=NOW() WHERE id=?`, [status, id])
  if (result.affectedRows !== 1) return json(response, 404, { message: '记录不存在' })
  json(response, 200, { data: true })
}

async function updateLicenseStatus(response, id, body) {
  const status=Number(body.status)
  if(!Number.isInteger(status)||status<0||status>3)throw problem('状态参数不正确')
  if(config.LICENSE_DELIVERY_ENABLED!=='true')throw problem('请先完成 License 工作流迁移并启用配置',503)
  return json(response,200,{data:await setApplicationStatus(licensePool,id,body,adminUser)})
}

async function handleLicenseDelivery(request, response, path, params) {
  const enabled = config.LICENSE_DELIVERY_ENABLED === 'true'
  if (request.method === 'GET' && path === '/license-delivery/config') return json(response, 200, {data:{enabled, sendingEnabled:config.LICENSE_SEND_ENABLED === 'true', timezone:'Asia/Shanghai', digestAt:'09:00', deliveryAt:'20:00'}})
  if (request.method === 'POST') {
    if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw problem('仅接受 JSON 请求',415)
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw problem('请求来源不允许',403)
  }
  if (path === '/license-delivery/mail-settings' && request.method === 'GET') {
    response.setHeader('Cache-Control','no-store')
    return json(response,200,{data:await mailSettingsView(config,configPath)})
  }
  if (path === '/license-delivery/mail-settings' && request.method === 'POST') {
    const body=await readLicenseJson(request,512000)
    const data=await withDeliveryLock(licensePool,()=>saveMailSettings(config,configPath,body,adminUser))
    response.setHeader('Cache-Control','no-store')
    return json(response,200,{data})
  }
  if (['/license-delivery/mail-preview','/license-delivery/mail-test'].includes(path) && request.method==='POST') {
    const body=await readLicenseJson(request,512000)
    const effective=await applySavedMailSettings(config,configPath)
    const message=sampleMail(effective,body)
    response.setHeader('Cache-Control','no-store')
    if(path.endsWith('/mail-preview'))return json(response,200,{data:publicMailPreview(effective,message)})
    if(body.confirm!==true||!validEmail(body.to)||!/^[a-f0-9-]{36}$/.test(body.testId||''))throw problem('请指定测试邮箱并确认发送',400)
    for(const [key,value]of mailTests)if(value.expiresAt<Date.now())mailTests.delete(key)
    const existing=mailTests.get(body.testId)
    if(existing)return json(response,200,{data:await existing.promise})
    if(mailTestRunning||mailTests.size>=30)throw problem('测试邮件正在发送或次数过多，请稍后再试',429)
    assertMailConfiguration(effective,{requireFae:['customer','rejection'].includes(message.mailKind)})
    mailTestRunning=true
    const promise=createWorkflowMailSender(effective,{testRecipient:body.to})(message)
      .then(result=>({...result,messageId:message.messageId,to:message.to}))
      .catch(()=>({state:'unknown',detail:'测试结果不明，请先检查邮箱，勿重复发送',messageId:message.messageId,to:message.to}))
      .finally(()=>{mailTestRunning=false})
    mailTests.set(body.testId,{promise,expiresAt:Date.now()+3600000})
    return json(response,200,{data:await promise})
  }
  if (!enabled) throw problem('License 自动发放尚未配置，请先执行数据库迁移并启用配置', 503)
  if(request.method==='POST'&&['/license-delivery/applications/batch-notify-fae/preview','/license-delivery/applications/batch-notify-fae'].includes(path)){
    const body=await readLicenseJson(request)
    const effective=await applySavedMailSettings(config,configPath)
    const options={applicationIds:body.applicationIds,requestId:body.requestId,expectedVersion:body.expectedVersion,expectedFaeEmail:body.expectedFaeEmail,confirm:body.confirm,faeEmail:effective.LICENSE_FAE_EMAIL,templates:effective.LICENSE_MAIL_TEMPLATES,logo:effective.LICENSE_MAIL_LOGO,actor:adminUser}
    response.setHeader('Cache-Control','no-store')
    if(path.endsWith('/preview'))return json(response,200,{data:await previewBatchFae(licensePool,options)})
    assertMailConfiguration(effective,{requireFae:false})
    return json(response,200,{data:await notifyBatchFae(licensePool,createWorkflowMailSender(effective),options)})
  }
  const applicationFileMatch=/^\/license-delivery\/applications\/(\d+)\/files$/.exec(path)
  if(applicationFileMatch&&request.method==='GET')return json(response,200,{data:await applicationFiles(licensePool,applicationFileMatch[1])})
  if(applicationFileMatch&&request.method==='POST')return json(response,200,{data:await uploadApplicationFile(licensePool,applicationFileMatch[1],await readLicenseJson(request,2*1024*1024),adminUser)})
  const queuedPreview=/^\/license-delivery\/(files|rejections)\/([a-f0-9-]+)\/mail-content$/.exec(path)
  if(queuedPreview&&['GET','POST'].includes(request.method)){
    const effective=await applySavedMailSettings(config,configPath)
    const options={from:effective.LICENSE_FAE_EMAIL,replyTo:effective.LICENSE_REPLY_TO||effective.LICENSE_FAE_EMAIL,templates:effective.LICENSE_MAIL_TEMPLATES,logo:effective.LICENSE_MAIL_LOGO}
    const data=await queuedMailPreview(licensePool,queuedPreview[1]==='files'?'file':'rejection',queuedPreview[2],options,request.method==='POST'?await readLicenseJson(request,100000):null,adminUser)
    return json(response,200,{data})
  }
  if(path==='/license-delivery/nightly-reports'&&request.method==='GET')return json(response,200,{data:await listNightlyReports(licensePool)})
  const reportMatch=/^\/license-delivery\/nightly-reports\/([a-f0-9-]{36})$/.exec(path)
  if(reportMatch&&request.method==='GET'){
    const report=await nightlyReportDetail(licensePool,reportMatch[1])
    return json(response,200,{data:{...report,message:{to:report.message.to,subject:report.message.subject,text:report.message.text,html:mailPreviewHtml(report.message)}}})
  }
  const workflowMatch=/^\/license-delivery\/applications\/(\d+)\/workflow$/.exec(path)
  if(workflowMatch&&['GET','POST'].includes(request.method)){
    const effective=await applySavedMailSettings(config,configPath)
    if(request.method==='GET')return json(response,200,{data:await applicationWorkflow(licensePool,workflowMatch[1],effective.LICENSE_FAE_EMAIL)})
    const body=await readLicenseJson(request)
    if(body.confirm!==true||String(body.confirmedApplicationId)!==workflowMatch[1]||(body.action==='deliver-license'&&(!/^[a-f0-9-]{36}$/.test(body.expectedFileId||'')||!Array.isArray(body.expectedCc))))throw problem('请确认选中的申请、文件及真实发送',400)
    assertMailConfiguration(effective,{requireFae:body.action==='deliver-license'})
    const result=await runApplicationStep(licensePool,createWorkflowMailSender(effective),{applicationId:workflowMatch[1],action:body.action,expectedFileId:body.expectedFileId,expectedEmail:body.expectedEmail,expectedCc:body.expectedCc,expectedFaeEmail:body.expectedFaeEmail,faeEmail:effective.LICENSE_FAE_EMAIL,replyTo:effective.LICENSE_REPLY_TO||effective.LICENSE_FAE_EMAIL,templates:effective.LICENSE_MAIL_TEMPLATES,logo:effective.LICENSE_MAIL_LOGO,actor:adminUser})
    return json(response,200,{data:result})
  }
  if (request.method === 'GET' && path === '/license-delivery/files') return json(response,200,{data:await listFiles(licensePool,params)})
  if (request.method === 'GET' && path === '/license-delivery/customer-mail') return json(response,200,{data:await listCustomerMail(licensePool,params)})
  if (request.method === 'GET' && path === '/license-delivery/notices') {
    const [records] = await licensePool.query("SELECT id,kind,recipient,state,detail,message_id,attempts,created_at,updated_at FROM dto_license_mail WHERE kind IN ('digest','summary') ORDER BY updated_at DESC LIMIT 20")
    return json(response,200,{data:{records}})
  }
  const ccMatch=/^\/license-delivery\/(files|rejections)\/([a-f0-9-]+)\/cc$/.exec(path)
  if(ccMatch&&request.method==='POST')return json(response,200,{data:await setMailCc(licensePool,ccMatch[1]==='files'?'file':'rejection',ccMatch[2],await readLicenseJson(request),adminUser)})
  const historyMatch=/^\/license-delivery\/applications\/(\d+)\/history$/.exec(path)
  if(historyMatch&&request.method==='GET')return json(response,200,{data:await applicationStatusHistory(licensePool,historyMatch[1])})
  const rejectionMatch=/^\/license-delivery\/rejections\/(\d+)(\/retry|\/cancel|\/restore)?$/.exec(path)
  if(rejectionMatch&&request.method==='GET'&&!rejectionMatch[2])return json(response,200,{data:await rejectionDetail(licensePool,rejectionMatch[1])})
  if(rejectionMatch&&request.method==='POST'&&rejectionMatch[2]==='/restore')return json(response,200,{data:await restoreRejection(licensePool,rejectionMatch[1],await readLicenseJson(request),adminUser)})
  if(rejectionMatch&&request.method==='POST'&&rejectionMatch[2]==='/cancel')return json(response,200,{data:await cancelRejection(licensePool,rejectionMatch[1],await readLicenseJson(request),adminUser)})
  if(rejectionMatch&&request.method==='POST'&&rejectionMatch[2]==='/retry')return json(response,200,{data:await retryRejection(licensePool,rejectionMatch[1],(await readLicenseJson(request)).note,adminUser)})
  const noticeMatch=/^\/license-delivery\/notices\/([a-f0-9-]{36})\/resolve$/.exec(path)
  if(noticeMatch&&request.method==='POST')return json(response,200,{data:await resolveWorkflowMail(licensePool,noticeMatch[1],await readLicenseJson(request),adminUser)})
  if (request.method === 'POST' && path === '/license-delivery/upload') return json(response,200,{data:await uploadFiles(licensePool,await readLicenseJson(request,MAX_UPLOAD_BODY),adminUser)})
  const match = /^\/license-delivery\/files\/([a-f0-9-]{36})(\/action|\/content)?$/.exec(path)
  if (match && request.method === 'GET' && !match[2]) return json(response,200,{data:await fileDetail(licensePool,match[1])})
  if (match && request.method === 'POST' && match[2] === '/action') return json(response,200,{data:await fileAction(licensePool,match[1],await readLicenseJson(request),adminUser)})
  if (match && request.method === 'GET' && match[2] === '/content') {
    const [[file]] = await licensePool.query('SELECT original_name,content FROM dto_license_file WHERE id=?',[match[1]])
    if (!file) throw problem('文件不存在',404)
    response.writeHead(200, {'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    return response.end(file.content)
  }
  throw problem('接口不存在',404)
}

async function updateFeedbackProgress(response, id, body) {
  const progress = String(body.processingProgress || '').trim()
  if (progress.length > 5000) return json(response, 400, { message: '处理进展不能超过5000字' })
  const [result] = await pool.query(
    'UPDATE dto_feedback SET processing_progress=?,uptime=NOW() WHERE id=?',
    [progress || null, id])
  if (result.affectedRows !== 1) return json(response, 404, { message: '反馈记录不存在' })
  json(response, 200, { data: true })
}

async function serveStatic(response, pathname) {
  const dist = join(root, 'dist')
  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let target = normalize(join(dist, relative))
  if (!target.startsWith(dist)) return json(response, 403, { message: 'Forbidden' })
  try {
    if (!(await stat(target)).isFile()) throw new Error('not file')
  } catch {
    target = join(dist, 'index.html')
  }
  const body = await readFile(target)
  response.writeHead(200, { 'Content-Type': mime(extname(target)), 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public,max-age=3600' })
  response.end(body)
}

function pagination(params, fallback) {
  const page = clampNumber(params.get('page'), 1, Number.MAX_SAFE_INTEGER, 1)
  const pageSize = clampNumber(params.get('pageSize'), 1, 100, fallback)
  return { page, pageSize, offset: (page - 1) * pageSize }
}
function selectedDateRange(params) {
  const today = formatLocalDate(new Date())
  const defaultStart = formatLocalDate(new Date(Date.now() - 29 * 86400000))
  const startDate = validDate(params.get('startDate')) || defaultStart
  const endDate = validDate(params.get('endDate')) || today
  const start = new Date(`${startDate}T00:00:00+08:00`)
  const end = new Date(`${endDate}T00:00:00+08:00`)
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
  if (dayCount < 1 || dayCount > 366) throw new Error('查询日期范围必须为1到366天')
  return { startDate, endDate, dayCount }
}
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return ''; const date = new Date(`${value}T00:00:00+08:00`); return Number.isNaN(date.getTime()) ? '' : value }
function formatLocalDate(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) }
function optionalStatus(value) { return value === null || value === '' ? null : clampNumber(value, 0, 3, 0) }
function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback }
function parseJson(value) { if (!value) return null; if (typeof value === 'object') return value; try { return JSON.parse(value) } catch { return null } }
function sequenceSql(count) { return Array.from({ length: count }, (_, index) => `SELECT ${index} n`).join(' UNION ALL ') }
function argumentValue(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : '' }
function loadConfig(path) {
  let text
  try { text = readFileSync(path, 'utf8') }
  catch { throw new Error(`无法读取数据库配置文件：${path}\n请复制 config/database.env.example 为 config/database.env 后填写。`) }
  return text.split(/\r?\n/).reduce((values, line, lineIndex) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return values
    const separator = trimmed.indexOf('=')
    if (separator <= 0) throw new Error(`配置文件第 ${lineIndex + 1} 行格式错误，应为 KEY=VALUE`)
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1)
    values[key] = value
    return values
  }, {})
}
function requiredConfig(name) { const value = config[name]; if (!value) throw new Error(`配置文件缺少 ${name}`); return value }
function parsePasswordHash(value) {
  const [algorithm, iterationsText, salt, hash] = String(value).split('$')
  const iterations = Number(iterationsText)
  if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100000 || !salt || !hash) {
    throw new Error('ADMIN_CONSOLE_PASSWORD_HASH 格式错误，请使用凭据生成脚本重新生成')
  }
  return { iterations, salt, hash }
}
function verifyPassword(password, stored) {
  const actual = pbkdf2Sync(password, stored.salt, stored.iterations, 32, 'sha256')
  const expected = fromBase64Url(stored.hash)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function safeTextEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
function toBase64Url(value) { return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
function fromBase64Url(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64 + '='.repeat((4 - base64.length % 4) % 4), 'base64')
}
function safeError(error) { return String(error?.message || error || '数据库查询失败，请检查本地服务日志') }
function json(response, status, body, headers = {}) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); response.end(JSON.stringify(body)) }
function readJson(request) { return new Promise((resolve, reject) => { let raw=''; request.on('data', chunk => { raw += chunk; if (raw.length > 10000) request.destroy() }); request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (error) { reject(error) } }); request.on('error', reject) }) }

async function readLicenseJson(request, maxBytes = 10000) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw problem('请求内容超过大小限制', 413)
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required')
    return body
  } catch { throw problem('JSON 格式错误，应为对象') }
}

function mime(extension) { return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2' })[extension] || 'application/octet-stream' }
