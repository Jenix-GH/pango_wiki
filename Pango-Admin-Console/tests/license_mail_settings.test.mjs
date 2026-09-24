import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mailSettingsView, saveMailSettings, applySavedMailSettings } from '../licenseMailSettings.mjs'
import { applyMailTemplate, validateTemplates, TEMPLATE_DEFAULTS } from '../licenseMailTemplates.mjs'
import { sampleMail, publicMailPreview } from '../licenseMailPreview.mjs'

test('saved FAE account is encrypted, redacted, preserves password and rejects stale/cross-account saves',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pango-settings-')),path=join(dir,'database.env')
 const base={LICENSE_FAE_EMAIL:'old@example.com',LICENSE_MAIL_ENV:'/platform.env'}
 try{
  const initial=await mailSettingsView(base,path)
  const account={email:'fae@example.com',password:'test-only-private-password',host:'smtp.example.com',port:587,security:'starttls',username:'',displayName:'FAE'}
  const saved=await saveMailSettings(base,path,{revision:initial.revision,fae:account},'admin')
  assert.equal(saved.fae.email,'fae@example.com');assert.equal(saved.passwordConfigured,true)
  assert.ok(!JSON.stringify(saved).includes(account.password));assert.ok(!JSON.stringify(saved).includes('secret'))
  const raw=await readFile(join(dir,'license-mail-settings.json'),'utf8')
  assert.ok(!raw.includes(account.password))
  if(process.platform!=='win32'){assert.equal((await stat(join(dir,'license-mail-settings.json'))).mode&0o777,0o600);assert.equal((await stat(join(dir,'.license-mail-settings.key'))).mode&0o777,0o600)}
  const effective=await applySavedMailSettings(base,path)
  assert.equal(effective.LICENSE_FAE_EMAIL,'fae@example.com');assert.equal(effective.LICENSE_FAE_SMTP.address,'fae@example.com');assert.equal(effective.LICENSE_FAE_SMTP.password,account.password)
  assert.equal(effective.LICENSE_MAIL_ENV,'/platform.env')
  await assert.rejects(saveMailSettings(base,path,{revision:initial.revision,fae:account},'admin'),/刷新/)
  await assert.rejects(saveMailSettings(base,path,{revision:saved.revision,fae:{...account,email:'another@example.com',password:''}},'admin'),/重新填写/)
  const updated=await saveMailSettings(base,path,{revision:saved.revision,fae:{...account,password:''}},'admin')
  assert.equal((await applySavedMailSettings(base,path)).LICENSE_FAE_SMTP.password,account.password)
  const templates=await saveMailSettings(base,path,{revision:updated.revision,templates:{customer:{subject:'给 {{申请人}}',text:'申请 #{{申请编号}} 已处理'}}},'admin')
  assert.equal(templates.passwordConfigured,true)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('templates render literal data, preserve recipients/attachments and reject missing critical variables',()=>{
 assert.throws(()=>validateTemplates({customer:{subject:'bad\nBcc: attacker',text:'body'}}),/换行/)
 assert.throws(()=>validateTemplates({rejection:{subject:'拒绝',text:'没有原因'}}),/拒绝原因/)
 assert.throws(()=>validateTemplates({digest:{subject:'汇总',text:'缺少列表'}}),/原始正文/)
 assert.throws(()=>validateTemplates({customer:{subject:'{{不存在}}',text:'body'}}),/不支持/)
 const message={to:'client@example.com',subject:'old',text:'old text',attachments:[{name:'actual.lic',base64:'YWJj'}],variables:{申请人:'甲\n乙',申请编号:'42'}}
 const result=applyMailTemplate(message,'customer',{customer:{subject:'给 {{申请人}}',text:'编号 {{申请编号}}'}})
 assert.equal(result.subject,'给 甲 乙');assert.equal(result.to,message.to);assert.equal(result.attachments,message.attachments)
})
test('test preview uses only synthetic records and draft templates; never includes SMTP password',()=>{
 const config={LICENSE_FAE_EMAIL:'fae@example.com',LICENSE_FAE_SMTP:{password:'never-render-this'},LICENSE_MAIL_TEMPLATES:{}}
 const sample=sampleMail(config,{kind:'customer',to:'tester@example.com',templates:{customer:{subject:'您好 {{申请人}}',text:'MAC {{MAC地址}}'}}})
 assert.match(sample.subject,/测试.*您好 测试申请人/);assert.equal(sample.to,'tester@example.com')
 assert.equal(Buffer.from(sample.attachments[0].base64,'base64').toString(),'TEST ONLY - NOT A VALID LICENSE\n')
 const preview=publicMailPreview(config,sample)
 assert.equal(preview.from,'fae@example.com');assert.ok(!JSON.stringify(preview).includes('never-render-this'))
 assert.ok(!JSON.stringify(preview).includes('base64'))
 assert.deepEqual(sampleMail(config,{kind:'rejection',templates:{rejection:TEMPLATE_DEFAULTS.rejection}}).attachments,[])
})
