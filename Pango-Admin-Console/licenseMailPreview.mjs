import { randomUUID } from 'node:crypto'
import { customerMessage, rejectionMessage, digestMessage, chinaTime, validEmail } from './licenseDelivery.mjs'
import { applyMailTemplate, validateTemplates, TEMPLATE_DEFAULTS } from './licenseMailTemplates.mjs'

export function sampleMail(config, body) {
  const kind=body.kind||'customer'
  if(!TEMPLATE_DEFAULTS[kind])throw new Error('请选择正确的邮件类型')
  const to=body.to||'preview@example.com'
  if(!validEmail(to))throw new Error('请输入单个有效的测试收件邮箱')
  const date=chinaTime().date
  const row={id:'TEST-001',dotime:`${date} 09:00:00`,applicant_name:'测试申请人',company_name:'测试公司或学校',operating_system:'Windows',software_version:'测试版本',license_type:'STANDALONE',duration_years:1,mac_address:'00-11-22-AA-BB-CC',email:to,phone:'测试电话',address:'测试地址'}
  const replyTo=config.LICENSE_FAE_EMAIL||to
  const file={original_name:'new_pds_001122aabbcc.lic',content:Buffer.from('TEST ONLY - NOT A VALID LICENSE\n')}
  const original=kind==='customer'?customerMessage(row,file,replyTo):kind==='rejection'?rejectionMessage(row,'申请资料不完整，请补充公司或学校名称及正确的 MAC 地址。',replyTo):kind==='digest'?digestMessage([row],[],date,to):{to,subject:`Pango License 夜间发放结果 ${date}`,text:'本次检查 1 个测试文件，处理 1 条测试拒绝通知。\n本预览使用虚构数据，无生产记录。',attachments:[]}
  const templates=body.templates===undefined?config.LICENSE_MAIL_TEMPLATES||{}:validateTemplates(body.templates)
  const message=applyMailTemplate(original,kind,templates,date)
  return {...message,to,mailKind:kind,messageId:`<test-${randomUUID()}@pango-license.local>`,subject:`【测试，请忽略】${message.subject}`,text:'本邮件使用虚构申请，不修改任何生产记录；.lic 附件仅为测试文本，不能用于授权。\n\n'+message.text}
}
export function publicMailPreview(config,message) {
  return {from:['digest','summary'].includes(message.mailKind)?'平台邮箱（使用服务器原配置）':config.LICENSE_FAE_EMAIL||'尚未设置 FAE 邮箱',to:message.to,replyTo:message.replyTo||'',subject:message.subject,text:message.text,attachments:message.attachments.map(item=>({name:item.name,bytes:Buffer.from(item.base64,'base64').length}))}
}
