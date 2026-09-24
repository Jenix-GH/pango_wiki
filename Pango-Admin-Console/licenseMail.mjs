import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'

export function createMailSender(config) {
  if (!config.LICENSE_MAIL_ENV || !isAbsolute(config.LICENSE_MAIL_ENV)) throw new Error('LICENSE_MAIL_ENV 必须指向服务器现有邮箱 .env 的绝对路径')
  const script = fileURLToPath(new URL('./scripts/license-mail/send_mail.py',import.meta.url))
  return message => new Promise(resolve => {
    let output='',finished=false
    const child=spawn(config.LICENSE_PYTHON || 'python3',[script,'--env',config.LICENSE_MAIL_ENV],{stdio:['pipe','pipe','pipe']})
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)}
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish({state:'unknown',detail:'邮件程序超时，请核查发送结果'})},180000)
    child.on('error',()=>finish({state:'failed',detail:'无法启动邮件程序，请检查 Python 配置'}))
    child.stdout.on('data',chunk=>{output+=chunk; if(output.length>16000){child.kill();finish({state:'unknown',detail:'邮件程序输出异常'})}})
    child.stderr.on('data',()=>{})
    child.on('close',()=>{try{finish(JSON.parse(output))}catch{finish({state:'unknown',detail:'邮件程序中断或返回无效结果'})}})
    child.stdin.on('error',()=>{})
    child.stdin.end(JSON.stringify(message))
  })
}
