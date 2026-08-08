import { pbkdf2Sync, randomBytes } from 'node:crypto'

const username = String(process.argv[2] || 'pango_admin').trim()
if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
  throw new Error('账号只能包含字母、数字、点、下划线或连字符，长度为3到64位')
}
const password = toBase64Url(randomBytes(18))
const salt = toBase64Url(randomBytes(18))
const iterations = 210000
const hash = toBase64Url(pbkdf2Sync(password, salt, iterations, 32, 'sha256'))

console.log(`ADMIN_CONSOLE_USER=${username}`)
console.log(`ADMIN_CONSOLE_PASSWORD_HASH=pbkdf2-sha256$${iterations}$${salt}$${hash}`)
console.log(`首次登录密码=${password}`)
console.log('请将前两行写入 config/database.env，并将首次登录密码保存在安全位置。')

function toBase64Url(value) {
  return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
