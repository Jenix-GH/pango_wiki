import { buildQueuedMessage } from './licenseQueuedMail.mjs'
import { storeNightlyReport, sentResultRow } from './licenseNightlyReport.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { applyMailTemplate, mailVariables, escapeMailHtml, mailTextToHtml } from './licenseMailTemplates.mjs'

export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_BATCH_BYTES = 10 * 1024 * 1024
export const MAX_BATCH_FILES = 50
export const MAX_UPLOAD_BODY = 15 * 1024 * 1024
const ACTIVE = ['queued', 'conflict', 'unmatched', 'paused', 'failed', 'unknown', 'sending']
export const FILE_COLUMNS = 'id,batch_id,original_name,mac,sha256,byte_length,application_id,state,reason,uploaded_by,attempts,uploaded_at,updated_at'

export function problem(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}
export function macFromFilename(name) {
  return /^new_pds_([a-f\d]{12})(?:_floating)?\.lic$/i.exec(String(name))?.[1].toUpperCase() || null
}
export function typeFromFilename(name) {
  const match = /^new_pds_[a-f\d]{12}(_floating)?\.lic$/i.exec(String(name))
  return match ? (match[1] ? 'SERVER' : 'STANDALONE') : null
}
export function normalizeMac(value) {
  const text = String(value || '').trim()
  if (!/^(?:[a-f\d]{12}|(?:[a-f\d]{2}[:-]){5}[a-f\d]{2})$/i.test(text)) return null
  return text.replace(/[:-]/g, '').toUpperCase()
}
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)
}
export function normalizeCc(value,to='') {
  if(value===undefined||value===null)return []
  if(typeof value==='string'){
    if(value.length>5000)throw problem('抄送内容过长，最多 10 个邮箱')
    value=value.split(/[,;，；\r\n]+/).map(item=>item.trim()).filter(Boolean)
  }
  if(!Array.isArray(value)||value.length>50||value.some(item=>typeof item!=='string'))throw problem('抄送邮箱格式不正确')
  const seen=new Set([String(to).toLowerCase()]),result=[]
  for(const raw of value){
    const email=raw.trim()
    if(!validEmail(email))throw problem('抄送邮箱无效，请仅填写邮箱地址，不要填写姓名或邮件头')
    if(!seen.has(email.toLowerCase())){seen.add(email.toLowerCase());result.push(email)}
  }
  if(result.length>10)throw problem('每封邮件最多抄送 10 个邮箱')
  return result
}
async function ccForMessage(db,kind,id,row){
  const [[setting]]=await db.query('SELECT * FROM dto_license_cc WHERE target_kind=? AND target_id=?',[kind,String(id)])
  if(!setting)return []
  if(String(setting.application_id)!==String(row.id)||setting.recipient!==row.email)throw problem('抄送设置对应的申请或收件人已变化，请重新保存或清除抄送',409)
  return normalizeCc(JSON.parse(setting.cc_json),row.email)
}
async function attachCc(db,kind,records){
  if(!records.length)return
  const ids=records.map(row=>String(kind==='file'?row.id:row.application_id))
  const [settings]=await db.query(`SELECT target_id,cc_json FROM dto_license_cc WHERE target_kind=? AND target_id IN (${ids.map(()=>'?').join(',')})`,[kind,...ids])
  const byId=new Map(settings.map(row=>[String(row.target_id),normalizeCc(JSON.parse(row.cc_json))]))
  for(const row of records)row.cc=byId.get(String(kind==='file'?row.id:row.application_id))||[]
}
async function attachRecipientHistory(db,mails){
  if(!mails.length)return
  const [records]=await db.query(`SELECT mail_id,recipient,cc_json,created_at FROM dto_license_mail_recipients WHERE mail_id IN (${mails.map(()=>'?').join(',')}) ORDER BY id DESC`,mails.map(row=>row.id))
  for(const mail of mails){
    mail.recipient_history=records.filter(row=>row.mail_id===mail.id).map(row=>({recipient:row.recipient,cc:normalizeCc(JSON.parse(row.cc_json),row.recipient),created_at:row.created_at}))
    mail.cc=mail.recipient_history[0]?.cc||[]
  }
}
export async function setMailCc(pool,kind,id,body,actor){
  if(!['file','rejection'].includes(kind))throw problem('邮件类型无效')
  if(body.cc===undefined||typeof body.expectedUpdatedAt!=='string')throw problem('请刷新当前记录后保存抄送')
  const table=kind==='file'?'dto_license_file':'dto_license_rejection',key=kind==='file'?'id':'application_id'
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[record]]=await db.query(`SELECT * FROM ${table} WHERE ${key}=? FOR UPDATE`,[id])
      if(!record)throw problem('记录不存在',404)
      if(!['queued','failed','paused'].includes(record.state))throw problem('仅待发送、明确失败或已暂停的邮件可以修改抄送；已发送或结果待核查时不能修改',409)
      if(String(record.updated_at)!==body.expectedUpdatedAt)throw problem('记录已变化，请刷新核对后保存抄送',409)
      const applicationId=record.application_id
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[applicationId])
      if(!row||!validEmail(row.email)||(kind==='file'?Number(row.status)===3:Number(row.status)!==3))throw problem('请先核对匹配申请、申请状态和收件邮箱',409)
      const [[mail]]=await db.query('SELECT state FROM dto_license_mail WHERE dedupe_key=?',[`${kind==='file'?'customer':'rejection'}:${applicationId}`])
      if(mail&&['accepted','sending','unknown'].includes(mail.state))throw problem('邮件已发出或结果待核查，不能修改抄送',409)
      const cc=normalizeCc(body.cc,row.email)
      if(cc.length)await db.query(`INSERT INTO dto_license_cc (target_kind,target_id,application_id,recipient,cc_json,updated_by) VALUES (?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE application_id=VALUES(application_id),recipient=VALUES(recipient),cc_json=VALUES(cc_json),updated_by=VALUES(updated_by),updated_at=NOW(6)`,[kind,String(id),applicationId,row.email,JSON.stringify(cc),actor])
      else await db.query('DELETE FROM dto_license_cc WHERE target_kind=? AND target_id=?',[kind,String(id)])
      await db.query(`UPDATE ${table} SET updated_at=NOW(6) WHERE ${key}=?`,[id])
      await audit(db,kind==='file'?id:null,actor,'set-cc',`申请 #${applicationId} ${kind==='file'?'License':'拒绝通知'}，抄送：${cc.join(', ')||'无'}`)
      await db.commit();return {cc}
    }catch(error){await db.rollback();throw error}
  })
}
export function snapshot(row) {
  const keys=['id','mac_address','email','operating_system','software_version','license_type','duration_years','applicant_name','company_name']
  // Do not invalidate historical snapshots merely because nullable columns were added.
  for(const key of ['email_type','contact_person','max_users'])if(row[key]!=null&&row[key]!=='')keys.push(key)
  return JSON.stringify(Object.fromEntries(keys.map(key => [key, String(row[key] ?? '')])))
}
export function chinaTime(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now).map(p => [p.type,p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}
export function decodeUpload(body) {
  if (!Array.isArray(body?.files) || body.files.length < 1 || body.files.length > MAX_BATCH_FILES) throw problem(`每批请选择 1–${MAX_BATCH_FILES} 个文件`)
  let total = 0
  return body.files.map(file => {
    const name = file?.name
    if (typeof name !== 'string' || !name || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name) || !/\.lic$/i.test(name)) throw problem('仅接受文件名不含路径的 .lic 文件')
    if (typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw problem('文件编码无效')
    const content = Buffer.from(file.base64, 'base64')
    if (!content.length || content.length > MAX_FILE_BYTES) throw problem('单个文件不能为空且不能超过 1 MB')
    total += content.length
    if (total > MAX_BATCH_BYTES) throw problem('每批文件总大小不能超过 10 MB')
    return { name, content, mac: macFromFilename(name), sha256: createHash('sha256').update(content).digest('hex') }
  })
}

// One database-scoped advisory lock serializes uploads, operator actions and scheduled jobs.
// External writers are additionally excluded by an application row lock during SMTP dispatch.
export async function withDeliveryLock(pool, callback) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [[result]] = await connection.query("SELECT GET_LOCK(CONCAT('pango-license:', MD5(DATABASE())), 0) acquired")
    locked = Number(result.acquired) === 1
    if (!locked) throw problem('License 任务正在处理，请稍后重试', 409)
    return await callback(connection)
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT('pango-license:', MD5(DATABASE())))").catch(() => {})
    connection.release()
  }
}
async function audit(db, fileId, actor, action, note = '') {
  await db.query('INSERT INTO dto_license_delivery_audit (file_id,actor,action,note) VALUES (?,?,?,?)', [fileId,actor,action,note.slice(0,500)])
}
async function setFile(db, id, state, reason) {
  await db.query('UPDATE dto_license_file SET state=?,reason=?,updated_at=NOW(6) WHERE id=?', [state,reason.slice(0,500),id])
}
export async function candidates(db, mac, licenseType) {
  if (!mac || !licenseType) return []
  const [rows] = await db.query(`SELECT a.* FROM dto_license_application a
    WHERE UPPER(REPLACE(REPLACE(a.mac_address,'-',''),':',''))=? AND a.license_type=?
    AND a.status IN (0,1,2)
    AND NOT EXISTS (SELECT 1 FROM dto_license_mail m WHERE m.application_id=a.id AND m.kind='customer' AND m.state IN ('accepted','unknown','sending'))
    ORDER BY a.id DESC`, [mac,licenseType])
  return rows.filter(row => normalizeMac(row.mac_address) === mac && row.license_type === licenseType)
}
export async function matchFile(db, file, { resetSnapshot = false } = {}) {
  const licenseType=typeFromFilename(file.original_name)
  if (!file.mac || !licenseType || macFromFilename(file.original_name)!==file.mac) return { state:'unmatched', reason:'文件名应为 new_pds_<12位十六进制MAC>.lic 或 new_pds_<12位十六进制MAC>_floating.lic；请核对后重新上传', application:null }
  if(file.state==='conflict'&&!file.application_id&&!resetSnapshot)return {state:'conflict',reason:'该文件曾有多条候选申请，请在 License 发放中手动上传文件',application:null}
  const available = await candidates(db, file.mac, licenseType)
  let row
  if (file.application_id && (Number(file.manual_selection) === 1 || available.length === 1)) row = available.find(item => String(item.id) === String(file.application_id))
  else if (available.length === 1) row = available[0]
  if (!row) return { state: available.length > 1 ? 'conflict' : 'unmatched', reason: available.length > 1 ? '同一 MAC 和授权类型有多条申请，请在 License 发放中指定申请并手动上传' : '未找到可发放申请，或该申请已发放/待核查/被拒绝', application:null }
  if (!validEmail(row.email)) return { state:'conflict', reason:'客户邮箱格式无效，请先核对申请信息', application:row }
  if (!resetSnapshot && file.application_snapshot && file.application_snapshot !== snapshot(row)) return { state:'conflict', reason:'申请信息已变化，请核对后重新匹配', application:row }
  const [siblings] = await db.query(`SELECT id,original_name FROM dto_license_file WHERE mac=? AND id<>? AND state IN (${ACTIVE.map(() => '?').join(',')})`, [file.mac,file.id,...ACTIVE])
  if (siblings.some(item=>!typeFromFilename(item.original_name)||typeFromFilename(item.original_name)===licenseType)) return { state:'conflict', reason:'同一 MAC 和授权类型有其他待处理文件，请先取消多余文件', application:row }
  return { state:'queued', reason:'唯一匹配；授权内容由上传人员核对，每晚 20:00 自动处理', application:row }
}
async function persistMatch(db, file, result, { advanceStatus = true } = {}) {
  if (advanceStatus && result.state === 'queued' && result.application) {
    await db.query('UPDATE dto_license_application SET status=2,uptime=NOW() WHERE id=? AND status IN (0,1)',[result.application.id])
  }
  await db.query('UPDATE dto_license_file SET application_id=?,application_snapshot=?,state=?,reason=?,updated_at=NOW(6) WHERE id=?', [result.application?.id || file.application_id || null,result.application ? snapshot(result.application) : file.application_snapshot || null,result.state,result.reason,file.id])
}
export async function uploadFiles(pool, body, actor) {
  const files = decodeUpload(body)
  return withDeliveryLock(pool, async db => {
    await db.beginTransaction()
    try {
      const batchId = randomUUID()
      const ids = []
      const reusedIds = []
      for (const file of files) {
        const [existing] = await db.query("SELECT id,state FROM dto_license_file WHERE sha256=? AND mac <=> ? AND (RIGHT(LOWER(original_name),13)='_floating.lic')=(RIGHT(LOWER(?),13)='_floating.lic') AND state<>'duplicate' ORDER BY (state='cancelled'),uploaded_at DESC,id LIMIT 1", [file.sha256,file.mac,file.name])
        if(existing[0]?.state==='cancelled'){
          const id=existing[0].id
          ids.push(id);reusedIds.push(id)
          // Re-upload is explicit intent to restore this file; retain its binding, snapshot,
          // attempt count and history so it cannot silently switch applications or evade retries.
          await db.query("UPDATE dto_license_file SET batch_id=?,original_name=?,content=?,byte_length=?,state='queued',reason='重新上传，等待重新匹配',uploaded_by=?,uploaded_at=NOW(6),updated_at=NOW(6) WHERE id=?",[batchId,file.name,file.content,file.content.length,actor,id])
          await audit(db,id,actor,'reuploaded','已取消文件重新上传，复用原记录并重新校对；保留历史邮件及操作记录')
          continue
        }
        const id = randomUUID()
        ids.push(id)
        await db.query(`INSERT INTO dto_license_file
          (id,batch_id,original_name,mac,sha256,byte_length,content,state,reason,uploaded_by)
          VALUES (?,?,?,?,?,?,?,?,?,?)`, [id,batchId,file.name,file.mac,file.sha256,file.content.length,file.content,existing.length ? 'duplicate':'queued',existing.length ? '相同文件已上传，本条不会再次发送':'等待匹配',actor])
        await audit(db,id,actor,'uploaded',file.name)
      }
      // Match only after the entire batch exists, so two distinct files cannot both queue for one MAC.
      for (const id of ids) {
        const [[file]] = await db.query('SELECT * FROM dto_license_file WHERE id=?',[id])
        if (file.state !== 'duplicate') await persistMatch(db,file,await matchFile(db,file))
      }
      const [records] = await db.query(`SELECT ${FILE_COLUMNS} FROM dto_license_file WHERE batch_id=? ORDER BY uploaded_at,id`,[batchId])
      await db.commit()
      return { batchId, records, reusedIds }
    } catch (error) { await db.rollback(); throw error }
  })
}
export async function listFiles(pool, params) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get('page'),10) || 1))
  const state = params.get('state') || ''
  const query = (params.get('query') || '').slice(0,200)
  const where = ['1=1'], args = []
  if (state) { where.push('state=?'); args.push(state) }
  if (query) { where.push('(original_name LIKE ? OR mac LIKE ? OR application_id=?)'); args.push(`%${query}%`,`%${query.toUpperCase().replace(/[:-]/g,'')}%`,query) }
  const dates=dateConditions(params,'uploaded_at')
  where.push(...dates.conditions);args.push(...dates.args)
  const applicationStatus=params.get('applicationStatus') || ''
  if(applicationStatus){validateApplicationStatus(applicationStatus);where.push('application_id IN (SELECT id FROM dto_license_application WHERE status=?)');args.push(Number(applicationStatus))}
  const clause = where.join(' AND ')
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM dto_license_file WHERE ${clause}`,args)
  const [records] = await pool.query(`SELECT ${FILE_COLUMNS} FROM dto_license_file WHERE ${clause} ORDER BY uploaded_at DESC,id LIMIT 30 OFFSET ?`,[...args,(page-1)*30])
  const [summary] = await pool.query(`SELECT state,COUNT(*) count FROM dto_license_file WHERE ${clause} GROUP BY state`,args)
  await attachCc(pool,'file',records)
  return {records,total:count.total,page,pageSize:30,summary,startDate:dates.startDate,endDate:dates.endDate}
}
export async function fileDetail(pool, id) {
  const [[file]] = await pool.query(`SELECT ${FILE_COLUMNS},application_snapshot FROM dto_license_file WHERE id=?`,[id])
  if (!file) throw problem('文件不存在',404)
  const [mails] = await pool.query('SELECT id,recipient,message_id,state,attempts,detail,created_at,updated_at FROM dto_license_mail WHERE file_id=? ORDER BY created_at DESC',[id])
  const [history] = await pool.query('SELECT actor,action,note,created_at FROM dto_license_delivery_audit WHERE file_id=? ORDER BY id DESC LIMIT 100',[id])
  await attachCc(pool,'file',[file]);await attachRecipientHistory(pool,mails)
  const [[application]]=file.application_id?await pool.query('SELECT * FROM dto_license_application WHERE id=?',[file.application_id]):[[]]
  return {file,application:application||null,licenseType:typeFromFilename(file.original_name),candidates:await candidates(pool,file.mac,typeFromFilename(file.original_name)),mails,history}
}
export async function fileAction(pool,id,body,actor) {
  const note = String(body.note || '').trim().slice(0,500)
  return withDeliveryLock(pool, async db => {
    await db.beginTransaction()
    try {
      const [[file]] = await db.query('SELECT * FROM dto_license_file WHERE id=? FOR UPDATE',[id])
      if (!file) throw problem('文件不存在',404)
      if (['accepted','cancelled','duplicate','sending'].includes(file.state)) throw problem('该记录不可执行此操作',409)
      if (body.action === 'resolve-accepted' || body.action === 'resolve-failed') {
        if (file.state !== 'unknown' || !note) throw problem('仅结果待核查记录可登记核查结论，必须填写依据')
        const accepted = body.action === 'resolve-accepted'
        await db.query("UPDATE dto_license_mail SET state=?,detail=?,updated_at=NOW(6) WHERE file_id=? AND state='unknown'",[accepted?'accepted':'failed',`人工核查：${note}`,id])
        await setFile(db,id,accepted?'accepted':'paused',`人工核查：${note}`)
      } else if (file.state === 'unknown') throw problem('先核查邮件服务记录，登记已发送或确定未发送')
      else if (body.action === 'cancel') await setFile(db,id,'cancelled',note || '管理员取消，文件不再发放')
      else if (body.action === 'pause') await setFile(db,id,'paused','管理员暂停自动发放')
      else if (body.action === 'match') {
        if (!note) throw problem('请填写已核对申请和文件的说明')
        if(body.applicationId)throw problem('请在 License 发放中手动上传或替换文件',400)
        const result = await matchFile(db,file,{resetSnapshot:true})
        await persistMatch(db,file,result)
        // Rechecking/resuming an existing association must not discard the operator's choice.
        const manualSelection=Number(file.manual_selection)===1 ? 1 : 0
        await db.query('UPDATE dto_license_file SET manual_selection=? WHERE id=?',[manualSelection,id])
        if (result.state === 'queued') {
          await db.query('UPDATE dto_license_file SET attempts=0 WHERE id=?',[id])
          await db.query("UPDATE dto_license_mail SET attempts=0,detail='管理员核对后重新排队',updated_at=NOW(6) WHERE application_id=? AND kind='customer' AND state='failed'",[result.application.id])
        }
      } else throw problem('不支持的操作')
      await audit(db,id,actor,String(body.action),note)
      await db.commit()
      return {id}
    } catch(error) { await db.rollback(); throw error }
  })
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"','""')}"`
}
export function digestMessage(rows, exceptions, date, recipient) {
  const columns = [['id','申请编号'],['dotime','申请时间'],['applicant_name','申请人'],['company_name','公司或学校'],['operating_system','操作系统'],['software_version','软件版本'],['license_type','授权类型'],['duration_years','使用年限（年）'],['mac_address','MAC 地址'],['email','电子邮箱'],['phone','联系电话'],['address','地址'],['official_submitted','是否已在官网提交'],['email_type','邮箱类型'],['contact_person','FAE 或渠道负责人'],['max_users','最大支持人数']]
  const value=(row,key)=>key==='official_submitted'?(row[key]==null?'未记录':Number(row[key])===1?'是':'否'):key==='email_type'?(row[key]==='PERSONAL'?'个人邮箱':row[key]==='ORGANIZATION'?'公司或学校邮箱':'未填写'):key==='max_users'?(row.license_type==='SERVER'?(row[key]??'未填写'):'不适用'):key==='contact_person'?(row[key]||'未填写'):(row[key]??'')
  const csv = '\ufeff' + [columns.map(([,label]) => csvCell(label)).join(','),...rows.map(row => columns.map(([key])=>csvCell(value(row,key))).join(','))].join('\r\n')
  const details=rows.flatMap(row=>[`#${row.id} | ${row.company_name||''} | ${row.applicant_name||''} | ${row.mac_address||''}`,...columns.map(([key,label])=>`${label}：${value(row,key)}`),''])
  const text = [`待处理 License 申请：${rows.length} 条。这些申请尚未通知 FAE；发送成功后自动转为处理中。`,'',...details,`发放异常：${exceptions.length} 条。`,...exceptions.map(file=>`${file.original_name}：${file.reason}`),'','请登录管理后台处理。'].join('\n')
  const cellStyle='border:1px solid #dbe3ed;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;'
  const widths=[80,135,85,150,80,105,105,90,155,180,115,200,120,130,150,100]
  const tableHead=columns.map(([,label])=>`<th scope="col" style="${cellStyle}background:#eaf0f8;font-weight:600;">${escapeMailHtml(label)}</th>`).join('')
  const tableRows=rows.map((row,index)=>`<tr style="background:${index%2?'#f6f8fb':'#ffffff'};">${columns.map(([key])=>`<td style="${cellStyle}">${mailTextToHtml(value(row,key))||'—'}</td>`).join('')}</tr>`).join('')
  const tables=`<div style="max-width:100%;overflow-x:auto;margin:16px 0 24px;"><table width="2080" cellspacing="0" cellpadding="0" style="width:2080px;min-width:2080px;table-layout:fixed;border-collapse:collapse;font-size:13px;line-height:1.6;"><colgroup>${widths.map(width=>`<col style="width:${width}px;">`).join('')}</colgroup><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></div>`
  const exceptionHtml=exceptions.length?`<ul>${exceptions.map(file=>`<li>${mailTextToHtml(file.original_name)}：${mailTextToHtml(file.reason)}</li>`).join('')}</ul>`:''
  const html=`<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#172b4d;font-size:14px;line-height:1.6;width:100%;"><h2 style="font-size:20px;margin:0 0 12px;">Pango License 待处理申请</h2><p>${escapeMailHtml(date)} · 共 ${rows.length} 条申请</p><p>这些申请尚未通知 FAE；发送成功后自动转为处理中。</p>${tables}<p>发放异常：${exceptions.length} 条。</p>${exceptionHtml}<p>请登录管理后台处理。完整申请信息也已附在 CSV 附件中。</p></div>`
  return { to:recipient,subject:`Pango License 待办汇总 ${date}`,text,html,attachments:[{name:`license_applications_${date}.csv`,base64:Buffer.from(csv).toString('base64')}] }
}
export function customerMessage(row, file, replyTo, cc=[]) {
  return { variables:mailVariables(row),to:row.email,cc:normalizeCc(cc,row.email),replyTo,subject:`Pango License 发放 · 申请 #${row.id}`,text:[`${row.applicant_name || '您好'}：`,'', '您申请的 License 文件已附在本邮件中。',`申请编号：${row.id}`,`软件版本：${row.software_version}`,`授权类型：${row.license_type}`,`使用年限：${row.duration_years} 年`,`MAC 地址：${row.mac_address}`,'','如有问题，请联系对接 FAE。'].join('\n'),attachments:[{name:file.original_name,base64:file.content.toString('base64')}] }
}
async function recoverInterrupted(db) {
  await db.beginTransaction()
  try {
    await db.query("UPDATE dto_license_file SET state='unknown',reason='上次执行中断，发送结果待核查；不会自动重发',updated_at=NOW(6) WHERE state='sending'")
    await db.query("UPDATE dto_license_rejection SET state='unknown',detail='上次发送中断，请核查邮件服务记录',updated_at=NOW(6) WHERE state='sending'")
    await db.query("UPDATE dto_license_mail SET state='unknown',detail='上次执行中断，需核查发送结果',updated_at=NOW(6) WHERE state='sending'")
    await db.commit()
  } catch(error) { await db.rollback(); throw error }
}
async function prepareMail(db, { key,kind,fileId=null,applicationId=null,message }) {
  const [[previous]] = await db.query('SELECT * FROM dto_license_mail WHERE dedupe_key=?',[key])
  if (previous && (previous.state !== 'failed' || previous.attempts >= 3)) return null
  const id = previous?.id || randomUUID()
  const messageId = previous?.message_id || `<${id}@pango-license.local>`
  if (previous) await db.query("UPDATE dto_license_mail SET state='sending',file_id=?,recipient=?,subject=?,attempts=attempts+1,updated_at=NOW(6) WHERE id=?",[fileId,message.to,message.subject,id])
  else await db.query(`INSERT INTO dto_license_mail (id,dedupe_key,kind,file_id,application_id,recipient,subject,message_id,state,attempts) VALUES (?,?,?,?,?,?,?,?,'sending',1)`,[id,key,kind,fileId,applicationId,message.to,message.subject,messageId])
  if(['customer','rejection'].includes(kind))await db.query('INSERT INTO dto_license_mail_recipients (mail_id,recipient,cc_json) VALUES (?,?,?)',[id,message.to,JSON.stringify(normalizeCc(message.cc,message.to))])
  return {id,messageId}
}
async function safeSend(sender, message) {
  try {
    const result = await sender(message)
    if (!['accepted','failed','unknown'].includes(result?.state)) return {state:'unknown',detail:'发送程序返回了无法识别的结果'}
    return { state:result.state,detail:String(result.detail || '').slice(0,500) }
  } catch { return {state:'unknown',detail:'发送程序中断，结果待核查'} }
}
async function finishMail(db, mail, result) {
  await db.query('UPDATE dto_license_mail SET state=?,detail=?,updated_at=NOW(6) WHERE id=?',[result.state,result.detail,mail.id])
}
async function sendNotice(db,sender,key,kind,message,reportId=null) {
  if (!validEmail(message.to)) throw problem('FAE 收件邮箱配置无效')
  let mail
  await db.beginTransaction()
  try {
    const [[priorReport]]=reportId?await db.query('SELECT r.id,r.payload FROM dto_license_nightly_report r JOIN dto_license_mail m ON m.id=r.mail_id WHERE m.dedupe_key=? ORDER BY r.created_at LIMIT 1',[key]):[[]]
    if(priorReport){
      const original=JSON.parse(priorReport.payload).message
      if(original.to!==message.to){
        await db.query('UPDATE dto_license_nightly_report SET summary_detail=? WHERE id=?',['FAE 收件邮箱已变化，原汇总不自动重试；请核查',reportId])
        await db.commit();return {state:'skipped',detail:'FAE 收件邮箱已变化，请核查原汇总'}
      }
      message=original
    }
    mail = await prepareMail(db,{key,kind,message})
    if(reportId)await db.query('UPDATE dto_license_nightly_report SET mail_id=?,summary_detail=? WHERE id=?',[priorReport?null:mail?.id||null,priorReport?(mail?'已重试当日首份汇总；本次明细保留在后台，未另行发送':'当日汇总已处理或需要人工核查；本次明细保留在后台'):(mail?'':'当日汇总已处理或需要人工核查；本次明细保留在后台'),reportId])
    await db.commit()
  }catch(error){await db.rollback();throw error}
  if (!mail) return {state:'skipped',detail:'本次通知已处理或需要人工核查'}
  const result = await safeSend(sender,{...message,messageId:mail.messageId,mailKind:kind})
  await finishMail(db,mail,result)
  return result
}
async function applyDigestStatus(db,mailId) {
  const [items]=await db.query('SELECT * FROM dto_license_digest_item WHERE mail_id=?',[mailId])
  for(const item of items){
    const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[item.application_id])
    if(row && Number(row.status)===0 && snapshot(row)===item.application_snapshot){
      await db.query('UPDATE dto_license_application SET status=1,uptime=NOW() WHERE id=? AND status=0',[row.id])
    }
  }
}
async function dispatchDigest(db,sender,mail,batch,firstAttempt) {
  if(!firstAttempt){
    if(mail.state!=='failed'||mail.attempts>=3)return {state:mail.state==='accepted'?'skipped':mail.state,count:0}
    await db.query("UPDATE dto_license_mail SET state='sending',attempts=attempts+1,updated_at=NOW(6) WHERE id=?",[mail.id])
  }
  const message=JSON.parse(batch.payload)
  await db.beginTransaction()
  try{
    // Keep the exact original digest membership on retry. Never mark new arrivals as notified.
    const [items]=await db.query('SELECT * FROM dto_license_digest_item WHERE mail_id=?',[mail.id])
    for(const item of items){
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[item.application_id])
      if(!row || Number(row.status)!==0 || snapshot(row)!==item.application_snapshot){
        const result={state:'cancelled',detail:'汇总内申请已变化，本封未发送；仍待处理申请进入下次汇总'}
        await finishMail(db,mail,result);await db.commit();return {...result,count:items.length}
      }
    }
    const result=await safeSend(sender,{...message,messageId:mail.message_id,mailKind:'digest'})
    await finishMail(db,mail,result)
    if(result.state==='accepted')await applyDigestStatus(db,mail.id)
    await db.commit()
    return {...result,count:items.length}
  }catch(error){await db.rollback();throw error}
}
export async function runDigest(pool,sender,{faeEmail,now=new Date(),templates={},logo=null}) {
  const {date,hour}=chinaTime(now)
  if(hour!==9)throw problem('早间任务仅在北京时间 09:00–09:59 执行')
  if(!validEmail(faeEmail))throw problem('FAE 收件邮箱配置无效')
  return withDeliveryLock(pool,async db=>{
    await recoverInterrupted(db)
    // Retry a prior explicit failure using its original payload and members, even across dates.
    const [[pending]]=await db.query("SELECT m.*,b.payload FROM dto_license_mail m JOIN dto_license_digest_batch b ON b.mail_id=m.id WHERE m.kind='digest' AND m.state='failed' AND m.attempts<3 ORDER BY m.created_at LIMIT 1")
    if(pending)return dispatchDigest(db,sender,pending,pending,false)
    const [[existing]]=await db.query('SELECT m.*,b.payload FROM dto_license_mail m LEFT JOIN dto_license_digest_batch b ON b.mail_id=m.id WHERE m.dedupe_key=?',[`digest:${date}`])
    if(existing)return {state:existing.state==='accepted'?'skipped':existing.state,count:0}
    const [rows]=await db.query(`SELECT a.* FROM dto_license_application a WHERE a.status=0
      AND NOT EXISTS (SELECT 1 FROM dto_license_file f WHERE f.application_id=a.id AND f.state IN ('queued','sending','accepted','unknown','paused'))
      AND NOT EXISTS (SELECT 1 FROM dto_license_mail m WHERE m.application_id=a.id AND m.kind='customer' AND m.state IN ('accepted','unknown','sending'))
      AND NOT EXISTS (SELECT 1 FROM dto_license_digest_item i JOIN dto_license_mail m ON m.id=i.mail_id WHERE i.application_id=a.id AND m.state IN ('accepted','sending','unknown','failed')) ORDER BY a.id`)
    const [exceptions]=await db.query("SELECT original_name,reason FROM dto_license_file WHERE state IN ('conflict','unmatched','failed','unknown') ORDER BY uploaded_at")
    const [rejected]=await db.query("SELECT application_id,detail FROM dto_license_rejection WHERE state IN ('failed','unknown','paused')")
    exceptions.push(...rejected.map(row=>({original_name:`申请 #${row.application_id} 拒绝邮件`,reason:row.detail})))
    if(!rows.length&&!exceptions.length)return {state:'empty',count:0}
    const message=applyMailTemplate(digestMessage(rows,exceptions,date,faeEmail),'digest',templates,date,logo)
    let prepared
    await db.beginTransaction()
    try{
      prepared=await prepareMail(db,{key:`digest:${date}`,kind:'digest',message})
      await db.query('INSERT INTO dto_license_digest_batch (mail_id,payload) VALUES (?,?)',[prepared.id,JSON.stringify(message)])
      for(const row of rows)await db.query('INSERT INTO dto_license_digest_item (mail_id,application_id,application_snapshot) VALUES (?,?,?)',[prepared.id,row.id,snapshot(row)])
      await db.commit()
    }catch(error){await db.rollback();throw error}
    return dispatchDigest(db,sender,{id:prepared.id,message_id:prepared.messageId},{payload:JSON.stringify(message)},true)
  })
}
async function deliverLicenseFile(db,sender,id,{date,replyTo,faeEmail,templates={},logo=null,actor='nightly',expectedApplicationId,expectedEmail,expectedCc}) {
      const [[file]] = await db.query('SELECT * FROM dto_license_file WHERE id=?',[id])
      if (createHash('sha256').update(file.content).digest('hex') !== file.sha256 || file.content.length !== file.byte_length) {
        await setFile(db,id,'paused','文件完整性校验失败，请取消并重新上传')
        return {id,state:'paused'}
      }
      const match = await matchFile(db,file)
      if (match.state !== 'queued') { await setFile(db,id,match.state,match.reason); return {id,state:match.state} }
      if(expectedApplicationId && String(match.application.id)!==String(expectedApplicationId))throw problem('文件匹配已变化，请刷新核对',409)
      if(expectedEmail && match.application.email!==expectedEmail)throw problem('申请邮箱已变化，请刷新核对',409)
      await persistMatch(db,file,match,{advanceStatus:false})
      const row = match.application
      let cc
      try{cc=await ccForMessage(db,'file',file.id,row)}catch(error){if(!error.statusCode)throw error;await setFile(db,file.id,'paused',error.message);return {id:file.id,state:'paused',detail:error.message}}
      if(expectedCc!==undefined&&JSON.stringify(normalizeCc(expectedCc,row.email))!==JSON.stringify(cc))throw problem('抄送邮箱已变化，请刷新核对后再发送',409)
      let message
      try{({message}=await buildQueuedMessage(db,'file',file,row,{replyTo,from:faeEmail,cc,templates,date,logo}))}
      catch(error){if(!error.statusCode)throw error;await setFile(db,id,'paused',error.message);return {id,state:'paused',detail:error.message}}
      let mail
      await db.beginTransaction()
      try {
        mail = await prepareMail(db,{key:`customer:${row.id}`,kind:'customer',fileId:id,applicationId:row.id,message})
        if (!mail) {
          await setFile(db,id,'paused','申请已有发放记录或已达重试上限，请核查')
          await db.commit(); return {id,state:'paused'}
        }
        await db.query("UPDATE dto_license_file SET state='sending',attempts=attempts+1,reason='正在发送',updated_at=NOW(6) WHERE id=?",[id])
        await audit(db,id,actor,'sending',`申请 #${row.id}，收件人 ${message.to}，Message-ID ${mail.messageId}`)
        await db.commit()
      } catch(error) { await db.rollback(); throw error }
      await db.beginTransaction()
      try {
        const [[current]] = await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[row.id])
        let result
        if (!current || ![0,1,2].includes(Number(current.status)) || snapshot(current) !== snapshot(row)) result={state:'failed',detail:'发送前申请信息已改变，本次未发信'}
        else result=await safeSend(sender,{...message,messageId:mail.messageId,mailKind:'customer'})
        await finishMail(db,mail,result)
        await setFile(db,id,result.state,result.state==='accepted'?'邮件服务已接受；不代表客户已收件':result.detail)
        await audit(db,id,actor,result.state,result.detail)
        await db.commit()
        return {id,state:result.state,detail:result.detail,reportRow:sentResultRow('file',row,message,file.original_name,result)}
      } catch(error) {
        await db.rollback()
        throw error
      }
}

