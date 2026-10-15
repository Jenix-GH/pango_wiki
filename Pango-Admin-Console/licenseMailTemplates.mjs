import { withMailLogo } from './licenseMailLogo.mjs'

export const TEMPLATE_DEFAULTS = {
  customer: { label:'客户 License', subject:'Pango License 发放 · 申请 #{{申请编号}}', text:'{{申请人}}：\n\n您申请的 License 文件已附在本邮件中。\n申请编号：{{申请编号}}\n软件版本：{{软件版本}}\n授权类型：{{授权类型}}\n使用年限：{{年限}} 年\nMAC 地址：{{MAC地址}}\n\n如有问题，请联系对接 FAE。' },
  rejection: { label:'客户拒绝说明', subject:'Pango License 申请未通过 · 申请 #{{申请编号}}', text:'{{申请人}}：\n\n您的 License 申请 #{{申请编号}} 未通过处理。\nMAC 地址：{{MAC地址}}\n\n拒绝原因：\n{{拒绝原因}}\n\n如需补充资料或有疑问，请联系对接 FAE。' },
  digest: { label:'FAE 待处理汇总', subject:'Pango License 待办汇总 {{日期}}', text:'{{原始正文}}' },
  summary: { label:'FAE 发放结果', subject:'Pango License 夜间发放结果 {{日期}}', text:'{{原始正文}}' },
}
export const TEMPLATE_VARIABLES = ['申请编号','申请人','公司或学校','软件版本','授权类型','年限','MAC地址','拒绝原因','日期','原始正文']
const rowKeys = { '申请编号':'id','申请人':'applicant_name','公司或学校':'company_name','软件版本':'software_version','授权类型':'license_type','年限':'duration_years','MAC地址':'mac_address' }
export function mailVariables(row={}, reason='') {
  return { ...Object.fromEntries(Object.entries(rowKeys).map(([label,key])=>[label,String(row[key]??'')])), '拒绝原因':reason }
}
export function validateTemplates(templates) {
  if (!templates || typeof templates!=='object' || Array.isArray(templates)) throw new Error('邮件模板格式错误')
  const result={}
  for (const [kind, template] of Object.entries(templates)) {
    if (!TEMPLATE_DEFAULTS[kind] || !template || typeof template.subject!=='string' || typeof template.text!=='string') throw new Error('邮件模板类型或格式错误')
    if (!template.subject.trim() || template.subject.length>200 || /[\r\n\x00]/.test(template.subject)) throw new Error('邮件标题不能为空，最多 200 字且不能换行')
    if (!template.text.trim() || template.text.length>12000 || /\x00/.test(template.text)) throw new Error('邮件正文不能为空，最多 12000 字')
    for (const match of (template.subject+'\n'+template.text).matchAll(/{{(.*?)}}/g)) if(!TEMPLATE_VARIABLES.includes(match[1]))throw new Error(`不支持的邮件变量：${match[1]}`)
    if(kind==='rejection'&&!template.text.includes('{{拒绝原因}}'))throw new Error('拒绝说明正文必须保留 {{拒绝原因}}')
    if(['digest','summary'].includes(kind)&&!template.text.includes('{{原始正文}}'))throw new Error('FAE 汇总正文必须保留 {{原始正文}}，以保留完整申请及异常信息')
    result[kind]={subject:template.subject.trim(),text:template.text}
  }
  return result
}
export function escapeMailHtml(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
}
export function mailTextToHtml(value) { return escapeMailHtml(value).replace(/\r\n|\r|\n/g,'<br>') }
export function applyMailTemplate(message,kind,templates={},date='',logo=null) {
  if(!templates[kind])return withMailLogo(message,logo,mailTextToHtml(message.text))
  const template=validateTemplates({[kind]:templates[kind]})[kind]
  const values={...message.variables,'原始正文':message.text,'日期':date}
  const render=(text,subject=false)=>text.replace(/{{(.*?)}}/g,(_,key)=>subject?String(values[key]??'').replace(/[\r\n]+/g,' '):String(values[key]??''))
  const subject=render(template.subject,true)
  if(subject.length>300)throw new Error('替换变量后的邮件标题过长')
  let html
  if(message.html){
    // Escape the template and every variable; only the server-generated original body is HTML.
    const pieces=template.text.split(/({{.*?}})/g)
    html=pieces.map(piece=>{
      const token=/^{{(.*?)}}$/.exec(piece)
      return token?(token[1]==='原始正文'?message.html:mailTextToHtml(values[token[1]]??'')):mailTextToHtml(piece)
    }).join('')
  }
  const result={...message,subject,text:render(template.text),...(html?{html}:{})}
  return withMailLogo(result,logo,mailTextToHtml(result.text))
}
