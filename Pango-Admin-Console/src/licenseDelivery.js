import { ccEditor, recipientHistory } from './licenseCc.js'
export const deliveryLabels={queued:'待夜间发放',conflict:'匹配冲突',unmatched:'无法匹配',duplicate:'重复文件',paused:'已暂停',sending:'发送中',accepted:'邮件服务已接受',failed:'发送失败',unknown:'结果待核查',cancelled:'已取消'}
const fileReason=file=>file.state==='queued'&&file.reason==='唯一匹配；授权内容由上传人员核对，每晚 22:00 自动处理'?'唯一匹配；授权内容由上传人员核对，每晚 20:00 自动处理':file.reason
const labels=deliveryLabels
const actions={uploaded:'上传文件',reuploaded:'重新上传并恢复原记录',match:'核对并重新匹配',pause:'暂停发放',cancel:'取消此文件','set-cc':'修改抄送邮箱','resolve-accepted':'已核实发出','resolve-failed':'已核实未发出'}
const displayTime=value=>String(value||'—').replace('T',' ').slice(0,19)
const node=(tag,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el}
function button(text,onClick,className=''){const el=node('button',text,className);el.type='button';el.addEventListener('click',onClick);return el}
function badge(state){return node('span',labels[state]||state,`delivery-badge delivery-${state}`)}
function table(headers,rows){const wrap=node('div','','table-wrap');const t=node('table');const head=node('thead');const tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');for(const values of rows){const row=node('tr');for(const value of values){const cell=node('td');cell.append(value instanceof Node?value:node('span',value??'—'));row.append(cell)}body.append(row)}if(!rows.length){const row=node('tr');const cell=node('td','暂无记录','empty');cell.colSpan=headers.length;row.append(cell);body.append(row)}t.append(body);wrap.append(t);return wrap}
async function encodeFile(file){const buffer=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<buffer.length;i+=8192)binary+=String.fromCharCode(...buffer.subarray(i,i+8192));return {name:file.name,base64:btoa(binary)}}

