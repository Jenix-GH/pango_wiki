// Run after npm ci in Pango-Wiki-Frontend. No WeChat service or external network is used.
const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../../Pango-Wiki-Frontend/node_modules/typescript')

function page(name, stored = {}) {
  const calls = { requests: [], navigation: [], files: [], shares: [] }
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
  vm.runInNewContext(compiled,{exports:{},wx,console,getApp:()=>({globalData:{baseHost:'https://test.invalid'}}),Page:value=>{definition=value}})
  const instance = {...definition,data:structuredClone(definition.data),setData(update) {
    for(const [key,value] of Object.entries(update)) {
      if(key.includes('.')) { const [parent,child]=key.split('.'); this.data[parent][child]=value }
      else this.data[key]=value
    }
  }}
  return { instance, calls, storage }
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
test('download rejects JSON error bodies and only shares after explicit user action',()=>{
  const {instance:p,calls}=page('my-licenses',member)
  p.onShow(); p.data.records=[{id:1,canDownload:true,filename:'new_pds_AABBCCDDEEFF.lic'}]
  p.download({currentTarget:{dataset:{id:1}}});const bad=calls.requests.pop()
  bad.success({statusCode:200,header:{'Content-Type':'application/json'},data:new ArrayBuffer(20)});bad.complete()
  assert.equal(calls.files.length,0)
  p.download({currentTarget:{dataset:{id:1}}});const good=calls.requests.pop()
  good.success({statusCode:200,header:{'Content-Type':'application/octet-stream'},data:new ArrayBuffer(20)});good.complete()
  assert.equal(calls.files.length,1);assert.equal(calls.shares.length,0)
  p.saveFile();assert.equal(calls.shares[0].fileName,'new_pds_AABBCCDDEEFF.lic')
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
