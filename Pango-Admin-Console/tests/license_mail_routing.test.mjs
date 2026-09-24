import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkflowMailSender, assertMailConfiguration } from '../licenseMail.mjs'

const config = { LICENSE_MAIL_ENV: '/private/platform.env', LICENSE_FAE_MAIL_ENV: '/private/fae.env', LICENSE_FAE_EMAIL: 'fae@example.com' }
test('digest/summary use platform SMTP; customer/rejection use FAE SMTP and require its From address', async () => {
  const sent = []
  const sender = createWorkflowMailSender(config, { senderFactory: cfg => async message => {
    sent.push({ path: cfg.LICENSE_MAIL_ENV, message }); return { state: 'accepted' }
  } })
  for (const mailKind of ['digest','summary','customer','rejection']) {
    const to = ['digest','summary'].includes(mailKind) ? 'fae@example.com' : 'customer@example.com'
    assert.equal((await sender({ mailKind, to })).state, 'accepted')
  }
  assert.deepEqual(sent.map(item => item.path), ['/private/platform.env','/private/platform.env','/private/fae.env','/private/fae.env'])
  assert.equal(sent[2].message.expectedFrom, 'fae@example.com')
  assert.equal(sent[3].message.expectedFrom, 'fae@example.com')
  assert.equal(sent[0].message.forbiddenFrom, 'fae@example.com')
})
test('missing FAE credentials, unknown kind and platform-to-customer attempts cannot fall back', async () => {
  let sends = 0
  const sender = createWorkflowMailSender({ ...config, LICENSE_FAE_MAIL_ENV: '' }, { senderFactory: () => async () => { sends++; return { state:'accepted' } } })
  for (const message of [{mailKind:'customer',to:'customer@example.com'}, {mailKind:'rejection',to:'customer@example.com'}, {mailKind:'digest',to:'customer@example.com'}, {to:'fae@example.com'}]) {
    assert.equal((await sender(message)).state,'failed')
  }
  assert.equal(sends,0)
})
test('explicit testing routes both accounts only to the single designated test recipient', async () => {
  const sent = []
  const sender = createWorkflowMailSender(config, { testRecipient:'tester@example.com', senderFactory: cfg => async message => { sent.push([cfg.LICENSE_MAIL_ENV,message.to,message.expectedFrom]); return {state:'accepted'} } })
  for (const mailKind of ['digest','customer','rejection']) assert.equal((await sender({mailKind,to:'tester@example.com'})).state,'accepted')
  assert.equal((await sender({mailKind:'customer',to:'real-customer@example.com'})).state,'failed')
  assert.equal(sent.length,3)
  assert.equal(sent[1][2],'fae@example.com')
})
test('preflight allows platform-only morning jobs but refuses missing or identical FAE configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(),'pango-mail-routing-'))
  try {
    const platform=join(directory,'platform.env'), fae=join(directory,'fae.env')
    await writeFile(platform,'test-only', {mode:0o600})
    const current={...config,LICENSE_MAIL_ENV:platform,LICENSE_FAE_MAIL_ENV:fae}
    assert.doesNotThrow(()=>assertMailConfiguration(current,{requireFae:false}))
    assert.throws(()=>assertMailConfiguration(current),/不可读/)
    assert.throws(()=>assertMailConfiguration({...current,LICENSE_FAE_MAIL_ENV:platform}),/同一文件/)
    if(process.platform!=='win32'){
      await symlink(platform,fae)
      assert.throws(()=>assertMailConfiguration(current),/同一文件/)
    }
  } finally { await rm(directory,{recursive:true,force:true}) }
})
