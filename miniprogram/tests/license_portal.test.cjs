// Run after npm ci in Pango-Wiki-Frontend. No WeChat service or external network is used.
const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../../Pango-Wiki-Frontend/node_modules/typescript')

function page(name, stored = {}) {
  const calls = { requests: [], navigation: [], files: [], shares: [] }
  const timers = new Map(); let timerId=0
  let definition
  const storage = new Map(Object.entries(stored))
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key,value) => storage.set(key,value),
    navigateTo: options => calls.navigation.push(options.url),
    switchTab: options => calls.navigation.push(options.url),
    request: options => calls.requests.push(options),
    env: { USER_DATA_PATH: '/test' },
    getFileSystemManager: () => ({ unlink() {}, writeFile(options) { calls.files.push(options); options.success() } }),
    shareFileMessage: options => calls.shares.push(options),
  }
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages',name,`${name}.ts`),'utf8')
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  vm.runInNewContext(compiled,{exports:{},wx,console,setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),getApp:()=>({globalData:{baseHost:'https://test.invalid'}}),Page:value=>{definition=value}})
  const instance = {...definition,data:structuredClone(definition.data),setData(update) {
    for(const [key,value] of Object.entries(update)) {
      if(key.includes('.')) { const [parent,child]=key.split('.'); this.data[parent][child]=value }
      else this.data[key]=value
    }
  }}
  return { instance, calls, storage, timers }
}
const member = {userInfo:{id:42,nickName:'测试',userType:'MEMBER'},pangoAccessToken:'test-only'}

test('guest is sent to login without submitting, and completed fields remain',()=>{
  const {instance:p,calls}=page('license')
  p.onLoad(); p.onShow(); p.inputField({currentTarget:{dataset:{field:'softwareVersion'}},detail:{value:'PDS2022.2'}})
  p.submitApplication()
  assert.equal(calls.requests.length,0); assert.equal(calls.navigation[0],'/pages/license-login/license-login')
  assert.equal(p.data.form.softwareVersion,'PDS2022.2')
})
test('official-submitted yes remains submittable with marker and no client owner id',()=>{
  const {instance:p,calls}=page('license',member)
  p.onLoad(); p.onShow(); p.selectOfficial({detail:{value:'true'}})
  Object.assign(p.data.form,{softwareVersion:'PDS2022.2',macAddress:'AA-BB-CC-DD-EE-FF',applicantName:'测试',companyName:'公司',email:'user@example.com',phone:'13800000000',address:'地址'})
  p.submitApplication(); const request=calls.requests[0]
  assert.equal(request.data.officialSubmitted,true); assert.equal('userinfoId' in request.data,false)
  assert.equal(request.header.Authorization,'Bearer test-only')
  request.success({statusCode:401,data:{code:401}})
  assert.equal(p.data.form.softwareVersion,'PDS2022.2'); assert.equal(p.data.loggedIn,false)
})
test('personal center handles no records, four states and rejection reason',()=>{
  const {instance:p,calls}=page('my-licenses',member)
  p.onShow(); const req=calls.requests.pop()
  req.success({statusCode:200,data:{code:2000,data:{records:[],pageSize:20,total:0}}});req.complete()
  assert.equal(p.data.records.length,0); assert.equal(p.data.loading,false)
  p.refresh(); const next=calls.requests.pop()
  next.success({statusCode:200,data:{code:2000,data:{pageSize:20,total:4,records:[0,1,2,3].map(status=>({id:status+1,status,submittedAt:'2026-09-24T09:00:00+08:00',officialSubmitted:true,rejectionReason:status===3?'缺少信息':null}))}}})
  assert.equal(p.data.records.map(r=>r.statusLabel).join(','),'待处理,处理中,已处理,已拒绝')
  assert.equal(p.data.records[3].rejectionReason,'缺少信息'); assert.equal(p.data.records[0].dateLabel,'2026-09-24 09:00:00')
})
test('mail progress refreshes without file access and stops refreshing on hide',()=>{
  const {instance:p,calls,timers}=page('my-licenses',member);p.onShow()
  const reply=state=>({statusCode:200,data:{code:2000,data:{total:1,pageSize:20,records:[{id:1,submittedAt:'2026-10-27T09:00:00+08:00',status:2,mail:{state,label:state,note:'测试'}}]}}})
  const first=calls.requests.pop();first.success(reply('queued'));first.complete()
  assert.equal(p.data.records[0].mail.state,'queued');assert.equal(timers.size,1)
  Array.from(timers.values())[0]();const poll=calls.requests.pop()
  poll.success(reply('sent'));poll.complete()
  assert.equal(p.data.records[0].statusLabel,'已处理');assert.equal(p.data.records[0].mail.state,'sent')
  assert.equal(p.download,undefined);assert.equal(p.saveFile,undefined);assert.equal(calls.files.length,0)
  p.onHide();assert.equal(timers.size,0);p.onShow();const stale=calls.requests.pop();p.onUnload();stale.success(reply('failed'));stale.complete();assert.equal(timers.size,0)
})

