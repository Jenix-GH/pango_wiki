const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node}
export function ccEditor(cc,editable,onSave){
  const box=el('section');box.className='delivery-action-form'
  box.append(el('h3','抄送邮箱（可选）'))
  if(!editable){box.append(el('p',cc?.join('、')||'未设置抄送'));return box}
  const input=el('textarea');input.rows=2;input.maxLength=5000;input.value=(cc||[]).join('\n');input.setAttribute('aria-label','抄送邮箱');input.placeholder='例如：colleague@example.com；manager@example.com'
  const save=el('button','保存抄送');save.type='button';save.className='export-button'
  const error=el('p');error.className='delivery-message';error.setAttribute('role','alert')
  save.addEventListener('click',async()=>{
    save.disabled=true;input.disabled=true;error.textContent='正在保存…'
    try{await onSave(input.value)}catch(err){if(!err.authentication)error.textContent=err.message||'保存失败'}finally{save.disabled=false;input.disabled=false}
  })
  box.append(el('p','填写后需点击“保存抄送”才会用于发信。留空保存可清除；最多 10 个邮箱，用逗号、分号或换行分隔。抄送人会收到相同正文及附件，邮箱地址彼此可见。'),input,save,error)
  return box
}
export function recipientHistory(mails){
  const box=el('section');box.append(el('h3','发送收件人记录'))
  const records=mails.flatMap(mail=>(mail.recipient_history||[]).map(record=>({...record,messageId:mail.message_id})))
  if(!records.length){box.append(el('p','暂无发送收件人记录。'));return box}
  for(const row of records){const item=el('p',`${row.created_at}\n收件人：${row.recipient}\n抄送：${row.cc.join('、')||'无'}\nMessage-ID：${row.messageId}`);item.style.whiteSpace='pre-wrap';box.append(item)}
  return box
}
