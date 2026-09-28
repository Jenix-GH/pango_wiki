import { deliveryLabels } from './licenseDelivery.js'

const statuses=['待处理','处理中','已处理','已拒绝']
const mailLabels={...deliveryLabels,queued:'待发送'}
const view={page:1,status:'',startDate:'',endDate:''}
const el=(tag,text='',className='')=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item}
const time=value=>value?String(value).replace('T',' ').slice(0,19):'—'
function button(text,action,className=''){const item=el('button',text,className);item.type='button';item.addEventListener('click',action);return item}
function addRow(body,values){const tr=el('tr');for(const value of values){const td=el('td');td.append(value instanceof Node?value:el('span',value??'—'));tr.append(td)}body.append(tr)}
function dialog(title){const d=el('dialog','','delivery-dialog');const header=el('div','','delivery-dialog-header');header.append(el('h2',title),button('关闭',()=>d.close()));const body=el('div','','delivery-dialog-body');d.append(header,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return {d,body}}

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
  let loading=false
  const query=button('查询',()=>apply())
  const clear=button('重置',()=>{status.value='';start.input.value='';end.input.value='';apply()})
  filters.append(start.wrap,end.wrap,status,query,clear);root.append(filters,message,count,panel)
  function apply(){
    if(start.input.value&&end.input.value&&start.input.value>end.input.value){message.textContent='开始日期不能晚于结束日期';return}
    Object.assign(view,{page:1,status:status.value,startDate:start.input.value,endDate:end.input.value});load().catch(report)
  }
  status.addEventListener('change',apply)
  function report(error){if(!error.authentication)message.textContent=error.message||String(error)}
  async function reject(row){
    const {d,body}=dialog(`拒绝申请 #${row.id}`)
    body.append(el('p',`${row.applicant_name} · ${row.company_name} · ${row.mac_address}`),el('p',`说明邮件将发送至：${row.email}`),el('p','拒绝理由会原文发送给客户。提交后停止此申请的 License 发放，说明邮件进入每晚 22:00 队列。','delivery-warning'))
    const form=el('form','','license-reject-form');const label=el('label','拒绝理由');const reason=document.createElement('textarea');reason.required=true;reason.maxLength=2000;reason.rows=5;reason.setAttribute('aria-label','拒绝理由');reason.placeholder='请填写清晰、适合向客户说明的拒绝原因';label.append(reason)
    const error=el('p','','delivery-message');error.setAttribute('role','alert');const submit=el('button','确认拒绝并安排邮件','export-button');submit.type='submit';form.append(label,error,submit);body.append(form)
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!reason.value.trim()){error.textContent='请填写拒绝理由';return}submit.disabled=true
      try{await request(`/licenses/${row.id}/status`,{method:'POST',body:JSON.stringify({status:3,reason:reason.value.trim(),expectedStatus:Number(row.status)})});d.close();message.textContent='已拒绝，说明邮件已加入夜间发送队列。';await load()}catch(err){error.textContent=err.message}finally{submit.disabled=false}
    })
  }
  async function showRejection(row){
    const {d,body}=dialog(`拒绝记录 · 申请 #${row.id}`);body.append(el('p','读取中…'))
    try{
      const data=await request(`/license-delivery/rejections/${row.id}`);if(!d.isConnected)return;body.replaceChildren()
      const record=data.record
      body.append(el('h3','拒绝理由'),el('p',record.reason,'rejection-reason'),el('p',`操作人：${record.requested_by} · ${time(record.created_at)}`),el('p',`收件人：${record.recipient}`),el('p',`邮件状态：${mailLabels[record.state]||record.state}`),el('p',record.detail))
      for(const mail of data.mails)body.append(el('p',`${mail.current_cycle?'本次拒绝邮件':'历史拒绝邮件'} · Message-ID：${mail.message_id}\n${time(mail.updated_at)} · ${mailLabels[mail.state]||mail.state}\n${mail.detail}`,'rejection-reason'))
      if(['failed','paused','unknown'].includes(record.state)){
        const note=document.createElement('textarea');note.setAttribute('aria-label','邮件核查说明');note.placeholder='填写核查依据或已修正信息的说明';note.rows=3
        const error=el('p','','delivery-message');error.setAttribute('role','alert');const group=el('div','','delivery-action-buttons')
        const act=async outcome=>{
          if(!note.value.trim()){error.textContent='请填写核查说明';return}
          group.querySelectorAll('button').forEach(b=>b.disabled=true)
          try{
            if(outcome==='retry')await request(`/license-delivery/rejections/${row.id}/retry`,{method:'POST',body:JSON.stringify({note:note.value})})
            else await request(`/license-delivery/notices/${data.mails[0].id}/resolve`,{method:'POST',body:JSON.stringify({outcome,note:note.value})})
            d.close();await load()
          }catch(err){error.textContent=err.message}finally{group.querySelectorAll('button').forEach(b=>b.disabled=false)}
        }
        if(record.state==='unknown'&&data.mails.length){body.append(el('p','先核查邮件服务日志，避免重复通知客户。','delivery-warning'));group.append(button('已核实发出',()=>act('accepted')),button('已核实未发出',()=>act('failed')))}
        else if(record.state!=='unknown')group.append(button('核对后重新排队',()=>act('retry')))
        body.append(note,group,error)
      }
    }catch(error){body.replaceChildren(el('p',error.message))}
  }
  async function notifyFae(row,target){
    target.disabled=true
    try{
      const workflow=await request(`/license-delivery/applications/${row.id}/workflow`)
      const current=workflow.application
      if(!workflow.faeEmail)throw new Error('请先配置 FAE 邮箱')
      if(!window.confirm(`立即通知 FAE？\n申请 #${current.id} · ${current.applicant_name}\n公司或学校：${current.company_name}\nFAE 收件邮箱：${workflow.faeEmail}\n\n平台邮箱将发送这一条申请。成功后转为“处理中”，早间汇总会跳过已通知的申请。`))return
      const result=await request(`/license-delivery/applications/${row.id}/workflow`,{method:'POST',body:JSON.stringify({action:'notify-fae',confirm:true,confirmedApplicationId:String(row.id),expectedEmail:current.email,expectedFaeEmail:workflow.faeEmail})})
      message.textContent=result.state==='accepted'?`申请 #${row.id} 已通知 FAE，状态已转为处理中。邮件服务器已接受，请核对收件箱。`:`申请 #${row.id}：${mailLabels[result.state]||result.state}。${result.detail||'请查看 FAE 通知记录。'}`
      await load()
    }catch(error){report(error)}finally{target.disabled=false}
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
    if(loading)return;loading=true;filters.querySelectorAll('input,select,button').forEach(item=>item.disabled=true)
    try{
      const data=await request(`/licenses?${new URLSearchParams({page:String(view.page),status:view.status,startDate:view.startDate,endDate:view.endDate})}`)
      if(!root.isConnected)return
      mode.hidden=Boolean(data.workflowEnabled&&data.sendingEnabled)
      mode.textContent=data.workflowEnabled?'当前为准备模式：定时发送未启用；状态和拒绝理由会保存，明确确认后可单条立即通知 FAE。':'工作流尚未配置：可查询申请，暂不能设置状态或安排拒绝通知。'
      count.textContent=`共 ${data.total} 条申请 · 按提交时间筛选${view.startDate||view.endDate?`：${view.startDate||'不限'} 至 ${view.endDate||'不限'}（含结束当天）`:''}`
      const table=el('table'),head=el('thead'),hr=el('tr');['申请编号','提交时间','申请人 / 公司','系统 / 版本','类型 / 年限','MAC 地址','联系方式','官网已提交','申请状态','文件 / 邮件','拒绝理由','操作'].forEach(h=>hr.append(el('th',h)));head.append(hr);const tbody=el('tbody');table.append(head,tbody)
      for(const row of data.records){
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
        if(data.workflowEnabled){
          if(Number(row.status)===0)operation.append(button('立即通知 FAE',event=>notifyFae(row,event.currentTarget),'feedback-detail-link'))
          operation.append(button('状态记录',()=>showHistory(row),'feedback-detail-link'))
          if(Number(row.status)===3&&row.rejection_reason)operation.append(button('拒绝详情 / 邮件',()=>showRejection(row),'feedback-detail-link'))
          else if(!['accepted','sending','unknown'].includes(row.delivery_state))operation.append(button(Number(row.status)===3?'补充拒绝理由':'拒绝申请',()=>reject(row),'license-reject-button'))
        }
        const delivery=Number(row.status)===3?(row.rejection_mail_state?`拒绝邮件：${mailLabels[row.rejection_mail_state]||row.rejection_mail_state}`:'历史记录：未保存理由及邮件'):deliveryLabels[row.delivery_state]||'未上传 / 未关联文件'
        const applicationId=el('span',`#${row.id}`,'license-application-id');applicationId.title='与邮件中的申请编号一致'
        addRow(tbody,[applicationId,time(row.dotime),`${row.applicant_name}\n${row.company_name}`,`${row.operating_system} / ${row.software_version}`,`${row.license_type} / ${row.duration_years}年`,row.mac_address,`${row.email||''}\n${row.phone||''}`,row.official_submitted==null?'未记录':Number(row.official_submitted)===1?'是':'否',state,delivery,row.rejection_reason?(Number(row.status)===3?row.rejection_reason:`历史拒绝：${row.rejection_reason}`):'—',operation])
      }
      if(!data.records.length){const row=el('tr'),cell=el('td','该时段及状态下暂无申请','empty');cell.colSpan=12;row.append(cell);tbody.append(row)}
      const wrap=el('div','','table-wrap');wrap.append(table);const pager=el('div','','pager');const pages=Math.max(1,Math.ceil(data.total/30))
      const previous=button('上一页',()=>{view.page--;load().catch(report)}),next=button('下一页',()=>{view.page++;load().catch(report)});previous.disabled=view.page<=1;next.disabled=view.page>=pages;pager.append(el('span',`${view.page} / ${pages}`),previous,next);panel.replaceChildren(wrap,pager)
    }finally{loading=false;filters.querySelectorAll('input,select,button').forEach(item=>item.disabled=false)}
  }
  await load().catch(report)
}
