import assert from 'node:assert/strict'
import {
  advanceAgentProgress as advanceMiniProgress,
  createAgentProgress as createMiniProgress,
} from '../miniprogram/utils/agent-progress.ts'
import {
  advanceAgentProgress as advanceWebProgress,
  createAgentProgress as createWebProgress,
} from '../../Pango-Wiki-Frontend/src/utils/agentProgress.ts'

const phaseCases = [
  { phase: 'understand', status: '正在理解问题…', expected: 'understand' },
  { phase: 'retrieval', status: '正在查阅资料…', expected: 'retrieval' },
  { phase: 'evidence', status: '正在整理依据…', expected: 'evidence' },
  { phase: 'answer', status: '正在生成回答…', expected: 'answer' },
  { phase: 'verify', status: '正在核对来源…', expected: 'verify' },
] as const

for (const item of phaseCases) {
  assert.equal(createWebProgress(item.status, item.phase).phase, item.expected)
  assert.equal(createMiniProgress(item.status, item.phase).phase, item.expected)
}

assert.equal(createWebProgress('检索知识库中').phase, 'retrieval')
assert.equal(createMiniProgress('汇总有效证据').phase, 'evidence')

const verifiedWeb = createWebProgress('正在核对来源…', 'verify')
const lateRetrievalWeb = createWebProgress('正在查阅资料…', 'retrieval')
assert.equal(advanceWebProgress(verifiedWeb, lateRetrievalWeb).phase, 'verify')

const verifiedMini = createMiniProgress('正在核对来源…', 'verify')
const lateRetrievalMini = createMiniProgress('正在查阅资料…', 'retrieval')
assert.equal(advanceMiniProgress(verifiedMini, lateRetrievalMini).phase, 'verify')
