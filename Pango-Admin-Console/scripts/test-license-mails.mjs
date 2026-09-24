#!/usr/bin/env node
// Standalone template/SMTP test. No database queries, worker jobs or configuration writes.
import { resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseOptions(args) {
  const options = { send: false }
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--send') { options.send = true; continue }
    if (!['--admin-dir', '--to', '--config', '--mail-env', '--fae-mail-env'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('用法：node test-license-mails.mjs --admin-dir 后台绝对路径 --to 测试邮箱 [--config 配置绝对路径] [--mail-env 平台邮箱配置绝对路径] [--fae-mail-env FAE邮箱配置绝对路径] [--send]')
    }
    if (options[key]) throw new Error(`参数重复：${key}`)
    options[key] = args[++index]
  }
  if (!options['--admin-dir'] || !isAbsolute(options['--admin-dir']) || !options['--to']) throw new Error('必须填写 --admin-dir 后台绝对路径和 --to 测试邮箱')
  for (const key of ['--config', '--mail-env', '--fae-mail-env']) if (options[key] && !isAbsolute(options[key])) throw new Error(`${key} 必须是绝对路径`)
  return options
}

export async function deliverSamples(messages, sender, report = console.log) {
  for (const message of messages) {
    report(`发送：${message.subject}\n收件人：${message.to}\nMessage-ID：${message.messageId}`)
    const result = await sender(message)
    report(`结果：${result.state}；${result.detail}`)
    if (result.state !== 'accepted') throw new Error('测试已停止，后续邮件未发送。请先核查此封邮件及上述 Message-ID，不要直接重复运行。')
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const root = resolve(options['--admin-dir'])
  const templates = await import(pathToFileURL(resolve(root, 'licenseDelivery.mjs')))
  if (!templates.validEmail(options['--to'])) throw new Error('请将 --to 替换为你自己的单个测试邮箱')
  const { readWorkerConfig } = await import(pathToFileURL(resolve(root, 'licenseConfig.mjs')))
  const configPath=options['--config'] || resolve(root, 'config/database.env')
  const { applySavedMailSettings }=await import(pathToFileURL(resolve(root,'licenseMailSettings.mjs')))
  const { sampleMail }=await import(pathToFileURL(resolve(root,'licenseMailPreview.mjs')))
  const config=await applySavedMailSettings(readWorkerConfig(['--config',configPath]),configPath)
  if (options['--mail-env']) config.LICENSE_MAIL_ENV = options['--mail-env']
  if (options['--fae-mail-env']) {config.LICENSE_FAE_MAIL_ENV = options['--fae-mail-env'];delete config.LICENSE_FAE_SMTP}
  const messages = ['digest','customer','rejection'].map(kind=>sampleMail(config,{kind,to:options['--to']}))
  for (const message of messages) {
    console.log(`\n通道：${message.mailKind === 'digest' ? '平台邮箱 → 测试邮箱' : 'FAE邮箱 → 测试邮箱'}\n${message.subject}\n收件人：${message.to}\n回复地址：${message.replyTo || '沿用实际发件人'}\n${message.text}\n附件：${message.attachments.map(item => item.name).join(', ') || '无'}`)
  }
  if (!options.send) {
    console.log('\n仅预览，没有连接 SMTP、发送邮件或访问数据库。核对收件人后加 --send 可真实发送这三封测试邮件。')
    return
  }
  const { createWorkflowMailSender, assertMailConfiguration } = await import(pathToFileURL(resolve(root, 'licenseMail.mjs')))
  if (!createWorkflowMailSender || !assertMailConfiguration) throw new Error('后台尚未更新为双邮箱版本，请先部署 v5.3 或对应 Git 提交，再测试。')
  assertMailConfiguration(config)
  await deliverSamples(messages, createWorkflowMailSender(config, { testRecipient: options['--to'] }))
  console.log('三封测试邮件均已被邮件服务接受，请检查收件箱及垃圾邮件。没有修改数据库、cron 或任何配置；正常收件需以邮箱实际收到为准。')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.code ? `测试失败（${error.code}），请核对后台路径、配置位置和依赖。` : error.message); process.exitCode = 1 })
}
