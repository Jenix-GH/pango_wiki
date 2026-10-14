import DOMPurify from 'dompurify'
const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node}
const button=(text,action,className='')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node}
export function mailFrame(message,title='邮件正文预览') {
  const frame=el('iframe','','license-mail-frame');frame.title=title;frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer'
  const content=message.html||`<div style="white-space:pre-wrap"></div>`
  frame.srcdoc=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"></head><body style="margin:20px;font:14px/1.7 Arial,'Microsoft YaHei',sans-serif;color:#182a48;overflow-wrap:anywhere;">${DOMPurify.sanitize(content)}</body></html>`
  if(!message.html)frame.srcdoc=frame.srcdoc.replace('<div style="white-space:pre-wrap"></div>',`<div style="white-space:pre-wrap">${DOMPurify.sanitize(message.text,{ALLOWED_TAGS:[],ALLOWED_ATTR:[]}).replace(/</g,'&lt;')}</div>`)
  return frame
}
function modal(title){
  const d=el('dialog','','delivery-dialog license-mail-dialog');const head=el('div','','delivery-dialog-header'),body=el('div','','delivery-dialog-body')
  head.append(el('h2',title),button('关闭',()=>d.close()));d.append(head,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return {d,body,head}
}
export async function showQueuedMail(kind,id,request){
  const {d,body,head}=modal('邮件预览');body.append(el('p','正在读取…'))
  const path=`/license-delivery/${kind==='file'?'files':'rejections'}/${id}/mail-content`
  let data,editing=false,busy=false
  const draw=(notice='')=>{
    body.replaceChildren();head.querySelector('h2').textContent=`邮件预览 · 申请 #${data.applicationId} · ${kind==='file'?'客户 License':'拒绝通知'}`
    const meta=el('dl','','license-mail-meta')
    for(const [label,value] of [['发件人',data.from],['收件人',data.to],['抄送',data.cc.join('、')||'未设置'],['邮件标题',data.subject]])meta.append(el('dt',label),el('dd',value))
    body.append(meta)
    if(data.stale)body.append(el('p','申请、附件或收件信息已变化。原保存内容不会自动发送，请核对本页的新信息及正文后重新保存。','delivery-warning'))
    const state=el('p',notice||(data.saved?'已保存本封内容。修改全局模板不会覆盖本封邮件。':'当前使用全局模板。确认并保存后，可固定本封内容和格式。'),'delivery-message');state.setAttribute('role','status')
    body.append(state)
    let subject,text
    if(editing){
      const titleLabel=el('label','邮件标题');subject=el('input');subject.value=data.subject;subject.maxLength=200;subject.setAttribute('aria-label','本封邮件标题');titleLabel.append(subject)
      const textLabel=el('label','邮件正文');text=el('textarea');text.value=data.text;text.maxLength=12000;text.rows=15;text.setAttribute('aria-label','本封邮件正文');textLabel.append(text)
      body.append(el('p','编辑标题和正文即可，换行会保留；Logo、字体及排版由系统统一处理。仅修改当前这封邮件。'),titleLabel,textLabel)
      if(data.rejectionReason)body.append(el('p',`请保留完整拒绝理由：${data.rejectionReason}`,'rejection-reason'))
    }else body.append(mailFrame(data))
    body.append(el('p',`附件：${data.attachments.length?data.attachments.map(file=>file.name).join('、'):'无附件'}`,'license-mail-attachments'))
    const footer=el('div','','delivery-action-buttons license-mail-footer')
    const save=async(action)=>{
      if(busy)return;busy=true;footer.querySelectorAll('button').forEach(b=>b.disabled=true);state.textContent='正在保存，未发送邮件…'
      try{
        data=await request(path,{method:'POST',body:JSON.stringify({action,expectedVersion:data.version,subject:editing?subject.value:data.subject,text:editing?text.value:data.text})})
        if(!d.isConnected)return;editing=false;draw('本封邮件已保存。下方为发送时使用的正文；本次操作未发送邮件。')
      }catch(error){if(!error.authentication)state.textContent=error.message}finally{busy=false;footer.querySelectorAll('button').forEach(b=>b.disabled=false)}
    }
    if(editing){
      footer.append(button('取消编辑',()=>{editing=false;draw()}),button('保存并预览',()=>save('save'),'export-button'))
    }else{
      footer.append(button('返回详情',()=>d.close()),button('编辑本封邮件',()=>{editing=true;draw()},'export-button'))
      if(!data.saved||data.stale)footer.append(button('确认预览并保存',()=>save('save')))
      if(data.saved)footer.append(button('恢复当前模板',()=>{if(window.confirm('将本封内容恢复为当前全局模板并保存？不会发送邮件。'))save('reset')}))
    }
    body.append(el('p','仅预览和保存，不会发送邮件。实际发送请返回详情；已暂停的邮件仍需先恢复排队。','license-mail-help'),footer)
  }
  try{data=await request(path);if(d.isConnected)draw()}catch(error){body.replaceChildren(el('p',error.message))}
}
export async function showNightlyReport(id,request){
  const {d,body}=modal('夜间发放结果 · 汇总邮件预览');body.append(el('p','正在读取…'))
  try{
    const data=await request(`/license-delivery/nightly-reports/${id}`);if(!d.isConnected)return
    const states={accepted:'邮件服务已接受',failed:'发送失败',unknown:'结果待核查',sending:'发送中',skipped:'未发送'}
    body.replaceChildren(el('p',`北京时间 ${data.date} · 截止 ${data.cutoff.slice(0,19)}`),el('p',`汇总收件人：${data.message.to}`),el('p',`汇总邮件结果：${states[data.summaryState]||data.summaryState} · ${data.summaryDetail||'—'}`),el('h3',data.message.subject),mailFrame(data.message,'夜间汇总邮件正文'),el('p','上方保留原汇总文字，并列出本次处理明细。邮件服务已接受不代表客户已收件；已取消且未参与本次任务的记录不计入本次结果。','license-mail-help'))
  }catch(error){body.replaceChildren(el('p',error.message))}
}
