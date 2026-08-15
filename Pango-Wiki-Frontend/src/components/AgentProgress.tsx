import { useEffect, useRef } from 'react'
import type { AgentPhase, AgentProgressState } from '../utils/agentProgress'
import './AgentProgress.css'

interface AgentProgressProps {
  progress: AgentProgressState
  compact?: boolean
}

interface ParticlePoint {
  x: number
  y: number
  trail?: number
}

type PhaseWeights = Record<AgentPhase, number>

const PARTICLE_COUNT = 52
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
    return {
      x: centerX + Math.cos(angle) * orbit,
      y: centerY + Math.sin(angle) * orbit * 0.86,
    }
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

function prepareCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.max(1, Math.round(bounds.width * ratio))
  const pixelHeight = Math.max(1, Math.round(bounds.height * ratio))
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { width: bounds.width, height: bounds.height }
}

function drawParticles(
  context: CanvasRenderingContext2D,
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
    context.lineWidth = 2.2
    context.lineCap = 'round'
    context.stroke()
  }

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const point = points[index]
    const highlighted = index % 7 === 0 || index % 11 === 0
    const particleRadius = highlighted ? 1.75 : 1.15 + seeded(index, 17) * 0.45
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

export default function AgentProgress({ progress, compact = false }: AgentProgressProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetPhaseRef = useRef<AgentPhase>(progress.phase)
  const currentPointsRef = useRef<ParticlePoint[]>([])
  const transitionFromPointsRef = useRef<ParticlePoint[] | null>(null)
  const currentWeightsRef = useRef<PhaseWeights>(createPhaseWeights(progress.phase))
  const transitionFromWeightsRef = useRef<PhaseWeights>(createPhaseWeights(progress.phase))
  const transitionStartedAtRef = useRef<number | null>(null)
  const reducedMotionRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let animationFrame = 0
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const render = (time: number) => {
      const { width, height } = prepareCanvas(canvas, context)
      const targetPhase = targetPhaseRef.current
      const targetPoints = createParticlePositions(targetPhase, time, width, height)
      const transitionFrom = transitionFromPointsRef.current
      let points = targetPoints
      let weights = createPhaseWeights(targetPhase)

      if (transitionFrom?.length === targetPoints.length) {
        if (transitionStartedAtRef.current === null) transitionStartedAtRef.current = time
        const elapsed = time - transitionStartedAtRef.current
        const progressAmount = Math.min(1, Math.max(0, elapsed / MORPH_DURATION))
        const easedAmount = easeInOutCubic(progressAmount)
        points = targetPoints.map((point, index) => (
          interpolatePoint(transitionFrom[index], point, easedAmount)
        ))
        weights = interpolateWeights(
          transitionFromWeightsRef.current,
          targetPhase,
          easedAmount,
        )
        if (progressAmount >= 1) {
          transitionFromPointsRef.current = null
          transitionStartedAtRef.current = null
          weights = createPhaseWeights(targetPhase)
        }
      }

      currentPointsRef.current = points
      currentWeightsRef.current = weights
      drawParticles(context, width, height, points, weights, time)
      if (!reducedMotionRef.current) animationFrame = window.requestAnimationFrame(render)
    }

    animationFrame = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [])

  useEffect(() => {
    const nextPhase = progress.phase
    if (targetPhaseRef.current === nextPhase) return
    targetPhaseRef.current = nextPhase

    if (!reducedMotionRef.current && currentPointsRef.current.length === PARTICLE_COUNT) {
      transitionFromPointsRef.current = currentPointsRef.current.map((point) => ({ ...point }))
      transitionFromWeightsRef.current = { ...currentWeightsRef.current }
      transitionStartedAtRef.current = null
      return
    }

    transitionFromPointsRef.current = null
    transitionStartedAtRef.current = null
    currentWeightsRef.current = createPhaseWeights(nextPhase)
    const animationFrame = window.requestAnimationFrame((time) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d')
      if (!context) return
      const { width, height } = prepareCanvas(canvas, context)
      const points = createParticlePositions(nextPhase, time, width, height)
      currentPointsRef.current = points
      drawParticles(context, width, height, points, currentWeightsRef.current, time)
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [progress.phase])

  return (
    <div
      className={`agent-progress agent-progress--${progress.phase}${compact ? ' agent-progress--compact' : ''}`}
      data-agent-phase={progress.phase}
      role="status"
      aria-live="polite"
      aria-label={`${progress.title}，${progress.detail}`}
    >
      <canvas ref={canvasRef} className="agent-progress-particles" aria-hidden="true" />
      <div className="agent-progress-body">
        <div className="agent-progress-copy">
          <strong>{progress.title}</strong>
          <span>{progress.detail}</span>
        </div>
        <div className="agent-progress-lane" aria-hidden="true">
          <span className="agent-progress-shuttle"><i /></span>
        </div>
      </div>
    </div>
  )
}
