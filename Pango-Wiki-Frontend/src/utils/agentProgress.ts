export const AGENT_PHASES = ['understand', 'retrieval', 'evidence', 'answer', 'verify'] as const

export type AgentPhase = (typeof AGENT_PHASES)[number]

export interface AgentProgressState {
  phase: AgentPhase
  title: string
  detail: string
}

export const AGENT_PROGRESS_COPY: Record<AgentPhase, Omit<AgentProgressState, 'phase'>> = {
  understand: { title: '正在理解问题…', detail: '分析上下文' },
  retrieval: { title: '正在查阅资料…', detail: '检索知识库' },
  evidence: { title: '正在整理依据…', detail: '汇总有效证据' },
  answer: { title: '正在生成回答…', detail: '组织回答内容' },
  verify: { title: '正在核对来源…', detail: '检查引用依据' },
}

const PHASE_ORDER = new Map<AgentPhase, number>(AGENT_PHASES.map((phase, index) => [phase, index]))

export const INITIAL_AGENT_PROGRESS: AgentProgressState = {
  phase: 'understand',
  ...AGENT_PROGRESS_COPY.understand,
}

export function normalizeAgentPhase(phase: unknown, statusText = ''): AgentPhase {
  const rawPhase = String(phase || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const phaseAliases: Record<string, AgentPhase> = {
    understand: 'understand',
    understanding: 'understand',
    analysis: 'understand',
    retrieval: 'retrieval',
    retrieve: 'retrieval',
    search: 'retrieval',
    evidence: 'evidence',
    grounding: 'evidence',
    answer: 'answer',
    generation: 'answer',
    generate: 'answer',
    verify: 'verify',
    verification: 'verify',
    citation: 'verify',
  }
  if (phaseAliases[rawPhase]) return phaseAliases[rawPhase]

  const status = statusText.toLowerCase()
  if (/核对|核验|引用|来源|verify|citation/.test(status)) return 'verify'
  if (/生成|回答|组织|answer|generation/.test(status)) return 'answer'
  if (/整理|依据|证据|汇总|evidence|ground/.test(status)) return 'evidence'
  if (/查阅|检索|搜索|知识库|retriev|search/.test(status)) return 'retrieval'
  return 'understand'
}

export function createAgentProgress(statusText = '', phase?: unknown): AgentProgressState {
  const normalizedPhase = normalizeAgentPhase(phase, statusText)
  return {
    phase: normalizedPhase,
    ...AGENT_PROGRESS_COPY[normalizedPhase],
  }
}

export function advanceAgentProgress(
  current: AgentProgressState | null,
  incoming: AgentProgressState,
): AgentProgressState {
  if (!current) return incoming
  const currentOrder = PHASE_ORDER.get(current.phase) ?? 0
  const incomingOrder = PHASE_ORDER.get(incoming.phase) ?? 0
  return incomingOrder >= currentOrder ? incoming : current
}
