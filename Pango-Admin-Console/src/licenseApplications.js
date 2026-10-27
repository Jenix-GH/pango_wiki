import { showRejection } from './licenseRejections.js'
import { deliveryLabels } from './licenseDelivery.js'

const statuses=['待处理','处理中','已处理','已拒绝']
const mailLabels={...deliveryLabels,queued:'待发送'}
const view={page:1,status:'',startDate:'',endDate:''}
const el=(tag,text='',className='')=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item}
const time=value=>value?String(value).replace('T',' ').slice(0,19):'—'
function button(text,action,className=''){const item=el('button',text,className);item.type='button';item.addEventListener('click',action);return item}
function addRow(body,values){const tr=el('tr');for(const value of values){const td=el('td');td.append(value instanceof Node?value:el('span',value??'—'));tr.append(td)}body.append(tr)}
function dialog(title){const d=el('dialog','','delivery-dialog');const header=el('div','','delivery-dialog-header');header.append(el('h2',title),button('关闭',()=>d.close()));const body=el('div','','delivery-dialog-body');d.append(header,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return {d,body}}
function batchRequestId(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{const value=crypto.getRandomValues(new Uint8Array(1))[0]&15;return (char==='x'?value:(value&3)|8).toString(16)})}

export async function renderLicenseApplications(content,request,openDelivery){
  const root=el('section','','license-applications');content.replaceChildren(root)
  const heading=el('div','','page-heading');const intro=el('div');intro.append(el('h1','License 申请'),el('p','支持人工设置四种状态；通知 FAE、上传并匹配 License 后也会自动更新。拒绝需填写理由。'))
  heading.append(intro,button('批量上传 / 发放记录',openDelivery,'export-button'));root.append(heading)
  const mode=el('div','','delivery-warning');mode.hidden=true;root.append(mode)
  const filters=el('div','','license-filters')
  const status=document.createElement('select');status.setAttribute('aria-label','申请状态');const all=el('option','全部状态');all.value='';status.append(all)
  statuses.forEach((label,index)=>{const option=el('option',label);option.value=String(index);status.append(option)});status.value=view.status
  const dateInput=(label,value)=>{const wrap=el('label',label);const input=document.createElement('input');input.type='date';input.value=value;input.setAttribute('aria-label',label);wrap.append(input);return {wrap,input}}
  const start=dateInput('提交开始日期',view.startDate),end=dateInput('提交结束日期',view.endDate)
  const message=el('p','','delivery-message');message.setAttribute('role','status')
  const count=el('p','','license-count');const panel=el('div','','panel table-panel')
  let loading=false,batchBusy=false,workflowEnabled=false
  const selected=new Map()
  let pageCheckboxes=[],selectPage
  const batchBar=el('div','','license-batch-actions'),selectedCount=el('span')
  const batchButton=button('批量立即通知 FAE',notifySelected,'export-button')
  const clearSelected=button('清空勾选',()=>{selected.clear();syncSelection()})
  batchBar.append(selectedCount,batchButton,clearSelected)
  const query=button('查询',()=>apply())
  const clear=button('重置',()=>{status.value='';start.input.value='';end.input.value='';apply()})
  filters.append(start.wrap,end.wrap,status,query,clear);root.append(filters,batchBar,message,count,panel)
  syncSelection()
  function apply(){
    if(start.input.value&&end.input.value&&start.input.value>end.input.value){message.textContent='开始日期不能晚于结束日期';return}
    selected.clear();syncSelection()
    Object.assign(view,{page:1,status:status.value,startDate:start.input.value,endDate:end.input.value});load().catch(report)
  }
  status.addEventListener('change',apply)
  function report(error){if(!error.authentication)message.textContent=error.message||String(error)}
  function syncSelection(){
    selectedCount.textContent=`已勾选 ${selected.size} 条待处理申请（最多 100 条，可跨页）`
    batchButton.disabled=loading||batchBusy||!workflowEnabled||selected.size===0
    clearSelected.disabled=loading||batchBusy||selected.size===0
    for(const {input,row} of pageCheckboxes){input.checked=selected.has(String(row.id));input.disabled=loading||batchBusy||!workflowEnabled||Number(row.status)!==0}
    if(selectPage){
      const eligible=pageCheckboxes.filter(({row})=>Number(row.status)===0)
      const checked=eligible.filter(({row})=>selected.has(String(row.id))).length
      selectPage.checked=eligible.length>0&&checked===eligible.length
      selectPage.indeterminate=checked>0&&checked<eligible.length
      selectPage.disabled=loading||batchBusy||!workflowEnabled||eligible.length===0
    }
  }
  async function notifySelected(){
    if(batchBusy||!selected.size)return
    batchBusy=true;syncSelection()
    try{
      const applicationIds=[...selected.keys()]
      const preview=await request('/license-delivery/applications/batch-notify-fae/preview',{method:'POST',body:JSON.stringify({applicationIds})})
      if(!root.isConnected)return
      const payload={applicationIds,requestId:batchRequestId(),expectedVersion:preview.version,expectedFaeEmail:preview.faeEmail,confirm:true}
      const {d,body}=dialog(`批量通知 FAE · ${preview.records.length} 条申请`)
      d.classList.add('license-batch-dialog')
      body.append(el('p',`FAE 收件邮箱：${preview.faeEmail}`),el('p','选中的申请将合成一封表格邮件，包含完整申请信息及 CSV 附件。邮件服务器接受后转为“处理中”，后续定时汇总不再重复通知。'))
      if(preview.failedBatchCount)body.append(el('p',`选中申请关联 ${preview.failedBatchCount} 封明确失败的旧汇总。确认后旧汇总停止重试并保留记录；本次只发送勾选项，未勾选的申请仍保持待处理。`,'delivery-warning'))
      const table=el('table'),head=el('thead'),tr=el('tr'),tbody=el('tbody'),wrap=el('div','','table-wrap')
      for(const label of ['申请编号','申请人 / 公司','联系邮箱','MAC 地址','联系地址'])tr.append(el('th',label))
      head.append(tr);table.append(head,tbody);wrap.append(table);body.append(wrap)
      for(const row of preview.records)addRow(tbody,[`#${row.id}`,`${row.applicant_name}\n${row.company_name}`,row.email,row.mac_address,row.address||'未填写'])
      const feedback=el('p','','delivery-message');feedback.setAttribute('role','status')
      const submit=button('确认合并发送',send,'export-button');body.append(feedback,submit)
      let sending=false,waiting
      d.addEventListener('cancel',event=>{if(sending)event.preventDefault()})
      d.addEventListener('close',()=>{batchBusy=false;syncSelection()},{once:true})
      async function send(){
        if(sending)return
        sending=true;submit.disabled=true;d.querySelector('.delivery-dialog-header button').disabled=true
        feedback.textContent='正在合并发送，请等待实际结果，勿重复操作。'
        waiting=setTimeout(()=>{feedback.textContent='仍在等待邮件服务器响应，结果尚未确认。请勿另建发送请求。'},20000)
        try{
          const result=await request('/license-delivery/applications/batch-notify-fae',{method:'POST',body:JSON.stringify(payload)})
          clearTimeout(waiting)
          const text=result.state==='accepted'?`${result.count} 条申请已合成一封邮件，邮件服务器已接受，申请已转为“处理中”。`:`批量通知结果：${mailLabels[result.state]||result.state}。${result.detail||'请查看最近 FAE 汇总邮件。'}`
          feedback.textContent=text;message.textContent=text
          for(const id of applicationIds)selected.delete(id)
          submit.hidden=true
          await load()
        }catch(error){
          clearTimeout(waiting)
          feedback.textContent=`${error.message||'请求失败'}。若连接中断，请先查看最近 FAE 汇总邮件；重复提交此按钮只核对同一请求，不会重新发一封。`
          submit.textContent='重试本次请求';submit.disabled=false
        }finally{
          clearTimeout(waiting);sending=false;d.querySelector('.delivery-dialog-header button').disabled=false
        }
      }
    }catch(error){batchBusy=false;syncSelection();report(error)}
    finally{if(!root.isConnected)batchBusy=false}
  }
  async function reject(row){
    const {d,body}=dialog(`拒绝申请 #${row.id}`)
    body.append(el('p',`${row.applicant_name} · ${row.company_name} · ${row.mac_address}`),el('p',`说明邮件将发送至：${row.email}`),el('p','拒绝理由会原文发送给客户。提交后停止此申请的 License 发放，说明邮件进入每晚 20:00 队列。','delivery-warning'))
    const form=el('form','','license-reject-form');const label=el('label','拒绝理由');const reason=document.createElement('textarea');reason.required=true;reason.maxLength=2000;reason.rows=5;reason.setAttribute('aria-label','拒绝理由');reason.placeholder='请填写清晰、适合向客户说明的拒绝原因';label.append(reason)
    const error=el('p','','delivery-message');error.setAttribute('role','alert');const submit=el('button','确认拒绝并安排邮件','export-button');submit.type='submit';form.append(label,error,submit);body.append(form)
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!reason.value.trim()){error.textContent='请填写拒绝理由';return}submit.disabled=true
      try{await request(`/licenses/${row.id}/status`,{method:'POST',body:JSON.stringify({status:3,reason:reason.value.trim(),expectedStatus:Number(row.status)})});d.close();message.textContent='已拒绝，说明邮件已加入夜间发送队列。';await load()}catch(err){error.textContent=err.message}finally{submit.disabled=false}
    })
  }
  async function notifyFae(row,target){
    target.disabled=true
    const originalLabel=target.textContent
    const actions=target.closest('.license-row-actions')
    let feedback=actions.querySelector('.fae-send-feedback')
    if(!feedback){feedback=el('p','','delivery-message fae-send-feedback');feedback.setAttribute('role','status');actions.append(feedback)}
    const status=text=>{message.textContent=text;feedback.textContent=text}
    let waiting,submitted=false
    try{
      target.textContent='正在核对…';status(`申请 #${row.id}：正在读取 FAE 收件信息，尚未发送。`)
      const workflow=await request(`/license-delivery/applications/${row.id}/workflow`)
      const current=workflow.application
      if(!workflow.faeEmail)throw new Error('请先配置 FAE 邮箱')
      if(!window.confirm(`确认发送申请给 FAE？\n申请 #${current.id} · ${current.applicant_name}\n公司或学校：${current.company_name}\nFAE 收件邮箱：${workflow.faeEmail}\n\n当前尚未发送。点击“确定”后，平台邮箱才会发送这一条申请；只有邮件服务器接受后才转为“处理中”。`)){status(`申请 #${row.id}：已取消，未提交发送请求。`);return}
      submitted=true;target.textContent='发送中…';status(`申请 #${row.id}：正在向 ${workflow.faeEmail} 发送，请等待实际结果，勿重复点击。`)
      waiting=setTimeout(()=>status(`申请 #${row.id}：仍在等待服务器响应，发送结果尚未确认。请勿重复点击；可在“License 发放”底部查看最近 FAE 汇总邮件记录。`),20000)
      const result=await request(`/license-delivery/applications/${row.id}/workflow`,{method:'POST',body:JSON.stringify({action:'notify-fae',confirm:true,confirmedApplicationId:String(row.id),expectedEmail:current.email,expectedFaeEmail:workflow.faeEmail})})
      clearTimeout(waiting)
      status(result.state==='accepted'?`申请 #${row.id} 已通知 FAE，状态已转为处理中。邮件服务器已接受，请核对收件箱。`:`申请 #${row.id}：${mailLabels[result.state]||result.state}。${result.detail||'请查看 FAE 通知记录。'}`)
      await load()
    }catch(error){
      if(!error.authentication)status(`申请 #${row.id}：${error.message||'请求失败'}${submitted?'。若请求中断，请先核对“License 发放”中的 FAE 邮件记录，勿直接重复发送。':''}`)
    }finally{clearTimeout(waiting);target.disabled=false;target.textContent=originalLabel}
  }
  function showApplication(row){
    const {body}=dialog(`申请详情 · #${row.id}`)
    const fields=[['申请人姓名',row.applicant_name],['公司或学校',row.company_name],['邮箱类型',row.email_type==='PERSONAL'?'个人邮箱':row.email_type==='ORGANIZATION'?'公司或学校邮箱':'未填写'],['联系邮箱',row.email],['联系电话',row.phone],['联系地址',row.address],['FAE 或渠道负责人',row.contact_person||'未填写'],['操作系统',row.operating_system],['软件版本',row.software_version],['授权类型',row.license_type==='SERVER'?'服务器版（浮点）':'单机版'],['最大支持人数',row.license_type==='SERVER'?(row.max_users??'未填写'):'不适用'],['使用时长',`${row.duration_years}年`],['MAC 地址',row.mac_address],['官网已提交',row.official_submitted==null?'未记录':Number(row.official_submitted)===1?'是':'否']]
    for(const [label,value] of fields)body.append(el('p',`${label}：${value??'未填写'}`))
  }
  async function showHistory(row){
    const {d,body}=dialog(`状态记录 · 申请 #${row.id}`);body.append(el('p','读取中…'))
    try{
      const {records}=await request(`/license-delivery/applications/${row.id}/history`)
      if(!d.isConnected)return;body.replaceChildren()
      if(!records.length)body.append(el('p','暂无人工修改记录。'))
      for(const record of records){
        const item=el('section','','license-history-item')
        item.append(el('h3',`${statuses[record.previous_status]} → ${statuses[record.next_status]}`),el('p',`${record.actor} · ${time(record.created_at)}`),el('p',record.note,'rejection-reason'))
        if(record.rejection_snapshot)item.append(el('p',`此前拒绝理由：${record.rejection_snapshot.reason}\n此前邮件状态：${mailLabels[record.rejection_snapshot.state]||record.rejection_snapshot.state}`,'rejection-reason'))
        body.append(item)
      }
    }catch(error){body.replaceChildren(el('p',error.message))}
  }
  async function load(){
    if(loading)return;loading=true;syncSelection();filters.querySelectorAll('input,select,button').forEach(item=>item.disabled=true)
    try{
      const data=await request(`/licenses?${new URLSearchParams({page:String(view.page),status:view.status,startDate:view.startDate,endDate:view.endDate})}`)
      if(!root.isConnected)return
      workflowEnabled=data.workflowEnabled;pageCheckboxes=[];selectPage=null
      for(const row of data.records)if(Number(row.status)!==0)selected.delete(String(row.id))
      mode.hidden=Boolean(data.workflowEnabled&&data.sendingEnabled)
      mode.textContent=data.workflowEnabled?'当前为准备模式：定时发送未启用；状态和拒绝理由会保存，明确确认后可单条或批量立即通知 FAE。':'工作流尚未配置：可查询申请，暂不能设置状态或安排拒绝通知。'
      count.textContent=`共 ${data.total} 条申请 · 按提交时间筛选${view.startDate||view.endDate?`：${view.startDate||'不限'} 至 ${view.endDate||'不限'}（含结束当天）`:''}`
      const table=el('table'),head=el('thead'),hr=el('tr');
      selectPage=document.createElement('input');selectPage.type='checkbox';selectPage.setAttribute('aria-label','勾选本页待处理申请')
      selectPage.addEventListener('change',()=>{
        const eligible=pageCheckboxes.filter(({row})=>Number(row.status)===0)
        if(selectPage.checked){
          const additions=eligible.filter(({row})=>!selected.has(String(row.id)))
          if(selected.size+additions.length>100){message.textContent='每批最多勾选 100 条，请减少选择';syncSelection();return}
          for(const {row} of eligible)selected.set(String(row.id),row)
        }else for(const {row} of eligible)selected.delete(String(row.id))
        syncSelection()
      })
      const selectionHead=el('th');selectionHead.append(selectPage);hr.append(selectionHead);
      ['申请编号','提交时间','申请人 / 公司','系统 / 版本','类型 / 年限','MAC 地址','联系方式','联系地址','邮箱类型 / 对接人','官网已提交','申请状态','文件 / 邮件','拒绝理由','操作'].forEach(h=>hr.append(el('th',h)));head.append(hr);const tbody=el('tbody');table.append(head,tbody)
      for(const row of data.records){
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',`勾选申请 #${row.id}`)
        checkbox.addEventListener('change',()=>{
          if(checkbox.checked){if(selected.size>=100){message.textContent='每批最多勾选 100 条';syncSelection();return}selected.set(String(row.id),row)}
          else selected.delete(String(row.id))
          syncSelection()
        });pageCheckboxes.push({input:checkbox,row})
        const state=document.createElement('select')
        state.className=`application-badge application-status-${row.status}`
        state.setAttribute('aria-label',`设置申请 #${row.id} 状态`)
        state.title='人工设置用于进度校正；邮件和文件记录单独保存。'
        for(const [index,label] of statuses.entries()){const option=el('option',label);option.value=String(index);state.append(option)}
        state.value=String(row.status);state.disabled=!data.workflowEnabled
        state.addEventListener('change',async()=>{
          const next=Number(state.value)
          if(next===3){state.value=String(row.status);await reject(row);return}
          state.disabled=true
          try{
            await request(`/licenses/${row.id}/status`,{method:'POST',body:JSON.stringify({status:next,expectedStatus:Number(row.status)})})
            message.textContent=`申请 #${row.id} 已人工设为${statuses[next]}。已有文件及邮件记录保留。`
            await load()
          }catch(error){state.value=String(row.status);report(error);await load().catch(report)}finally{state.disabled=!data.workflowEnabled}
        })
        const operation=el('div','','license-row-actions')
        operation.append(button('申请详情',()=>showApplication(row),'feedback-detail-link'))
        if(data.workflowEnabled){
          if(Number(row.status)===0)operation.append(button('立即通知 FAE',event=>notifyFae(row,event.currentTarget),'feedback-detail-link'))
          operation.append(button('状态记录',()=>showHistory(row),'feedback-detail-link'))
          if(Number(row.status)===3&&row.rejection_reason)operation.append(button('拒绝详情 / 邮件',()=>showRejection(row,request,{refresh:load,report:text=>{message.textContent=text}}),'feedback-detail-link'))
          else if(!['accepted','sending','unknown'].includes(row.delivery_state))operation.append(button(Number(row.status)===3?'补充拒绝理由':'拒绝申请',()=>reject(row),'license-reject-button'))
        }
        const delivery=Number(row.status)===3?(row.rejection_mail_state?`拒绝邮件：${mailLabels[row.rejection_mail_state]||row.rejection_mail_state}`:'历史记录：未保存理由及邮件'):deliveryLabels[row.delivery_state]||'未上传 / 未关联文件'
        const applicationId=el('span',`#${row.id}`,'license-application-id');applicationId.title='与邮件中的申请编号一致'
        const address=el('span',row.address||'未填写','license-contact-address')
        addRow(tbody,[checkbox,applicationId,time(row.dotime),`${row.applicant_name}\n${row.company_name}`,`${row.operating_system} / ${row.software_version}`,`${row.license_type} / ${row.duration_years}年${row.license_type==='SERVER'?`\n最大支持人数：${row.max_users??'未填写'}`:''}`,row.mac_address,`${row.email||''}\n${row.phone||''}`,address,`${row.email_type==='PERSONAL'?'个人邮箱':row.email_type==='ORGANIZATION'?'公司或学校邮箱':'未填写'}\n${row.contact_person||'未填写'}`,row.official_submitted==null?'未记录':Number(row.official_submitted)===1?'是':'否',state,delivery,row.rejection_reason?(Number(row.status)===3?row.rejection_reason:`历史拒绝：${row.rejection_reason}`):'—',operation])
      }
      if(!data.records.length){const row=el('tr'),cell=el('td','该时段及状态下暂无申请','empty');cell.colSpan=15;row.append(cell);tbody.append(row)}
      const wrap=el('div','','table-wrap');wrap.append(table);const pager=el('div','','pager');const pages=Math.max(1,Math.ceil(data.total/30))
      const previous=button('上一页',()=>{view.page--;load().catch(report)}),next=button('下一页',()=>{view.page++;load().catch(report)});previous.disabled=view.page<=1;next.disabled=view.page>=pages;pager.append(el('span',`${view.page} / ${pages}`),previous,next);panel.replaceChildren(wrap,pager)
    }finally{loading=false;filters.querySelectorAll('input,select,button').forEach(item=>item.disabled=false);syncSelection()}
  }
  await load().catch(report)
}
