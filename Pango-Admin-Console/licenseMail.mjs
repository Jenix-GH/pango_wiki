import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { accessSync, constants, realpathSync } from 'node:fs'
import { validEmail } from './licenseDelivery.mjs'

export function assertMailConfiguration(config, { requireFae = true } = {}) {
  if (!validEmail(config.LICENSE_FAE_EMAIL)) throw new Error('LICENSE_FAE_EMAIL 必须填写实际 FAE 邮箱')
  const keys = requireFae && !config.LICENSE_FAE_SMTP ? ['LICENSE_MAIL_ENV', 'LICENSE_FAE_MAIL_ENV'] : ['LICENSE_MAIL_ENV']
  for (const key of keys) {
    if (!config[key] || !isAbsolute(config[key])) throw new Error(`${key} 必须指向对应邮箱配置文件的绝对路径`)
    try { accessSync(config[key], constants.R_OK) } catch { throw new Error(`${key} 文件不存在或当前运行账号不可读`) }
  }
  if (requireFae && !config.LICENSE_FAE_SMTP && realpathSync(config.LICENSE_MAIL_ENV) === realpathSync(config.LICENSE_FAE_MAIL_ENV)) {
    throw new Error('平台和 FAE 必须使用两份独立邮箱配置，不能指向同一文件')
  }
}

export function createWorkflowMailSender(config, { testRecipient, senderFactory = createMailSender } = {}) {
  if (!validEmail(config.LICENSE_FAE_EMAIL)) throw new Error('LICENSE_FAE_EMAIL 必须填写实际 FAE 邮箱')
  if (testRecipient !== undefined && !validEmail(testRecipient)) throw new Error('测试收件人必须是单个有效邮箱')
  const senders = new Map()
  return async message => {
    const platform = ['digest', 'summary'].includes(message.mailKind)
    const fae = ['customer', 'rejection'].includes(message.mailKind)
    if (!platform && !fae) return { state: 'failed', detail: '缺少有效邮件类型，未发送' }
    const expectedRecipient = testRecipient || (platform ? config.LICENSE_FAE_EMAIL : null)
    if (!validEmail(message.to) || (expectedRecipient && message.to.toLowerCase() !== expectedRecipient.toLowerCase())) {
      return { state: 'failed', detail: '收件人不符合邮件通道配置，未发送' }
    }
    const key = platform ? 'LICENSE_MAIL_ENV' : 'LICENSE_FAE_MAIL_ENV'
    const smtp=fae ? config.LICENSE_FAE_SMTP : undefined
    if (!smtp && (!config[key] || !isAbsolute(config[key]))) return { state: 'failed', detail: `${key} 未配置，未发送；不会切换到其他邮箱` }
    if (!senders.has(key)) senders.set(key, senderFactory({ ...config, LICENSE_MAIL_ENV: config[key], LICENSE_SMTP_SETTINGS:smtp }))
    return senders.get(key)({ ...message,
      expectedFrom: fae ? config.LICENSE_FAE_EMAIL : undefined,
      forbiddenFrom: platform ? config.LICENSE_FAE_EMAIL : undefined,
    })
  }
}

export function createMailSender(config) {
  if (!config.LICENSE_SMTP_SETTINGS && (!config.LICENSE_MAIL_ENV || !isAbsolute(config.LICENSE_MAIL_ENV))) throw new Error('LICENSE_MAIL_ENV 必须指向服务器现有邮箱 .env 的绝对路径')
  const script = fileURLToPath(new URL('./scripts/license-mail/send_mail.py',import.meta.url))
  return message => new Promise(resolve => {
    let output='',finished=false
    // Credentials must come from this channel's file, not inherited platform SMTP variables.
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(MAIL_|SMTP_|POP3_)/i.test(key)))
    const args=config.LICENSE_SMTP_SETTINGS ? [script] : [script,'--env',config.LICENSE_MAIL_ENV]
    const child=spawn(config.LICENSE_PYTHON || 'python3',args,{stdio:['pipe','pipe','pipe'],env})
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)}
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish({state:'unknown',detail:'邮件程序超时，请核查发送结果'})},180000)
    child.on('error',()=>finish({state:'failed',detail:'无法启动邮件程序，请检查 Python 配置'}))
    child.stdout.on('data',chunk=>{output+=chunk; if(output.length>16000){child.kill();finish({state:'unknown',detail:'邮件程序输出异常'})}})
    child.stderr.on('data',()=>{})
    child.on('close',()=>{try{finish(JSON.parse(output))}catch{finish({state:'unknown',detail:'邮件程序中断或返回无效结果'})}})
    child.stdin.on('error',()=>{})
    child.stdin.end(JSON.stringify({...message,smtpConfig:config.LICENSE_SMTP_SETTINGS}))
  })
}
