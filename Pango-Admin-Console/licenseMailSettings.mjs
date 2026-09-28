import { validateMailLogo } from './licenseMailLogo.mjs'
import { readFile, writeFile, rename, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto'
import { validEmail } from './licenseDelivery.mjs'
import { TEMPLATE_DEFAULTS, TEMPLATE_VARIABLES, validateTemplates } from './licenseMailTemplates.mjs'

function locations(configPath) { const dir=dirname(configPath);return {file:join(dir,'license-mail-settings.json'),key:join(dir,'.license-mail-settings.key')} }
async function readStored(configPath) {
  try { const data=JSON.parse(await readFile(locations(configPath).file,'utf8'));if(data.version!==1)throw new Error();return data }
  catch(error){if(error.code==='ENOENT')return {version:1,revision:'initial',templates:{}};throw new Error('邮件设置文件无法读取，请联系管理员检查文件及备份')}
}
async function getKey(configPath,create=false) {
  const path=locations(configPath).key
  if(create){try{const file=await open(path,'wx',0o600);try{await file.writeFile(randomBytes(32));await file.sync()}finally{await file.close()}}catch(error){if(error.code!=='EEXIST')throw error}}
  const key=await readFile(path)
  if(key.length!==32)throw new Error('邮件设置密钥无效，请联系管理员恢复原密钥')
  return key
}
function encrypt(password,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return {iv:iv.toString('base64'),value:Buffer.concat([cipher.update(password,'utf8'),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')}}
function decrypt(secret,key){try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(secret.iv,'base64'));decipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(secret.value,'base64')),decipher.final()]).toString('utf8')}catch{throw new Error('FAE 密码无法解密，请恢复邮件设置的配套密钥，或重新保存账号密码')}}
function cleanAccount(input) {
  const email=String(input.email||'').trim(),host=String(input.host||'').trim(),port=Number(input.port),security=String(input.security||'')
  if(!validEmail(email))throw new Error('请输入有效的 FAE 邮箱；该地址同时用于收取平台通知和给客户发信')
  if(!/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/.test(host))throw new Error('请输入正确的 SMTP 服务器地址，不包含协议或路径')
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SMTP 端口必须为 1–65535')
  if(!['ssl','starttls','none'].includes(security))throw new Error('请选择正确的 SMTP 加密方式')
  const username=String(input.username||'').trim(),displayName=String(input.displayName||'').trim()
  if(username.length>254||displayName.length>100||/[\r\n\x00]/.test(username+displayName))throw new Error('邮箱登录名或发件人名称无效')
  return {email,host,port,security,username,displayName}
}
export async function mailSettingsView(config,configPath) {
  const stored=await readStored(configPath)
  const {secret,...fae}=stored.fae||{email:config.LICENSE_FAE_EMAIL||'',host:'',port:587,security:'starttls',username:'',displayName:''}
  return {revision:stored.revision,logo:stored.logo?validateMailLogo(stored.logo):null,fae,passwordConfigured:Boolean(secret),savedAccount:Boolean(stored.fae),externalAccountConfigured:Boolean(config.LICENSE_FAE_MAIL_ENV),templates:Object.fromEntries(Object.entries(TEMPLATE_DEFAULTS).map(([key,value])=>[key,{...value,...stored.templates?.[key]}])),defaults:TEMPLATE_DEFAULTS,variables:TEMPLATE_VARIABLES,updatedAt:stored.updatedAt||null}
}
export async function saveMailSettings(config,configPath,body,actor) {
  const stored=await readStored(configPath)
  if(body.revision!==stored.revision)throw Object.assign(new Error('设置已被更新，请刷新后重新编辑'),{statusCode:409})
  const next={...stored,revision:randomUUID(),updatedAt:new Date().toISOString(),updatedBy:actor}
  if(body.fae!==undefined){
    const account=cleanAccount(body.fae)
    const password=body.fae.password
    if(typeof password!=='string'||password.length>2048||/[\r\n\x00]/.test(password))throw new Error('SMTP 密码格式无效')
    if(!password&&(!stored.fae?.secret||account.email.toLowerCase()!==stored.fae.email.toLowerCase()||account.username!==stored.fae.username||account.host!==stored.fae.host))throw new Error('首次设置或更换邮箱/服务器/登录名时，请重新填写 SMTP 密码或授权码')
    next.fae={...account,secret:password?encrypt(password,await getKey(configPath,true)):stored.fae.secret}
  }
  if(body.logo!==undefined)next.logo=validateMailLogo(body.logo)
  if(body.templates!==undefined)next.templates=validateTemplates(body.templates)
  const path=locations(configPath).file,temporary=path+'.'+randomUUID()+'.tmp'
  try{await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path)}finally{await rm(temporary,{force:true})}
  return mailSettingsView(config,configPath)
}
export async function applySavedMailSettings(config,configPath) {
  const stored=await readStored(configPath),result={...config,LICENSE_MAIL_LOGO:stored.logo?validateMailLogo(stored.logo):null,LICENSE_MAIL_TEMPLATES:stored.templates||{}}
  if(stored.fae){
    const account=cleanAccount(stored.fae)
    result.LICENSE_FAE_EMAIL=account.email;result.LICENSE_REPLY_TO=account.email
    result.LICENSE_FAE_SMTP={address:account.email,password:decrypt(stored.fae.secret,await getKey(configPath)),smtp_host:account.host,smtp_port:account.port,smtp_security:account.security,username:account.username,display_name:account.displayName}
  }
  return result
}
