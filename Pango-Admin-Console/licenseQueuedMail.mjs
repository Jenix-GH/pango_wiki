import { createHash, randomUUID } from 'node:crypto'
import { applyMailTemplate, mailTextToHtml } from './licenseMailTemplates.mjs'
import { withMailLogo, mailPreviewHtml } from './licenseMailLogo.mjs'
import { snapshot, customerMessage, rejectionMessage, normalizeCc, validEmail, withDeliveryLock, problem, chinaTime } from './licenseDelivery.mjs'

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const editableStates=['queued','failed','paused']
export function renderQueuedContent(subject,text,logo=null) {
  if(typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n\x00-\x1f\x7f]/.test(subject))throw problem('标题须为 1–200 字，不能换行')
  const html=`<div style="font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px;line-height:1.7;color:#182a48;overflow-wrap:anywhere;">${mailTextToHtml(text)}</div>`
  return withMailLogo({subject,text,html},logo,html)
}
function contentOf(message) {
  return {subject:message.subject,text:message.text,html:message.html,inlineImages:message.inlineImages||[]}
}
function bindingFor(kind,record,row,message,from) {
  return hash({kind,from:from||message.replyTo||'',application:snapshot(row),to:message.to,cc:message.cc||[],replyTo:message.replyTo||'',
    file:kind==='file'?[record.id,record.sha256,record.original_name]:null,
    rejection:kind==='rejection'?[record.created_at,record.reason]:null})
}
export async function buildQueuedMessage(db,kind,record,row,{replyTo,from,cc=[],templates={},date=chinaTime().date,logo=null}, {allowStale=false}={}) {
  const base=kind==='file'?customerMessage(row,record,replyTo,cc):rejectionMessage(row,record.reason,replyTo,cc)
  const binding=bindingFor(kind,record,row,base,from)
  const [[draft]]=await db.query('SELECT * FROM dto_license_mail_draft WHERE target_kind=? AND target_id=?',[kind,String(kind==='file'?record.id:row.id)])
  // Dispatch of an approved message is independent of later global template or logo edits.
  let current=null
  if(!draft||allowStale){
    const rendered=applyMailTemplate(base,kind==='file'?'customer':'rejection',templates,date)
    current=renderQueuedContent(rendered.subject,rendered.text,logo)
  }
  const stale=Boolean(draft&&draft.binding_hash!==binding)
  if(stale&&!allowStale)throw problem('已保存的邮件与当前申请、附件或收件信息不一致，请打开邮件预览重新核对并保存',409)
  const content=draft?JSON.parse(draft.content_json):current
  return {message:{...base,...content},current,binding,draft,stale}
}
function publicMessage(message) {
  return {subject:message.subject,text:message.text,html:mailPreviewHtml(message),to:message.to,cc:message.cc||[],replyTo:message.replyTo||'',
    attachments:message.attachments.map(file=>({name:file.name,bytes:Buffer.from(file.base64,'base64').length}))}
}
async function context(db,kind,id,options) {
  if(!['file','rejection'].includes(kind))throw problem('邮件类型无效')
  const table=kind==='file'?'dto_license_file':'dto_license_rejection',key=kind==='file'?'id':'application_id'
  const [[record]]=await db.query(`SELECT * FROM ${table} WHERE ${key}=?`,[id])
  if(!record)throw problem('邮件记录不存在',404)
  if(!editableStates.includes(record.state))throw problem('仅待发送、明确失败或已暂停的邮件支持预览编辑；已发送或结果待核查时不可修改',409)
  const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[record.application_id])
  if(!row||!validEmail(row.email)||(kind==='file'?![0,1,2].includes(Number(row.status)):Number(row.status)!==3))throw problem('请先核对关联申请、状态及收件邮箱',409)
  const [[mail]]=await db.query('SELECT state FROM dto_license_mail WHERE dedupe_key=?',[`${kind==='file'?'customer':'rejection'}:${row.id}`])
  if(mail&&['accepted','sending','unknown'].includes(mail.state))throw problem('邮件已发出或结果待核查，不能修改',409)
  const [[setting]]=await db.query('SELECT * FROM dto_license_cc WHERE target_kind=? AND target_id=?',[kind,String(id)])
  if(setting&&(String(setting.application_id)!==String(row.id)||setting.recipient!==row.email))throw problem('请先重新保存或清除抄送设置',409)
  const cc=setting?normalizeCc(JSON.parse(setting.cc_json),row.email):[]
  const built=await buildQueuedMessage(db,kind,record,row,{...options,cc},{allowStale:true})
  const version=hash({binding:built.binding,revision:built.draft?.revision||'',updatedAt:record.updated_at,state:record.state,current:built.current})
  return {...built,record,row,version}
}
// Caller holds the delivery lock, so the verified draft/recipient binding remains valid for dispatch.
export async function verifyRejectionVersion(db,id,options,expectedVersion) {
  const ctx=await context(db,'rejection',id,options)
  if(ctx.version!==expectedVersion||ctx.stale)throw problem('拒绝通知、收件人或草稿已变化，请重新核对并确认',409)
}
function present(ctx,options) {
  return {...publicMessage(ctx.message),applicationId:String(ctx.row.id),state:ctx.record.state,from:options.from||options.replyTo||'尚未设置 FAE 邮箱',
    version:ctx.version,saved:Boolean(ctx.draft),stale:ctx.stale,updatedAt:ctx.draft?.updated_at||null,
    rejectionReason:ctx.record.reason&&ctx.record.application_id&&!ctx.record.original_name?ctx.record.reason:''}
}
export async function queuedMailPreview(pool,kind,id,options,body=null,actor='admin') {
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try {
      let ctx=await context(db,kind,id,options)
      if(body!==null){
        if(body.expectedVersion!==ctx.version)throw problem('邮件或配置已变化，请关闭并重新打开预览后再保存',409)
        let content
        if(body.action==='reset')content=ctx.current
        else {
          if(typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>200||/[\r\n\x00-\x1f\x7f]/.test(body.subject))throw problem('标题须为 1–200 字，不能换行')
          if(typeof body.text!=='string'||!body.text.trim()||body.text.length>12000||/\x00/.test(body.text))throw problem('正文须为 1–12000 字')
          const text=body.text.replace(/\r\n?/g,'\n')
          if(kind==='rejection'&&!text.includes(ctx.record.reason))throw problem('正文必须保留完整拒绝理由')
          // Preserve the already-approved logo when editing; resetting explicitly adopts the current template/logo.
          const image=ctx.draft?ctx.message.inlineImages?.[0]:null
          const width=/width="(\d+)"/.exec(ctx.message.html||'')?.[1]
          const logo=ctx.draft?(image?{...image,width:Number(width||180)}:null):options.logo
          content=renderQueuedContent(body.subject.trim(),text,logo)
        }
        if(kind==='rejection'&&!content.text.includes(ctx.record.reason))throw problem('正文必须保留完整拒绝理由')
        await db.query(`INSERT INTO dto_license_mail_draft (target_kind,target_id,binding_hash,revision,content_json,updated_by) VALUES (?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE binding_hash=VALUES(binding_hash),revision=VALUES(revision),content_json=VALUES(content_json),updated_by=VALUES(updated_by),updated_at=NOW(6)`,
          [kind,String(id),ctx.binding,randomUUID(),JSON.stringify(contentOf(content)),actor])
        await db.query('INSERT INTO dto_license_delivery_audit (file_id,actor,action,note) VALUES (?,?,?,?)',[kind==='file'?id:null,actor,'save-mail-content',`申请 #${ctx.row.id} ${kind==='file'?'License':'拒绝通知'}，${body.action==='reset'?'恢复当前模板':'保存本封邮件'}；未发送`])
        ctx=await context(db,kind,id,options)
      }
      await db.commit();return present(ctx,options)
    } catch(error){await db.rollback();throw error}
  })
}

