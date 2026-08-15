import { normalizeAgentPhase, type AgentPhase } from '../../utils/agent-progress'

interface ParticlePoint {
  x: number
  y: number
  trail?: number
}

type PhaseWeights = Record<AgentPhase, number>

const PARTICLE_COUNT = 44
const MORPH_DURATION = 760
const BREATH_DURATION = 3200
const TAU = Math.PI * 2

function createPhaseWeights(phase: AgentPhase): PhaseWeights {
  return {
    understand: phase === 'understand' ? 1 : 0,
    retrieval: phase === 'retrieval' ? 1 : 0,
    evidence: phase === 'evidence' ? 1 : 0,
    answer: phase === 'answer' ? 1 : 0,
    verify: phase === 'verify' ? 1 : 0,
  }
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function interpolatePoint(from: ParticlePoint, to: ParticlePoint, amount: number): ParticlePoint {
  const fromTrail = from.trail ?? 0
  const toTrail = to.trail ?? 0
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    trail: fromTrail + (toTrail - fromTrail) * amount,
  }
}

function interpolateWeights(
  from: PhaseWeights,
  targetPhase: AgentPhase,
  amount: number,
): PhaseWeights {
  const target = createPhaseWeights(targetPhase)
  return {
    understand: from.understand + (target.understand - from.understand) * amount,
    retrieval: from.retrieval + (target.retrieval - from.retrieval) * amount,
    evidence: from.evidence + (target.evidence - from.evidence) * amount,
    answer: from.answer + (target.answer - from.answer) * amount,
    verify: from.verify + (target.verify - from.verify) * amount,
  }
}

function seeded(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function particlePosition(
  phase: AgentPhase,
  index: number,
  time: number,
  centerX: number,
  centerY: number,
  radius: number,
): ParticlePoint {
  const baseAngle = (index / PARTICLE_COUNT) * TAU
  const wobble = seeded(index, 3) - 0.5

  if (phase === 'retrieval') {
    const angle = baseAngle + time * 0.0011
    const orbit = radius * (0.28 + seeded(index, 5) * 0.6)
    return { x: centerX + Math.cos(angle) * orbit, y: centerY + Math.sin(angle) * orbit * 0.86 }
  }

  if (phase === 'evidence') {
    const clusters = [
      { x: -0.34, y: -0.2 },
      { x: 0.34, y: -0.16 },
      { x: 0, y: 0.3 },
    ]
    const cluster = clusters[index % clusters.length]
    const angle = baseAngle * 2.3 + time * 0.00035
    const localRadius = radius * (0.12 + seeded(index, 7) * 0.23)
    return {
      x: centerX + cluster.x * radius + Math.cos(angle) * localRadius,
      y: centerY + cluster.y * radius + Math.sin(angle) * localRadius,
    }
  }

  if (phase === 'answer') {
    const angle = baseAngle + wobble * 0.8
    const localRadius = radius * (0.18 + seeded(index, 9) * 0.62)
    const flow = (time * 0.018 + index * 1.7) % (radius * 0.48)
    return {
      x: centerX + Math.cos(angle) * localRadius + flow * 0.2,
      y: centerY + Math.sin(angle) * localRadius * 0.86,
      trail: 3 + seeded(index, 11) * 8,
    }
  }

  if (phase === 'verify') {
    const angle = baseAngle - Math.PI / 2
    const pulse = 1 + Math.sin(time * 0.003 + index * 0.16) * 0.035
    return {
      x: centerX + Math.cos(angle) * radius * 0.74 * pulse,
      y: centerY + Math.sin(angle) * radius * 0.74 * pulse,
    }
  }

  const angle = baseAngle + time * 0.00032 + wobble * 0.65
  const localRadius = radius * (0.46 + seeded(index, 13) * 0.34)
  return {
    x: centerX + Math.cos(angle) * localRadius,
    y: centerY + Math.sin(angle) * localRadius * 0.88,
  }
}

function createParticlePositions(
  phase: AgentPhase,
  time: number,
  width: number,
  height: number,
): ParticlePoint[] {
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.48
  const points = new Array<ParticlePoint>(PARTICLE_COUNT)
  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    points[index] = particlePosition(phase, index, time, centerX, centerY, radius)
  }
  return points
}

function drawParticles(
  context: any,
  width: number,
  height: number,
  points: ParticlePoint[],
  phaseWeights: PhaseWeights,
  time: number,
) {
  context.clearRect(0, 0, width, height)
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.48
  const breathAmount = (
    Math.sin((time / BREATH_DURATION) * TAU - Math.PI / 2) + 1
  ) / 2
  const breathScale = 0.97 + breathAmount * 0.06
  context.save()
  context.translate(centerX, centerY)
  context.scale(breathScale, breathScale)
  context.translate(-centerX, -centerY)

  if (phaseWeights.retrieval > 0.001) {
    context.beginPath()
    context.arc(centerX, centerY, radius * 0.82, -1.34, 0.2)
    context.strokeStyle = `rgba(193, 16, 119, ${0.36 * phaseWeights.retrieval})`
    context.lineWidth = 1.2
    context.lineCap = 'butt'
    context.stroke()
    context.beginPath()
    context.arc(centerX, centerY, radius * 0.82, 1.86, 2.92)
    context.stroke()
  }

  if (phaseWeights.verify > 0.001) {
    const sweep = (time * 0.0011) % TAU
    context.beginPath()
    context.arc(centerX, centerY, radius * 0.74, sweep, sweep + 0.7)
    context.strokeStyle = `rgba(177, 0, 103, ${0.32 * phaseWeights.verify})`
    context.lineWidth = 2
    context.lineCap = 'round'
    context.stroke()
  }

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const point = points[index]
    const highlighted = index % 7 === 0 || index % 11 === 0
    const particleRadius = highlighted ? 1.65 : 1.05 + seeded(index, 17) * 0.4
    const opacity = highlighted ? 0.92 : 0.34 + seeded(index, 19) * 0.42

    if (point.trail && index % 4 === 0) {
      context.beginPath()
      context.moveTo(point.x - point.trail, point.y)
      context.lineTo(point.x - 1.5, point.y)
      context.strokeStyle = `rgba(193, 16, 119, ${opacity * 0.32})`
      context.lineWidth = 0.8
      context.stroke()
    }

    context.beginPath()
    context.arc(point.x, point.y, particleRadius, 0, TAU)
    context.fillStyle = highlighted
      ? `rgba(177, 0, 103, ${opacity})`
      : `rgba(218, 64, 153, ${opacity})`
    context.fill()
  }
  context.restore()
}

