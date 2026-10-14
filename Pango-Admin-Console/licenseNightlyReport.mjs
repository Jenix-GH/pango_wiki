import { randomUUID } from 'node:crypto'
import { escapeMailHtml, mailTextToHtml, applyMailTemplate } from './licenseMailTemplates.mjs'

export const resultLabels={accepted:'邮件服务已接受',failed:'发送失败',unknown:'结果待核查',sending:'发送中',queued:'未发送',paused:'未发送（已暂停）',cancelled:'未发送（已取消）',conflict:'未发送（匹配冲突）',unmatched:'未发送（未匹配）',duplicate:'未发送（重复文件）',skipped:'未发送'}
const columns=['申请编号','申请人及公司或学校','邮件类型','收件人','抄送','发送结果','文件或拒绝理由','说明']
const values=row=>[row.applicationId?`#${row.applicationId}`:'未关联',`${row.applicantName||'—'}\n${row.companyName||'—'}`,row.kind==='rejection'?'拒绝通知':'License 发放',row.recipient||'—',(row.cc||[]).join('、')||'—',resultLabels[row.state]||row.state,row.content||'—',row.detail||'—']
export function renderResultTable(rows) {
  const cell='border:1px solid #dce3ed;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;'
  const html=`<h3 style="font-size:16px;margin:24px 0 12px;">本次处理明细</h3><table style="border-collapse:collapse;width:100%;font-size:13px;line-height:1.6;font-family:Arial,'Microsoft YaHei',sans-serif;"><thead><tr>${columns.map(label=>`<th style="${cell}background:#f3f6fa;">${escapeMailHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${values(row).map(value=>`<td style="${cell}">${mailTextToHtml(value)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="8" style="${cell}">本次没有新增处理记录，请查看上方累计异常。</td></tr>`}</tbody></table><p>License 发放与拒绝通知分别列示；邮件服务已接受不代表收件人已收到或已阅读。</p>`
  const text=['本次处理明细',columns.join(' | '),...rows.map(row=>values(row).map(v=>String(v).replace(/\n/g,' ')).join(' | '))].join('\n')
  return {html,text}
}
export function sentResultRow(kind,row,message,content,result) {
  return {applicationId:String(row.id),kind,applicantName:row.applicant_name||'',companyName:row.company_name||'',recipient:message.to,cc:message.cc||[],state:result.state,content,detail:result.detail||''}
}
export async function nightlyReportRows(db,results) {
  const rows=[]
  for(const result of results){
    if(result.reportRow){rows.push(result.reportRow);continue}
    const rejected=result.kind==='rejection'
    const [[record]]=await db.query(rejected?'SELECT * FROM dto_license_rejection WHERE application_id=?':'SELECT * FROM dto_license_file WHERE id=?',[rejected?result.applicationId:result.id])
    const applicationId=record?.application_id||result.applicationId||null
    const [[application]]=applicationId?await db.query('SELECT applicant_name,company_name,email FROM dto_license_application WHERE id=?',[applicationId]):[[]]
    const [[cc]]=await db.query('SELECT cc_json FROM dto_license_cc WHERE target_kind=? AND target_id=?',[rejected?'rejection':'file',String(rejected?applicationId:result.id)])
    rows.push({applicationId:applicationId?String(applicationId):null,kind:rejected?'rejection':'file',applicantName:application?.applicant_name||'',companyName:application?.company_name||'',recipient:application?.email||record?.recipient||'',cc:cc?JSON.parse(cc.cc_json):[],state:result.state,content:rejected?record?.reason:record?.original_name,detail:result.detail||(rejected?record?.detail:record?.reason)||''})
  }
  return rows
}
export async function storeNightlyReport(db,{date,cutoff,files,rejectionResults,counts,results,faeEmail,templates,logo}) {
  const rows=await nightlyReportRows(db,results)
  const original=[`本次检查 ${files.length} 个文件，处理 ${rejectionResults.length} 条拒绝通知。`,'拒绝通知结果：',...rejectionResults.map(item=>`申请 #${item.applicationId}：${resultLabels[item.state]||item.state}`),'截至本批截止时间的文件状态（累计）：',...counts.map(item=>`${resultLabels[item.state]||item.state}: ${item.count}`),'','请登录管理后台查看异常及邮件记录。SMTP 接受不等于收件人已收到。'].join('\n')
  const stats={accepted:0,failed:0,unknown:0,unsent:0}
  for(const row of rows)stats[['accepted','failed','unknown'].includes(row.state)?row.state:'unsent']++
  const statsText=`本次结果：邮件服务已接受 ${stats.accepted}，发送失败 ${stats.failed}，结果待核查 ${stats.unknown}，未发送 ${stats.unsent}。`
  const table=renderResultTable(rows)
  const message=applyMailTemplate({to:faeEmail,subject:`Pango License 夜间发放结果 ${date}`,text:`${original}\n\n${statsText}\n\n${table.text}`,html:`<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#182a48;font-size:14px;line-height:1.7;">${mailTextToHtml(original)}<p>${escapeMailHtml(statsText)}</p>${table.html}</div>`,attachments:[]},'summary',templates,date,logo)
  const id=randomUUID(),payload={date,cutoff,rows,stats,counts,message}
  await db.query('INSERT INTO dto_license_nightly_report (id,report_date,payload) VALUES (?,?,?)',[id,date,JSON.stringify(payload)])
  return {id,message}
}
export async function listNightlyReports(pool) {
  const [records]=await pool.query(`SELECT r.id,r.report_date,r.created_at,r.summary_detail,m.state AS mail_state,m.recipient,m.detail AS mail_detail
    FROM dto_license_nightly_report r LEFT JOIN dto_license_mail m ON m.id=r.mail_id ORDER BY r.created_at DESC,r.id DESC LIMIT 30`)
  return {records}
}
export async function nightlyReportDetail(pool,id) {
  const [[row]]=await pool.query('SELECT r.*,m.state AS mail_state,m.detail AS mail_detail FROM dto_license_nightly_report r LEFT JOIN dto_license_mail m ON m.id=r.mail_id WHERE r.id=?',[id])
  if(!row)throw Object.assign(new Error('夜间结果记录不存在'),{statusCode:404})
  return {...JSON.parse(row.payload),summaryState:row.mail_state||'skipped',summaryDetail:row.mail_detail||row.summary_detail}
}
