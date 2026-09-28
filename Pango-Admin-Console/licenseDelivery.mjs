import { createHash, randomUUID } from 'node:crypto'
import { applyMailTemplate, mailVariables } from './licenseMailTemplates.mjs'

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
  return /^new_pds_([a-f\d]{12})\.lic$/i.exec(String(name))?.[1].toUpperCase() || null
}
export function normalizeMac(value) {
  const text = String(value || '').trim()
  if (!/^(?:[a-f\d]{12}|(?:[a-f\d]{2}[:-]){5}[a-f\d]{2})$/i.test(text)) return null
  return text.replace(/[:-]/g, '').toUpperCase()
}
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)
}
export function snapshot(row) {
  return JSON.stringify(Object.fromEntries(['id','mac_address','email','operating_system','software_version','license_type','duration_years','applicant_name','company_name'].map(key => [key, String(row[key] ?? '')])))
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
export async function candidates(db, mac) {
  if (!mac) return []
  const [rows] = await db.query(`SELECT a.* FROM dto_license_application a
    WHERE UPPER(REPLACE(REPLACE(a.mac_address,'-',''),':',''))=?
    AND a.status IN (0,1,2)
    AND NOT EXISTS (SELECT 1 FROM dto_license_mail m WHERE m.application_id=a.id AND m.kind='customer' AND m.state IN ('accepted','unknown','sending'))
    ORDER BY a.id DESC`, [mac])
  return rows.filter(row => normalizeMac(row.mac_address) === mac)
}
export async function matchFile(db, file, { applicationId, resetSnapshot = false } = {}) {
  if (!file.mac) return { state:'unmatched', reason:'文件名应为 new_pds_<12位十六进制MAC>.lic', application:null }
  if(file.state==='conflict'&&!file.application_id&&!resetSnapshot)return {state:'conflict',reason:'该文件曾有多条候选申请，请人工核对后选择申请',application:null}
  const available = await candidates(db, file.mac)
  let row
  if (applicationId) {
    row = available.find(item => String(item.id) === String(applicationId))
    if (!row) throw problem('所选申请不属于此 MAC 的可发放候选，请刷新核对')
  }
  else if (file.application_id && (Number(file.manual_selection) === 1 || available.length === 1)) row = available.find(item => String(item.id) === String(file.application_id))
  else if (available.length === 1) row = available[0]
  if (!row) return { state: available.length > 1 ? 'conflict' : 'unmatched', reason: available.length > 1 ? '同一 MAC 有多条申请，请选择并核对' : '未找到可发放申请，或该申请已发放/待核查/被拒绝', application:null }
  if (!validEmail(row.email)) return { state:'conflict', reason:'客户邮箱格式无效，请先核对申请信息', application:row }
  if (!resetSnapshot && file.application_snapshot && file.application_snapshot !== snapshot(row)) return { state:'conflict', reason:'申请信息已变化，请核对后重新匹配', application:row }
  const [siblings] = await db.query(`SELECT id FROM dto_license_file WHERE mac=? AND id<>? AND state IN (${ACTIVE.map(() => '?').join(',')})`, [file.mac,file.id,...ACTIVE])
  if (siblings.length) return { state:'conflict', reason:'同一 MAC 有其他待处理文件，请先取消多余文件', application:row }
  return { state:'queued', reason:'唯一匹配；授权内容由上传人员核对，每晚 22:00 自动处理', application:row }
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
      for (const file of files) {
        const [existing] = await db.query("SELECT id FROM dto_license_file WHERE sha256=? AND mac <=> ? AND state NOT IN ('cancelled','duplicate') LIMIT 1", [file.sha256,file.mac])
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
      return { batchId, records }
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
  return {records,total:count.total,page,pageSize:30,summary,startDate:dates.startDate,endDate:dates.endDate}
}
export async function fileDetail(pool, id) {
  const [[file]] = await pool.query(`SELECT ${FILE_COLUMNS},application_snapshot FROM dto_license_file WHERE id=?`,[id])
  if (!file) throw problem('文件不存在',404)
  const [mails] = await pool.query('SELECT id,recipient,message_id,state,attempts,detail,created_at,updated_at FROM dto_license_mail WHERE file_id=? ORDER BY created_at DESC',[id])
  const [history] = await pool.query('SELECT actor,action,note,created_at FROM dto_license_delivery_audit WHERE file_id=? ORDER BY id DESC LIMIT 100',[id])
  return {file,candidates:await candidates(pool,file.mac),mails,history}
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
        const result = await matchFile(db,file,{applicationId:body.applicationId,resetSnapshot:true})
        await persistMatch(db,file,result)
        await db.query('UPDATE dto_license_file SET manual_selection=? WHERE id=?',[body.applicationId ? 1 : 0,id])
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
  const columns = [['id','申请编号'],['dotime','申请时间'],['applicant_name','申请人'],['company_name','公司'],['operating_system','系统'],['software_version','版本'],['license_type','类型'],['duration_years','年限'],['mac_address','MAC'],['email','邮箱'],['phone','电话'],['address','地址']]
  const csv = '\ufeff' + [columns.map(([,label]) => csvCell(label)).join(','),...rows.map(row => columns.map(([key])=>csvCell(row[key])).join(','))].join('\r\n')
  const text = [`待处理 License 申请：${rows.length} 条。这些申请尚未通知 FAE；发送成功后自动转为处理中。`,...rows.map(row=>`#${row.id} | ${row.company_name} | ${row.applicant_name} | ${row.mac_address}`), '',`发放异常：${exceptions.length} 条。`,...exceptions.map(file=>`${file.original_name}：${file.reason}`),'','请登录管理后台处理。'].join('\n')
  return { to:recipient,subject:`Pango License 待办汇总 ${date}`,text,attachments:[{name:`license_applications_${date}.csv`,base64:Buffer.from(csv).toString('base64')}] }
}
export function customerMessage(row, file, replyTo) {
  return { variables:mailVariables(row),to:row.email,replyTo,subject:`Pango License 发放 · 申请 #${row.id}`,text:[`${row.applicant_name || '您好'}：`,'', '您申请的 License 文件已附在本邮件中。',`申请编号：${row.id}`,`软件版本：${row.software_version}`,`授权类型：${row.license_type}`,`使用年限：${row.duration_years} 年`,`MAC 地址：${row.mac_address}`,'','如有问题，请联系对接 FAE。'].join('\n'),attachments:[{name:file.original_name,base64:file.content.toString('base64')}] }
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
async function sendNotice(db,sender,key,kind,message) {
  if (!validEmail(message.to)) throw problem('FAE 收件邮箱配置无效')
  const mail = await prepareMail(db,{key,kind,message})
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
export async function runDigest(pool,sender,{faeEmail,now=new Date(),templates={}}) {
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
    const message=applyMailTemplate(digestMessage(rows,exceptions,date,faeEmail),'digest',templates,date)
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
async function deliverLicenseFile(db,sender,id,{date,replyTo,templates={},actor='nightly',expectedApplicationId,expectedEmail}) {
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
      const message = applyMailTemplate(customerMessage(row,file,replyTo),'customer',templates,date)
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
        return {id,state:result.state,detail:result.detail}
      } catch(error) {
        await db.rollback()
        throw error
      }
}

export async function runNightly(pool,sender,{faeEmail,replyTo,now=new Date(),templates={}}) {
  const {date,hour} = chinaTime(now)
  if (hour !== 22) throw problem('夜间任务仅在北京时间 22:00–22:59 执行')
  if (!validEmail(faeEmail)) throw problem('FAE 收件邮箱配置无效')
  if (replyTo && !validEmail(replyTo)) throw problem('FAE 回复邮箱配置无效')
  return withDeliveryLock(pool, async db => {
    await recoverInterrupted(db)
    const cutoff = `${date} 22:00:00.000000`
    const [files] = await db.query("SELECT id FROM dto_license_file WHERE uploaded_at<=? AND state IN ('queued','conflict','unmatched','failed') AND attempts<3 ORDER BY uploaded_at,id LIMIT 500",[cutoff])
    const results=[]
    for (const {id} of files) results.push(await deliverLicenseFile(db,sender,id,{date,replyTo,templates}))
    const rejectionResults=await dispatchRejections(db,sender,{cutoff,replyTo,templates,date})
    results.push(...rejectionResults)
    const [counts] = await db.query('SELECT state,COUNT(*) count FROM dto_license_file WHERE uploaded_at<=? GROUP BY state',[cutoff])
    let summaryResult = null
    if (files.length || rejectionResults.length || counts.some(item=>['unknown','failed','conflict','unmatched'].includes(item.state))) {
      summaryResult = await sendNotice(db,sender,`nightly-summary:${date}`,'summary',applyMailTemplate({to:faeEmail,subject:`Pango License 夜间发放结果 ${date}`,text:[`本次检查 ${files.length} 个文件，处理 ${rejectionResults.length} 条拒绝通知。`,'拒绝通知结果：',...rejectionResults.map(item=>`申请 #${item.applicationId}：${item.state}`),'截至本批截止时间的文件状态（累计）：',...counts.map(item=>`${item.state}: ${item.count}`),'','请登录管理后台查看异常及邮件记录。SMTP 接受不等于收件人已收到。'].join('\n'),attachments:[]},'summary',templates,date))
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
  return {application,faeEmail,files,mails}
}
// Explicit administrator action: scope every query/transition to this application.
// It uses the same dispatch functions and durable dedupe keys as scheduled jobs.
export async function runApplicationStep(pool,sender,{applicationId,action,expectedFileId,expectedEmail,expectedFaeEmail,faeEmail,replyTo,templates={},actor='admin',now=new Date()}){
  const id=validApplicationId(applicationId)
  if(action!=='deliver-license')throw problem('请选择立即发送 License')
  if(!validEmail(faeEmail)||expectedFaeEmail!==faeEmail)throw problem('FAE 邮箱已变化或未配置，请刷新核对',409)
  return withDeliveryLock(pool,async db=>{
    const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=?',[id])
    if(!row)throw problem('申请不存在',404)
    if(expectedEmail!==row.email||!validEmail(row.email))throw problem('申请邮箱已变化或无效，请刷新核对',409)
    if(Number(row.status)===3)throw problem('已拒绝申请不能发放 License',409)
    const [[mail]]=await db.query("SELECT state FROM dto_license_mail WHERE dedupe_key=?",[`customer:${id}`])
    if(mail?.state==='accepted')return {state:'skipped',detail:'该申请已成功发放，本次未重复发送'}
    if(mail&&mail.state!=='failed')throw problem('发放记录正在处理或需核查，本次不重发',409)
    const [files]=await db.query("SELECT id,state,attempts FROM dto_license_file WHERE application_id=? AND state NOT IN ('cancelled','duplicate') ORDER BY uploaded_at,id",[id])
    if(files.length!==1)throw problem(files.length?'存在多个文件，请先核对并取消多余文件':'尚未关联 License，请先上传并匹配',409)
    const file=files[0]
    if(expectedFileId && String(file.id)!==String(expectedFileId))throw problem('关联文件已变化，请刷新核对',409)
    if(!['queued','failed'].includes(file.state)||Number(file.attempts)>=3)throw problem('文件未处于可发放状态；暂停、冲突、结果待核查或重试超限时需先处理',409)
    const result=await deliverLicenseFile(db,sender,file.id,{date:chinaTime(now).date,replyTo,templates,actor,expectedApplicationId:id,expectedEmail})
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
export function rejectionMessage(row,reason,replyTo){
  return {variables:mailVariables(row,reason),to:row.email,replyTo,subject:`Pango License 申请未通过 · 申请 #${row.id}`,text:[`${row.applicant_name||'您好'}：`,'',`您的 License 申请 #${row.id} 未通过处理。`,`MAC 地址：${row.mac_address}`,'','拒绝原因：',reason,'','如需补充资料或有疑问，请联系对接 FAE。'].join('\n'),attachments:[]}
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
      await recordStatusChange(db,row,3,actor,'人工拒绝：'+reason,existing)

      await db.query('UPDATE dto_license_application SET status=3,uptime=NOW() WHERE id=?',[id])
      await db.query("UPDATE dto_license_file SET state='cancelled',reason='申请已拒绝，停止 License 发放',updated_at=NOW(6) WHERE application_id=? AND state IN ('queued','conflict','unmatched','failed','paused')",[id])
      await audit(db,null,actor,'application-rejected',`申请 #${id}，理由已保存，客户说明邮件进入夜间队列`)
      await db.commit()
      return {applicationId:id,state:'queued'}
    }catch(error){await db.rollback();throw error}
  })
}
async function dispatchRejections(db,sender,{cutoff,replyTo,templates,date}){
  const [requests]=await db.query("SELECT * FROM dto_license_rejection WHERE created_at<=? AND state IN ('queued','failed') AND attempts<3 ORDER BY created_at,application_id LIMIT 500",[cutoff])
  const results=[]
  for(const rejected of requests){
    const id=rejected.application_id
    const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=?',[id])
    if(!row||Number(row.status)!==3||snapshot(row)!==rejected.application_snapshot||!validEmail(row.email)){
      await db.query("UPDATE dto_license_rejection SET state='paused',detail='申请状态或联系信息已变化，或邮箱无效；请核对后重试',updated_at=NOW(6) WHERE application_id=?",[id])
      results.push({applicationId:id,kind:'rejection',state:'paused'});continue
    }
    const message=applyMailTemplate(rejectionMessage(row,rejected.reason,replyTo),'rejection',templates,date)
    let mail
    await db.beginTransaction()
    try{
      mail=await prepareMail(db,{key:`rejection:${id}`,kind:'rejection',applicationId:id,message})
      if(!mail){await db.rollback();continue}
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
      await db.commit();results.push({applicationId:id,kind:'rejection',state:result.state})
    }catch(error){await db.rollback();throw error}
  }
  return results
}
export async function rejectionDetail(pool,id){
  const [[record]]=await pool.query('SELECT * FROM dto_license_rejection WHERE application_id=?',[id])
  if(!record)throw problem('尚无拒绝理由或通知记录',404)
  const [mails]=await pool.query("SELECT id,recipient,state,detail,message_id,attempts,updated_at,(dedupe_key=CONCAT('rejection:',application_id)) current_cycle FROM dto_license_mail WHERE application_id=? AND kind='rejection' ORDER BY (dedupe_key=CONCAT('rejection:',application_id)) DESC,created_at DESC",[id])
  return {record,mails}
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
