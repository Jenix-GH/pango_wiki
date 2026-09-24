import test from 'node:test'
import assert from 'node:assert/strict'
import {macFromFilename,normalizeMac,validEmail,decodeUpload,chinaTime,customerMessage,digestMessage,snapshot,matchFile,dateConditions,rejectionMessage} from '../licenseDelivery.mjs'

test('filename matching is anchored, hexadecimal and case insensitive',()=>{
  assert.equal(macFromFilename('new_pds_1a2b3c4d5f60.lic'),'1A2B3C4D5F60')
  assert.equal(macFromFilename('NEW_PDS_1A2B3C4D5F60.LIC'),'1A2B3C4D5F60')
  for(const name of ['new_pds_1a2b3c4d5f6z.lic','xnew_pds_1a2b3c4d5f60.lic','new_pds_1a2b3c4d5f60.lic.bak','../new_pds_1a2b3c4d5f60.lic']) assert.equal(macFromFilename(name),null)
  assert.equal(normalizeMac('1a-2b-3c-4d-5f-60'),'1A2B3C4D5F60')
  assert.equal(normalizeMac('1A:2B:3C:4D:5F:60'),'1A2B3C4D5F60')
  assert.equal(normalizeMac('nonsense1A2B3C4D5F60'),null)
})
test('uploads enforce count, decoded size, names, nonempty files and base64',()=>{
  const f={name:'new_pds_1a2b3c4d5f60.lic',base64:Buffer.from('license').toString('base64')}
  assert.equal(decodeUpload({files:[f]})[0].content.toString(),'license')
  for(const files of [[],Array(51).fill(f),[{...f,name:'../a.lic'}],[{...f,base64:'!bad!'}],[{...f,base64:''}],[{...f,name:'x.exe'}],[{...f,base64:Buffer.alloc(1048577).toString('base64')}],Array(11).fill({...f,base64:Buffer.alloc(1048576).toString('base64')})])assert.throws(()=>decodeUpload({files}))
})
test('single recipient validation rejects header injection and lists',()=>{
  assert.equal(validEmail('customer+license@example.com'),true)
  for(const email of ['a@example.com,b@example.com','a@example.com\r\nBcc: victim@example.com','Name <a@example.com>','missing@','a @example.com'])assert.equal(validEmail(email),false)
})
test('Beijing time is independent of server timezone',()=>{
  assert.deepEqual(chinaTime(new Date('2026-09-23T14:00:00Z')),{date:'2026-09-23',hour:22,minute:0})
  assert.equal(chinaTime(new Date('2026-09-23T01:00:00Z')).hour,9)
})
test('customer payload contains exactly the selected recipient and attachment',()=>{
  const row={id:12,email:'customer@example.com',applicant_name:'客户',mac_address:'1A-2B-3C-4D-5F-60'}
  const file={original_name:'new_pds_1a2b3c4d5f60.lic',content:Buffer.from('only-this-license')}
  const message=customerMessage(row,file,'fae@example.com')
  assert.equal(message.to,row.email);assert.equal(message.replyTo,'fae@example.com');assert.equal(message.attachments.length,1)
  assert.equal(Buffer.from(message.attachments[0].base64,'base64').toString(),'only-this-license')
  assert.notEqual(snapshot(row),snapshot({...row,email:'other@example.com'}))
})
test('FAE CSV neutralizes formula cells and preserves Unicode',()=>{
  const message=digestMessage([{id:1,company_name:'=HYPERLINK("bad")',applicant_name:'张三'}],[],'2026-09-23','fae@example.com')
  const csv=Buffer.from(message.attachments[0].base64,'base64').toString()
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('张三'))
})
test('unattended matching blocks changed snapshots and new ambiguous candidates',async()=>{
  const row={id:1,email:'customer@example.com',mac_address:'1A-2B-3C-4D-5F-60',status:0}
  const file={id:'file',mac:'1A2B3C4D5F60',application_id:1,application_snapshot:snapshot(row)}
  const db=rows=>({query:async sql=>sql.includes('FROM dto_license_application')?[rows]:[[]]})
  assert.equal((await matchFile(db([row]),file)).state,'queued')
  assert.equal((await matchFile(db([{...row,email:'new@example.com'}]),file)).state,'conflict')
  assert.equal((await matchFile(db([row,{...row,id:2}]),file)).state,'conflict')
  assert.equal((await matchFile(db([row,{...row,id:2}]),{...file,manual_selection:1})).state,'queued')
})

test('date range validates real calendar dates and retains end-date inclusion',()=>{
  const range=dateConditions(new URLSearchParams({startDate:'2026-09-01',endDate:'2026-09-23'}),'uploaded_at')
  assert.deepEqual(range.args,['2026-09-01 00:00:00','2026-09-23 00:00:00'])
  assert.ok(range.conditions[1].includes('INTERVAL 1 DAY'))
  for(const values of [{startDate:'2026-02-30'},{startDate:'2026-09-24',endDate:'2026-09-23'}])assert.throws(()=>dateConditions(new URLSearchParams(values),'uploaded_at'))
})
test('rejection email carries the full customer-facing reason and no license attachment',()=>{
  const message=rejectionMessage({id:5,email:'customer@example.com',applicant_name:'客户',mac_address:'AA-BB-CC-DD-EE-FF'},'资料不完整。\n请补充项目用途。','fae@example.com')
  assert.equal(message.to,'customer@example.com');assert.equal(message.replyTo,'fae@example.com')
  assert.ok(message.text.includes('资料不完整。\n请补充项目用途。'));assert.deepEqual(message.attachments,[])
})
