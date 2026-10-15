export const MAX_LOGO_BYTES = 256 * 1024
const CID = 'pango-company-logo'
export function validateMailLogo(input) {
  if(input===null)return null
  if(!input||typeof input!=='object'||!['image/png','image/jpeg'].includes(input.mimeType))throw new Error('Logo 仅支持 PNG 或 JPG 图片')
  if(typeof input.base64!=='string'||input.base64.length>Math.ceil(MAX_LOGO_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw new Error('Logo 图片编码无效或超过 256 KB')
  const bytes=Buffer.from(input.base64,'base64')
  const valid=input.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  if(!valid||bytes.length>MAX_LOGO_BYTES)throw new Error('Logo 文件内容不是有效的 PNG 或 JPG 图片')
  const width=Number(input.width??180)
  if(!Number.isInteger(width)||width<60||width>400)throw new Error('Logo 显示宽度应为 60–400 像素')
  return {mimeType:input.mimeType,base64:bytes.toString('base64'),width}
}
export function withMailLogo(message,input,plainHtml) {
  if(!input)return message
  const logo=validateMailLogo(input)
  return {...message,html:`<div style="margin:0 0 20px;"><img src="cid:${CID}" alt="公司 Logo" width="${logo.width}" style="display:block;width:${logo.width}px;max-width:100%;height:auto;border:0;"></div>${message.html||plainHtml}`,inlineImages:[{cid:CID,mimeType:logo.mimeType,base64:logo.base64}]}
}
export function mailPreviewHtml(message) {
  if(!message.html)return null
  let html=message.html
  for(const image of message.inlineImages||[]){
    if(image.cid!==CID)continue
    const logo=validateMailLogo({...image,width:180})
    html=html.replaceAll(`cid:${CID}`,`data:${logo.mimeType};base64,${logo.base64}`)
  }
  return html
}
