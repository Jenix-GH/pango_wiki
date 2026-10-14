import {showQueuedMail} from './licenseQueuedMail.js'
import {deliveryLabels} from './licenseDelivery.js'
const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node}
const button=(text,fn,className='')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',fn);return node}
const time=value=>String(value||'—').replace('T',' ').slice(0,19)
export async function renderApplicationFiles(root,id,request,{refresh=async()=>{},openForm=false}={}){
  root.replaceChildren(el('p','正在读取关联文件…'))
  try{
    const data=await request(`/license-delivery/applications/${id}/files`)
    if(!root.isConnected)return
    root.replaceChildren(el('h3','License 文件'))
    const current=data.files.filter(file=>!['cancelled','duplicate'].includes(file.state))
    if(!current.length)root.append(el('p','当前尚未匹配 License 文件，可在这里直接手动上传。'))
    for(const file of current){
      const item=el('section','','application-file-item')
      item.append(el('strong',file.original_name),el('p',`${deliveryLabels[file.state]||file.state} · ${file.manual_selection===1?'手动上传或确认':'自动匹配'} · ${time(file.uploaded_at)}`))
      const download=el('a','下载核对');download.href=`/local-api/license-delivery/files/${file.id}/content`;download.className='feedback-detail-link';item.append(download)
      if(['queued','failed','paused'].includes(file.state))item.append(button('邮件预览 / 编辑',()=>showQueuedMail('file',file.id,request),'feedback-detail-link'))
      item.append(el('p',file.reason));root.append(item)
    }
    if(!data.canUpload)root.append(el('p',data.blocked,'delivery-warning'))
    else{
      const toggle=button(current.length?'替换 License 文件':'手动上传 License',()=>{form.hidden=!form.hidden},'export-button')
      const form=el('form','','application-file-upload');form.hidden=!openForm
      form.append(el('p',`上传至申请 #${id} · ${data.application.applicant_name} · ${data.application.company_name}`),el('p',`收件邮箱：${data.application.email}`),el('p',`MAC：${data.application.mac_address} · 授权类型：${data.application.license_type==='SERVER'?'服务器版（浮点）':'单机版'}${data.application.license_type==='SERVER'?` · 最大支持人数：${data.application.max_users??'未填写'}`:''}`))
      const label=el('label','选择 License 文件（单个 .lic，最大 1 MB）'),input=el('input');input.type='file';input.accept='.lic';input.required=true;input.setAttribute('aria-label','手动上传 License 文件');label.append(input)
      const selected=el('p','尚未选择文件')
      input.addEventListener('change',()=>{selected.textContent=input.files[0]?`已选择：${input.files[0].name}`:'尚未选择文件'})
      form.append(label,selected,el('p',`保存及发放文件名：${data.filename}。系统只规范文件名，不修改文件内容；以当前申请为准，不再依赖文件名搜索申请。`))
      if(current.length)form.append(el('p','确认后替换此申请当前未发放的文件，旧文件停止发放并保留历史。原抄送保留，新文件使用当前邮件模板，请重新预览核对。','delivery-warning'))
      const noteLabel=el('label','核对说明'),note=el('textarea');note.required=true;note.maxLength=500;note.rows=3;note.setAttribute('aria-label','上传核对说明');noteLabel.append(note)
      const checkLabel=el('label','','application-file-confirm'),confirm=el('input');confirm.type='checkbox';confirm.required=true;checkLabel.append(confirm,el('span','我已核对文件内的 MAC、授权类型、版本及人数，确认此文件属于当前申请'))
      const status=el('p','','delivery-message');status.setAttribute('role','status')
      const submit=el('button',current.length?'确认替换并加入待发放':'确认上传并加入待发放','export-button');submit.type='submit'
      form.append(noteLabel,checkLabel,status,submit,el('p','上传只加入待发放，不会立即发送邮件。'))
      form.addEventListener('submit',async event=>{
        event.preventDefault();const file=input.files?.[0]
        if(!file||!file.size||file.size>1024*1024||!/\.lic$/i.test(file.name)){status.textContent='请选择一个不为空、且不超过 1 MB 的 .lic 文件';return}
        if(!confirm.checked||!note.value.trim()){status.textContent='请勾选核对确认并填写说明';return}
        submit.disabled=true;input.disabled=true;toggle.disabled=true;status.textContent='正在上传并校对，未发送邮件…'
        try{
          const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
          const result=await request(`/license-delivery/applications/${id}/files`,{method:'POST',body:JSON.stringify({file:{name:file.name,base64:btoa(binary)},expectedVersion:data.version,confirm:true,note:note.value.trim()})})
          if(!root.isConnected)return
          await renderApplicationFiles(root,id,request,{refresh});root.prepend(el('p',`已保存 ${result.filename}，已加入待发放，本次未发送邮件。`,'delivery-message'));await refresh()
        }catch(error){if(!error.authentication)status.textContent=error.message}finally{submit.disabled=false;input.disabled=false;toggle.disabled=false}
      })
      root.append(toggle,form)
    }
    const history=data.files.filter(file=>['cancelled','duplicate'].includes(file.state))
    if(history.length){
      const details=el('details','','application-file-history');details.append(el('summary',`历史文件（${history.length}）`))
      for(const file of history){const item=el('p',`${file.original_name} · ${deliveryLabels[file.state]||file.state} · ${time(file.updated_at)} · ${file.reason} `);const link=el('a','下载核对');link.className='feedback-detail-link';link.href=`/local-api/license-delivery/files/${file.id}/content`;item.append(link);details.append(item)}
      root.append(details)
    }
  }catch(error){root.replaceChildren(el('p',error.message,'delivery-message'))}
}


export function showDeliveryFileUpload(request,{applicationId=null,refresh=async()=>{}}={}){
  const d=el('dialog','','delivery-dialog'),header=el('div','','delivery-dialog-header'),body=el('div','','delivery-dialog-body')
  header.append(el('h2',applicationId?`手动上传 / 替换 License · 申请 #${applicationId}`:'手动上传 License'),button('关闭',()=>d.close()))
  d.append(header,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal()
  const content=el('section','','application-files')
  if(applicationId){body.append(content);renderApplicationFiles(content,applicationId,request,{refresh,openForm:true});return}
  body.append(el('p','先填写本次发放对应的申请编号，核对客户信息后选择电脑上的 License 文件。'))
  const form=el('form','','delivery-manual-application'),label=el('label','申请编号'),input=el('input');input.required=true;input.placeholder='例如：45';input.setAttribute('aria-label','手动上传对应申请编号');label.append(input)
  const submit=el('button','读取申请','export-button');submit.type='submit'
  const status=el('p','','delivery-message');status.setAttribute('role','status');form.append(label,submit,status);body.append(form,content)
  let loading=false
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(loading)return
    const id=input.value.trim().replace(/^#/,'')
    if(!/^[1-9]\d{0,19}$/.test(id)){status.textContent='请填写有效的申请编号';return}
    loading=true;submit.disabled=true;status.textContent=''
    try{await renderApplicationFiles(content,id,request,{refresh,openForm:true})}finally{loading=false;submit.disabled=false}
  })
}