export async function runNightly(pool,sender,{faeEmail,replyTo,now=new Date(),templates={},logo=null}) {
  const {date,hour} = chinaTime(now)
  if (hour!==20) throw problem('夜间任务仅在北京时间 20:00–20:59 执行')
  if (!validEmail(faeEmail)) throw problem('FAE 收件邮箱配置无效')
  if (replyTo && !validEmail(replyTo)) throw problem('FAE 回复邮箱配置无效')
  return withDeliveryLock(pool, async db => {
    await recoverInterrupted(db)
    const cutoff = `${date} 20:00:00.000000`
    const [files] = await db.query("SELECT id FROM dto_license_file WHERE uploaded_at<=? AND state IN ('queued','conflict','unmatched','failed') AND attempts<3 ORDER BY uploaded_at,id LIMIT 500",[cutoff])
    const results=[]
    for (const {id} of files) results.push(await deliverLicenseFile(db,sender,id,{date,replyTo,faeEmail,templates,logo}))
    const rejectionResults=await dispatchRejections(db,sender,{cutoff,replyTo,faeEmail,templates,date,logo})
    results.push(...rejectionResults)
    const [counts] = await db.query('SELECT state,COUNT(*) count FROM dto_license_file WHERE uploaded_at<=? GROUP BY state',[cutoff])
    let summaryResult = null
    if (files.length || rejectionResults.length || counts.some(item=>['unknown','failed','conflict','unmatched'].includes(item.state))) {
      const report=await storeNightlyReport(db,{date,cutoff,files,rejectionResults,counts,results,faeEmail,templates,logo})
      summaryResult = await sendNotice(db,sender,`nightly-summary:${date}`,'summary',report.message,report.id)
    }
    return {date,cutoff,results,summary:summaryResult}
  })
}