export async function renderLicenseDelivery(content,request){
  const root=node('section','','delivery-root');content.replaceChildren(root)
  const heading=node('div','','page-heading');const title=node('div');title.append(node('h1','License 自动发放'),node('p','每天 09:00 汇总给 FAE · 每晚 20:00 校对并发送 · 北京时间'));heading.append(title);root.append(heading)
  const message=node('p','','delivery-message');message.setAttribute('role','status');root.append(message)
  const report=error=>{if(!error.authentication)message.textContent=error.message||String(error)}
  let cfg
  try{cfg=await request('/license-delivery/config')}catch(error){report(error);return}
  if(!root.isConnected)return
  await renderLicenseMailSettings(root,request)
  if(!root.isConnected)return
  if(!cfg.enabled){root.append(node('div','自动发放尚未配置。请先执行数据库迁移，再启用 LICENSE_DELIVERY_ENABLED。','panel'));return}
  if(!cfg.sendingEnabled)root.append(node('div','当前为准备模式：可以上传和核对文件，自动发信尚未启用。','delivery-warning'))
  const uploadPanel=node('section','','panel delivery-upload')
  uploadPanel.append(node('h2','批量上传 License'),node('p','文件名：new_pds_<12位MAC>.lic。上传即加入处理队列，20:00 后上传的文件进入下一晚。请先核对文件内授权信息。已取消的相同内容文件再次上传，会复用原记录并重新匹配。'))
  const fileLabel=node('label','选择文件（每批最多 50 个，单个 1 MB，总计 10 MB）');const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.lic';input.id='licenseFiles';fileLabel.htmlFor=input.id;uploadPanel.append(fileLabel,input)
  const upload=button('上传并匹配',async()=>{
    const files=Array.from(input.files||[])
    if(!files.length){message.textContent='请先选择 License 文件';return}
    if(files.length>50||files.some(f=>f.size>1024*1024||!f.size)||files.reduce((n,f)=>n+f.size,0)>10*1024*1024){message.textContent='请检查文件数量、大小，文件不能为空';return}
    upload.disabled=true;input.disabled=true;message.textContent='正在上传并匹配…'
    try{
      const result=await request('/license-delivery/upload',{method:'POST',body:JSON.stringify({files:await Promise.all(files.map(encodeFile))})})
      if(!root.isConnected)return
      const queued=result.records.filter(f=>f.state==='queued').length
      message.textContent=`本批 ${result.records.length} 个文件：${queued} 个待发放，${result.records.length-queued} 个需查看匹配结果。${result.reusedIds?.length?`其中 ${result.reusedIds.length} 个复用已取消的原记录，未新增条目。`:''}`
      input.value='';page=1;await reload()
    }catch(error){report(error)}finally{upload.disabled=false;input.disabled=false}
  },'export-button')
  uploadPanel.append(upload);root.append(uploadPanel)
  const summary=node('div','','delivery-summary');root.append(summary)
  const filters=node('div','','delivery-filters');const filter=document.createElement('select');filter.setAttribute('aria-label','发放状态');const all=node('option','全部状态');all.value='';filter.append(all);for(const [value,label]of Object.entries(labels)){const option=node('option',label);option.value=value;filter.append(option)}
  const startDate=document.createElement('input');startDate.type='date';startDate.setAttribute('aria-label','上传开始日期')
  const endDate=document.createElement('input');endDate.type='date';endDate.setAttribute('aria-label','上传结束日期')
  const startLabel=node('label','上传开始日期');startLabel.append(startDate)
  const endLabel=node('label','上传结束日期');endLabel.append(endDate)
  const search=document.createElement('input');search.placeholder='文件名、MAC 或申请编号';search.setAttribute('aria-label','搜索文件');let page=1,busy=false
  const refresh=button('查询 / 刷新',()=>{page=1;reload().catch(report)})
  filter.addEventListener('change',()=>{page=1;reload().catch(report)});search.addEventListener('keydown',event=>{if(event.key==='Enter'){page=1;reload().catch(report)}})
  filters.append(startLabel,endLabel,filter,search,refresh);root.append(filters)
  const list=node('div','','panel table-panel');root.append(list)
  const notices=node('section','','panel delivery-notices');root.append(notices)
  async function detail(id){
    const dialog=document.createElement('dialog');dialog.className='delivery-dialog'
    const header=node('div','','delivery-dialog-header');header.append(node('h2','文件与发放记录'),button('关闭',()=>dialog.close()));dialog.append(header)
    const body=node('div','','delivery-dialog-body');dialog.append(body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();body.append(node('p','正在读取…'))
    try{
      const data=await request(`/license-delivery/files/${id}`);if(!dialog.isConnected)return;body.replaceChildren()
      const file=data.file
      body.append(node('h3',file.original_name),badge(file.state),node('p',fileReason(file)),node('p',`MAC：${file.mac||'未识别'} · 申请：${file.application_id||'尚未关联'} · 尝试次数：${file.attempts}`))
      const download=node('a','下载文件核对');download.href=`/local-api/license-delivery/files/${id}/content`;download.className='feedback-detail-link';body.append(download)
      body.append(ccEditor(file.cc,Boolean(file.application_id)&&['queued','failed','paused'].includes(file.state),async cc=>{
        await request(`/license-delivery/files/${id}/cc`,{method:'POST',body:JSON.stringify({cc,expectedUpdatedAt:file.updated_at})})
        message.textContent='此文件的抄送设置已保存，立即发送和夜间发放均会使用。';dialog.close();await reload();await detail(id)
      }))
      if(file.application_id&&['queued','failed'].includes(file.state)){
        const sendStatus=node('p','','delivery-message');sendStatus.setAttribute('role','status')
        const sendNow=button('立即发送',async()=>{
          sendNow.disabled=true;sendStatus.textContent='正在读取收件信息…'
          try{
            const workflow=await request(`/license-delivery/applications/${file.application_id}/workflow`)
            if(!dialog.isConnected)return
            const row=workflow.application
            const cc=workflow.files.find(item=>item.id===file.id)?.cc||[]
            if(!window.confirm(`立即发送此 License？\n\n申请编号：#${row.id}\n附件：${file.original_name}\n发件人：${workflow.faeEmail||'FAE 邮箱未配置'}\n收件人：${row.email}\n抄送：${cc.join('、')||'无'}\n\n这会真实发送并保存正式记录。成功后 20:00任务不再重复发放；只处理此文件对应的申请。`)){sendStatus.textContent='已取消，未发送。';return}
            sendStatus.textContent='正在校对并发送此文件，请稍候…'
            const result=await request(`/license-delivery/applications/${row.id}/workflow`,{method:'POST',body:JSON.stringify({action:'deliver-license',confirm:true,confirmedApplicationId:String(row.id),expectedFileId:file.id,expectedEmail:row.email,expectedCc:cc,expectedFaeEmail:workflow.faeEmail})})
            message.textContent=result.state==='accepted'?'邮件服务已接受，请核对实际收件与附件；本申请已记录发放结果，定时任务不会重复发放。':`${labels[result.state]||result.state}：${result.detail||'请查看文件与邮件记录'}`
            dialog.close();await reload()
          }catch(error){if(!error.authentication)sendStatus.textContent=error.message||'发送失败，请核对后再试'}finally{sendNow.disabled=false}
        },'export-button')
        body.append(node('p','可立即发送已匹配的这份真实附件，不用等到 20:00；会保存正式发放记录。暂停、冲突或结果待核查的文件需先处理。','delivery-warning'),sendNow,sendStatus)
      }
      if(data.candidates.length)body.append(table(['申请编号','申请人 / 公司','系统 / 版本','类型 / 年限','客户邮箱'],data.candidates.map(row=>[row.id,`${row.applicant_name}\n${row.company_name}`,`${row.operating_system} / ${row.software_version}`,`${row.license_type} / ${row.duration_years}年`,row.email])))
      if(!['accepted','cancelled','duplicate','sending'].includes(file.state)){
        const form=node('div','','delivery-action-form');const select=document.createElement('select');select.setAttribute('aria-label','选择匹配申请');const blank=node('option','按 MAC 自动匹配');blank.value='';select.append(blank);for(const row of data.candidates){const option=node('option',`#${row.id} ${row.applicant_name} · ${row.company_name}`);option.value=String(row.id);select.append(option)}if(file.application_id)select.value=String(file.application_id)
        const note=document.createElement('textarea');note.placeholder='填写核对依据或处理说明（重新匹配和邮件核查必填）';note.setAttribute('aria-label','核对说明');const errorBox=node('p','','delivery-message');errorBox.setAttribute('role','alert')
        const group=node('div','','delivery-action-buttons');const allowed=file.state==='unknown'?['resolve-accepted','resolve-failed']:['match','pause','cancel']
        for(const action of allowed)group.append(button(actions[action],async()=>{
          if(['match','resolve-accepted','resolve-failed'].includes(action)&&!note.value.trim()){errorBox.textContent='请填写核对依据或说明';return}
          if(action==='cancel'&&!window.confirm('取消后，此文件不会自动发放。确定取消？'))return
          group.querySelectorAll('button').forEach(el=>el.disabled=true)
          try{await request(`/license-delivery/files/${id}/action`,{method:'POST',body:JSON.stringify({action,applicationId:select.value||undefined,note:note.value})});dialog.close();await reload()}catch(error){if(!error.authentication)errorBox.textContent=error.message}finally{group.querySelectorAll('button').forEach(el=>el.disabled=false)}
        }))
        if(file.state!=='unknown')form.append(select)
        else form.append(node('p','请先按 Message-ID 核查主收件人和所有抄送人的邮件服务记录。登记“未发出”后会暂停，需要重新匹配才会再次排队。','delivery-warning'))
        form.append(note,group,errorBox);body.append(form)
      }
      body.append(recipientHistory(data.mails))
      body.append(node('h3','邮件记录'),table(['收件人','结果','Message-ID','详情','更新时间'],data.mails.map(mail=>[mail.recipient,labels[mail.state]||mail.state,mail.message_id,mail.detail,displayTime(mail.updated_at)])))
      body.append(node('h3','操作记录'),table(['时间','操作人','操作','说明'],data.history.map(row=>[displayTime(row.created_at),row.actor==='nightly'?'夜间任务':row.actor,actions[row.action]||labels[row.action]||row.action,row.note])))
    }catch(error){body.replaceChildren(node('p',error.message))}
  }
  async function reload(){
    if(busy)return
    if(startDate.value&&endDate.value&&startDate.value>endDate.value){message.textContent='开始日期不能晚于结束日期';return}
    busy=true;refresh.disabled=true
    try{
      const params=new URLSearchParams({page:String(page),state:filter.value,query:search.value.trim(),startDate:startDate.value,endDate:endDate.value})
      const data=await request(`/license-delivery/files?${params}`)
      if(!root.isConnected)return
      summary.replaceChildren(...data.summary.map(item=>node('span',`${labels[item.state]||item.state} ${item.count}`,'delivery-stat')))
      list.replaceChildren(table(['上传时间','文件 / MAC','申请编号','抄送','状态','说明','操作'],data.records.map(file=>[displayTime(file.uploaded_at),`${file.original_name}\n${file.mac||'无法识别 MAC'}`,file.application_id||'—',file.cc?.join('、')||'—',badge(file.state),fileReason(file),button('查看 / 处理',()=>detail(file.id),'feedback-detail-link')])))
      const pager=node('div','','pager');const pages=Math.max(1,Math.ceil(data.total/30));const previous=button('上一页',()=>{page--;reload().catch(report)}),next=button('下一页',()=>{page++;reload().catch(report)});previous.disabled=page<=1;next.disabled=page>=pages;pager.append(node('span',`共 ${data.total} 条 · ${page} / ${pages}`),previous,next);list.append(pager)
      const noticeData=await request('/license-delivery/notices');if(!root.isConnected)return
      notices.replaceChildren(node('h2','最近 FAE 汇总邮件'),table(['时间','类型','收件人','结果','说明 / Message-ID','操作'],noticeData.records.map(row=>{
        const group=node('div','','delivery-action-buttons')
        if(row.kind==='digest'&&['unknown','failed'].includes(row.state)){
          for(const [label,outcome] of row.state==='unknown'?[['已核实发出','accepted'],['已核实未发出','failed']]:[['核对后重试','retry']])group.append(button(label,async()=>{
            const note=window.prompt('填写邮件服务核查依据：');if(!note?.trim())return
            try{await request(`/license-delivery/notices/${row.id}/resolve`,{method:'POST',body:JSON.stringify({outcome,note})});await reload()}catch(error){report(error)}
          }))
        }
        return [displayTime(row.updated_at),row.kind==='digest'?'早间待办':'夜间结果',row.recipient,badge(row.state),`${row.detail}\n${row.message_id}`,group]
      })))
    }finally{busy=false;refresh.disabled=false}
  }
  await reload().catch(report)
}
import { renderLicenseMailSettings } from './licenseMailSettings.js'
