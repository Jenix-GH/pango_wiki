import { readFile } from 'node:fs/promises'
import { readWorkerConfig, workerConfigPath, workerPool } from '../licenseConfig.mjs'
import { applySavedMailSettings } from '../licenseMailSettings.mjs'
import { runDigest, runNightly } from '../licenseDelivery.mjs'
import { assertMailConfiguration, createWorkflowMailSender } from '../licenseMail.mjs'

const mode=process.argv[2]
let pool
try {
  if(!['digest','nightly','migrate'].includes(mode))throw new Error('用法：node scripts/license-worker.mjs digest|nightly|migrate [--config 文件]')
  const base=readWorkerConfig()
  const config=mode==='migrate'?base:await applySavedMailSettings(base,workerConfigPath())
  if(mode!=='migrate'&&(config.LICENSE_DELIVERY_ENABLED!=='true'||config.LICENSE_SEND_ENABLED!=='true'))throw new Error('自动发放未启用：需要 LICENSE_DELIVERY_ENABLED=true 且 LICENSE_SEND_ENABLED=true')
  if(mode!=='migrate')assertMailConfiguration(config,{requireFae:mode==='nightly'})
  pool=workerPool(config)
  if(mode==='migrate'){
    for (const name of ['20260923_license_delivery.sql','20260923_license_workflow.sql','20260924_license_manual_status.sql']) {
      const sql=await readFile(new URL(`../database/${name}`,import.meta.url),'utf8')
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement)
    }
    console.log('License 发放表已创建；未发送邮件。')
  }else{
    const sender=createWorkflowMailSender(config)
    const options={faeEmail:config.LICENSE_FAE_EMAIL,replyTo:config.LICENSE_REPLY_TO||config.LICENSE_FAE_EMAIL,templates:config.LICENSE_MAIL_TEMPLATES,logo:config.LICENSE_MAIL_LOGO}
    const result=await (mode==='digest'?runDigest:runNightly)(pool,sender,options)
    console.log(JSON.stringify({mode,...result}))
    if(['failed','unknown'].includes(result.state)||['failed','unknown'].includes(result.summary?.state)||result.results?.some(item=>['failed','unknown'].includes(item.state)))process.exitCode=1
  }
}catch(error){
  console.error(error.code ? `License 任务失败：${error.code}；请检查数据库连接、迁移及权限。` : error.message)
  process.exitCode=1
}finally{if(pool)await pool.end()}
