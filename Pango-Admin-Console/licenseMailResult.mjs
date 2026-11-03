// Keep transport/retry states intact. The persisted detail distinguishes RCPT rejection.
export const refusalPrefix='收件地址被拒收：'
export const legacyRefusalDetails=['邮件服务明确拒绝：SMTPRecipientsRefused','所有收件人被邮件服务拒绝']
export function mailResultLabel(state,detail,labels){
  if(state==='failed'&&(String(detail??'').startsWith(refusalPrefix)||legacyRefusalDetails.includes(detail)))return '收件地址被拒收'
  return labels[state]||state
}
