// Destructive only in a dedicated, explicitly opted-in local test database.
import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import {readFile} from 'node:fs/promises'
import {createWorkflowMailSender} from '../licenseMail.mjs'
import {uploadFiles,fileAction,fileDetail,runNightly,runDigest,withDeliveryLock,rejectApplication,rejectionDetail,retryRejection,resolveWorkflowMail,listApplications,listFiles,setApplicationStatus,applicationStatusHistory} from '../licenseDelivery.mjs'
const night={faeEmail:'fae@example.com',replyTo:'fae@example.com',now:new Date('2026-09-23T14:00:00Z')}
const morning={...night,now:new Date('2026-09-23T01:00:00Z')}
const input=(content='license one',name='new_pds_1A2B3C4D5F60.lic')=>({name,base64:Buffer.from(content).toString('base64')})
test('MySQL delivery integration',{skip:process.env.LICENSE_MYSQL_TEST!=='1'},async t=>{
 const pool=mysql.createPool({host:'127.0.0.1',port:13316,user:'root',password:'local-test-only',database:'pango_license_test',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,connectionLimit:5})
 pool.on('connection',c=>c.query("SET time_zone='+08:00'"))
 try{
  assert.equal((await pool.query('SELECT DATABASE() name'))[0][0].name,'pango_license_test')
  await pool.query(`CREATE TABLE IF NOT EXISTS dto_license_application (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,userinfo_id BIGINT NULL,mac_address VARCHAR(50),email VARCHAR(254),applicant_name VARCHAR(100),company_name VARCHAR(200),operating_system VARCHAR(50),software_version VARCHAR(50),license_type VARCHAR(30),duration_years INT,status INT DEFAULT 0,dotime DATETIME DEFAULT CURRENT_TIMESTAMP,uptime DATETIME DEFAULT CURRENT_TIMESTAMP,phone VARCHAR(50),address VARCHAR(500)) ENGINE=InnoDB`)
  for (const name of ['20260923_license_delivery.sql','20260923_license_workflow.sql','20260924_license_manual_status.sql']) {
    const migration=await readFile(new URL(`../database/${name}`,import.meta.url),'utf8')
    for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(sql)
  }
  const reset=async()=>{for(const table of ['dto_license_status_change','dto_license_rejection','dto_license_digest_item','dto_license_digest_batch','dto_license_delivery_audit','dto_license_mail','dto_license_file','dto_license_application'])await pool.query(`TRUNCATE TABLE ${table}`)}
  const application=async(id=1,mail='customer@example.com',mac='1a-2b-3c-4d-5f-60')=>pool.query("INSERT INTO dto_license_application(id,mac_address,email,applicant_name,company_name,operating_system,software_version,license_type,duration_years) VALUES(?,?,?,'测试客户','测试公司','Windows','test','STANDALONE',1)",[id,mac,mail])
  const upload=async(files=[input()])=>{const result=await uploadFiles(pool,{files},'tester');await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 21:00:00'");return result}
  const state=async id=>(await pool.query('SELECT state FROM dto_license_file WHERE id=?',[id]))[0][0].state
  let sent=[]
  const sender=async message=>{sent.push(message);return {state:'accepted',detail:'fake accepted'}}
  const customerCount=()=>sent.filter(m=>m.to!=='fae@example.com').length
  await t.test('failed digest retries its saved customized content after templates change',async()=>{
   await reset();await application();const messages=[]
   const failed=async message=>{messages.push(message);return {state:'failed',detail:'test rejection'}}
   await runDigest(pool,failed,{...morning,templates:{digest:{subject:'旧标题 {{日期}}',text:'旧正文\n{{原始正文}}'}}})
   await runDigest(pool,failed,{...morning,templates:{digest:{subject:'新标题 {{日期}}',text:'新正文\n{{原始正文}}'}}})
   assert.equal(messages.length,2);assert.equal(messages[1].subject,messages[0].subject);assert.equal(messages[1].text,messages[0].text)
  })
  await t.test('database workflows tag digest/summary for platform and customer/rejection for FAE',async()=>{
   await reset();const delivered=[]
   const routed=createWorkflowMailSender({LICENSE_MAIL_ENV:'/platform.env',LICENSE_FAE_MAIL_ENV:'/fae.env',LICENSE_FAE_EMAIL:'fae@example.com'},{senderFactory:config=>async message=>{delivered.push({path:config.LICENSE_MAIL_ENV,...message});return {state:'accepted',detail:'fake SMTP'}}})
   await application();await upload();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   await rejectApplication(pool,2,'测试拒绝理由','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 21:00:00'")
   await runNightly(pool,routed,night)
   assert.deepEqual(delivered.map(m=>[m.mailKind,m.path]),[['customer','/fae.env'],['rejection','/fae.env'],['summary','/platform.env']])
   await reset();delivered.length=0;await application();await runDigest(pool,routed,morning)
   assert.deepEqual(delivered.map(m=>[m.mailKind,m.path]),[['digest','/platform.env']])
  })
  await t.test('unique match sends once; repeated run and duplicate upload do not resend',async()=>{
   await reset();sent=[];await application();const {records}=await upload();assert.equal(records[0].state,'queued')
   await runNightly(pool,sender,night);assert.equal(await state(records[0].id),'accepted');assert.equal(customerCount(),1)
   assert.equal(sent[0].to,'customer@example.com');assert.equal(Buffer.from(sent[0].attachments[0].base64,'base64').toString(),'license one')
   await runNightly(pool,sender,night);assert.equal(customerCount(),1);assert.equal((await upload()).records[0].state,'duplicate')
   assert.equal((await fileDetail(pool,records[0].id)).mails[0].state,'accepted')
  })
  await t.test('multiple applications require explicit selection',async()=>{
   await reset();sent=[];await application();await application(2,'second@example.com');const {records}=await upload();assert.equal(records[0].state,'conflict')
   await runNightly(pool,sender,night);assert.equal(customerCount(),0)
   await fileAction(pool,records[0].id,{action:'match',applicationId:2,note:'核对该文件对应第二条申请'},'tester');await runNightly(pool,sender,night)
   assert.equal(sent.filter(m=>m.to==='second@example.com').length,1)
  })
  await t.test('distinct files for one MAC conflict; cancel extra and recheck',async()=>{
   await reset();sent=[];await application();const {records}=await upload([input('one'),input('two')]);assert.ok(records.every(r=>r.state==='conflict'))
   await fileAction(pool,records[1].id,{action:'cancel'},'tester');await fileAction(pool,records[0].id,{action:'match',note:'核对文件'},'tester')
   await runNightly(pool,sender,night);assert.equal(customerCount(),1)
  })
  await t.test('new ambiguity after upload blocks auto match',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await application(2);await runNightly(pool,sender,night)
   assert.equal(await state(records[0].id),'conflict');assert.equal(customerCount(),0)
  })
  await t.test('changed recipient requires explicit recheck',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await pool.query("UPDATE dto_license_application SET email='changed@example.com' WHERE id=1")
   await runNightly(pool,sender,night);assert.equal(await state(records[0].id),'conflict');assert.equal(customerCount(),0)
   await fileAction(pool,records[0].id,{action:'match',note:'已核实新邮箱'},'tester');await runNightly(pool,sender,night);assert.equal(sent.filter(m=>m.to==='changed@example.com').length,1)
  })
  await t.test('bad filename, bad email and rejected application never dispatch',async()=>{
   await reset();sent=[];await application(1,'bad-email');const {records}=await upload([input(),input('bad','new_pds_1a2b3c4d5f6z.lic')]);assert.equal(records[0].state,'conflict');assert.equal(records[1].state,'unmatched')
   await pool.query('UPDATE dto_license_application SET status=3');await runNightly(pool,sender,night);assert.equal(customerCount(),0)
  })
  await t.test('ambiguous SMTP result never auto retries; can reconcile accepted',async()=>{
   await reset();sent=[];await application();const {records}=await upload()
   await runNightly(pool,async m=>{sent.push(m);return {state:'unknown'}},night);assert.equal(await state(records[0].id),'unknown')
   await runNightly(pool,sender,night);assert.equal(customerCount(),1)
   await assert.rejects(()=>fileAction(pool,records[0].id,{action:'match',note:'try'},'tester'))
   await fileAction(pool,records[0].id,{action:'resolve-accepted',note:'服务日志核实已接受'},'tester');assert.equal(await state(records[0].id),'accepted')
  })
  await t.test('confirmed non-delivery stays paused until explicit requeue',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await runNightly(pool,async()=>({state:'unknown'}),night)
   await fileAction(pool,records[0].id,{action:'resolve-failed',note:'邮件服务确认未发出'},'tester');assert.equal(await state(records[0].id),'paused')
   await fileAction(pool,records[0].id,{action:'match',note:'确认重试'},'tester');await runNightly(pool,sender,night);assert.equal(await state(records[0].id),'accepted')
   assert.ok((await fileDetail(pool,records[0].id)).history.some(r=>r.action==='resolve-failed'))
  })
  await t.test('crashed sending marker recovers to unknown',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await pool.query("UPDATE dto_license_file SET state='sending' WHERE id=?",[records[0].id])
   await runNightly(pool,sender,night);assert.equal(await state(records[0].id),'unknown');assert.equal(customerCount(),0)
  })
  await t.test('SMTP acceptance followed by database failure is recovered without duplicate mail',async()=>{
   await reset();sent=[];await application();const {records}=await upload()
   let failWrite=true
   const broken={getConnection:async()=>{
    const c=await pool.getConnection()
    return new Proxy(c,{get(target,key){
     if(key==='query')return async(sql,...args)=>{if(failWrite&&sql.startsWith('UPDATE dto_license_mail SET state=?,detail=')){failWrite=false;throw new Error('simulated persistence failure')}return target.query(sql,...args)}
     const value=target[key];return typeof value==='function'?value.bind(target):value
    }})
   }}
   await assert.rejects(()=>runNightly(broken,sender,night),/simulated persistence failure/)
   assert.equal(customerCount(),1);assert.equal(await state(records[0].id),'sending')
   await runNightly(pool,sender,night);assert.equal(customerCount(),1);assert.equal(await state(records[0].id),'unknown')
  })
  await t.test('explicit failures have maximum three automatic attempts',async()=>{
   await reset();sent=[];await application();const {records}=await upload();const fail=async m=>{sent.push(m);return {state:'failed',detail:'rejected'}}
   for(let i=0;i<4;i++)await runNightly(pool,fail,night);assert.equal(customerCount(),3);assert.equal(await state(records[0].id),'failed')
  })
  await t.test('late and paused files do not dispatch',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 22:01:00'")
   await runNightly(pool,sender,night);assert.equal(sent.length,0);await fileAction(pool,records[0].id,{action:'pause'},'tester')
   await runNightly(pool,sender,{...night,now:new Date('2026-09-24T14:00:00Z')});assert.equal(customerCount(),0)
  })
  await t.test('corrupted content pauses file',async()=>{
   await reset();sent=[];await application();const {records}=await upload();await pool.query("UPDATE dto_license_file SET content='tampered'");await runNightly(pool,sender,night)
   assert.equal(await state(records[0].id),'paused');assert.equal(customerCount(),0)
  })
  await t.test('morning digest excludes queued files and is deduped by date',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF');await upload()
   assert.equal((await runDigest(pool,sender,morning)).count,1);assert.ok(sent[0].text.includes('#2'));assert.ok(!sent[0].text.includes('#1 |'))
   await runDigest(pool,sender,morning);assert.equal(sent.length,1)
  })
  await t.test('empty digest and Beijing execution windows',async()=>{
   await reset();sent=[];assert.equal((await runDigest(pool,sender,morning)).state,'empty');assert.equal(sent.length,0)
   await assert.rejects(()=>runNightly(pool,sender,morning));await assert.rejects(()=>runDigest(pool,sender,night))
  })
  await t.test('another worker or upload cannot enter during job lock',async()=>{
   await reset();await application();await withDeliveryLock(pool,async()=>assert.rejects(()=>uploadFiles(pool,{files:[input()]},'tester'),e=>e.statusCode===409))
  })
  const applicationState=async id=>Number((await pool.query('SELECT status FROM dto_license_application WHERE id=?',[id]))[0][0].status)
  const reject=async(id,reason='缺少必要申请资料，请补充后重新申请。')=>{
    const result=await rejectApplication(pool,id,reason,'tester')
    await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 21:00:00' WHERE application_id=?",[id])
    return result
  }
  await t.test('business status advances only after successful FAE digest and valid upload',async()=>{
    await reset();sent=[];await application();assert.equal(await applicationState(1),0)
    await runDigest(pool,sender,morning);assert.equal(await applicationState(1),1)
    await upload();assert.equal(await applicationState(1),2)
    await runNightly(pool,sender,night);assert.equal(await applicationState(1),2)
  })
  await t.test('failed digest retry preserves original members, not new arrivals',async()=>{
    await reset();sent=[];await application()
    await runDigest(pool,async()=>({state:'failed'}),morning);assert.equal(await applicationState(1),0)
    await application(2,'new@example.com','AA-BB-CC-DD-EE-FF')
    await runDigest(pool,sender,{...morning,now:new Date('2026-09-24T01:00:00Z')})
    assert.equal(await applicationState(1),1);assert.equal(await applicationState(2),0)
    assert.ok(!sent[0].text.includes('#2 |'))
  })
  await t.test('unknown FAE result does not advance or automatically re-notify',async()=>{
    await reset();sent=[];await application()
    await runDigest(pool,async m=>{sent.push(m);return {state:'unknown'}},morning)
    assert.equal(await applicationState(1),0)
    await runDigest(pool,sender,{...morning,now:new Date('2026-09-24T01:00:00Z')});assert.equal(sent.length,1)
    const [[mail]]=await pool.query("SELECT id FROM dto_license_mail WHERE kind='digest'")
    await resolveWorkflowMail(pool,mail.id,{outcome:'accepted',note:'核查 FAE 服务日志确认收到'},'tester')
    assert.equal(await applicationState(1),1)
  })
  await t.test('FAE accepted but database write failed leaves status pending until reconciliation',async()=>{
    await reset();sent=[];await application();let failWrite=true
    const broken={getConnection:async()=>{const c=await pool.getConnection();return new Proxy(c,{get(target,key){
      if(key==='query')return async(sql,...args)=>{if(failWrite&&sql.startsWith('UPDATE dto_license_application SET status=1')){failWrite=false;throw new Error('commit simulation')}return target.query(sql,...args)}
      const value=target[key];return typeof value==='function'?value.bind(target):value
    }})}}
    await assert.rejects(()=>runDigest(broken,sender,morning),/commit simulation/)
    assert.equal(await applicationState(1),0);assert.equal(sent.length,1)
    await runDigest(pool,sender,morning);assert.equal(sent.length,1)
    const [[mail]]=await pool.query("SELECT id,state FROM dto_license_mail WHERE kind='digest'");assert.equal(mail.state,'unknown')
    await resolveWorkflowMail(pool,mail.id,{outcome:'accepted',note:'服务端确认接受'},'tester');assert.equal(await applicationState(1),1)
  })
  await t.test('conflicting uploads do not prematurely mark application processed',async()=>{
    await reset();await application();await upload([input('one'),input('two')]);assert.equal(await applicationState(1),0)
  })
  await t.test('rejection requires a reason and atomically cancels pending license dispatch',async()=>{
    await reset();sent=[];await application()
    for(const reason of ['', '   ', 'x'.repeat(2001), null])await assert.rejects(()=>rejectApplication(pool,1,reason,'tester'))
    assert.equal(await applicationState(1),0)
    const {records}=await upload();assert.equal(await applicationState(1),2)
    await reject(1);assert.equal(await applicationState(1),3);assert.equal(await state(records[0].id),'cancelled')
    await reject(1);await runNightly(pool,sender,night)
    const emails=sent.filter(m=>m.to==='customer@example.com');assert.equal(emails.length,1)
    assert.ok(emails[0].text.includes('缺少必要申请资料'));assert.equal(emails[0].attachments.length,0)
    await runNightly(pool,sender,night);assert.equal(customerCount(),1)
    assert.equal((await rejectionDetail(pool,1)).record.state,'accepted');assert.equal(await applicationState(1),3)
    await assert.rejects(()=>reject(1,'不同理由'),/已有拒绝记录/)
  })
  await t.test('already dispatched license cannot be rejected',async()=>{
    await reset();sent=[];await application();await upload();await runNightly(pool,sender,night)
    await assert.rejects(()=>reject(1),/不能再拒绝/)
  })
  await t.test('rejecting one candidate does not silently resolve a previous ambiguous upload',async()=>{
    await reset();sent=[];await application();await application(2,'second@example.com')
    const {records}=await upload();assert.equal(records[0].state,'conflict')
    await reject(1);await runNightly(pool,sender,night)
    assert.equal(await state(records[0].id),'conflict');assert.equal(sent.some(m=>m.to==='second@example.com'),false)
  })
  await t.test('rejected applicants never receive subsequently uploaded license files',async()=>{
    await reset();sent=[];await application();await reject(1);const {records}=await upload();assert.equal(records[0].state,'unmatched')
    await runNightly(pool,sender,night);assert.equal(customerCount(),1);assert.equal(sent.find(m=>m.to==='customer@example.com').attachments.length,0)
  })
  await t.test('rejection unknown result is recoverable without blind retries',async()=>{
    await reset();sent=[];await application();await reject(1)
    await runNightly(pool,async m=>{sent.push(m);return {state:'unknown'}},night);assert.equal((await rejectionDetail(pool,1)).record.state,'unknown')
    await runNightly(pool,sender,night);assert.equal(customerCount(),1)
    await assert.rejects(()=>retryRejection(pool,1,'retry','tester'))
    const {mails}=await rejectionDetail(pool,1)
    await resolveWorkflowMail(pool,mails[0].id,{outcome:'failed',note:'服务记录明确未发送'},'tester')
    await retryRejection(pool,1,'已核实，安排重试','tester');await runNightly(pool,sender,night)
    assert.equal((await rejectionDetail(pool,1)).record.state,'accepted');assert.equal(await applicationState(1),3)
  })
  await t.test('rejection accepted then database failure never causes automatic resend',async()=>{
    await reset();sent=[];await application();await reject(1);let failWrite=true
    const broken={getConnection:async()=>{const c=await pool.getConnection();return new Proxy(c,{get(target,key){
      if(key==='query')return async(sql,...args)=>{if(failWrite&&sql.startsWith('UPDATE dto_license_mail SET state=?,detail=')){failWrite=false;throw new Error('rejection commit simulation')}return target.query(sql,...args)}
      const value=target[key];return typeof value==='function'?value.bind(target):value
    }})}}
    await assert.rejects(()=>runNightly(broken,sender,night),/rejection commit simulation/)
    assert.equal(customerCount(),1);assert.equal((await rejectionDetail(pool,1)).record.state,'sending')
    await runNightly(pool,sender,night);assert.equal(customerCount(),1);assert.equal((await rejectionDetail(pool,1)).record.state,'unknown');assert.equal(await applicationState(1),3)
  })
  await t.test('rejection explicit failures are bounded and do not change rejected status',async()=>{
    await reset();sent=[];await application();await reject(1)
    for(let i=0;i<4;i++)await runNightly(pool,async m=>{sent.push(m);return {state:'failed'}},night)
    assert.equal(customerCount(),3);assert.equal(await applicationState(1),3)
    await retryRejection(pool,1,'SMTP 已修复','tester');await runNightly(pool,sender,night)
    assert.equal((await rejectionDetail(pool,1)).record.state,'accepted')
  })
  await t.test('combined application dates and four-status filters include end day only',async()=>{
    await reset();await application(1);await application(2);await application(3);await application(4)
    await pool.query("UPDATE dto_license_application SET dotime='2026-09-23 00:00:00',status=0 WHERE id=1")
    await pool.query("UPDATE dto_license_application SET dotime='2026-09-23 23:59:59',status=1 WHERE id=2")
    await pool.query("UPDATE dto_license_application SET dotime='2026-09-24 00:00:00',status=1 WHERE id=3")
    await pool.query("UPDATE dto_license_application SET dotime='2026-09-22 23:59:59',status=3 WHERE id=4")
    const params=new URLSearchParams({startDate:'2026-09-23',endDate:'2026-09-23'})
    assert.equal(Number((await listApplications(pool,params)).total),2)
    params.set('status','1');const result=await listApplications(pool,params);assert.equal(Number(result.total),1);assert.equal(String(result.records[0].id),'2')
    for(const status of ['0','1','2','3']){const result=await listApplications(pool,new URLSearchParams({status}));assert.ok(result.records.every(r=>String(r.status)===status))}
    await assert.rejects(()=>listApplications(pool,new URLSearchParams({status:'8'})))
    await assert.rejects(()=>listApplications(pool,new URLSearchParams({startDate:'2026-02-30'})))
    await assert.rejects(()=>listApplications(pool,new URLSearchParams({startDate:'2026-09-24',endDate:'2026-09-23'})))
  })
  await t.test('file upload date and state filters are combined',async()=>{
    await reset();await application();const {records}=await upload();const params=new URLSearchParams({startDate:'2026-09-23',endDate:'2026-09-23',state:'queued'})
    assert.equal(Number((await listFiles(pool,params)).total),1)
    params.set('state','unmatched');assert.equal(Number((await listFiles(pool,params)).total),0)
    params.set('state','queued');params.set('startDate','2026-09-24');params.set('endDate','2026-09-24');assert.equal(Number((await listFiles(pool,params)).total),0)
    assert.equal(await applicationState(1),2)
  })
  await t.test('manual status 0/1/2 is editable without inventing a file or mail',async()=>{
    await reset();sent=[];await application()
    await setApplicationStatus(pool,1,{status:1,expectedStatus:0},'fae')
    assert.equal(await applicationState(1),1)
    await setApplicationStatus(pool,1,{status:2,expectedStatus:1},'fae')
    assert.equal(await applicationState(1),2)
    await setApplicationStatus(pool,1,{status:0,expectedStatus:2},'fae')
    assert.equal(await applicationState(1),0)
    assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM dto_license_mail'))[0][0].n),0)
    assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM dto_license_file'))[0][0].n),0)
    const {records}=await applicationStatusHistory(pool,1)
    assert.equal(records.length,3);assert.deepEqual(records.map(r=>[r.previous_status,r.next_status]),[[2,0],[1,2],[0,1]])
    assert.ok(records.every(r=>r.actor==='fae'))
  })
  await t.test('stale manual changes and blank rejection reasons are rejected',async()=>{
    await reset();await application();await setApplicationStatus(pool,1,{status:1,expectedStatus:0},'fae')
    await assert.rejects(()=>setApplicationStatus(pool,1,{status:2,expectedStatus:0},'fae'),/状态已变化/)
    await assert.rejects(()=>setApplicationStatus(pool,1,{status:3,reason:' '},'fae'),/拒绝理由/)
    assert.equal(await applicationState(1),1)
  })
  await t.test('manual reopen cancels pending rejection then supports a fresh rejection cycle',async()=>{
    await reset();sent=[];await application();await reject(1,'第一轮理由')
    await setApplicationStatus(pool,1,{status:1,expectedStatus:3},'fae')
    assert.equal((await rejectionDetail(pool,1)).record.state,'cancelled')
    await runNightly(pool,sender,night);assert.equal(customerCount(),0)
    await reject(1,'第二轮理由');await runNightly(pool,sender,night)
    assert.equal(customerCount(),1);assert.ok(sent.find(m=>m.to==='customer@example.com').text.includes('第二轮理由'))
    const history=await applicationStatusHistory(pool,1)
    assert.ok(history.records.some(r=>r.rejection_snapshot?.reason==='第一轮理由'))
  })
  await t.test('already sent rejection stays in history after reopening and re-rejection',async()=>{
    await reset();sent=[];await application();await reject(1,'第一轮已发理由');await runNightly(pool,sender,night)
    await setApplicationStatus(pool,1,{status:0},'fae');await reject(1,'第二轮新理由');await runNightly(pool,sender,night)
    assert.equal(customerCount(),2)
    const {mails}=await rejectionDetail(pool,1)
    assert.equal(mails.length,2);assert.ok(mails.every(m=>m.state==='accepted'));assert.equal(Number(mails[0].current_cycle),1);assert.equal(Number(mails[1].current_cycle),0)
    await runNightly(pool,sender,night);assert.equal(customerCount(),2)
  })
  await t.test('uncertain email blocks manual reopening until reconciled',async()=>{
    await reset();await application();await reject(1);await runNightly(pool,async()=>({state:'unknown'}),night)
    await assert.rejects(()=>setApplicationStatus(pool,1,{status:1},'fae'),/待核查/)
    assert.equal(await applicationState(1),3)
  })
  await t.test('nightly revalidation does not overwrite a manual status correction',async()=>{
    await reset();sent=[];await application();await upload();assert.equal(await applicationState(1),2)
    await setApplicationStatus(pool,1,{status:1},'fae')
    await runNightly(pool,sender,night);assert.equal(customerCount(),1);assert.equal(await applicationState(1),1)
    await setApplicationStatus(pool,1,{status:0},'fae');await runNightly(pool,sender,night);assert.equal(customerCount(),1)
  })
  await reset()
 }finally{await pool.end()}
})