function validApplicationId(id){if(!/^[1-9]\d{0,19}$/.test(String(id)))throw problem('申请编号无效');return String(id)}
export async function applicationWorkflow(pool,id,faeEmail){
  id=validApplicationId(id)
  const [[application]]=await pool.query('SELECT * FROM dto_license_application WHERE id=?',[id])
  if(!application)throw problem('申请不存在',404)
  const [files]=await pool.query(`SELECT ${FILE_COLUMNS} FROM dto_license_file WHERE application_id=? ORDER BY uploaded_at DESC,id`,[id])
  const [mails]=await pool.query(`SELECT m.id,m.kind,m.recipient,m.state,m.message_id,m.detail,m.updated_at FROM dto_license_mail m
    WHERE m.application_id=? OR EXISTS (SELECT 1 FROM dto_license_digest_item i WHERE i.mail_id=m.id AND i.application_id=?) ORDER BY m.created_at DESC LIMIT 20`,[id,id])
  await attachCc(pool,'file',files);await attachRecipientHistory(pool,mails)
  return {application,faeEmail,files,mails}
}
// Explicit administrator action: scope every query/transition to this application.
// It uses the same dispatch functions and durable dedupe keys as scheduled jobs.
export async function runApplicationStep(pool,sender,{applicationId,action,expectedFileId,expectedEmail,expectedCc,expectedFaeEmail,faeEmail,replyTo,templates={},logo=null,actor='admin',now=new Date()}){
  const id=validApplicationId(applicationId)
  if(!['deliver-license','notify-fae'].includes(action))throw problem('请选择立即发送 License 或通知 FAE')
  if(!validEmail(faeEmail)||expectedFaeEmail!==faeEmail)throw problem('FAE 邮箱已变化或未配置，请刷新核对',409)
  return withDeliveryLock(pool,async db=>{
    const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=?',[id])
    if(!row)throw problem('申请不存在',404)
    if(expectedEmail!==row.email||!validEmail(row.email))throw problem('申请邮箱已变化或无效，请刷新核对',409)
    if(action==='notify-fae'){
      const [previous]=await db.query(`SELECT m.*,b.payload FROM dto_license_mail m
        JOIN dto_license_digest_item i ON i.mail_id=m.id JOIN dto_license_digest_batch b ON b.mail_id=m.id
        WHERE i.application_id=? AND m.state IN ('accepted','sending','unknown','failed') ORDER BY m.created_at`,[id])
      if(previous.some(mail=>mail.state==='accepted'))return {state:'skipped',detail:'该申请已通知 FAE，本次未重复发送'}
      if(previous.some(mail=>['sending','unknown'].includes(mail.state)))throw problem('FAE 通知正在处理或结果需核查，本次不重发',409)
      if(Number(row.status)!==0)throw problem('仅待处理申请可以立即通知 FAE',409)
      const [[active]]=await db.query(`SELECT id FROM dto_license_file WHERE application_id=? AND state IN ('queued','sending','accepted','unknown','paused') LIMIT 1`,[id])
      const [[delivered]]=await db.query(`SELECT id FROM dto_license_mail WHERE application_id=? AND kind='customer' AND state IN ('accepted','unknown','sending') LIMIT 1`,[id])
      if(active||delivered)throw problem('该申请已进入 License 发放流程，请先核对文件和邮件记录',409)
      let result
      if(previous.length){
        const mail=previous[0]
        const [[members]]=await db.query('SELECT COUNT(*) total FROM dto_license_digest_item WHERE mail_id=?',[mail.id])
        if(Number(members.total)!==1)throw problem('该申请属于多条申请的失败汇总，请在汇总记录中处理，不能单条重发整封汇总',409)
        if(Number(mail.attempts)>=3)throw problem('FAE 通知重试次数已达上限，请先核查',409)
        if(JSON.parse(mail.payload).to!==faeEmail)throw problem('原汇总收件邮箱与当前 FAE 邮箱不同，请先核查',409)
        result=await dispatchDigest(db,sender,mail,mail,false)
      }else{
        const date=chinaTime(now).date
        const message=applyMailTemplate(digestMessage([row],[],date,faeEmail),'digest',templates,date,logo)
        let prepared
        await db.beginTransaction()
        try{
          // A cancelled snapshot may be replaced; accepted/uncertain membership above prevents resends.
          prepared=await prepareMail(db,{key:`digest:application:${id}:${randomUUID()}`,kind:'digest',message})
          await db.query('INSERT INTO dto_license_digest_batch (mail_id,payload) VALUES (?,?)',[prepared.id,JSON.stringify(message)])
          await db.query('INSERT INTO dto_license_digest_item (mail_id,application_id,application_snapshot) VALUES (?,?,?)',[prepared.id,id,snapshot(row)])
          await db.commit()
        }catch(error){await db.rollback();throw error}
        result=await dispatchDigest(db,sender,{id:prepared.id,message_id:prepared.messageId},{payload:JSON.stringify(message)},true)
      }
      await audit(db,null,actor,'manual-notify-fae',`申请 #${id}: ${result.state}`)
      return result
    }
    if(Number(row.status)===3)throw problem('已拒绝申请不能发放 License',409)
    const [[mail]]=await db.query("SELECT state FROM dto_license_mail WHERE dedupe_key=?",[`customer:${id}`])
    if(mail?.state==='accepted')return {state:'skipped',detail:'该申请已成功发放，本次未重复发送'}
    if(mail&&mail.state!=='failed')throw problem('发放记录正在处理或需核查，本次不重发',409)
    const [files]=await db.query("SELECT id,state,attempts FROM dto_license_file WHERE application_id=? AND state NOT IN ('cancelled','duplicate') ORDER BY uploaded_at,id",[id])
    if(files.length!==1)throw problem(files.length?'存在多个文件，请先核对并取消多余文件':'尚未关联 License，请先上传并匹配',409)
    const file=files[0]
    if(expectedFileId && String(file.id)!==String(expectedFileId))throw problem('关联文件已变化，请刷新核对',409)
    if(!['queued','failed'].includes(file.state)||Number(file.attempts)>=3)throw problem('文件未处于可发放状态；暂停、冲突、结果待核查或重试超限时需先处理',409)
    const result=await deliverLicenseFile(db,sender,file.id,{date:chinaTime(now).date,replyTo,faeEmail,templates,logo,actor,expectedApplicationId:id,expectedEmail,expectedCc})
    return {...result,detail:result.detail||'已完成这条申请的校对，请查看文件状态；其他申请未处理'}
  })
}

