import test from 'node:test'
import JSZip from 'jszip'
import {applyMailTemplate} from '../licenseMailTemplates.mjs'
import assert from 'node:assert/strict'
import {macFromFilename,typeFromFilename,normalizeCc,normalizeMac,validEmail,decodeUpload,chinaTime,customerMessage,digestMessage,snapshot,matchFile,dateConditions,rejectionMessage} from '../licenseDelivery.mjs'

test('filename matching is anchored, hexadecimal and case insensitive',()=>{
  assert.equal(macFromFilename('new_pds_1a2b3c4d5f60.lic'),'1A2B3C4D5F60')
  assert.equal(macFromFilename('NEW_PDS_1A2B3C4D5F60.LIC'),'1A2B3C4D5F60')
  for(const name of ['new_pds_1a2b3c4d5f6z.lic','xnew_pds_1a2b3c4d5f60.lic','new_pds_1a2b3c4d5f60.lic.bak','../new_pds_1a2b3c4d5f60.lic']) assert.equal(macFromFilename(name),null)
  assert.equal(normalizeMac('1a-2b-3c-4d-5f-60'),'1A2B3C4D5F60')
  assert.equal(normalizeMac('1A:2B:3C:4D:5F:60'),'1A2B3C4D5F60')
  assert.equal(normalizeMac('nonsense1A2B3C4D5F60'),null)
})
test('uploads enforce count, decoded size, names, nonempty files and base64',async()=>{
  const f={name:'new_pds_1a2b3c4d5f60.lic',base64:Buffer.from('license').toString('base64')}
  assert.equal((await decodeUpload({files:[f]}))[0].content.toString(),'license')
  for(const files of [[],Array(51).fill(f),[{...f,name:'../a.lic'}],[{...f,base64:'!bad!'}],[{...f,base64:''}],[{...f,name:'x.exe'}],[{...f,base64:Buffer.alloc(1048577).toString('base64')}],Array(11).fill({...f,base64:Buffer.alloc(1048576).toString('base64')})])await assert.rejects(decodeUpload({files}))
})
test('zip uploads expand prefixed license names and ignore unrelated files',async()=>{
  const zip=new JSZip()
  zip.file('客户资料/西安宏泰时频-F4A80DA47D72-2026-10-26-new_pds_F4A80DA47D72.lic','standalone-license')
  zip.file('客户资料/new_pds_112233445566_floating.lic','server-license')
  zip.file('说明.txt','ignored')
  const archive=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
  const files=await decodeUpload({files:[{name:'license_20261026100112653053.zip',base64:archive.toString('base64')}]})
  assert.deepEqual(files.map(file=>[file.name,file.mac,file.content.toString()]),[
    ['new_pds_f4a80da47d72.lic','F4A80DA47D72','standalone-license'],
    ['new_pds_112233445566_floating.lic','112233445566','server-license'],
  ])

  const directBase64=Buffer.from('direct-license').toString('base64')
  const direct=await decodeUpload({files:[{name:'客户名称-2026-10-26-new_pds_AABBCCDDEEFF.lic',base64:directBase64}]})
  assert.equal(direct[0].name,'new_pds_aabbccddeeff.lic')
})
test('zip uploads reject unrelated, oversized and invalid archive contents',async()=>{
  const noLicense=new JSZip();noLicense.file('说明.txt','ignored')
  const unrelated=new JSZip();unrelated.file('客户资料/license.lic','not-a-license')
  const oversized=new JSZip();oversized.file('new_pds_AABBCCDDEEFF.lic',Buffer.alloc(1048577))
  for(const zip of [noLicense,unrelated,oversized]){
    const archive=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
    await assert.rejects(decodeUpload({files:[{name:'licenses.zip',base64:archive.toString('base64')}]}))
  }
  await assert.rejects(decodeUpload({files:[{name:'licenses.zip',base64:Buffer.from('not-a-zip').toString('base64')}]}))
})
test('single recipient validation rejects header injection and lists',()=>{
  assert.equal(validEmail('customer+license@example.com'),true)
  for(const email of ['a@example.com,b@example.com','a@example.com\r\nBcc: victim@example.com','Name <a@example.com>','missing@','a @example.com'])assert.equal(validEmail(email),false)
})
test('Beijing time is independent of server timezone',()=>{
  assert.deepEqual(chinaTime(new Date('2026-09-23T12:00:00Z')),{date:'2026-09-23',hour:20,minute:0})
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
test('FAE body and CSV include every application form field and distinguish missing official declaration',()=>{
  const row={id:'9007199254740993',dotime:'2026-09-28 11:00:00',applicant_name:'张三',company_name:'示例学校',operating_system:'Linux',software_version:'PDS2022.2',license_type:'SERVER',duration_years:3,mac_address:'AA-BB-CC-DD-EE-FF',email:'applicant@example.com',phone:'12345678901',address:'示例地址一号楼',official_submitted:1}
  for(const [official,label] of [[1,'是'],[0,'否'],[null,'未记录'],[undefined,'未记录']]){
    const message=digestMessage([{...row,official_submitted:official}],[],'2026-09-28','fae@example.com')
    const csv=Buffer.from(message.attachments[0].base64,'base64').toString()
    for(const [key,value] of Object.entries(row))if(key!=='official_submitted'){
      assert.ok(message.text.includes(String(value)),`body missing ${key}`);assert.ok(csv.includes(String(value)),`CSV missing ${key}`);assert.ok(message.html.includes(String(value)),`HTML missing ${key}`)
    }
    assert.ok(message.text.includes(`是否已在官网提交：${label}`));assert.ok(csv.includes('是否已在官网提交'));assert.ok(csv.includes(`"${label}"`));assert.ok(csv.includes('公司或学校'))
    assert.equal(message.to,'fae@example.com');assert.equal(message.attachments.length,1)
  }
})
test('FAE HTML tables escape application data and template text without interpreting user content',()=>{
  const row={id:1,applicant_name:'<img src=x onerror=alert(1)>',company_name:'A&B {{日期}}',address:'第一行\n第二行',official_submitted:0}
  const message=digestMessage([row,{...row,id:2}], [{original_name:'<script>bad</script>',reason:'<b>reason</b>'}],'2026-09-28','fae@example.com')
  assert.equal((message.html.match(/<table /g)||[]).length,1)
  assert.equal((message.html.match(/<th scope="col"/g)||[]).length,16)
  assert.equal((message.html.match(/<td /g)||[]).length,32)
  assert.ok(!message.html.includes('<img'));assert.ok(!message.html.includes('<script>'));assert.ok(message.html.includes('&lt;img'))
  assert.ok(message.html.includes('A&amp;B {{日期}}'));assert.ok(message.html.includes('第一行<br>第二行'))
  const custom=applyMailTemplate(message,'digest',{digest:{subject:'待办 {{日期}}',text:'<b>您好</b>\n{{原始正文}}\n谢谢 {{日期}}'}},'2026-09-28')
  assert.ok(custom.html.startsWith('&lt;b&gt;您好&lt;/b&gt;<br>'));assert.ok(custom.html.includes(message.html));assert.ok(custom.html.endsWith('谢谢 2026-09-28'))
  assert.equal(custom.text,'<b>您好</b>\n'+message.text+'\n谢谢 2026-09-28');assert.deepEqual(custom.attachments,message.attachments);assert.equal(custom.to,message.to)
})
test('unattended matching blocks changed snapshots and new ambiguous candidates',async()=>{
  const row={id:1,email:'customer@example.com',mac_address:'1A-2B-3C-4D-5F-60',license_type:'STANDALONE',status:0}
  const file={id:'file',original_name:'new_pds_1a2b3c4d5f60.lic',mac:'1A2B3C4D5F60',application_id:1,application_snapshot:snapshot(row)}
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

test('CC normalization is optional, deduplicates To and validates every address',()=>{
 assert.deepEqual(normalizeCc('  cc@example.com；CC@example.com, main@example.com\nsecond@example.com ','main@example.com'),['cc@example.com','second@example.com'])
 assert.deepEqual(normalizeCc(''),[])
 for(const cc of ['bad address','good@example.com\r\nBcc: victim@example.com',['valid@example.com\nBcc: victim@example.com'],['Name <test@example.com>'],[{}],Array.from({length:11},(_,i)=>`cc${i}@example.com`)])assert.throws(()=>normalizeCc(cc))
})


test('floating names are strict and types do not cross-match even with the same MAC',async()=>{
 const name='new_pds_c85309cb494b_floating.lic'
 assert.equal(macFromFilename(name),'C85309CB494B');assert.equal(typeFromFilename(name),'SERVER')
 assert.equal(typeFromFilename('NEW_PDS_C85309CB494B.LIC'),'STANDALONE')
 for(const bad of ['new_pds_c85309cb494b_floating.lic.exe','new_pds_c85309cb494b_floating2.lic','../'+name])assert.equal(typeFromFilename(bad),null)
 const file={id:'f',original_name:name,mac:'C85309CB494B'}
 const rows=[{id:1,license_type:'STANDALONE',mac_address:'C8-53-09-CB-49-4B',email:'single@example.com'},{id:2,license_type:'SERVER',mac_address:'c8:53:09:cb:49:4b',email:'server@example.com'}]
 const db={query:async sql=>sql.includes('dto_license_application')?[rows]:[[{id:'single-file',original_name:'new_pds_c85309cb494b.lic'}]]}
 assert.equal((await matchFile(db,file)).application.id,2)
 assert.equal((await matchFile(db,{...file,application_id:1,manual_selection:1},{resetSnapshot:true})).state,'unmatched')
})
test('new snapshot fields protect edits while historical null fields keep the same snapshot',()=>{
 const old={id:1,license_type:'SERVER'}
 assert.equal(snapshot(old),snapshot({...old,email_type:null,contact_person:null,max_users:null}))
 for(const extra of [{max_users:5},{contact_person:'负责人'},{email_type:'PERSONAL'}])assert.notEqual(snapshot(old),snapshot({...old,...extra}))
})
test('FAE HTML and CSV include email type contact name and requested server capacity',()=>{
 const message=digestMessage([{id:1,license_type:'SERVER',email_type:'PERSONAL',contact_person:'王工<script>',max_users:12}],[],'2026-10-14','fae@example.com')
 assert.match(message.text,/邮箱类型：个人邮箱/);assert.match(message.text,/最大支持人数：12/)
 const csv=Buffer.from(message.attachments[0].base64,'base64').toString();assert.ok(csv.includes('王工<script>'))
 assert.ok(message.html.includes('王工&lt;script&gt;'));assert.ok(!message.html.includes('王工<script>'))
 assert.ok(message.html.includes('最大支持人数'));assert.ok(csv.includes('FAE 或渠道负责人'))
})
