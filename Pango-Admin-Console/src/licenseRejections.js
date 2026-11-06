import { mailResultLabel } from '../licenseMailResult.mjs'
import { showQueuedMail } from './licenseQueuedMail.js'
import { ccEditor, recipientHistory } from './licenseCc.js'

export const rejectionLabels={queued:'待发送',sending:'发送中',accepted:'邮件服务已接受',failed:'发送失败',unknown:'结果待核查',paused:'已暂停',cancelled:'已取消'}
const mailLabels=rejectionLabels
const el=(tag,text='',className='')=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item}
const time=value=>value?String(value).replace('T',' ').slice(0,19):'—'
function button(text,action,className=''){const item=el('button',text,className);item.type='button';item.addEventListener('click',action);return item}
function dialog(title){const d=el('dialog','','delivery-dialog');const header=el('div','','delivery-dialog-header');header.append(el('h2',title),button('关闭',()=>d.close()));const body=el('div','','delivery-dialog-body');d.append(header,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return {d,body}}

export async function showRejection(row,request,{refresh=async()=>{},report=()=>{},allowSendNow=false}={}){
    const {d,body}=dialog(`拒绝记录 · 申请 #${row.id}`);body.append(el('p','读取中…'))
    try{
      const data=await request(`/license-delivery/rejections/${row.id}`);if(!d.isConnected)return;body.replaceChildren()
      const record=data.record
      body.append(el('h3','拒绝理由'),el('p',record.reason,'rejection-reason'),el('p',`操作人：${record.requested_by} · ${time(record.created_at)}`),el('p',`收件人：${record.recipient}`),el('p',`邮件状态：${mailResultLabel(record.state,record.detail,mailLabels)}`),el('p',record.detail))
      if(['queued','failed','paused','cancelled'].includes(record.state)){
        const editor=el('form','','license-reject-form');editor.hidden=true
        const label=el('label','修改拒绝理由'),reason=el('textarea')
        reason.value=record.reason;reason.required=true;reason.maxLength=2000;reason.rows=5;reason.setAttribute('aria-label','修改拒绝理由');label.append(reason)
        const feedback=el('p','','delivery-message');feedback.setAttribute('role','alert')
        const actions=el('div','','delivery-action-buttons'),save=el('button','保存拒绝理由','export-button');save.type='submit'
        const edit=button('修改拒绝理由',()=>{
          reason.value=record.reason;feedback.textContent='';editor.hidden=false;edit.hidden=true
          body.querySelectorAll('button').forEach(item=>{if(!editor.contains(item))item.disabled=true})
          reason.focus()
        })
        actions.append(save,button('取消编辑',()=>{
          editor.hidden=true;edit.hidden=false;body.querySelectorAll('button').forEach(item=>item.disabled=false)
        }))
        editor.append(label,el('p','保存后同步更新本封邮件中的拒绝理由，并保留其他自定义内容及当前队列状态。','license-mail-help'),actions,feedback)
        editor.addEventListener('submit',async event=>{
          event.preventDefault();if(!reason.value.trim()){feedback.textContent='请填写拒绝理由';return}
          editor.querySelectorAll('button').forEach(item=>item.disabled=true)
          try{
            await request(`/license-delivery/rejections/${row.id}/reason`,{method:'POST',body:JSON.stringify({reason:reason.value,expectedUpdatedAt:record.updated_at})})
            report(`申请 #${row.id} 的拒绝理由已保存，邮件正文已同步更新。`)
            d.close();await refresh();await showRejection(row,request,{refresh,report,allowSendNow})
          }catch(error){if(!error.authentication)feedback.textContent=error.message}
          finally{editor.querySelectorAll('button').forEach(item=>item.disabled=false)}
        })
        body.append(edit,editor)
      }
      body.append(ccEditor(record.cc,['queued','failed','paused'].includes(record.state),async cc=>{
        await request(`/license-delivery/rejections/${row.id}/cc`,{method:'POST',body:JSON.stringify({cc,expectedUpdatedAt:record.updated_at})})
        report(`申请 #${row.id} 的拒绝通知抄送设置已保存。`);d.close();await refresh();await showRejection(row,request,{refresh,report,allowSendNow})
      }),recipientHistory(data.mails))
      if(allowSendNow&&['queued','failed'].includes(record.state)&&Number(record.attempts)<3){
        const feedback=el('p','','delivery-message');feedback.setAttribute('role','status')
        const send=button('立即发送拒绝通知',async()=>{
          const controls=Array.from(body.querySelectorAll('button:not(:disabled)'))
          controls.forEach(item=>item.disabled=true)
          let submitted=false
          try{
            feedback.textContent='正在核对这封拒绝通知…'
            const preview=await request(`/license-delivery/rejections/${row.id}/mail-content`)
            if(!d.isConnected)return
            if(preview.stale)throw new Error('已保存的草稿与申请不一致，请先重新核对并保存')
            if(!window.confirm(`立即发送这封拒绝通知？\n\n申请 #${row.id}\n发件人：${preview.from}\n收件人：${preview.to}\n抄送：${preview.cc.join('、')||'无'}\n标题：${preview.subject}\n拒绝理由：${preview.rejectionReason}\n\n仅发送这条通知，成功后夜间不再重复发送。`)){feedback.textContent='已取消，未发送。';return}
            submitted=true;feedback.textContent='正在发送，请等待实际结果。'
            const result=await request(`/license-delivery/rejections/${row.id}/send-now`,{method:'POST',body:JSON.stringify({confirm:true,confirmedApplicationId:String(row.id),expectedVersion:preview.version,expectedFrom:preview.from,expectedUpdatedAt:record.updated_at})})
            report(`申请 #${row.id} · ${mailLabels[result.state]||result.state}：${result.detail||''}`);d.close();await refresh()
          }catch(error){if(!error.authentication)feedback.textContent=(error.message||'请求失败')+(submitted?'；如连接中断，请先核对邮件记录再操作。':'')}
          finally{controls.forEach(item=>item.disabled=false)}
        },'export-button')
        body.append(send,feedback)
      }
      if(['queued','failed','paused'].includes(record.state))body.append(button('邮件预览 / 编辑',()=>showQueuedMail('rejection',row.id,request)))
      for(const mail of data.mails)body.append(el('p',`${Number(mail.current_cycle)===1?'本次拒绝邮件':'历史拒绝邮件'} · Message-ID：${mail.message_id}\n${time(mail.updated_at)} · ${mailResultLabel(mail.state,mail.detail,mailLabels)}\n${mail.detail}`,'rejection-reason'))
      if(['queued','failed','paused'].includes(record.state)){
        const error=el('p','','delivery-message');error.setAttribute('role','alert')
        const cancel=button('屏蔽此拒绝通知',async()=>{
          if(!window.confirm(`屏蔽申请 #${row.id} 的拒绝通知？\n收件人：${record.recipient}\n\n这条拒绝邮件将不再自动发送；申请保持“已拒绝”，拒绝理由和历史记录保留。`))return
          body.querySelectorAll('button').forEach(b=>b.disabled=true)
          try{
            await request(`/license-delivery/rejections/${row.id}/cancel`,{method:'POST',body:JSON.stringify({confirm:true,expectedUpdatedAt:record.updated_at})})
            d.close();report(`申请 #${row.id} 的拒绝通知已屏蔽，不再自动发送；拒绝状态和理由保留。`);await refresh()
          }catch(err){if(!err.authentication)error.textContent=err.message}finally{body.querySelectorAll('button').forEach(b=>b.disabled=false)}
        },'license-reject-button')
        body.append(el('p','若这条通知无需发送，可单独屏蔽；不会更改其他申请。','delivery-warning'),cancel,error)
      }
      if(record.state==='cancelled'){
        const error=el('p','','delivery-message');error.setAttribute('role','alert')
        const restore=button('恢复此拒绝通知',async()=>{
          if(!window.confirm(`恢复申请 #${row.id} 的拒绝通知？\n收件人：${record.recipient}\n拒绝理由：${record.reason}\n\n确认后重新进入待发送队列。开启自动发送后，夜间任务会给客户发送这条拒绝说明。现在不会立即发信。`))return
          restore.disabled=true
          try{
            await request(`/license-delivery/rejections/${row.id}/restore`,{method:'POST',body:JSON.stringify({confirm:true,expectedUpdatedAt:record.updated_at})})
            d.close();report(`申请 #${row.id} 的拒绝通知已恢复为待发送，尚未发信；需要时仍可再次屏蔽。`);await refresh()
          }catch(err){if(!err.authentication)error.textContent=err.message}finally{restore.disabled=false}
        },'export-button')
        body.append(el('p','此拒绝通知已取消，不会进入自动发送队列。若之前误点屏蔽，可恢复后重新排队。','delivery-warning'),restore,error)
      }
      if(['failed','paused','unknown'].includes(record.state)){
        const note=document.createElement('textarea');note.setAttribute('aria-label','邮件核查说明');note.placeholder='填写核查依据或已修正信息的说明';note.rows=3
        const error=el('p','','delivery-message');error.setAttribute('role','alert');const group=el('div','','delivery-action-buttons')
        const act=async outcome=>{
          if(!note.value.trim()){error.textContent='请填写核查说明';return}
          group.querySelectorAll('button').forEach(b=>b.disabled=true)
          try{
            if(outcome==='retry')await request(`/license-delivery/rejections/${row.id}/retry`,{method:'POST',body:JSON.stringify({note:note.value})})
            else await request(`/license-delivery/notices/${data.mails[0].id}/resolve`,{method:'POST',body:JSON.stringify({outcome,note:note.value})})
            d.close();await refresh()
          }catch(err){error.textContent=err.message}finally{group.querySelectorAll('button').forEach(b=>b.disabled=false)}
        }
        if(record.state==='unknown'&&data.mails.length){body.append(el('p','先核查主收件人和全部抄送人的邮件服务日志，避免重复通知。','delivery-warning'));group.append(button('已核实发出',()=>act('accepted')),button('已核实未发出',()=>act('failed')))}
        else if(record.state!=='unknown')group.append(button('核对后重新排队',()=>act('retry')))
        body.append(note,group,error)
      }
    }catch(error){body.replaceChildren(el('p',error.message))}
  }
