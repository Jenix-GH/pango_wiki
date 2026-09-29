// Destructive only in a dedicated, explicitly opted-in local test database.
import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import {readFile} from 'node:fs/promises'
import {runApplicationStep,applicationWorkflow} from '../licenseDelivery.mjs'
import {createWorkflowMailSender} from '../licenseMail.mjs'
import {uploadFiles,setMailCc,fileAction,fileDetail,runNightly,runDigest,withDeliveryLock,rejectApplication,rejectionDetail,retryRejection,cancelRejection,restoreRejection,resolveWorkflowMail,listApplications,listFiles,listCustomerMail,setApplicationStatus,applicationStatusHistory} from '../licenseDelivery.mjs'
const night={faeEmail:'fae@example.com',replyTo:'fae@example.com',now:new Date('2026-09-23T12:00:00Z')}
const morning={...night,now:new Date('2026-09-23T01:00:00Z')}
const input=(content='license one',name='new_pds_1A2B3C4D5F60.lic')=>({name,base64:Buffer.from(content).toString('base64')})
test('MySQL delivery integration',{skip:process.env.LICENSE_MYSQL_TEST!=='1'},async t=>{
 const pool=mysql.createPool({host:'127.0.0.1',port:13316,user:'root',password:'local-test-only',database:'pango_license_test',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,connectionLimit:5})
 pool.on('connection',c=>c.query("SET time_zone='+08:00'"))
 try{
  assert.equal((await pool.query('SELECT DATABASE() name'))[0][0].name,'pango_license_test')
  await pool.query(`CREATE TABLE IF NOT EXISTS dto_license_application (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,userinfo_id BIGINT NULL,official_submitted TINYINT NULL,mac_address VARCHAR(50),email VARCHAR(254),applicant_name VARCHAR(100),company_name VARCHAR(200),operating_system VARCHAR(50),software_version VARCHAR(50),license_type VARCHAR(30),duration_years INT,status INT DEFAULT 0,dotime DATETIME DEFAULT CURRENT_TIMESTAMP,uptime DATETIME DEFAULT CURRENT_TIMESTAMP,phone VARCHAR(50),address VARCHAR(500)) ENGINE=InnoDB`)
  for (const name of ['20260923_license_delivery.sql','20260923_license_workflow.sql','20260924_license_manual_status.sql', '20260928_license_cc.sql']) {
    const migration=await readFile(new URL(`../database/${name}`,import.meta.url),'utf8')
    for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(sql)
  }
  const reset=async()=>{for(const table of ['dto_license_cc','dto_license_mail_recipients','dto_license_status_change','dto_license_rejection','dto_license_digest_item','dto_license_digest_batch','dto_license_delivery_audit','dto_license_mail','dto_license_file','dto_license_application'])await pool.query(`TRUNCATE TABLE ${table}`)}
  const application=async(id=1,mail='customer@example.com',mac='1a-2b-3c-4d-5f-60')=>pool.query("INSERT INTO dto_license_application(id,mac_address,email,applicant_name,company_name,operating_system,software_version,license_type,duration_years) VALUES(?,?,?,'测试客户','测试公司','Windows','test','STANDALONE',1)",[id,mac,mail])
  const upload=async(files=[input()])=>{const result=await uploadFiles(pool,{files},'tester');await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 19:00:00'");return result}
  const state=async id=>(await pool.query('SELECT state FROM dto_license_file WHERE id=?',[id]))[0][0].state
  let sent=[]
  const sender=async message=>{sent.push(message);return {state:'accepted',detail:'fake accepted'}}
  const customerCount=()=>sent.filter(m=>m.to!=='fae@example.com').length
  const manual=(action,extra={})=>runApplicationStep(pool,sender,{...night,now:new Date('2026-09-24T05:00:00Z'),applicationId:'1',action,expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com',actor:'tester',...extra})
  const cancelNotice=async(id=1,extra={})=>cancelRejection(pool,String(id),{confirm:true,expectedUpdatedAt:(await rejectionDetail(pool,id)).record.updated_at,...extra},'tester')
  const restoreNotice=async(id=1,extra={})=>restoreRejection(pool,String(id),{confirm:true,expectedUpdatedAt:(await rejectionDetail(pool,id)).record.updated_at,...extra},'tester')
  const setCc=async(kind,id,cc,extra={})=>setMailCc(pool,kind,id,{cc,expectedUpdatedAt:kind==='file'?(await fileDetail(pool,id)).file.updated_at:(await rejectionDetail(pool,id)).record.updated_at,...extra},'tester')
  await t.test('rejection queue lists current notifications, filters dates/state/search and only eligible waiting attempts',async()=>{
   await reset();sent=[]
   for(let id=1;id<=8;id++){await application(id,`customer${id}@example.com`);await rejectApplication(pool,id,'test reason','tester',0)}
   const states=['queued','failed','cancelled','accepted','paused','unknown','sending','failed']
   for(let i=0;i<states.length;i++)await pool.query("UPDATE dto_license_rejection SET state=?,attempts=?,created_at=? WHERE application_id=?",[states[i],i===7?3:0,i===0?'2026-09-28 23:59:59.999999':'2026-09-29 00:00:00',i+1])
   await setCc('rejection','1','copy@example.com')
   await application(9);await pool.query('UPDATE dto_license_application SET status=3 WHERE id=9')
   const all=await listCustomerMail(pool,new URLSearchParams());assert.equal(Number(all.total),8);assert.equal(all.summary.reduce((n,r)=>n+Number(r.count),0),8)
   assert.deepEqual(all.records.find(r=>String(r.application_id)==='1').cc,['copy@example.com']);assert.equal(all.records[0].application_snapshot,undefined)
   const waiting=await listCustomerMail(pool,new URLSearchParams({view:'waiting'}));assert.deepEqual(waiting.records.map(r=>String(r.application_id)).sort(),['1','2'])
   const day=await listCustomerMail(pool,new URLSearchParams({startDate:'2026-09-28',endDate:'2026-09-28'}));assert.equal(Number(day.total),1)
   for(const query of ['#1','customer1@example.com'])assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query}))).total),1)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query:'测试公司',state:'failed'}))).total),2)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query:"' OR 1=1 --"}))).total),0)
   await assert.rejects(listCustomerMail(pool,new URLSearchParams({state:'invalid'})),/状态不正确/)
   await assert.rejects(listCustomerMail(pool,new URLSearchParams({startDate:'2026-02-30'})),/日期格式/)
   assert.equal(sent.length,0)
  })
  await t.test('rejection queue pagination keeps equal timestamps stable and empty search has no side effects',async()=>{
   await reset()
   for(let id=1;id<=32;id++){await application(id);await rejectApplication(pool,id,'分页测试','tester',0)}
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-29 08:00:00'")
   const first=await listCustomerMail(pool,new URLSearchParams()),second=await listCustomerMail(pool,new URLSearchParams({page:'2'}))
   assert.equal(Number(first.total),32);assert.equal(first.records.length,30);assert.equal(second.records.length,2)
   assert.equal(String(first.records[0].application_id),'32');assert.equal(String(second.records[1].application_id),'1')
   assert.equal(new Set([...first.records,...second.records].map(r=>String(r.application_id))).size,32)
   const last=await listCustomerMail(pool,new URLSearchParams({page:'99'}));assert.equal(last.page,2);assert.equal(last.records.length,2)
   assert.deepEqual((await listCustomerMail(pool,new URLSearchParams({query:'absent'}))).summary,[])
  })
  await t.test('waiting License list excludes settled, paused and exhausted attempts and includes recipient',async()=>{
   await reset();await application();const file=(await upload()).records[0]
   const params=new URLSearchParams({view:'waiting'})
   assert.equal((await listCustomerMail(pool,params)).records[0].recipient,'customer@example.com')
   for(const state of ['accepted','cancelled','duplicate','paused','unknown','sending','unmatched','conflict']){
    await pool.query('UPDATE dto_license_file SET state=? WHERE id=?',[state,file.id]);assert.equal(Number((await listCustomerMail(pool,params)).total),0)
   }
   await pool.query("UPDATE dto_license_file SET state='failed',attempts=2 WHERE id=?",[file.id]);assert.equal(Number((await listCustomerMail(pool,params)).total),1)
   await pool.query('UPDATE dto_license_file SET attempts=3 WHERE id=?',[file.id]);assert.equal(Number((await listCustomerMail(pool,params)).total),0)
  })
  await t.test('unified customer queue mixes types before sorting and pagination, with consistent filters and CC',async()=>{
   await reset()
   for(let id=1;id<=16;id++){
    await application(id,`rejected${id}@example.com`);await rejectApplication(pool,id,'reason','tester',0)
    const mac=(100000+id).toString(16).padStart(12,'0')
    await application(1000+id,`license${id}@example.com`,mac)
    await upload([input(`license ${id}`,`new_pds_${mac}.lic`)])
   }
   await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-29 10:00:00'")
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-29 10:00:00'")
   const file=(await listFiles(pool,new URLSearchParams())).records.find(r=>String(r.application_id)==='1001')
   await setCc('file',file.id,'file-copy@example.com');await setCc('rejection','1','reason-copy@example.com')
   const params=new URLSearchParams({view:'waiting'}),first=await listCustomerMail(pool,params)
   params.set('page','2');const second=await listCustomerMail(pool,params)
   assert.equal(Number(first.total),32);assert.equal(first.records.length,30);assert.equal(second.records.length,2)
   assert.deepEqual([...new Set(first.records.map(r=>r.kind))],['file','rejection'])
   assert.equal(new Set([...first.records,...second.records].map(r=>`${r.kind}:${r.id}`)).size,32)
   assert.equal(first.summary.reduce((n,r)=>n+Number(r.count),0),32)
   const rows=[...first.records,...second.records]
   assert.deepEqual(rows.find(r=>r.id===file.id).cc,['file-copy@example.com']);assert.deepEqual(rows.find(r=>r.kind==='rejection'&&String(r.application_id)==='1').cc,['reason-copy@example.com'])
   for(const kind of ['file','rejection'])assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({kind,view:'waiting'}))).total),16)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query:'#1001'}))).total),1)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query:'license1@example.com'}))).total),1)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({query:'00:00:00:01:86:A1'}))).total),1)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({startDate:'2026-09-29',endDate:'2026-09-29'}))).total),32)
   assert.equal(Number((await listCustomerMail(pool,new URLSearchParams({startDate:'2026-09-30'}))).total),0)
   await assert.rejects(listCustomerMail(pool,new URLSearchParams({kind:'digest'})),/类型不正确/)
   await assert.rejects(listCustomerMail(pool,new URLSearchParams({view:'oops'})),/范围不正确/)
   assert.ok(rows.every(r=>r.content===undefined&&r.application_snapshot===undefined))
  })
  await t.test('CC remains per file, works for immediate and scheduled mail, and records exact recipients',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   const first=(await upload()).records[0],second=(await upload([input('other','new_pds_AABBCCDDEEFF.lic')])).records[0]
   await setCc('file',first.id,'cc1@example.com;cc2@example.com;customer@example.com;CC1@example.com')
   assert.deepEqual((await fileDetail(pool,first.id)).file.cc,['cc1@example.com','cc2@example.com'])
   assert.deepEqual((await listFiles(pool,new URLSearchParams())).records.find(r=>r.id===first.id).cc,['cc1@example.com','cc2@example.com'])
   await assert.rejects(manual('deliver-license',{expectedCc:[]}),/抄送邮箱已变化/)
   await manual('deliver-license',{expectedCc:['cc1@example.com','cc2@example.com']})
   assert.deepEqual(sent[0].cc,['cc1@example.com','cc2@example.com']);assert.equal(sent[0].to,'customer@example.com')
   assert.deepEqual((await fileDetail(pool,first.id)).mails[0].recipient_history[0].cc,sent[0].cc)
   await setCc('file',second.id,'other-copy@example.com');await runNightly(pool,sender,night)
   assert.deepEqual(sent.find(m=>m.to==='other@example.com').cc,['other-copy@example.com'])
   assert.equal(sent.filter(m=>m.to==='customer@example.com').length,1)
   await assert.rejects(setCc('file',first.id,''),/不能修改/)
  })
  await t.test('CC edits can clear pending copies, reject stale views and keep immutable attempt history',async()=>{
   await reset();sent=[];await application();const file=(await upload()).records[0]
   const old=(await fileDetail(pool,file.id)).file.updated_at
   await setCc('file',file.id,'first@example.com')
   await assert.rejects(setCc('file',file.id,'new@example.com',{expectedUpdatedAt:old}),/记录已变化/)
   await runNightly(pool,async()=>({state:'failed',detail:'all recipients rejected'}),night)
   await setCc('file',file.id,'');assert.deepEqual((await fileDetail(pool,file.id)).file.cc,[])
   await runNightly(pool,sender,night)
   const history=(await fileDetail(pool,file.id)).mails[0].recipient_history
   assert.deepEqual(history.map(r=>r.cc),[[],['first@example.com']]);assert.deepEqual(sent.find(m=>m.mailKind==='customer').cc,[])
  })
  await t.test('changed primary applicant pauses saved CC rather than sending to stale parties',async()=>{
   await reset();sent=[];await application();const file=(await upload()).records[0];await setCc('file',file.id,'copy@example.com')
   await pool.query("UPDATE dto_license_application SET email='changed@example.com' WHERE id=1")
   await fileAction(pool,file.id,{action:'match',note:'verified new primary recipient'},'tester')
   await runNightly(pool,sender,night);assert.equal(await state(file.id),'paused');assert.equal(customerCount(),0)
   await setCc('file',file.id,'');await fileAction(pool,file.id,{action:'match',note:'clear stale CC'},'tester')
   await runNightly(pool,sender,night);assert.equal(sent.filter(m=>m.to==='changed@example.com').length,1)
  })
  await t.test('partial CC delivery remains unknown and blocks recipient edits or automatic duplicates',async()=>{
   await reset();sent=[];await application();const file=(await upload()).records[0];await setCc('file',file.id,'copy@example.com')
   let calls=0;await runNightly(pool,async()=>{calls++;return {state:'unknown',detail:'partial delivery'}},night)
   const count=calls;await runNightly(pool,async()=>{calls++;return {state:'accepted'}},night)
   assert.equal(calls,count);assert.equal(await state(file.id),'unknown');await assert.rejects(setCc('file',file.id,''),/不能修改/)
  })
  await t.test('rejection CC is optional, persists through suppression/restore, and resets for a new cycle',async()=>{
   await reset();sent=[];await application();await rejectApplication(pool,1,'first reason','tester',0)
   await setCc('rejection','1','reviewer@example.com');assert.deepEqual((await rejectionDetail(pool,1)).record.cc,['reviewer@example.com'])
   await cancelNotice();await restoreNotice();await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
   await runNightly(pool,sender,night);assert.deepEqual(sent.find(m=>m.mailKind==='rejection').cc,['reviewer@example.com'])
   const prior=(await rejectionDetail(pool,1)).mails[0];assert.deepEqual(prior.cc,['reviewer@example.com'])
   await setApplicationStatus(pool,1,{status:0,expectedStatus:3},'tester');await rejectApplication(pool,1,'second reason','tester',0)
   assert.deepEqual((await rejectionDetail(pool,1)).record.cc,[]);assert.deepEqual((await rejectionDetail(pool,1)).mails[0].recipient_history[0].cc,['reviewer@example.com'])
  })
  await t.test('restore reverses only selected suppression without immediate mail, can cancel again, and later sends once',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   await rejectApplication(pool,1,'原拒绝理由','tester',0);await rejectApplication(pool,2,'其他理由','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
   const original=(await pool.query('SELECT * FROM dto_license_application WHERE id=1'))[0][0]
   await cancelNotice();await cancelNotice(2)
   assert.equal((await restoreNotice()).state,'queued');assert.equal((await restoreNotice()).state,'queued');assert.equal(sent.length,0)
   assert.deepEqual((await pool.query('SELECT * FROM dto_license_application WHERE id=1'))[0][0],original)
   assert.equal((await rejectionDetail(pool,1)).record.reason,'原拒绝理由');assert.equal((await rejectionDetail(pool,2)).record.state,'cancelled')
   assert.equal(Number((await pool.query("SELECT COUNT(*) total FROM dto_license_delivery_audit WHERE action='restore-rejection'"))[0][0].total),1)
   await cancelNotice();await runNightly(pool,sender,night);assert.equal(customerCount(),0)
   await restoreNotice();await runNightly(pool,sender,night);await runNightly(pool,sender,night)
   assert.equal(sent.filter(m=>m.to==='customer@example.com').length,1);assert.equal(sent.some(m=>m.to==='other@example.com'),false)
  })
  await t.test('restoring failed cancelled notice repairs current dedupe state and preserves accepted history',async()=>{
   await reset();sent=[];await application();await rejectApplication(pool,1,'第一次','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'");await runNightly(pool,sender,night)
   await setApplicationStatus(pool,1,{status:0,expectedStatus:3},'tester');await rejectApplication(pool,1,'第二次','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'");await runNightly(pool,async()=>({state:'failed'}),night)
   await cancelNotice();await restoreNotice();const before=await rejectionDetail(pool,1)
   assert.equal(before.record.attempts,0);assert.equal(before.mails.find(m=>Number(m.current_cycle)===1).state,'failed');assert.equal(before.mails.find(m=>Number(m.current_cycle)===0).state,'accepted')
   sent=[];await runNightly(pool,sender,night);assert.equal(customerCount(),1)
   assert.equal((await rejectionDetail(pool,1)).mails.length,2)
  })
  await t.test('restore requires confirmation, fresh unchanged application, safe current mail and idle worker',async()=>{
   await reset();await application();await rejectApplication(pool,1,'原因','tester',0);await cancelNotice()
   await assert.rejects(restoreNotice(1,{confirm:false}),/请确认/)
   await assert.rejects(restoreNotice(1,{expectedUpdatedAt:'stale'}),/已变化/)
   await assert.rejects(withDeliveryLock(pool,()=>restoreNotice()),/正在处理/)
   await pool.query("UPDATE dto_license_application SET email='changed@example.com' WHERE id=1")
   await assert.rejects(restoreNotice(),/信息或收件邮箱/)
   await pool.query("UPDATE dto_license_application SET email='customer@example.com' WHERE id=1")
   for(const state of ['accepted','sending','unknown']){
    await pool.query('UPDATE dto_license_rejection SET state=? WHERE application_id=1',[state]);await assert.rejects(restoreNotice(),/仅已取消/)
   }
   await pool.query("UPDATE dto_license_rejection SET state='queued',created_at='2026-09-23 19:00:00' WHERE application_id=1")
   await runNightly(pool,async()=>({state:'unknown'}),night)
   await pool.query("UPDATE dto_license_rejection SET state='cancelled' WHERE application_id=1")
   await assert.rejects(restoreNotice(),/结果待核查/)
  })
  await t.test('cancel one queued rejection preserves rejected application and reason, skips nightly, and leaves others sendable',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   await rejectApplication(pool,1,'历史记录，不再通知','tester',0);await rejectApplication(pool,2,'第二条原因','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
   const original=(await pool.query('SELECT * FROM dto_license_application WHERE id=1'))[0][0]
   assert.equal((await cancelNotice()).state,'cancelled');assert.equal((await cancelNotice()).state,'cancelled')
   assert.deepEqual((await pool.query('SELECT * FROM dto_license_application WHERE id=1'))[0][0],original)
   assert.equal((await rejectionDetail(pool,1)).record.reason,'历史记录，不再通知')
   assert.equal((await rejectionDetail(pool,2)).record.state,'queued')
   assert.equal((await rejectApplication(pool,1,'历史记录，不再通知','tester',3)).state,'cancelled')
   await assert.rejects(retryRejection(pool,1,'try','tester'),/仅明确失败/)
   await runNightly(pool,sender,night)
   assert.equal(sent.some(m=>m.to==='customer@example.com'),false);assert.equal(sent.filter(m=>m.to==='other@example.com').length,1)
   assert.equal(Number((await pool.query("SELECT COUNT(*) total FROM dto_license_delivery_audit WHERE action='cancel-rejection'"))[0][0].total),1)
  })
  await t.test('cancel failed rejection stops retry but preserves previously sent rejection cycle',async()=>{
   await reset();sent=[];await application();await rejectApplication(pool,1,'第一次理由','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'");await runNightly(pool,sender,night)
   await setApplicationStatus(pool,1,{status:0,expectedStatus:3},'tester');await rejectApplication(pool,1,'第二次理由','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'");await runNightly(pool,async()=>({state:'failed',detail:'fake failure'}),night)
   assert.equal((await rejectionDetail(pool,1)).record.state,'failed');await cancelNotice()
   const detail=await rejectionDetail(pool,1);assert.equal(detail.record.state,'cancelled');assert.equal(detail.mails.find(m=>Number(m.current_cycle)===1).state,'cancelled');assert.equal(detail.mails.find(m=>Number(m.current_cycle)===0).state,'accepted')
   sent=[];await runNightly(pool,sender,night);assert.equal(customerCount(),0)
  })
  await t.test('cancel rejects stale views, unconfirmed actions, uncertain/sent notices and concurrent worker',async()=>{
   await reset();await application();await rejectApplication(pool,1,'原因','tester',0)
   await assert.rejects(cancelNotice(1,{confirm:false}),/请确认/)
   await assert.rejects(cancelNotice(1,{expectedUpdatedAt:'stale'}),/已变化/)
   await assert.rejects(withDeliveryLock(pool,()=>cancelNotice()),/正在处理/)
   for(const state of ['accepted','sending','unknown']){
    await pool.query('UPDATE dto_license_rejection SET state=? WHERE application_id=1',[state]);await assert.rejects(cancelNotice(),/不能直接屏蔽/)
   }
   await pool.query("UPDATE dto_license_rejection SET state='paused' WHERE application_id=1")
   assert.equal((await cancelNotice()).state,'cancelled')
  })
  await t.test('cancel checks current mail uncertainty even if rejection state has become inconsistent',async()=>{
   await reset();await application();await rejectApplication(pool,1,'原因','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
   await runNightly(pool,async()=>({state:'unknown'}),night)
   await pool.query("UPDATE dto_license_rejection SET state='queued' WHERE application_id=1")
   await assert.rejects(cancelNotice(),/待核查记录/)
   assert.equal((await rejectionDetail(pool,1)).record.state,'queued')
  })
  await t.test('cancelled identical upload reuses original ID, preserves history and sends only once',async()=>{
   await reset();sent=[];await application();const first=(await upload()).records[0]
   await fileAction(pool,first.id,{action:'cancel',note:'重新核对'},'tester')
   const restored=await upload()
   assert.equal(restored.records[0].id,first.id);assert.equal(restored.records[0].state,'queued');assert.deepEqual(restored.reusedIds,[first.id])
   assert.equal(Number((await pool.query('SELECT COUNT(*) total FROM dto_license_file'))[0][0].total),1)
   const detail=await fileDetail(pool,first.id)
   assert.ok(detail.history.some(r=>r.action==='cancel'));assert.ok(detail.history.some(r=>r.action==='reuploaded'));assert.ok(detail.history.some(r=>r.action==='uploaded'))
   assert.equal((await manual('deliver-license',{expectedFileId:first.id})).state,'accepted')
   await runNightly(pool,sender,night);assert.equal(customerCount(),1)
  })
  await t.test('cancelled corrupt storage can be repaired from identical re-upload without creating another record',async()=>{
   await reset();sent=[];await application();const first=(await upload()).records[0]
   await pool.query("UPDATE dto_license_file SET content=?,byte_length=999 WHERE id=?",[Buffer.from('corrupt'),first.id])
   await runNightly(pool,sender,night);assert.equal(await state(first.id),'paused');assert.equal(customerCount(),0)
   await fileAction(pool,first.id,{action:'cancel'},'tester')
   const restored=(await upload()).records[0];assert.equal(restored.id,first.id);assert.equal(restored.state,'queued')
   assert.equal((await manual('deliver-license',{expectedFileId:first.id})).state,'accepted')
   assert.equal(Buffer.from(sent.find(m=>m.mailKind==='customer').attachments[0].base64,'base64').toString(),'license one')
   assert.equal(Number((await pool.query('SELECT COUNT(*) total FROM dto_license_file'))[0][0].total),1)
  })
  await t.test('reupload of a rejection-cancelled file requires an eligible application',async()=>{
   await reset();sent=[];await application();const first=(await upload()).records[0]
   await rejectApplication(pool,1,'资料待核对','tester',2)
   const blocked=await upload();assert.equal(blocked.records[0].id,first.id);assert.equal(blocked.records[0].state,'unmatched')
   assert.equal(Number((await pool.query('SELECT status FROM dto_license_application WHERE id=1'))[0][0].status),3)
   await assert.rejects(manual('deliver-license'),/已拒绝/)
   await reset();await application();const second=(await upload()).records[0]
   await rejectApplication(pool,1,'资料待核对','tester',2)
   await setApplicationStatus(pool,1,{status:0,expectedStatus:3},'tester')
   const restored=await upload();assert.equal(restored.records[0].id,second.id);assert.equal(restored.records[0].state,'queued')
  })
  await t.test('restoring cancelled file does not silently change recipient or bind another same-MAC application',async()=>{
   await reset();await application();const first=(await upload()).records[0]
   await fileAction(pool,first.id,{action:'cancel'},'tester')
   await pool.query("UPDATE dto_license_application SET email='changed@example.com' WHERE id=1")
   assert.equal((await upload()).records[0].state,'conflict')
   await fileAction(pool,first.id,{action:'cancel'},'tester')
   await pool.query('UPDATE dto_license_application SET status=3 WHERE id=1')
   await application(2,'other@example.com')
   const restored=(await upload()).records[0];assert.equal(restored.state,'unmatched');assert.equal(String(restored.application_id),'1')
  })
  await t.test('different content remains a separate file; repeat identical contents within batch has one active record',async()=>{
   await reset();await application();const first=(await upload()).records[0]
   await fileAction(pool,first.id,{action:'cancel'},'tester')
   const changed=(await upload([input('new license content')])).records[0]
   assert.notEqual(changed.id,first.id);assert.equal(await state(first.id),'cancelled')
   await reset();await application();const original=(await upload()).records[0]
   await fileAction(pool,original.id,{action:'cancel'},'tester')
   const repeated=await upload([input(),input()]);assert.equal(repeated.records.filter(r=>r.state==='queued').length,1);assert.equal(repeated.records.filter(r=>r.state==='duplicate').length,1)
  })
  await t.test('restore uses new upload cutoff and retains retry budget',async()=>{
   await reset();sent=[];await application();const first=(await upload()).records[0]
   await fileAction(pool,first.id,{action:'cancel'},'tester')
   await pool.query('UPDATE dto_license_file SET attempts=3 WHERE id=?',[first.id])
   const before=Date.now();await uploadFiles(pool,{files:[input()]},'tester')
   const [[row]]=await pool.query('SELECT uploaded_at,attempts FROM dto_license_file WHERE id=?',[first.id])
   assert.equal(row.attempts,3);assert.ok(new Date(row.uploaded_at.replace(' ','T')+'+08:00').getTime()>=before-1000)
   await assert.rejects(manual('deliver-license'),/重试超限/)
   await runNightly(pool,sender,night);assert.equal(customerCount(),0)
  })
  await t.test('logo follows customer, rejection, summary and digest paths; failed digest retains saved logo',async()=>{
   const logo={mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6QAAAABJRU5ErkJggg==',width:180}
   await reset();sent=[];await application();await upload();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF');await rejectApplication(pool,2,'test reason','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
   await runNightly(pool,sender,{...night,logo})
   assert.deepEqual(sent.map(m=>m.mailKind),['customer','rejection','summary'])
   assert.ok(sent.every(m=>m.html.includes('cid:pango-company-logo')&&m.inlineImages.length===1))
   await reset();sent=[];await application()
   await runApplicationStep(pool,async()=>({state:'failed'}),{...night,applicationId:'1',action:'notify-fae',expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com',logo})
   await runDigest(pool,sender,{...morning,logo:null})
   assert.ok(sent[0].html.includes('cid:pango-company-logo'));assert.equal(sent[0].inlineImages[0].base64,logo.base64)
   const [[batch]]=await pool.query('SELECT payload FROM dto_license_digest_batch');assert.equal(JSON.parse(batch.payload).inlineImages[0].base64,logo.base64)
  })
  await t.test('manual and morning FAE digest both persist complete application data including official declaration',async()=>{
   await reset();sent=[];await application();await application(2,'second@example.com','AA-BB-CC-DD-EE-FF')
   await pool.query("UPDATE dto_license_application SET phone='12345678901',address='完整地址',official_submitted=1 WHERE id=1")
   await pool.query("UPDATE dto_license_application SET phone='10987654321',address='另一地址',official_submitted=0 WHERE id=2")
   const templates={digest:{subject:'待办 {{日期}}',text:'请审批\n{{原始正文}}'}}
   await manual('notify-fae',{templates});await runDigest(pool,sender,{...morning,templates})
   for(const [i,label] of ['是','否'].entries()){
    assert.ok(sent[i].html.includes('<table '));assert.ok(sent[i].html.includes('是否已在官网提交'));assert.ok(sent[i].text.startsWith('请审批'));assert.ok(sent[i].text.includes(`是否已在官网提交：${label}`))
    assert.ok(sent[i].text.includes(i===0?'完整地址':'另一地址'));assert.ok(sent[i].text.includes(i===0?'12345678901':'10987654321'))
    assert.ok(Buffer.from(sent[i].attachments[0].base64,'base64').toString().includes('是否已在官网提交'))
   }
   const [batches]=await pool.query('SELECT payload FROM dto_license_digest_batch')
   assert.equal(batches.length,2);assert.ok(batches.every(b=>JSON.parse(b.payload).text.includes('是否已在官网提交')));assert.ok(batches.every(b=>JSON.parse(b.payload).html.includes('<table ')))
  })
  await t.test('immediate FAE sends only selected application and daily digest skips it even after status reset',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   assert.equal((await manual('notify-fae')).state,'accepted')
   assert.equal(sent.length,1);assert.equal(sent[0].mailKind,'digest');assert.equal(sent[0].to,'fae@example.com')
   assert.ok(sent[0].text.includes('#1'));assert.ok(!sent[0].text.includes('#2'))
   assert.deepEqual((await pool.query('SELECT status FROM dto_license_application ORDER BY id'))[0].map(r=>r.status),[1,0])
   assert.equal((await manual('notify-fae')).state,'skipped');assert.equal(sent.length,1)
   await pool.query('UPDATE dto_license_application SET status=0 WHERE id=1')
   assert.equal((await runDigest(pool,sender,{...morning,now:new Date('2026-09-25T01:00:00Z')})).count,1)
   assert.ok(sent[1].text.includes('#2'));assert.ok(!sent[1].text.includes('#1 |'))
  })
  await t.test('immediate FAE rejects stale recipient, processed applications and uncertain mail',async()=>{
   await reset();sent=[];await application()
   await assert.rejects(manual('notify-fae',{expectedFaeEmail:'wrong@example.com'}),/FAE 邮箱/)
   for(const status of [1,2,3]){
    await pool.query('UPDATE dto_license_application SET status=? WHERE id=1',[status])
    await assert.rejects(manual('notify-fae'),/仅待处理/)
   }
   await pool.query('UPDATE dto_license_application SET status=0 WHERE id=1')
   await runApplicationStep(pool,async()=>({state:'unknown'}),{...night,applicationId:'1',action:'notify-fae',expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com'})
   await assert.rejects(manual('notify-fae'),/需核查/);assert.equal(sent.length,0)
  })
  await t.test('manual FAE retries single saved payload but never resends a multi-application batch',async()=>{
   await reset();sent=[];await application()
   const failed=[]
   await runApplicationStep(pool,async message=>{failed.push(message);return {state:'failed'}},{...night,applicationId:'1',action:'notify-fae',expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com'})
   assert.equal((await manual('notify-fae')).state,'accepted')
   assert.equal(sent[0].messageId,failed[0].messageId);assert.equal(sent[0].text,failed[0].text)
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   await runDigest(pool,async()=>({state:'failed'}),morning)
   await assert.rejects(manual('notify-fae'),/多条申请/);assert.equal(sent.length,0)
  })
  await t.test('manual FAE blocks an existing delivery and limits failed retries',async()=>{
   await reset();sent=[];await application();await upload()
   await pool.query('UPDATE dto_license_application SET status=0 WHERE id=1')
   await assert.rejects(manual('notify-fae'),/已进入 License/)
   await reset();await application()
   for(let n=0;n<3;n++)await runApplicationStep(pool,async()=>({state:'failed'}),{...night,applicationId:'1',action:'notify-fae',expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com'})
   await assert.rejects(manual('notify-fae'),/上限/);assert.equal(sent.length,0)
  })
  await t.test('accepted FAE notifications are not repeated after a manual status reset',async()=>{
   await reset();sent=[];await application();await runDigest(pool,sender,morning)
   await pool.query('UPDATE dto_license_application SET status=0 WHERE id=1')
   await runDigest(pool,sender,{...morning,now:new Date('2026-09-24T01:00:00Z')})
   assert.equal(sent.length,1)
  })
  await t.test('immediate license step sends real file, bypasses time only for selected ID, and shares scheduled dedupe',async()=>{
   await reset();sent=[];await application();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   const first=await upload();const second=await upload([input('other license','new_pds_AABBCCDDEEFF.lic')])
   await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-24 23:59:00'")
   assert.equal((await manual('deliver-license')).state,'accepted')
   assert.equal(sent.length,1);assert.equal(sent[0].to,'customer@example.com');assert.equal(sent[0].mailKind,'customer')
   assert.equal(Buffer.from(sent[0].attachments[0].base64,'base64').toString(),'license one')
   assert.equal(await state(first.records[0].id),'accepted');assert.equal(await state(second.records[0].id),'queued')
   assert.equal((await manual('deliver-license')).state,'skipped');assert.equal(sent.length,1)
   await runNightly(pool,sender,{...night,now:new Date('2026-09-25T12:00:00Z')})
   assert.equal(sent.filter(m=>m.to==='customer@example.com').length,1)
   assert.equal((await applicationWorkflow(pool,'1','fae@example.com')).mails[0].state,'accepted')
  })
  await t.test('manual steps block stale recipients, rejected/paused files and unknown results without changing unrelated records',async()=>{
   await reset();sent=[];await application();const first=await upload()
   await assert.rejects(manual('deliver-license',{expectedEmail:'wrong@example.com'}),/邮箱已变化/)
   await assert.rejects(manual('deliver-license',{expectedFaeEmail:'wrong@example.com'}),/FAE 邮箱/)
   await fileAction(pool,first.records[0].id,{action:'pause'},'tester')
   await assert.rejects(manual('deliver-license'),/可发放状态/);assert.equal(sent.length,0)
   await fileAction(pool,first.records[0].id,{action:'match',note:'verified'},'tester')
   await runApplicationStep(pool,async()=>({state:'unknown',detail:'test uncertainty'}),{...night,applicationId:'1',action:'deliver-license',expectedEmail:'customer@example.com',expectedFaeEmail:'fae@example.com'})
   await assert.rejects(manual('deliver-license'),/需核查/);assert.equal(sent.length,0)
   await reset();await application();await rejectApplication(pool,1,'test rejection','tester',0)
   await assert.rejects(manual('deliver-license'),/已拒绝/)
  })
  await t.test('failed digest retries its saved customized content after templates change',async()=>{
   await reset();await application();const messages=[]
   const failed=async message=>{messages.push(message);return {state:'failed',detail:'test rejection'}}
   await runDigest(pool,failed,{...morning,templates:{digest:{subject:'旧标题 {{日期}}',text:'旧正文\n{{原始正文}}'}}})
   await runDigest(pool,failed,{...morning,templates:{digest:{subject:'新标题 {{日期}}',text:'新正文\n{{原始正文}}'}}})
   assert.equal(messages.length,2);assert.equal(messages[1].subject,messages[0].subject);assert.equal(messages[1].text,messages[0].text);assert.equal(messages[1].html,messages[0].html)
  })
  await t.test('database workflows tag digest/summary for platform and customer/rejection for FAE',async()=>{
   await reset();const delivered=[]
   const routed=createWorkflowMailSender({LICENSE_MAIL_ENV:'/platform.env',LICENSE_FAE_MAIL_ENV:'/fae.env',LICENSE_FAE_EMAIL:'fae@example.com'},{senderFactory:config=>async message=>{delivered.push({path:config.LICENSE_MAIL_ENV,...message});return {state:'accepted',detail:'fake SMTP'}}})
   await application();await upload();await application(2,'other@example.com','AA-BB-CC-DD-EE-FF')
   await rejectApplication(pool,2,'测试拒绝理由','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00'")
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
   await reset();sent=[];await application();const {records}=await upload();await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 20:01:00'")
   await runNightly(pool,sender,night);assert.equal(sent.length,0);await fileAction(pool,records[0].id,{action:'pause'},'tester')
   await runNightly(pool,sender,{...night,now:new Date('2026-09-24T12:00:00Z')});assert.equal(customerCount(),0)
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
  await t.test('20:00 cutoff includes only files/rejections ready at cutoff, with a bounded manual execution window',async()=>{
   await reset();sent=[];await application();await application(2,'late@example.com','AA-BB-CC-DD-EE-FF');await application(3,'reject@example.com','CC-BB-CC-DD-EE-FF');await application(4,'late-reject@example.com','DD-BB-CC-DD-EE-FF')
   const first=(await upload()).records[0],late=(await upload([input('late','new_pds_AABBCCDDEEFF.lic')])).records[0]
   await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 20:00:00.000000' WHERE id=?",[first.id]);await pool.query("UPDATE dto_license_file SET uploaded_at='2026-09-23 20:00:00.000001' WHERE id=?",[late.id])
   await rejectApplication(pool,3,'cutoff reason','tester',0);await rejectApplication(pool,4,'late reason','tester',0)
   await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 20:00:00.000000' WHERE application_id=3");await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 20:00:00.000001' WHERE application_id=4")
   for(const clock of ['11:59:59','13:00:00','14:00:00'])await assert.rejects(runNightly(pool,sender,{...night,now:new Date(`2026-09-23T${clock}Z`)}),/20:00/)
   assert.equal(sent.length,0);const result=await runNightly(pool,sender,night);assert.equal(result.cutoff,'2026-09-23 20:00:00.000000')
   assert.deepEqual(sent.filter(m=>m.to!=='fae@example.com').map(m=>m.to),['customer@example.com','reject@example.com'])
   await runNightly(pool,sender,{...night,now:new Date('2026-09-23T12:59:59Z')});assert.equal(customerCount(),2)
   await runNightly(pool,sender,{...night,now:new Date('2026-09-24T12:00:00Z')});assert.equal(sent.filter(m=>m.to==='late@example.com').length,1);assert.equal(sent.filter(m=>m.to==='late-reject@example.com').length,1)
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
    await pool.query("UPDATE dto_license_rejection SET created_at='2026-09-23 19:00:00' WHERE application_id=?",[id])
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
