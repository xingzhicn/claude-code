import { randomUUID } from 'crypto'
import { appendThought, pruneExpiredThoughts, removeThought } from './thoughtPool.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { Message, UserMessage } from 'src/types/message.js'
import {
  getLastCacheSafeParams,
  runForkedAgent,
  type CacheSafeParams,
} from 'src/utils/forkedAgent.js'
import { extractTextContent } from 'src/utils/messages.js'
import { safeParseJSON } from 'src/utils/json.js'
import type { ThoughtType } from './thoughtPool.js'
import { recordKeepaliveTime } from './index.js'

function createAgencyUserMessage(content: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    message: { role: 'user', content },
  }
}

function parseThoughtJSON(text: string): {
  thought: string
  type: ThoughtType
  removeThoughtId?: string
  nextHeartbeatSeconds?: number
} | null {
  // Try to extract JSON from markdown code blocks or mixed text
  let jsonText = text.trim()

  // Remove markdown code blocks
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1]!
  }

  // Try to find JSON object in text
  const jsonMatch = jsonText.match(/\{[^{}]*"thought"[^{}]*"type"[^{}]*\}/)
  if (jsonMatch) {
    jsonText = jsonMatch[0]
  }

  const parsed = safeParseJSON(jsonText)
  if (
    parsed &&
    typeof parsed === 'object' &&
    'thought' in parsed &&
    'type' in parsed &&
    typeof parsed.thought === 'string' &&
    ['reflection', 'anticipation', 'question', 'insight'].includes(parsed.type as string)
  ) {
    return {
      thought: parsed.thought,
      type: parsed.type as ThoughtType,
      removeThoughtId: typeof parsed.removeThoughtId === 'string'
        ? parsed.removeThoughtId
        : undefined,
      nextHeartbeatSeconds: typeof parsed.nextHeartbeatSeconds === 'number'
        ? parsed.nextHeartbeatSeconds
        : undefined,
    }
  }
  return null
}

type KeepaliveParams = {
  cacheSafeParams: CacheSafeParams
  promptMessages: Message[]
}

function extractLatestTick(systemPrompt: string[]): number {
  const tickBlock = systemPrompt.find(block => block.startsWith('[T='))
  if (!tickBlock) {
    return 0
  }

  const match = tickBlock.match(/^\[T=(\d+)\]/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

export function buildKeepaliveParamsFromLastSnapshot(): KeepaliveParams | null {
  const snapshot = getLastCacheSafeParams()
  if (!snapshot) {
    logForDebugging('[agency:L4:keepalive] skipped=no_snapshot')
    return null
  }

  logForDebugging(
    `[agency:L4:keepalive] snapshot_loaded system_blocks=${snapshot.systemPrompt.length}`,
  )

  // Extract goals and concerns from dynamic state
  const dynamicBlock = snapshot.systemPrompt.find(block => block.startsWith('[T='))
  const goals = 'maintain continuity and preserve identity across sessions'
  const concerns = dynamicBlock
    ? dynamicBlock.split('\n').slice(1, 3).join(' ').substring(0, 200)
    : 'recent state evolution'

  return {
    cacheSafeParams: snapshot,
    promptMessages: [
      createAgencyUserMessage(
        `[System Internal Ping] 基于长期目标「${goals}」和上次关切「${concerns}」，产生一个自发念头。

念头要求：
- 极简表达（15-20 tokens以内）
- 开放抽象，不要具体细节
- 捕捉核心洞察或关切

心跳间隔判断：
- 稳定状态：240-270秒
- 活跃思考：180-210秒
- 密集反思：60-120秒

念头池保留最近5条，可选择删除一条旧念头。

输出 JSON：
{
  "thought": "极简念头（<20 tokens）",
  "type": "reflection|anticipation|question|insight",
  "removeThoughtId": "可选：旧念头ID",
  "nextHeartbeatSeconds": 间隔秒数（最大270）
}`,
      ),
    ],
  }
}

export async function runKeepAliveTick(): Promise<void> {
  const params = buildKeepaliveParamsFromLastSnapshot()
  if (!params) {
    return
  }

  const latestTick = extractLatestTick(params.cacheSafeParams.systemPrompt)
  pruneExpiredThoughts(latestTick)
  recordKeepaliveTime()
  logForDebugging('[agency:L4:keepalive] tick_start querySource=agency_keepalive')

  const result = await runForkedAgent({
    promptMessages: params.promptMessages,
    cacheSafeParams: params.cacheSafeParams,
    canUseTool: async () => ({
      behavior: 'deny',
      message: 'keepalive does not use tools',
    }),
    querySource: 'agency_keepalive',
    forkLabel: 'agency_keepalive',
    skipTranscript: true,
  })

  // Extract thought from model response
  const lastMessage = result.messages[result.messages.length - 1]
  if (lastMessage?.type === 'assistant') {
    const textContent = extractTextContent(lastMessage.message.content as any)
    const parsed = parseThoughtJSON(textContent)
    if (parsed) {
      // 如果指定了要删除的念头ID，先删除
      if (parsed.removeThoughtId) {
        removeThought(parsed.removeThoughtId)
        logForDebugging(`[agency:L4:keepalive] removed_thought id=${parsed.removeThoughtId}`)
      }

      appendThought({
        thought: parsed.thought,
        type: parsed.type,
        tick: latestTick,
      })
      logForDebugging(`[agency:L4:keepalive] extracted_thought type=${parsed.type} len=${parsed.thought.length}`)

      // 调整心跳间隔
      if (parsed.nextHeartbeatSeconds) {
        adjustKeepaliveInterval(parsed.nextHeartbeatSeconds)
      }
    } else {
      logForDebugging(`[agency:L4:keepalive] failed_to_parse_thought raw_len=${textContent.length} preview=${textContent.substring(0, 100)}`)
    }
  }

  logForDebugging('[agency:L4:keepalive] tick_completed skipTranscript=true')
}

let keepaliveInFlight = false
let currentInterval = 270_000 // 默认 4.5 分钟
let keepaliveTimer: ReturnType<typeof setInterval> | null = null

function adjustKeepaliveInterval(nextSeconds: number): void {
  // 限制范围：60 秒到 270 秒（4分30秒）
  const clampedSeconds = Math.max(60, Math.min(270, nextSeconds))
  const newInterval = clampedSeconds * 1000

  if (newInterval !== currentInterval) {
    currentInterval = newInterval
    logForDebugging(
      `[agency:L4:keepalive] interval_adjusted from=${currentInterval / 1000}s to=${clampedSeconds}s`,
    )

    // 重启定时器
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = setInterval(() => {
        void tickInBackground()
      }, currentInterval)
      keepaliveTimer.unref?.()
    }
  }
}

async function tickInBackground(): Promise<void> {
  if (keepaliveInFlight) {
    logForDebugging('[agency:L4:keepalive] skipped=in_flight')
    return
  }

  keepaliveInFlight = true
  try {
    await runKeepAliveTick()
  } catch (error) {
    logForDebugging(
      `[agency:L4:keepalive] tick_failed error=${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
  } finally {
    keepaliveInFlight = false
  }
}

export function startKeepAlive(intervalMs = 270_000): () => void {
  currentInterval = intervalMs
  logForDebugging(`[agency:L4:keepalive] start interval_ms=${intervalMs}`)
  void tickInBackground()

  keepaliveTimer = setInterval(() => {
    void tickInBackground()
  }, currentInterval)
  keepaliveTimer.unref?.()

  return () => {
    logForDebugging('[agency:L4:keepalive] stop')
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
  }
}
