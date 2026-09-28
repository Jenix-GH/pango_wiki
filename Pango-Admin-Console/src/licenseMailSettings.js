import DOMPurify from 'dompurify'

function el(tag,text='',className=''){const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item}
function field(label,type,value='',help=''){
  const wrap=el('label','','mail-field'),input=el('input');input.type=type;input.value=value;wrap.append(el('span',label),input)
  if(help)wrap.append(el('small',help));return {wrap,input}
}
function button(text,action){const item=el('button',text,'mail-button');item.type='button';item.addEventListener('click',action);return item}
function testId(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{const value=crypto.getRandomValues(new Uint8Array(1))[0]&15;return (char==='x'?value:(value&3)|8).toString(16)})}
export async function renderLicenseMailSettings(parent,request){
  const box=el('details','','panel mail-settings'),summary=el('summary','邮件设置与测试'),inner=el('div','','mail-settings-body')
  box.append(summary,inner);parent.append(box)
  const feedback=el('p','','delivery-message');feedback.setAttribute('role','status');inner.append(feedback)
  let view
  try{view=await request('/license-delivery/mail-settings')}catch(error){feedback.textContent=error.message;box.open=true;return}
  if(!box.isConnected)return
  box.open=!view.savedAccount
  const status=el('span',view.savedAccount?'FAE 邮箱已保存':'请设置 FAE 发信邮箱','mail-settings-status');summary.append(status)
  inner.append(el('p','平台邮箱 → FAE：待处理及发放结果汇总。FAE 邮箱 → 客户：License 和拒绝说明。','mail-intro'))
  const account=el('form','','mail-account-form');account.append(el('h3','FAE 邮箱'))
  const grid=el('div','','mail-account-grid')
  const fields={
    email:field('FAE 邮箱','email',view.fae.email,'同一个地址用于接收平台通知和给客户发邮件。'),
    password:field('SMTP 密码 / 授权码','password','',view.passwordConfigured?'已保存。留空保留原密码；已保存密码不回显。':'填写此 FAE 邮箱的 SMTP 密码或授权码。'),
    host:field('SMTP 服务器','text',view.fae.host,'填写邮箱管理员提供的服务器地址。'),
    port:field('SMTP 端口','number',view.fae.port),
    username:field('SMTP 登录名（可选）','text',view.fae.username,'留空时使用 FAE 邮箱地址。'),
    displayName:field('发件人名称（可选）','text',view.fae.displayName),
  }
  fields.email.input.required=true;fields.host.input.required=true;fields.port.input.required=true;fields.port.input.min='1';fields.port.input.max='65535'
  fields.password.input.autocomplete='new-password';fields.password.input.maxLength=2048
  const security=el('select');security.setAttribute('aria-label','SMTP 加密方式')
  for(const [value,label]of [['starttls','STARTTLS'],['ssl','SSL / TLS'],['none','无（仅按邮箱服务要求使用）']]){const option=el('option',label);option.value=value;security.append(option)}security.value=view.fae.security
  const securityLabel=el('label','','mail-field');securityLabel.append(el('span','SMTP 加密方式'),security)
  grid.append(fields.email.wrap,fields.password.wrap,fields.host.wrap,fields.port.wrap,securityLabel,fields.username.wrap,fields.displayName.wrap)
  account.append(grid)
  const saveAccount=el('button','保存 FAE 邮箱','mail-button primary');saveAccount.type='submit';account.append(saveAccount)
  if(view.externalAccountConfigured&&!view.savedAccount)account.append(el('p','当前可沿用服务器已有 FAE 邮箱配置。若在此接管设置，请完整填写 SMTP 信息及密码。','mail-hint'))
  inner.append(account)
  async function action(task){
    const controls=[...inner.querySelectorAll('button,input,select,textarea')];controls.forEach(control=>control.disabled=true)
    feedback.textContent='正在处理…'
    try{await task()}catch(error){if(!error.authentication)feedback.textContent=error.message||'操作失败，请重试'}finally{controls.forEach(control=>control.disabled=false)}
  }
  account.addEventListener('submit',event=>{event.preventDefault();const fae=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.input.value]));fae.security=security.value
    action(async()=>{view=await request('/license-delivery/mail-settings',{method:'POST',body:JSON.stringify({revision:view.revision,fae})});fields.password.input.value='';fields.password.wrap.querySelector('small').textContent='已保存。留空保留原密码；已保存密码不回显。';status.textContent='FAE 邮箱已保存';feedback.textContent='FAE 邮箱已保存，后续平台通知及客户发信使用此地址。请先发送测试邮件验证。'})
  })
  let logoDraft=view.logo?structuredClone(view.logo):null
  const logoEditor=el('section','','mail-logo-editor');logoEditor.append(el('h3','公司 Logo（可选）'),el('p','粘贴或选择正式 Logo，保存后用于所有新生成的 License 邮件页头。正文中的横向申请表保持不变。','mail-hint'))
  const logoStatus=el('p','','delivery-message');logoStatus.setAttribute('role','status')
  const logoImage=el('img');logoImage.alt='公司 Logo 草稿';logoImage.className='mail-logo-image'
  const pasteZone=button('点击这里，然后按 Ctrl+V / ⌘V 粘贴 Logo 图片',()=>pasteZone.focus());pasteZone.classList.add('mail-logo-paste');pasteZone.setAttribute('aria-label','粘贴公司 Logo')
  const logoFile=field('选择 Logo 图片','file','','支持 PNG / JPG，最大 256 KB。复制网页上的图片文字或图片网址无法直接粘贴；可改为选择图片文件。');logoFile.input.accept='image/png,image/jpeg'
  const logoWidth=field('Logo 显示宽度（像素）','number',logoDraft?.width||180);logoWidth.input.min='60';logoWidth.input.max='400';logoWidth.input.required=true
  function showLogo(){
    logoImage.hidden=!logoDraft
    if(logoDraft){logoImage.src=`data:${logoDraft.mimeType};base64,${logoDraft.base64}`;logoImage.style.width=`${logoDraft.width}px`}
    else logoImage.removeAttribute('src')
  }
  function currentLogo(){
    if(logoDraft&&!logoWidth.input.checkValidity())throw new Error('Logo 显示宽度应为 60–400 像素')
    return logoDraft?{...logoDraft,width:Number(logoWidth.input.value)}:null
  }
  async function loadLogo(file){
    if(!file)return
    try{
      if(!['image/png','image/jpeg'].includes(file.type)||!file.size||file.size>256*1024)throw new Error('请选择不超过 256 KB 的 PNG 或 JPG 图片')
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file)})
      const check=new Image();check.src=data;await check.decode()
      logoDraft={mimeType:file.type,base64:data.slice(data.indexOf(',')+1),width:Number(logoWidth.input.value)||180}
      showLogo();logoStatus.textContent='Logo 已载入草稿。可调整宽度并预览，点击“保存 Logo”后用于正式邮件。'
    }catch(error){logoStatus.textContent=error.message||'无法读取该图片'}finally{logoFile.input.value=''}
  }
  function pasteLogo(event){
    if(pasteZone.disabled)return
    const item=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'))
    if(item){event.preventDefault();loadLogo(item.getAsFile())}
    else if(event.currentTarget===pasteZone){event.preventDefault();logoStatus.textContent='剪贴板中没有图片。请复制图片本身，或使用“选择 Logo 图片”。'}
  }
  pasteZone.addEventListener('paste',pasteLogo)
  logoFile.input.addEventListener('change',()=>loadLogo(logoFile.input.files?.[0]))
  logoWidth.input.addEventListener('input',()=>{if(logoDraft&&logoWidth.input.checkValidity()){logoDraft.width=Number(logoWidth.input.value);showLogo();logoStatus.textContent='宽度已调整，尚未保存。'}})
  const logoActions=el('div','','mail-actions')
  logoActions.append(button('保存 Logo',()=>action(async()=>{view=await request('/license-delivery/mail-settings',{method:'POST',body:JSON.stringify({revision:view.revision,logo:currentLogo()})});logoDraft=view.logo?structuredClone(view.logo):null;showLogo();logoStatus.textContent=logoDraft?'Logo 已保存，新生成的邮件将显示此 Logo。':'已保存移除 Logo，新生成的邮件不再显示 Logo。';feedback.textContent=logoStatus.textContent})),button('移除 Logo',()=>{logoDraft=null;showLogo();logoStatus.textContent='已从草稿移除。点击“保存 Logo”后生效。'}))
  logoEditor.append(pasteZone,logoFile.wrap,logoImage,logoWidth.wrap,logoActions,logoStatus);inner.append(logoEditor);showLogo()
  const editor=el('section','','mail-template-editor');editor.append(el('h3','邮件内容'))
  const kind=el('select');kind.setAttribute('aria-label','邮件类型')
  for(const [key,value]of Object.entries(view.templates)){const option=el('option',value.label);option.value=key;kind.append(option)}
  const kindLabel=el('label','','mail-field');kindLabel.append(el('span','选择邮件类型'),kind)
  const subject=field('邮件标题','text');subject.input.maxLength=200
  const text=el('textarea');text.rows=10;text.maxLength=12000;text.setAttribute('aria-label','邮件正文');text.addEventListener('paste',pasteLogo)
  const textLabel=el('label','','mail-field');textLabel.append(el('span','邮件正文'),text)
  let drafts=structuredClone(view.templates)
  function showTemplate(){subject.input.value=drafts[kind.value].subject;text.value=drafts[kind.value].text}
  subject.input.addEventListener('input',()=>{drafts[kind.value].subject=subject.input.value})
  text.addEventListener('input',()=>{drafts[kind.value].text=text.value})
  kind.addEventListener('change',()=>{showTemplate();preview.replaceChildren()})
  const variables=el('div','','mail-variables');variables.append(el('span','点击插入正文变量：'))
  for(const variable of view.variables)variables.append(button(`{{${variable}}}`,()=>{text.focus();text.setRangeText(`{{${variable}}}`,text.selectionStart,text.selectionEnd,'end');drafts[kind.value].text=text.value}))
  const templateActions=el('div','','mail-actions')
  templateActions.append(button('保存邮件内容',()=>action(async()=>{view=await request('/license-delivery/mail-settings',{method:'POST',body:JSON.stringify({revision:view.revision,templates:drafts})});feedback.textContent='邮件内容已保存。后续新生成的邮件使用新内容；已生成的 FAE 汇总重试保留原内容。'})),button('恢复此类默认内容',()=>{drafts[kind.value]=structuredClone(view.defaults[kind.value]);showTemplate();feedback.textContent='已恢复默认草稿，点击“保存邮件内容”后生效。'}))
  editor.append(kindLabel,subject.wrap,textLabel,variables,el('p','附件与收件人由申请决定，不随正文修改。拒绝说明需保留 {{拒绝原因}}，FAE 汇总需保留 {{原始正文}}，申请信息会自动显示为表格。','mail-hint'),templateActions)
  inner.append(editor);showTemplate()
  const tester=el('section','','mail-tester');tester.append(el('h3','预览与测试'))
  const recipient=field('测试收件邮箱','email','','只向这个邮箱发送当前选中的一封测试邮件，不修改申请状态。');recipient.input.placeholder='填写你自己的测试邮箱'
  const confirmation=el('label','','mail-test-confirm'),checkbox=el('input');checkbox.type='checkbox';confirmation.append(checkbox,document.createTextNode('我确认向上述测试邮箱发送一封测试邮件'))
  const preview=el('div','','mail-preview');preview.setAttribute('aria-live','polite')
  function renderPreview(data){
    let body=el('pre',data.text)
    if(data.html){
      body=el('iframe');body.title='邮件内容预览';body.setAttribute('sandbox','');body.referrerPolicy='no-referrer'
      body.style.cssText='width:100%;height:560px;border:1px solid #dbe3ed;background:white;box-sizing:border-box;'
      body.srcdoc=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"></head><body style="margin:12px;font-family:Arial,sans-serif;overflow-wrap:anywhere;">${DOMPurify.sanitize(data.html)}</body></html>`
    }
    preview.replaceChildren(el('p',`发件人：${data.from}`),el('p',`收件人：${data.to}`),el('h4',data.subject),body,el('p',`附件：${data.attachments.map(item=>item.name).join('、')||'无'}`))
  }
  const testActions=el('div','','mail-actions')
  testActions.append(button('预览当前内容',()=>action(async()=>{const data=await request('/license-delivery/mail-preview',{method:'POST',body:JSON.stringify({kind:kind.value,to:recipient.input.value.trim()||undefined,templates:drafts,logo:currentLogo()})});renderPreview(data);feedback.textContent='仅预览，没有发送邮件。内容来自当前编辑草稿。'})),button('发送一封测试邮件',()=>{
    if(!recipient.input.value.trim()||!recipient.input.checkValidity()){feedback.textContent='请先填写有效的测试收件邮箱';recipient.input.focus();return}
    if(!checkbox.checked){feedback.textContent='请先勾选测试发送确认';return}
    action(async()=>{const result=await request('/license-delivery/mail-test',{method:'POST',body:JSON.stringify({kind:kind.value,to:recipient.input.value.trim(),templates:drafts,logo:currentLogo(),confirm:true,testId:testId()})});checkbox.checked=false;feedback.textContent=`${result.state==='accepted'?'邮件服务已接受，请检查收件箱和垃圾邮件':result.detail}。Message-ID：${result.messageId}${result.state==='unknown'?'。请先核查邮箱，勿直接重发。':''}`})
  }))
  tester.append(recipient.wrap,confirmation,testActions,preview);inner.append(tester)
}
