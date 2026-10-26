import {createHash,randomUUID} from 'node:crypto'
import {withDeliveryLock,problem,snapshot,normalizeMac,validEmail,normalizeCc,decodeUpload,matchFile,FILE_COLUMNS} from './licenseDelivery.mjs'

const lockedStates=['accepted','sending','unknown']
const active=file=>!['cancelled','duplicate'].includes(file.state)
async function detail(db,id){
  if(!/^[1-9]\d{0,19}$/.test(String(id)))throw problem('申请编号无效')
  const [[application]]=await db.query('SELECT * FROM dto_license_application WHERE id=?',[id])
  if(!application)throw problem('申请不存在',404)
  const [files]=await db.query(`SELECT ${FILE_COLUMNS},manual_selection FROM dto_license_file WHERE application_id=? ORDER BY uploaded_at DESC,id`,[id])
  const [mails]=await db.query("SELECT id,state,updated_at FROM dto_license_mail WHERE application_id=? AND kind='customer' ORDER BY id",[id])
  const mac=normalizeMac(application.mac_address)
  const filename=mac&&['SERVER','STANDALONE'].includes(application.license_type)?`new_pds_${mac.toLowerCase()}${application.license_type==='SERVER'?'_floating':''}.lic`:null
  let blocked=''
  if(![0,1,2].includes(Number(application.status)))blocked='已拒绝申请不能上传 License，请先在原流程中核对申请状态。'
  else if(files.some(file=>lockedStates.includes(file.state))||mails.some(mail=>lockedStates.includes(mail.state)))blocked='已有邮件发出、正在发送或结果待核查，不能替换附件；请先核查发送记录。'
  else if(!filename||!validEmail(application.email))blocked='申请的 MAC、授权类型或收件邮箱无效，请先核对申请信息。'
  const version=createHash('sha256').update(JSON.stringify({application:snapshot(application),status:application.status,files,mails})).digest('hex')
  return {application,files,filename,version,canUpload:!blocked,blocked}
}
export async function applicationFiles(pool,id){return detail(pool,id)}
export async function uploadApplicationFile(pool,id,body,actor){
  if(body.confirm!==true||typeof body.note!=='string'||!body.note.trim()||body.note.length>500)throw problem('请确认已核对文件内容及当前申请，并填写核对说明')
  const files=await decodeUpload({files:[body.file]})
  const file=files[0]
  return withDeliveryLock(pool,async db=>{
    await db.beginTransaction()
    try{
      await db.query('SELECT id FROM dto_license_application WHERE id=? FOR UPDATE',[id])
      const current=await detail(db,id),row=current.application
      if(!current.canUpload)throw problem(current.blocked,409)
      if(body.expectedVersion!==current.version)throw problem('申请或关联文件已变化，请刷新详情重新核对',409)
      const [same]=await db.query("SELECT * FROM dto_license_file WHERE sha256=? AND state<>'duplicate' ORDER BY uploaded_at DESC,id",[file.sha256])
      if(same.some(item=>lockedStates.includes(item.state)))throw problem('相同内容已有发出或待核查记录，不能重新上传发放',409)
      if(same.some(item=>item.application_id&&String(item.application_id)!==String(row.id)))throw problem('相同文件内容已关联其他申请，请核对文件内容，不可直接改发给另一申请',409)
      // Reuse an existing unassigned upload (including unrecognized filenames) instead of creating a second queue item.
      const reused=same.find(item=>active(item))||same[0]
      const fileId=reused?.id||randomUUID(),oldFiles=current.files.filter(active)
      const [settings]=await db.query("SELECT * FROM dto_license_cc WHERE target_kind='file' AND application_id=?",[row.id])
      const oldIds=new Set(oldFiles.map(item=>item.id))
      const relevant=settings.filter(item=>oldIds.has(item.target_id))
      if(relevant.some(item=>item.recipient!==row.email))throw problem('原文件抄送对应的收件邮箱已变化，请先核对并清除原抄送',409)
      const cc=normalizeCc(relevant.flatMap(item=>JSON.parse(item.cc_json)),row.email)
      for(const old of oldFiles){
        if(old.id===fileId)continue
        await db.query("UPDATE dto_license_file SET state='cancelled',reason='在 License 发放中手动替换，旧文件停止发放',updated_at=NOW(6) WHERE id=?",[old.id])
        await db.query('INSERT INTO dto_license_delivery_audit (file_id,actor,action,note) VALUES (?,?,?,?)',[old.id,actor,'application-file-replaced',`申请 #${row.id}，替换为文件 ${fileId}；${body.note.trim()}`.slice(0,500)])
      }
      // The standard stored filename keeps the existing Web/mini-program portal download contract intact.
      const reason='License 发放中手动上传并核对；每晚 20:00 发放'
      if(reused)await db.query("UPDATE dto_license_file SET batch_id=?,original_name=?,mac=?,byte_length=?,content=?,application_id=?,application_snapshot=?,manual_selection=1,state='queued',reason=?,uploaded_by=?,attempts=0,uploaded_at=NOW(6),updated_at=NOW(6) WHERE id=?",[randomUUID(),current.filename,normalizeMac(row.mac_address),file.content.length,file.content,row.id,snapshot(row),reason,actor,fileId])
      else await db.query("INSERT INTO dto_license_file (id,batch_id,original_name,mac,sha256,byte_length,content,application_id,application_snapshot,manual_selection,state,reason,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,1,'queued',?,?)",[fileId,randomUUID(),current.filename,normalizeMac(row.mac_address),file.sha256,file.content.length,file.content,row.id,snapshot(row),reason,actor])
      const [[stored]]=await db.query('SELECT * FROM dto_license_file WHERE id=?',[fileId])
      const checked=await matchFile(db,stored)
      if(checked.state!=='queued')throw problem(checked.reason,409)
      await db.query("DELETE FROM dto_license_cc WHERE target_kind='file' AND target_id=?",[fileId])
      if(cc.length)await db.query("INSERT INTO dto_license_cc (target_kind,target_id,application_id,recipient,cc_json,updated_by) VALUES ('file',?,?,?,?,?)",[fileId,row.id,row.email,JSON.stringify(cc),actor])
      // A replacement is an explicit new review. Old custom content remains in the old record;
      // if reusing the exact same file, require a fresh mail preview instead of carrying stale prose.
      await db.query("DELETE FROM dto_license_mail_draft WHERE target_kind='file' AND target_id=?",[fileId])
      await db.query("UPDATE dto_license_mail SET attempts=0,detail='License 发放中手动上传并重新核对',updated_at=NOW(6) WHERE application_id=? AND kind='customer' AND state='failed'",[row.id])
      await db.query('UPDATE dto_license_application SET status=2,uptime=NOW() WHERE id=?',[row.id])
      await db.query('INSERT INTO dto_license_delivery_audit (file_id,actor,action,note) VALUES (?,?,?,?)',[fileId,actor,'application-file-upload',`申请 #${row.id}；原文件名：${file.name}；保存为：${current.filename}；${body.note.trim()}`.slice(0,500)])
      await db.commit();return {id:fileId,filename:current.filename,reused:Boolean(reused),replaced:oldFiles.filter(item=>item.id!==fileId).map(item=>item.id)}
    }catch(error){await db.rollback();throw error}
  })
}
