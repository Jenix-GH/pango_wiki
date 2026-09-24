import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import http from 'node:http'
import { readWorkerConfig } from '../licenseConfig.mjs'

try {
  const [mode, name, target] = process.argv.slice(2)
  const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  const matches = processes.filter(item => item.name === name)
  if (matches.length > 1) throw new Error('Expected one PM2 process; cluster deployment needs an operator review.')
  const processInfo = matches[0]
  if (processInfo) {
    const env = processInfo.pm2_env
    if (resolve(env.pm_cwd || '/') !== resolve(target)) throw new Error('PM2 working directory does not match RemotePath; check the deployment settings.')
    const args = Array.isArray(env.args) ? env.args : [env.args || '']
    if (args.some(arg => /--config|--api-only/.test(arg))) throw new Error('A custom PM2 launch configuration is in use; this uploader requires the default config/database.env and full console service.')
  }
  if (mode === 'preflight') process.exit(0)
  if (mode !== 'health') throw new Error('Unknown deployment check mode')
  if (!processInfo || processInfo.pm2_env.status !== 'online') throw new Error('PM2 process is not online')
  const config = readWorkerConfig(['--config', resolve(target, 'config/database.env')])
  const expected = await readFile(resolve(target, 'dist/index.html'))
  const host = ['0.0.0.0', '::'].includes(config.ADMIN_CONSOLE_HOST) ? '127.0.0.1' : (config.ADMIN_CONSOLE_HOST || '127.0.0.1')
  const port = Number(config.ADMIN_CONSOLE_PORT || 3100)
  async function request(path) {
    return new Promise((done, reject) => {
      const req = http.get({ hostname: host, port, path, timeout: 2000 }, res => {
        const chunks = []
        res.on('data', data => chunks.push(data))
        res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error('Health request timed out')))
      req.on('error', reject)
    })
  }
  let healthy = false
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const page = await request('/')
      const session = await request('/local-api/auth/session')
      if (page.status === 200 && page.body.equals(expected) && session.status === 401 && JSON.parse(session.body).message === '登录状态已失效，请重新登录') { healthy = true; break }
    } catch { /* Retry only the local startup check. */ }
    await new Promise(done => setTimeout(done, 1000))
  }
  if (!healthy) throw new Error('The deployed page/API did not pass the local startup check')
  console.log('Deployed page and authentication API passed the startup check.')
} catch (error) {
  console.error(error.code ? 'PM2 or local health check failed; inspect the server logs.' : error.message)
  process.exitCode = 1
}
