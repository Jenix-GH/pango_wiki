import { readFile, writeFile, mkdir, mkdtemp, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { readWorkerConfig, workerPool } from '../licenseConfig.mjs'
import { withDeliveryLock } from '../licenseDelivery.mjs'

const migrations = ['20260923_license_delivery.sql', '20260923_license_workflow.sql', '20260924_license_manual_status.sql', '20260928_license_cc.sql']

export function preparationConfig(text) {
  // Remove duplicate definitions, including stale true values. Preserve every other setting.
  return text.split(/\r?\n/).filter(line => !/^\s*LICENSE_(DELIVERY|SEND)_ENABLED\s*=/.test(line)).join('\n').trimEnd() +
    '\nLICENSE_DELIVERY_ENABLED=true\nLICENSE_SEND_ENABLED=false\n'
}

export async function migrationDefinitions() {
  const definitions = []
  for (const name of migrations) {
    const source = await readFile(new URL(`../database/${name}`, import.meta.url), 'utf8')
    for (const sql of source.split(';').map(s => s.trim()).filter(Boolean)) {
      const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1]
      if (!table) throw new Error('Unexpected migration statement; deployment stopped.')
      const columns = [...sql.matchAll(/^  (\w+) (CHAR|VARCHAR|INT|BIGINT|TINYINT|TEXT|MEDIUMTEXT|MEDIUMBLOB|DATETIME)\b/gm)].map(m => m[1])
      definitions.push({ table, columns, sql })
    }
  }
  return definitions
}

export async function missingTables(db, definitions) {
  const [rows] = await db.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
  const tables = new Map(rows.map(row => [row.TABLE_NAME, row.ENGINE]))
  if (!tables.has('dto_license_application')) throw new Error('Existing dto_license_application table is missing; check the database configuration.')
  const missing = []
  for (const definition of definitions) {
    if (!tables.has(definition.table)) { missing.push(definition); continue }
    if (tables.get(definition.table) !== 'InnoDB') throw new Error(`${definition.table}: expected InnoDB; ask the DBA to review this table.`)
    // Validate all required columns without reading any applicant or attachment data.
    await db.query(`SELECT ${definition.columns.map(name => `\`${name}\``).join(',')} FROM \`${definition.table}\` LIMIT 0`)
  }
  if (tables.has('dto_license_mail')) {
    const [indexes] = await db.query('SHOW INDEX FROM dto_license_mail')
    const unique = indexes.filter(row => Number(row.Non_unique) === 0)
    const keys = new Map()
    for (const row of unique) keys.set(row.Key_name, [...(keys.get(row.Key_name) || []), row.Column_name])
    if (![...keys.values()].some(cols => cols.length === 1 && cols[0] === 'dedupe_key')) throw new Error('dto_license_mail is missing its unique dedupe_key index; ask the DBA to review it.')
  }
  return missing
}

function optionValue(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"'
}

async function backupDatabase(config, directory) {
  await mkdir(directory, { mode: 0o700 })
  const temporary = await mkdtemp(join(tmpdir(), 'pango-db-backup-'))
  const outputPath = join(directory, 'database.sql')
  let output
  try {
    const defaults = join(temporary, 'client.cnf')
    const values = { host: config.PANGO_DB_HOST, port: config.PANGO_DB_PORT || '3306', user: config.PANGO_DB_USER, password: config.PANGO_DB_PASSWORD }
    await writeFile(defaults, '[client]\n' + Object.entries(values).map(([key, value]) => `${key}=${optionValue(value)}`).join('\n') + '\n', { mode: 0o600 })
    output = await open(outputPath, 'wx', 0o600)
    // Credentials are passed only through a private, temporary option file, never argv/logs.
    await new Promise((done, reject) => {
      const child = spawn('mysqldump', [`--defaults-extra-file=${defaults}`, '--single-transaction', '--quick', '--hex-blob', '--no-tablespaces', '--skip-lock-tables', '--databases', config.PANGO_DB_NAME], { stdio: ['ignore', output.fd, 'ignore'] })
      child.once('error', () => reject(new Error('mysqldump could not start. Install the MySQL client on the admin server; the running release was not replaced.')))
      child.once('close', code => code === 0 ? done() : reject(new Error('Database backup failed. Ask the DBA to check backup permissions and client compatibility; no migration was started.')))
    })
    if ((await output.stat()).size === 0) throw new Error('Database backup is empty; no migration was started.')
    console.log(`Database backup retained: ${outputPath}`)
  } catch (error) {
    await rm(outputPath, { force: true })
    throw error
  } finally {
    await output?.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--backup-dir')
  if (at < 0 || !argv[at + 1]) throw new Error('--backup-dir is required')
  const configAt = argv.indexOf('--config')
  if (configAt < 0 || !argv[configAt + 1]) throw new Error('--config must name the staged config file')
  const configPath = resolve(argv[configAt + 1])
  const config = readWorkerConfig(['--config', configPath])
  if (config.LICENSE_SEND_ENABLED === 'true') throw new Error('Automatic sending is already enabled. Pause the new License sender and set LICENSE_SEND_ENABLED=false before this preparation deployment.')
  const pool = workerPool(config)
  try {
    await withDeliveryLock(pool, async db => {
      const [[packet]] = await db.query('SELECT @@max_allowed_packet AS bytes')
      if (Number(packet.bytes) < 16 * 1024 * 1024) throw new Error('MySQL max_allowed_packet must be at least 16 MB; ask the DBA to update it before deployment.')
      const definitions = await migrationDefinitions()
      const missing = await missingTables(db, definitions)
      if (missing.length) {
        console.log(`Missing License tables: ${missing.map(item => item.table).join(', ')}`)
        await backupDatabase(config, resolve(argv[at + 1]))
        for (const item of missing) await db.query(item.sql)
        await missingTables(db, definitions)
      }
      // Only the staged file changes; the running release keeps its original configuration.
      await writeFile(configPath, preparationConfig(await readFile(configPath, 'utf8')), { mode: 0o600 })
      console.log('License workflow ready. Sending remains disabled. No cron, application rows or Java portal columns were changed.')
    })
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Database errors can contain SQL or connection details; do not print their raw messages.
    console.error(error.code ? `Deployment preparation failed (${error.code}). Check schema/CREATE permissions; partial additive tables may remain. The running release has not been replaced.` : error.message)
    process.exitCode = 1
  })
}
