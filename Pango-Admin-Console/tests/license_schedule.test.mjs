import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

test('hourly cron wrapper dispatches Beijing 09/20 hours and skips old 22 hour',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pango-clock-')),trace=join(dir,'calls')
 try{
  await writeFile(join(dir,'date'),'#!/bin/sh\n[ "$TZ" = "Asia/Shanghai" ] || exit 8\nif [ "$1" = "+%H" ]; then printf "%s\\n" "$PANGO_TEST_CLOCK"; else printf "2026-10-27 09:00:01 +08:00\\n"; fi\n',{mode:0o755})
  await writeFile(join(dir,'node'),'#!/bin/sh\nprintf "%s\\n" "$@" >> "$PANGO_TEST_TRACE"\nexit "${PANGO_TEST_EXIT:-0}"\n',{mode:0o755})
  for(const [clock,mode] of [['09','digest'],['20','nightly'],['08',null],['10',null],['19',null],['21',null],['22',null],['23',null]]){
   await writeFile(trace,'')
   const result=spawnSync('/bin/sh',[fileURLToPath(new URL('../scripts/run-license-job.sh',import.meta.url))],{env:{...process.env,PATH:dir+':'+process.env.PATH,LICENSE_NODE_BIN:join(dir,'node'),LICENSE_CONFIG_FILE:'config/database.env',PANGO_TEST_CLOCK:clock,PANGO_TEST_TRACE:trace},encoding:'utf8'})
   assert.equal(result.status,0,result.stderr)
   if(mode){assert.match(result.stdout,/scheduler_start/);assert.match(result.stdout,/scheduler_end.*exit_code=0/)}else assert.equal(result.stdout,'')
   assert.equal(await readFile(trace,'utf8'),mode?`scripts/license-worker.mjs\n${mode}\n--config\nconfig/database.env\n`:'',clock)
  }
  const failed=spawnSync('/bin/sh',[fileURLToPath(new URL('../scripts/run-license-job.sh',import.meta.url))],{env:{...process.env,PATH:dir+':'+process.env.PATH,LICENSE_NODE_BIN:join(dir,'node'),PANGO_TEST_CLOCK:'09',PANGO_TEST_TRACE:trace,PANGO_TEST_EXIT:'7'},encoding:'utf8'})
  assert.equal(failed.status,7)
  assert.match(failed.stdout,/scheduler_end.*exit_code=7/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
