import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beijingTimestamp, createJobLogger } from '../scripts/license-job-log.mjs'

test('timestamps use Beijing time across UTC date boundaries',()=>{
  assert.equal(beijingTimestamp(new Date('2026-10-26T16:00:01Z')),'2026-10-27 00:00:01 +08:00')
})

test('actual mail attempts log recipients and results without payload secrets or changing sends',async()=>{
  for(const state of ['accepted','failed','unknown']){
    const lines=[]
    const logger=createJobLogger('digest',{write:line=>lines.push(JSON.parse(line)),runId:'test-run',now:()=>new Date('2026-10-27T01:00:00Z')})
    const message={mailKind:'digest',to:'fae@example.com',cc:['copy@example.com'],messageId:'<test@example.com>',text:'PRIVATE_BODY',attachments:[{base64:'PRIVATE_FILE'}],smtpConfig:{password:'PRIVATE_PASSWORD'}}
    const result={state,detail:'test outcome'}
    let calls=0
    assert.equal(await logger.sender(async payload=>{calls++;assert.equal(payload,message);return result})(message),result)
    assert.equal(calls,1)
    assert.deepEqual(lines.map(line=>line.event),['mail_start','mail_result'])
    assert.equal(lines[1].state,state)
    assert.equal(lines[1].to,message.to)
    assert.deepEqual(lines[1].cc,message.cc)
    assert.equal(lines[1].time,'2026-10-27 09:00:00 +08:00')
    assert.equal(lines[1].runId,'test-run')
    assert.doesNotMatch(JSON.stringify(lines),/PRIVATE_/)
  }
})

test('sender exceptions remain unknown and propagate without exposing exception secrets',async()=>{
  const lines=[],error=new Error('PRIVATE_PASSWORD')
  const logger=createJobLogger('nightly',{write:line=>lines.push(JSON.parse(line))})
  await assert.rejects(logger.sender(async()=>{throw error})({mailKind:'customer',to:'customer@example.com'}),e=>e===error)
  assert.equal(lines[1].state,'unknown')
  assert.doesNotMatch(JSON.stringify(lines),/PRIVATE_PASSWORD/)
})

test('disabled production sending logs dated start error and end without connecting or sending',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pango-job-log-'))
  try{
    const config=join(dir,'database.env')
    await writeFile(config,'LICENSE_DELIVERY_ENABLED=true\nLICENSE_SEND_ENABLED=false\n')
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/license-worker.mjs',import.meta.url)),'digest','--config',config],{encoding:'utf8'})
    assert.equal(result.status,1,result.stderr)
    const lines=result.stdout.trim().split('\n').map(line=>JSON.parse(line))
    assert.deepEqual(lines.map(line=>line.event),['task_start','task_error','task_end'])
    assert.match(lines[1].detail,/自动发放未启用/)
    assert.equal(lines[2].exitCode,1)
    assert.equal(new Set(lines.map(line=>line.runId)).size,1)
    assert.ok(lines.every(line=>line.time.endsWith('+08:00')))
  }finally{await rm(dir,{recursive:true,force:true})}
})