Component({
  properties: {
    phase: { type: String, value: 'understand' },
    title: { type: String, value: '正在理解问题…' },
    detail: { type: String, value: '分析上下文' },
  },
  observers: {
    phase(value: string) {
      this.transitionToPhase(value)
    },
  },
  lifetimes: {
    ready() {
      this.initCanvas()
    },
    detached() {
      this.stopAnimation()
    },
  },
  methods: {
    initCanvas() {
      this.createSelectorQuery()
        .select('#agentParticleCanvas')
        .fields({ node: true, size: true })
        .exec((result: any[]) => {
          const canvasInfo = result[0]
          if (!canvasInfo?.node || !canvasInfo.width || !canvasInfo.height) return
          const host = this as any
          const phase = normalizeAgentPhase(this.properties.phase)
          host._particleCanvas = canvasInfo.node
          host._particleContext = canvasInfo.node.getContext('2d')
          host._particleWidth = canvasInfo.width
          host._particleHeight = canvasInfo.height
          host._particleTargetPhase = phase
          host._particlePoints = []
          host._particleWeights = createPhaseWeights(phase)
          host._particleTransitionFromPoints = undefined
          host._particleTransitionStartedAt = undefined
          const ratio = Math.min(wx.getSystemInfoSync().pixelRatio || 1, 2)
          canvasInfo.node.width = Math.round(canvasInfo.width * ratio)
          canvasInfo.node.height = Math.round(canvasInfo.height * ratio)
          host._particleContext.setTransform(ratio, 0, 0, ratio, 0, 0)
          this.startAnimation()
        })
    },
    transitionToPhase(value: string) {
      const host = this as any
      const nextPhase = normalizeAgentPhase(value)
      if (host._particleTargetPhase === nextPhase) return
      host._particleTargetPhase = nextPhase
      const currentPoints = host._particlePoints as ParticlePoint[] | undefined
      if (currentPoints?.length === PARTICLE_COUNT) {
        host._particleTransitionFromPoints = currentPoints.map((point) => ({ ...point }))
        host._particleTransitionFromWeights = { ...host._particleWeights }
        host._particleTransitionStartedAt = undefined
        return
      }
      host._particleTransitionFromPoints = undefined
      host._particleTransitionStartedAt = undefined
      host._particleWeights = createPhaseWeights(nextPhase)
    },
    startAnimation() {
      const host = this as any
      if (
        !host._particleCanvas
        || !host._particleContext
        || host._particleFrameId !== undefined
      ) return

      const draw = (time: number) => {
        const frameTime = typeof time === 'number' ? time : Date.now()
        const targetPhase = host._particleTargetPhase
          || normalizeAgentPhase(this.properties.phase)
        const targetPoints = createParticlePositions(
          targetPhase,
          frameTime,
          host._particleWidth,
          host._particleHeight,
        )
        const transitionFrom = host._particleTransitionFromPoints as ParticlePoint[] | undefined
        let points = targetPoints
        let weights = createPhaseWeights(targetPhase)

        if (transitionFrom?.length === targetPoints.length) {
          if (host._particleTransitionStartedAt === undefined) {
            host._particleTransitionStartedAt = frameTime
          }
          const elapsed = frameTime - host._particleTransitionStartedAt
          const progressAmount = Math.min(1, Math.max(0, elapsed / MORPH_DURATION))
          const easedAmount = easeInOutCubic(progressAmount)
          points = targetPoints.map((point, index) => (
            interpolatePoint(transitionFrom[index], point, easedAmount)
          ))
          weights = interpolateWeights(
            host._particleTransitionFromWeights,
            targetPhase,
            easedAmount,
          )
          if (progressAmount >= 1) {
            host._particleTransitionFromPoints = undefined
            host._particleTransitionStartedAt = undefined
            weights = createPhaseWeights(targetPhase)
          }
        }

        host._particlePoints = points
        host._particleWeights = weights
        drawParticles(
          host._particleContext,
          host._particleWidth,
          host._particleHeight,
          points,
          weights,
          frameTime,
        )
        host._particleFrameId = host._particleCanvas.requestAnimationFrame(draw)
      }
      host._particleFrameId = host._particleCanvas.requestAnimationFrame(draw)
    },
    stopAnimation() {
      const host = this as any
      if (host._particleCanvas && host._particleFrameId !== undefined) {
        host._particleCanvas.cancelAnimationFrame(host._particleFrameId)
      }
      host._particleFrameId = undefined
    },
  },
})
