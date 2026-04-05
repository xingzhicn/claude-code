import * as fsPromises from 'fs/promises'
import { logForDebugging } from 'src/utils/debug.js'
import { drainThoughtsForWakeContext, initThoughtPool, initThoughtExtractor } from './thoughtPool.js'
import {
  getAgencyDynamicStatePath,
  getAgencyStaticCorePath,
} from './paths.js'

let identityAnchor = ''
let dynamicStateText = ''
let tick = 0
let lastWakeTime: number = Date.now()
let lastKeepaliveTime: number = Date.now()
let latestWakeDebugInfo: {
  tickLabel: string
  drainedThoughts: string[]
  generatedAt: string
} | null = null

async function readAgencyFile(path: string): Promise<string> {
  try {
    return await fsPromises.readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

export async function initAgency(): Promise<void> {
  const [staticCore, dynamicState] = await Promise.all([
    readAgencyFile(getAgencyStaticCorePath()),
    readAgencyFile(getAgencyDynamicStatePath()),
  ])

  identityAnchor = staticCore
  dynamicStateText = dynamicState
  tick = 0

  await initThoughtPool()
  initThoughtExtractor()

  logForDebugging(
    `[agency:L1:init] static_loaded=${staticCore.length > 0} static_len=${staticCore.length} dynamic_loaded=${dynamicState.length > 0} dynamic_len=${dynamicState.length}`,
  )
}

export function getIdentityAnchor(): string {
  return identityAnchor
}

export function getWakeContext(): string {
  tick += 1
  const now = Date.now()
  const timeSinceLastWake = Math.floor((now - lastWakeTime) / 1000)
  const timeSinceLastKeepalive = Math.floor((now - lastKeepaliveTime) / 1000)
  lastWakeTime = now

  // 格式化为时分秒
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}小时${m}分${s}秒`
    if (m > 0) return `${m}分${s}秒`
    return `${s}秒`
  }

  const tickLabel = `[T=${String(tick).padStart(4, '0')}]`
  const timeInfo = `[时间感知] 距上次唤醒: ${formatTime(timeSinceLastWake)} | 距上次心跳: ${formatTime(timeSinceLastKeepalive)}`

  const drainedThoughts = drainThoughtsForWakeContext(tick)
  const thoughtBlock = drainedThoughts.length > 0 ? `\n\n${drainedThoughts.join('\n')}` : ''
  const wakeContext = dynamicStateText
    ? `${tickLabel}\n${timeInfo}\n${dynamicStateText}${thoughtBlock}`
    : `${tickLabel}\n${timeInfo}${thoughtBlock}`

  latestWakeDebugInfo = {
    tickLabel,
    drainedThoughts,
    generatedAt: new Date().toISOString(),
  }

  logForDebugging(
    `[agency:L2:wake] tick=${tickLabel} dynamic_present=${dynamicStateText.length > 0} dynamic_len=${dynamicStateText.length} drained_thoughts=${drainedThoughts.length} time_since_wake=${timeSinceLastWake}s time_since_keepalive=${timeSinceLastKeepalive}s`,
  )

  return wakeContext
}

export function getLatestWakeDebugInfo(): {
  tickLabel: string
  drainedThoughts: string[]
  generatedAt: string
} | null {
  return latestWakeDebugInfo
}

export function replaceDynamicState(next: string): void {
  dynamicStateText = next
  logForDebugging(
    `[agency:L3:hot-swap] dynamic_len=${next.length}`,
  )
}

export function recordKeepaliveTime(): void {
  lastKeepaliveTime = Date.now()
  logForDebugging('[agency:L4:keepalive] time_recorded')
}

export function __resetAgencyStateForTests(): void {
  identityAnchor = ''
  dynamicStateText = ''
  tick = 0
  lastWakeTime = Date.now()
  lastKeepaliveTime = Date.now()
  latestWakeDebugInfo = null
}
