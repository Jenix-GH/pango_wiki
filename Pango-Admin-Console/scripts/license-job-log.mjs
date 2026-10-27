import { randomUUID } from 'node:crypto'

export function beijingTimestamp(date=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
  }).formatToParts(date).map(part=>[part.type,part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} +08:00`
}

export function createJobLogger(mode,{write=line=>console.log(line),now=()=>new Date(),runId=randomUUID()}={}) {
  // Metadata only: never log message bodies, attachments, SMTP settings or passwords.
  const log=(event,data={})=>write(JSON.stringify({...data,time:beijingTimestamp(now()),timezone:'Asia/Shanghai',mode,event,runId}))
  const sender=send=>async message=>{
    const metadata={kind:message.mailKind,to:message.to,cc:message.cc||[],messageId:message.messageId}
    log('mail_start',metadata)
    try {
      const result=await send(message)
      const valid=['accepted','failed','unknown'].includes(result?.state)
      log('mail_result',{...metadata,state:valid?result.state:'unknown',detail:valid?String(result.detail||'').slice(0,500):'发送程序返回了无法识别的结果'})
      return result
    }catch(error){
      // The existing delivery layer handles this as unknown; do not change retry semantics.
      log('mail_result',{...metadata,state:'unknown',detail:'发送程序异常，结果需核查'})
      throw error
    }
  }
  return {log,sender}
}