export function dateConditions(params,column) {
  const startDate=params.get('startDate')||'',endDate=params.get('endDate')||''
  for(const value of [startDate,endDate]){
    if(!value)continue
    const date=new Date(`${value}T00:00:00Z`)
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)throw problem('日期格式不正确')
  }
  if(startDate&&endDate&&startDate>endDate)throw problem('开始日期不能晚于结束日期')
  const conditions=[],args=[]
  if(startDate){conditions.push(`${column}>=?`);args.push(`${startDate} 00:00:00`)}
  if(endDate){conditions.push(`${column}<DATE_ADD(?,INTERVAL 1 DAY)`);args.push(`${endDate} 00:00:00`)}
  return {conditions,args,startDate,endDate}
}
function validateApplicationStatus(value){if(!['0','1','2','3'].includes(String(value)))throw problem('申请状态不正确')}
export async function listApplications(pool,params,{workflowEnabled=true}={}) {
  const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page'),10)||1))
  const status=params.get('status')||''
  const dates=dateConditions(params,'a.dotime')
  const conditions=[...dates.conditions],args=[...dates.args]
  if(status!==''){validateApplicationStatus(status);conditions.push('a.status=?');args.push(Number(status))}
  const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:''
  const [[count]]=await pool.query(`SELECT COUNT(*) total FROM dto_license_application a ${where}`,args)
  const rejectionColumns=workflowEnabled?',r.reason rejection_reason,r.state rejection_mail_state,r.detail rejection_mail_detail,r.created_at rejected_at':',NULL rejection_reason,NULL rejection_mail_state,NULL rejection_mail_detail,NULL rejected_at'
  const [records]=await pool.query(`SELECT a.*${rejectionColumns} FROM dto_license_application a ${workflowEnabled?'LEFT JOIN dto_license_rejection r ON r.application_id=a.id':''} ${where} ORDER BY a.dotime DESC,a.id DESC LIMIT 30 OFFSET ?`,[...args,(page-1)*30])
  if(workflowEnabled&&records.length){
    const placeholders=records.map(()=>'?').join(',')
    const ids=records.map(row=>row.id)
    const [files]=await pool.query(`SELECT application_id,state FROM dto_license_file WHERE application_id IN (${placeholders}) ORDER BY uploaded_at DESC,id DESC`,ids)
    const latest=new Map()
    for(const file of files)if(!latest.has(String(file.application_id)))latest.set(String(file.application_id),file.state)
    for(const row of records)row.delivery_state=latest.get(String(row.id))||null
  }
  return {records,total:count.total,page,pageSize:30,startDate:dates.startDate,endDate:dates.endDate,workflowEnabled}
}
export function rejectionMessage(row,reason,replyTo,cc=[]){
  return {variables:mailVariables(row,reason),to:row.email,cc:normalizeCc(cc,row.email),replyTo,subject:`Pango License 申请未通过 · 申请 #${row.id}`,text:[`${row.applicant_name||'您好'}：`,'',`您的 License 申请 #${row.id} 未通过处理。`,`MAC 地址：${row.mac_address}`,'','拒绝原因：',reason,'','如需补充资料或有疑问，请联系对接 FAE。'].join('\n'),attachments:[]}
}
export async function rejectApplication(pool,id,reason,actor,expectedStatus){
  if(typeof reason!=='string'||!reason.trim()||reason.trim().length>2000)throw problem('请填写 1–2000 字的拒绝理由')
  reason=reason.trim()
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      if(!row)throw problem('申请不存在',404)
      if(expectedStatus!==undefined&&Number(row.status)!==Number(expectedStatus))throw problem('申请状态已变化，请刷新后再操作',409)
      const [[existing]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=?',[id])
      if(existing&&Number(row.status)===3){
        if(Number(row.status)===3&&existing.reason===reason){await db.commit();return {applicationId:id,state:existing.state}}
        throw problem('该申请已有拒绝记录，请勿重复提交或覆盖理由',409)
      }
      const [sent]=await db.query("SELECT id FROM dto_license_mail WHERE application_id=? AND kind='customer' AND state IN ('accepted','sending','unknown')",[id])
      const [active]=await db.query("SELECT id FROM dto_license_file WHERE application_id=? AND state IN ('accepted','sending','unknown')",[id])
      if(sent.length||active.length)throw problem('License 已发送或发送结果待核查，不能再拒绝，请先核查发放记录',409)
      if(existing){
        if(['sending','unknown'].includes(existing.state))throw problem('拒绝邮件正在发送或结果待核查，请先核查',409)
        await archiveRejectionMail(db,id)
        await db.query("UPDATE dto_license_rejection SET reason=?,recipient=?,application_snapshot=?,requested_by=?,state='queued',detail='',attempts=0,created_at=NOW(6),updated_at=NOW(6) WHERE application_id=?",[reason,String(row.email||''),snapshot(row),actor,id])
      }else await db.query("INSERT INTO dto_license_rejection (application_id,reason,recipient,application_snapshot,requested_by) VALUES (?,?,?,?,?)",[id,reason,String(row.email||''),snapshot(row),actor])
      await db.query("DELETE FROM dto_license_cc WHERE target_kind='rejection' AND target_id=?",[String(id)])
      await recordStatusChange(db,row,3,actor,'人工拒绝：'+reason,existing)

      await db.query('UPDATE dto_license_application SET status=3,uptime=NOW() WHERE id=?',[id])
      await db.query("UPDATE dto_license_file SET state='cancelled',reason='申请已拒绝，停止 License 发放',updated_at=NOW(6) WHERE application_id=? AND state IN ('queued','conflict','unmatched','failed','paused')",[id])
      await audit(db,null,actor,'application-rejected',`申请 #${id}，理由已保存，客户说明邮件进入夜间队列`)
      await db.commit()
      return {applicationId:id,state:'queued'}
    }catch(error){await db.rollback();throw error}
  })
}
async function dispatchRejections(db,sender,{cutoff,replyTo,faeEmail,templates,date,logo}){
  const [requests]=await db.query("SELECT * FROM dto_license_rejection WHERE created_at<=? AND state IN ('queued','failed') AND attempts<3 ORDER BY created_at,application_id LIMIT 500",[cutoff])
  const results=[]
  for(const rejected of requests){
    const id=rejected.application_id
    const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=?',[id])
    if(!row||Number(row.status)!==3||snapshot(row)!==rejected.application_snapshot||!validEmail(row.email)){
      await db.query("UPDATE dto_license_rejection SET state='paused',detail='申请状态或联系信息已变化，或邮箱无效；请核对后重试',updated_at=NOW(6) WHERE application_id=?",[id])
      results.push({applicationId:id,kind:'rejection',state:'paused'});continue
    }
    let cc
    try{cc=await ccForMessage(db,'rejection',id,row)}catch(error){
      if(!error.statusCode)throw error
      await db.query("UPDATE dto_license_rejection SET state='paused',detail=?,updated_at=NOW(6) WHERE application_id=?",[error.message,id])
      results.push({applicationId:id,kind:'rejection',state:'paused'});continue
    }
    let message
    try{({message}=await buildQueuedMessage(db,'rejection',rejected,row,{replyTo,from:faeEmail,cc,templates,date,logo}))}
    catch(error){
      if(!error.statusCode)throw error
      await db.query("UPDATE dto_license_rejection SET state='paused',detail=?,updated_at=NOW(6) WHERE application_id=?",[error.message,id])
      results.push({applicationId:id,kind:'rejection',state:'paused',detail:error.message});continue
    }
    let mail
    await db.beginTransaction()
    try{
      mail=await prepareMail(db,{key:`rejection:${id}`,kind:'rejection',applicationId:id,message})
      if(!mail){await db.rollback();results.push({applicationId:id,kind:'rejection',state:'skipped',detail:'已有发送记录或已达重试上限，请核查'});continue}
      await db.query("UPDATE dto_license_rejection SET state='sending',attempts=attempts+1,detail='正在发送拒绝说明',updated_at=NOW(6) WHERE application_id=?",[id])
      await db.commit()
    }catch(error){await db.rollback();throw error}
    await db.beginTransaction()
    try{
      const [[current]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const result=!current||Number(current.status)!==3||snapshot(current)!==rejected.application_snapshot
        ?{state:'failed',detail:'申请信息已改变，本次未发信'}
        :await safeSend(sender,{...message,messageId:mail.messageId,mailKind:'rejection'})
      await finishMail(db,mail,result)
      await db.query('UPDATE dto_license_rejection SET state=?,detail=?,updated_at=NOW(6) WHERE application_id=?',[result.state,result.detail,id])
      await audit(db,null,'nightly',`rejection-${result.state}`,`申请 #${id}，收件人 ${message.to}，Message-ID ${mail.messageId}`)
      await db.commit();results.push({applicationId:id,kind:'rejection',state:result.state,reportRow:sentResultRow('rejection',row,message,rejected.reason,result)})
    }catch(error){await db.rollback();throw error}
  }
  return results
}
export async function listCustomerMail(pool,params){
  let page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page'),10)||1))
  const kind=params.get('kind')||'',state=params.get('state')||'',view=params.get('view')||'all'
  if(kind&&!['file','rejection'].includes(kind))throw problem('邮件类型不正确')
  if(state&&!['queued','conflict','unmatched','duplicate','paused','sending','accepted','failed','unknown','cancelled'].includes(state))throw problem('邮件状态不正确')
  if(!['all','waiting'].includes(view))throw problem('邮件查看范围不正确')
  // One ordered relation keeps filtering, totals and pagination consistent across both types.
  // Only project display fields: file bytes and application snapshots stay in detail APIs.
  // Legacy application columns and newer workflow tables may use different collations.
  // Normalize display text in the query without changing any stored table or value.
  const text=(expression,alias)=>`CONVERT(${expression} USING utf8mb4) COLLATE utf8mb4_unicode_ci ${alias}`
  const source=`(
    SELECT ${text("'file'",'kind')},${text('f.id','id')},f.application_id,f.uploaded_at queued_at,${text('f.state','state')},f.attempts,
      ${text('a.applicant_name','applicant_name')},${text('a.company_name','company_name')},${text('a.email','recipient')},
      ${text('f.original_name','original_name')},${text('f.mac','mac')},${text('f.reason','reason')},${text("''",'detail')}
      FROM dto_license_file f LEFT JOIN dto_license_application a ON a.id=f.application_id
    UNION ALL
    SELECT ${text("'rejection'",'kind')},${text('CAST(r.application_id AS CHAR)','id')},r.application_id,r.created_at queued_at,${text('r.state','state')},r.attempts,
      ${text('a.applicant_name','applicant_name')},${text('a.company_name','company_name')},${text('r.recipient','recipient')},
      ${text("''",'original_name')},${text('a.mac_address','mac')},${text('r.reason','reason')},${text('r.detail','detail')}
      FROM dto_license_rejection r LEFT JOIN dto_license_application a ON a.id=r.application_id
  ) q`
  const dates=dateConditions(params,'q.queued_at'),where=['1=1',...dates.conditions],args=[...dates.args]
  if(view==='waiting')where.push("q.state IN ('queued','failed') AND q.attempts<3")
  if(kind){where.push('q.kind=?');args.push(kind)}
  if(state){where.push('q.state=?');args.push(state)}
  const query=(params.get('query')||'').trim().slice(0,200)
  if(query){
    where.push("(CAST(q.application_id AS CHAR)=? OR q.applicant_name LIKE ? OR q.company_name LIKE ? OR q.recipient LIKE ? OR q.original_name LIKE ? OR REPLACE(REPLACE(q.mac,':',''),'-','') LIKE ?)")
    args.push(query.replace(/^#/,''),...Array(4).fill(`%${query}%`),`%${query.replace(/[:-]/g,'')}%`)
  }
  const from=`FROM ${source} WHERE ${where.join(' AND ')}`
  const [[count]]=await pool.query(`SELECT COUNT(*) total ${from}`,args)
  page=Math.min(page,Math.max(1,Math.ceil(Number(count.total)/30)))
  const [records]=await pool.query(`SELECT q.* ${from} ORDER BY q.queued_at DESC,q.kind ASC,q.application_id DESC,q.id DESC LIMIT 30 OFFSET ?`,[...args,(page-1)*30])
  const [summary]=await pool.query(`SELECT q.state,COUNT(*) count ${from} GROUP BY q.state`,args)
  await attachCc(pool,'file',records.filter(row=>row.kind==='file'))
  await attachCc(pool,'rejection',records.filter(row=>row.kind==='rejection'))
  return {records,total:count.total,page,pageSize:30,summary}
}
export async function rejectionDetail(pool,id){
  const [[record]]=await pool.query('SELECT * FROM dto_license_rejection WHERE application_id=?',[id])
  if(!record)throw problem('尚无拒绝理由或通知记录',404)
  const [mails]=await pool.query("SELECT id,recipient,state,detail,message_id,attempts,updated_at,(dedupe_key=CONCAT('rejection:',application_id)) current_cycle FROM dto_license_mail WHERE application_id=? AND kind='rejection' ORDER BY (dedupe_key=CONCAT('rejection:',application_id)) DESC,created_at DESC",[id])
  await attachCc(pool,'rejection',[record]);await attachRecipientHistory(pool,mails)
  return {record,mails}
}
export async function cancelRejection(pool,id,body,actor){
  id=validApplicationId(id)
  if(body.confirm!==true||typeof body.expectedUpdatedAt!=='string'||!body.expectedUpdatedAt)throw problem('请确认要屏蔽的拒绝通知，并刷新核对当前记录')
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const [[rejected]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=? FOR UPDATE',[id])
      if(!row||!rejected)throw problem('拒绝通知不存在',404)
      if(Number(row.status)!==3)throw problem('申请已不处于已拒绝状态，请刷新核对',409)
      if(rejected.state==='cancelled'){await db.commit();return {applicationId:id,state:'cancelled'}}
      if(String(rejected.updated_at)!==body.expectedUpdatedAt)throw problem('拒绝通知已变化，请刷新后再屏蔽',409)
      if(!['queued','failed','paused'].includes(rejected.state))throw problem('邮件已发送、正在发送或结果待核查，不能直接屏蔽；请先核查邮件记录',409)
      const [[mail]]=await db.query('SELECT state FROM dto_license_mail WHERE dedupe_key=? FOR UPDATE',[`rejection:${id}`])
      if(mail&&mail.state!=='failed')throw problem('当前拒绝邮件已有发送或待核查记录，不能直接屏蔽',409)
      const detail='管理员已屏蔽此拒绝通知，不再自动发送；申请仍为已拒绝，拒绝理由保留'
      await db.query("UPDATE dto_license_rejection SET state='cancelled',detail=?,updated_at=NOW(6) WHERE application_id=?",[detail,id])
      await db.query("UPDATE dto_license_mail SET state='cancelled',detail=?,updated_at=NOW(6) WHERE dedupe_key=? AND state='failed'",[detail,`rejection:${id}`])
      await audit(db,null,actor,'cancel-rejection',`申请 #${id}：${detail}`)
      await db.commit();return {applicationId:id,state:'cancelled'}
    }catch(error){await db.rollback();throw error}
  })
}
export async function restoreRejection(pool,id,body,actor){
  id=validApplicationId(id)
  if(body.confirm!==true||typeof body.expectedUpdatedAt!=='string'||!body.expectedUpdatedAt)throw problem('请确认恢复拒绝通知，并刷新核对当前记录')
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const [[rejected]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=? FOR UPDATE',[id])
      if(!row||!rejected)throw problem('拒绝通知不存在',404)
      if(Number(row.status)!==3)throw problem('申请已不处于已拒绝状态，请刷新核对',409)
      if(rejected.state==='queued'){await db.commit();return {applicationId:id,state:'queued'}}
      if(String(rejected.updated_at)!==body.expectedUpdatedAt)throw problem('拒绝通知已变化，请刷新后再恢复',409)
      if(rejected.state!=='cancelled')throw problem('仅已取消的拒绝通知可以恢复；已发出或待核查的邮件请先核查',409)
      if(!validEmail(row.email)||snapshot(row)!==rejected.application_snapshot||row.email!==rejected.recipient)throw problem('申请信息或收件邮箱已变化，请先核对，不能直接恢复旧通知',409)
      const [[mail]]=await db.query('SELECT state FROM dto_license_mail WHERE dedupe_key=? FOR UPDATE',[`rejection:${id}`])
      if(mail&&!['cancelled','failed'].includes(mail.state))throw problem('当前拒绝邮件已发出或结果待核查，不能重新排队',409)
      const detail='管理员已恢复此拒绝通知，等待夜间发送；拒绝状态和理由保留'
      await db.query("UPDATE dto_license_rejection SET state='queued',attempts=0,detail=?,updated_at=NOW(6) WHERE application_id=?",[detail,id])
      await db.query("UPDATE dto_license_mail SET state='failed',attempts=0,detail=?,updated_at=NOW(6) WHERE dedupe_key=? AND state IN ('cancelled','failed')",[detail,`rejection:${id}`])
      await audit(db,null,actor,'restore-rejection',`申请 #${id}：${detail}`)
      await db.commit();return {applicationId:id,state:'queued'}
    }catch(error){await db.rollback();throw error}
  })
}
export async function retryRejection(pool,id,note,actor){
  if(typeof note!=='string'||!note.trim())throw problem('请填写核对说明')
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const [[rejected]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=? FOR UPDATE',[id])
      if(!row||Number(row.status)!==3||!rejected||!['failed','paused'].includes(rejected.state))throw problem('仅明确失败或已暂停的拒绝邮件可以重试',409)
      if(!validEmail(row.email))throw problem('客户邮箱格式无效，请先修正申请联系信息')
      await db.query("UPDATE dto_license_rejection SET state='queued',attempts=0,recipient=?,application_snapshot=?,detail='管理员核对后重新排队',updated_at=NOW(6) WHERE application_id=?",[row.email,snapshot(row),id])
      await db.query("UPDATE dto_license_mail SET attempts=0,state='failed',updated_at=NOW(6) WHERE application_id=? AND kind='rejection' AND state='failed'",[id])
      await audit(db,null,actor,'retry-rejection',`申请 #${id}：${note}`)
      await db.commit();return {applicationId:id,state:'queued'}
    }catch(error){await db.rollback();throw error}
  })
}
export async function resolveWorkflowMail(pool,id,body,actor){
  const note=typeof body.note==='string'?body.note.trim():''
  if(!note||!['accepted','failed','retry'].includes(body.outcome))throw problem('请填写核查依据并选择结果')
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[mail]]=await db.query('SELECT * FROM dto_license_mail WHERE id=? FOR UPDATE',[id])
      if(!mail||!['digest','rejection'].includes(mail.kind))throw problem('记录不存在',404)
      if(body.outcome==='retry'?(mail.state!=='failed'||mail.kind!=='digest'):mail.state!=='unknown')throw problem('当前邮件状态不支持此操作',409)
      const state=body.outcome==='accepted'?'accepted':'failed'
      await db.query('UPDATE dto_license_mail SET state=?,attempts=0,detail=?,updated_at=NOW(6) WHERE id=?',[state,`人工核查：${note}`.slice(0,500),id])
      if(mail.kind==='digest'&&state==='accepted')await applyDigestStatus(db,id)
      if(mail.kind==='rejection')await db.query('UPDATE dto_license_rejection SET state=?,detail=?,updated_at=NOW(6) WHERE application_id=?',[state==='accepted'?'accepted':'paused',`人工核查：${note}`.slice(0,500),mail.application_id])
      await audit(db,null,actor,'resolve-notification',`邮件 ${id} ${body.outcome}：${note}`)
      await db.commit();return {id,state}
    }catch(error){await db.rollback();throw error}
  })
}