test('returning from License login refreshes the existing personal-center menu, even for equal nicknames',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../miniprogram/components/left-menu/left-menu.ts'),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  let definition
  let refreshes=0
  let user={id:42,nickName:'微信用户',userType:'MEMBER'}
  const app={globalData:{licenseLoginChanged:false}}
  vm.runInNewContext(js,{exports:{},require:()=>({}),getApp:()=>app,Component:d=>{definition=d},wx:{getStorageSync:key=>key==='userInfo'?user:'test-only'}})
  const instance={data:structuredClone(definition.data),setData(update){Object.assign(this.data,update)},triggerEvent(name){if(name==='refresh')refreshes++}}
  definition.pageLifetimes.show.call(instance)
  assert.equal(refreshes,0, 'ordinary page show must not refresh chat')
  app.globalData.licenseLoginChanged=true
  definition.pageLifetimes.show.call(instance)
  assert.equal(instance.data.flagLogin,true);assert.equal(app.globalData.licenseLoginChanged,false)
  user={...user,id:43}
  app.globalData.licenseLoginChanged=true
  definition.pageLifetimes.show.call(instance)
  assert.equal(refreshes,2)
  definition.pageLifetimes.show.call(instance)
  assert.equal(refreshes,2, 'refresh marker is consumed once')
})


test('License login preserves the same account avatar but never copies it to another account',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/license-login/license-login.ts'),'utf8')
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  for(const id of [42,99]){
    let definition,request,saved
    const old={id:42,avatarUrl:'https://example.com/original-avatar.png'}
    const wx={getStorageSync:()=>old,setStorageSync(){},navigateBack(){},request:options=>{request=options}}
    vm.runInNewContext(compiled,{exports:{},require:()=>({persistUserInfo:user=>{saved=user}}),wx,getApp:()=>({globalData:{baseHost:'https://test.invalid'}}),Page:value=>{definition=value}})
    const instance={...definition,data:structuredClone(definition.data),setData(update){Object.assign(this.data,update)}}
    instance.login('test-code')
    request.success({statusCode:200,data:{code:2000,data:{id,accessToken:'test-token',userType:'MEMBER'}}})
    assert.equal(saved.avatarUrl,id===42?old.avatarUrl:undefined)
  }
})


test('personal email requires contact; server capacity is numeric and discarded for standalone',()=>{
 const {instance:p,calls}=page('license',member);p.onLoad();p.onShow()
 Object.assign(p.data.form,{softwareVersion:'test',macAddress:'AA-BB-CC-DD-EE-FF',applicantName:'测试',companyName:'公司',email:'user@example.com',phone:'13800000000',address:'地址'})
 p.selectEmailType({detail:{value:'PERSONAL'}});p.submitApplication();assert.equal(calls.requests.length,0);assert.match(p.data.error,/负责人/)
 p.data.form.contactPerson=' 王工 ';p.selectLicenseType({currentTarget:{dataset:{type:'SERVER'}}})
 for(const value of ['', '0','1.5','-1','2147483648']){p.data.form.maxUsers=value;p.submitApplication();assert.equal(calls.requests.length,0)}
 p.data.form.maxUsers='12';p.submitApplication();assert.equal(calls.requests[0].data.maxUsers,12);assert.equal(calls.requests[0].data.contactPerson,'王工')
 calls.requests[0].complete();p.selectLicenseType({currentTarget:{dataset:{type:'STANDALONE'}}});assert.equal(p.data.form.maxUsers,'')
 p.selectEmailType({detail:{value:'ORGANIZATION'}});p.data.form.contactPerson='';p.submitApplication();assert.equal(calls.requests[1].data.maxUsers,null)
})
test('registered member keeps server license details with email delivery only',()=>{
 const {instance:p,calls}=page('my-licenses',member);p.onShow()
 const req=calls.requests.pop();assert.equal(req.header.Authorization,'Bearer test-only');assert.ok(req.url.includes('/mine?'))
 req.success({statusCode:200,data:{code:2000,data:{total:1,pageSize:20,records:[{id:1,submittedAt:'2026-10-14T09:00:00+08:00',status:2,licenseType:'SERVER',emailType:'PERSONAL',contactPerson:'王工',maxUsers:12,mail:{state:'sent',label:'License 已发送至邮箱',note:'or***@example.org'}}]}}});req.complete()
 assert.equal(p.data.records[0].maxUsers,12);assert.equal(p.data.records[0].mail.label,'License 已发送至邮箱');p.onUnload()
})