// Use the same lock as dispatch so edits cannot race a manual or nightly send.
export async function updateRejectionReason(pool,id,body,options,actor='admin') {
  if(!/^[1-9]\d*$/.test(String(id)))throw problem('申请编号无效')
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>2000||/\x00/.test(body.reason))throw problem('请填写 1–2000 字的拒绝理由')
  if(typeof body.expectedUpdatedAt!=='string'||!body.expectedUpdatedAt)throw problem('请刷新并核对当前拒绝记录')
  const reason=body.reason.trim().replace(/\r\n?/g,'\n')
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try {
      const [[row]]=await db.query('SELECT * FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const [[record]]=await db.query('SELECT * FROM dto_license_rejection WHERE application_id=? FOR UPDATE',[id])
      if(!row||!record)throw problem('拒绝通知不存在',404)
      if(Number(row.status)!==3)throw problem('申请已不处于已拒绝状态，请刷新核对',409)
      if(!['queued','failed','paused','cancelled'].includes(record.state))throw problem('邮件已发送、正在发送或结果待核查，不能修改拒绝理由',409)
      if(String(record.updated_at)!==body.expectedUpdatedAt)throw problem('拒绝记录已变化，请重新打开详情后修改',409)
      const [[mail]]=await db.query('SELECT state FROM dto_license_mail WHERE dedupe_key=? FOR UPDATE',[`rejection:${id}`])
      if(mail&&!['failed','cancelled'].includes(mail.state))throw problem('当前拒绝邮件已有发送或待核查记录，不能修改拒绝理由',409)
      if(record.reason===reason){await db.commit();return {applicationId:String(id),state:record.state}}
      const [[draft]]=await db.query("SELECT * FROM dto_license_mail_draft WHERE target_kind='rejection' AND target_id=?",[String(id)])
      if(draft){
        const [[setting]]=await db.query("SELECT * FROM dto_license_cc WHERE target_kind='rejection' AND target_id=?",[String(id)])
        const cc=setting?normalizeCc(JSON.parse(setting.cc_json),row.email):[]
        const message=rejectionMessage(row,record.reason,options.replyTo,cc)
        const oldBinding=bindingFor('rejection',record,row,message,options.from)
        const original=JSON.parse(draft.content_json)
        if(!original.text.includes(record.reason))throw problem('已保存邮件未包含完整旧拒绝理由，请先核对邮件正文',409)
        const subject=original.subject.split(record.reason).join(reason)
        const text=original.text.split(record.reason).join(reason)
        if(text.length>12000)throw problem('修改后邮件正文超过 12000 字，请先精简邮件正文')
        const image=original.inlineImages?.[0]
        const width=/width="(\d+)"/.exec(original.html||'')?.[1]
        const logo=image?{...image,width:Number(width||180)}:null
        const content=renderQueuedContent(subject,text,logo)
        // Keep an already-stale draft stale; a reason edit must not approve other changed fields.
        const binding=draft.binding_hash===oldBinding
          ?bindingFor('rejection',{...record,reason},row,message,options.from):draft.binding_hash
        await db.query("UPDATE dto_license_mail_draft SET binding_hash=?,revision=?,content_json=?,updated_by=?,updated_at=NOW(6) WHERE target_kind='rejection' AND target_id=?",
          [binding,randomUUID(),JSON.stringify(contentOf(content)),actor,String(id)])
      }
      await db.query('UPDATE dto_license_rejection SET reason=?,updated_at=NOW(6) WHERE application_id=?',[reason,id])
      await db.query(`INSERT INTO dto_license_status_change (application_id,previous_status,next_status,actor,note,rejection_snapshot) VALUES (?,3,3,?,?,?)`,
        [id,actor,('修改拒绝理由：'+reason).slice(0,500),JSON.stringify(record)])
      await db.query('INSERT INTO dto_license_delivery_audit (file_id,actor,action,note) VALUES (NULL,?,?,?)',
        [actor,'edit-rejection-reason',`申请 #${id}，修改拒绝理由${draft?'并同步本封邮件草稿':''}；队列状态保留，未发送邮件`])
      await db.commit();return {applicationId:String(id),state:record.state}
    }catch(error){await db.rollback();throw error}
  })
}