async function archiveRejectionMail(db,id){
  // Keep accepted emails as evidence; free the active dedupe key for a new rejection cycle.
  await db.query(`UPDATE dto_license_mail SET dedupe_key=CONCAT('rejection-archived:',id),
    state=CASE WHEN state='failed' THEN 'cancelled' ELSE state END,updated_at=NOW(6)
    WHERE dedupe_key=?`,[`rejection:${id}`])
}
async function recordStatusChange(db,row,status,actor,note='',rejection=null){
  await db.query(`INSERT INTO dto_license_status_change
    (application_id,previous_status,next_status,actor,note,rejection_snapshot) VALUES (?,?,?,?,?,?)`,
    [row.id,Number(row.status),status,actor,String(note).slice(0,500),rejection?JSON.stringify(rejection):null])
}
export async function setApplicationStatus(pool,id,body,actor){
  validateApplicationStatus(body.status)
  const status=Number(body.status)
  if(status===3)return rejectApplication(pool,id,body.reason,actor,body.expectedStatus)
  const note=typeof body.note==='string'?body.note.trim().slice(0,500):''
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      if(!row)throw problem('申请不存在',404)
      if(body.expectedStatus!==undefined&&Number(row.status)!==Number(body.expectedStatus))throw problem('申请状态已变化，请刷新后再操作',409)
      if(Number(row.status)===status){await db.commit();return {applicationId:id,status}}
      const [uncertain]=await db.query("SELECT id FROM dto_license_mail WHERE application_id=? AND kind IN ('customer','rejection') AND state IN ('sending','unknown')",[id])
      const [uncertainFiles]=await db.query("SELECT id FROM dto_license_file WHERE application_id=? AND state IN ('sending','unknown')",[id])
      const [[rejected]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=?',[id])
      if(uncertain.length||uncertainFiles.length||['sending','unknown'].includes(rejected?.state))throw problem('邮件正在发送或结果待核查，请先核查邮件记录再修改状态',409)
      if(Number(row.status)===3&&rejected){
        if(rejected.state!=='accepted')await db.query("UPDATE dto_license_rejection SET state='cancelled',detail='人工改回其他状态，未发送的拒绝通知已取消',updated_at=NOW(6) WHERE application_id=?",[id])
        await archiveRejectionMail(db,id)
      }
      await recordStatusChange(db,row,status,actor,note||'人工设置状态',rejected)
      await db.query('UPDATE dto_license_application SET status=?,uptime=NOW() WHERE id=?',[status,id])
      await db.commit()
      return {applicationId:id,status}
    }catch(error){await db.rollback();throw error}
  })
}
export async function applicationStatusHistory(pool,id){
  const [records]=await pool.query('SELECT previous_status,next_status,actor,note,rejection_snapshot,created_at FROM dto_license_status_change WHERE application_id=? ORDER BY id DESC LIMIT 100',[id])
  return {records:records.map(row=>({...row,rejection_snapshot:row.rejection_snapshot?JSON.parse(row.rejection_snapshot):null}))}
}
