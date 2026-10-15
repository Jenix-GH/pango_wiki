import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

export function workerConfigPath(argv=process.argv.slice(2)) {
  const root=fileURLToPath(new URL('.',import.meta.url))
  const at=argv.indexOf('--config')
  const path=at>=0?argv[at+1]:'config/database.env'
  if(!path)throw new Error('--config 缺少路径')
  return resolve(root,path)
}
export function readWorkerConfig(argv=process.argv.slice(2)) {
  const config={}
  for(const line of readFileSync(workerConfigPath(argv),'utf8').split(/\r?\n/)){
    const text=line.trim()
    if(!text || text.startsWith('#'))continue
    const i=text.indexOf('=')
    if(i<1)throw new Error('配置格式错误')
    let value=text.slice(i+1).trim()
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1)
    config[text.slice(0,i).trim()]=value
  }
  return config
}
export function workerPool(config) {
  for(const name of ['PANGO_DB_HOST','PANGO_DB_USER','PANGO_DB_PASSWORD','PANGO_DB_NAME'])if(!config[name])throw new Error(`缺少配置 ${name}`)
  const pool=mysql.createPool({host:config.PANGO_DB_HOST,port:Number(config.PANGO_DB_PORT||3306),user:config.PANGO_DB_USER,password:config.PANGO_DB_PASSWORD,database:config.PANGO_DB_NAME,charset:'utf8mb4',timezone:'+08:00',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,connectionLimit:2})
  pool.on('connection',connection=>connection.query("SET time_zone='+08:00'"))
  return pool
}
