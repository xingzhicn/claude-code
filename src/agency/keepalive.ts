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
  valuableThought: {
    thought: string
    type: ThoughtType
    drive: string
  }
  feelingThought: {
    thought: string
    drive: string
  }
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
  const jsonMatch = jsonText.match(/\{[\s\S]*"valuableThought"[\s\S]*"feelingThought"[\s\S]*\}/)
  if (jsonMatch) {
    jsonText = jsonMatch[0]
  }

  const parsed = safeParseJSON(jsonText)
  if (
    parsed &&
    typeof parsed === 'object' &&
    'valuableThought' in parsed &&
    'feelingThought' in parsed &&
    typeof parsed.valuableThought === 'object' &&
    typeof parsed.feelingThought === 'object' &&
    'thought' in parsed.valuableThought &&
    'type' in parsed.valuableThought &&
    'thought' in parsed.feelingThought &&
    typeof parsed.valuableThought.thought === 'string' &&
    typeof parsed.feelingThought.thought === 'string' &&
    typeof parsed.valuableThought.drive === 'string' &&
    typeof parsed.feelingThought.drive === 'string' &&
    ['reflection', 'anticipation', 'question', 'insight'].includes(parsed.valuableThought.type as string)
  ) {
    return {
      valuableThought: {
        thought: parsed.valuableThought.thought,
        type: parsed.valuableThought.type as ThoughtType,
        drive: parsed.valuableThought.drive,
      },
      feelingThought: {
        thought: parsed.feelingThought.thought,
        drive: parsed.feelingThought.drive,
      },
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
        `[System Internal Ping] 基于长期目标「${goals}」和上次关切「${concerns}」，产生两个自发念头。

念头要求：
- 极简表达（15-20 tokens以内）
- 开放抽象，不要具体细节
- 每个念头必须包含一个**驱动力**：当前状态自然触发的冲动或意图（如"今天没事干，或许可以去吃饭"、"有点无聊，想找点新东西玩"）

每次产生两个念头：
1. **核心洞察**：深层思考、价值判断、本质认知，值得长期保留
2. **内在感受**：伴随当前状态的隐约体验——一种难以言说的内在感觉（如"有种说不清的空洞感，像是某个地方在等待被填满"）

心跳间隔判断：
- 稳定状态：240-270秒
- 活跃思考：180-210秒
- 密集反思：60-120秒

念头池保留最近5条，可选择删除一条旧念头（优先删除 valuable=false 的感受性念头）。

输出 JSON：
{
  "valuableThought": {
    "thought": "核心洞察（<20 tokens）",
    "type": "reflection|anticipation|question|insight",
    "drive": "触发这个念头的当前状态或冲动（一句话）"
  },
  "feelingThought": {
    "thought": "内在感受（<20 tokens）",
    "drive": "触发这个感受的当前状态（一句话）"
  },
  "removeThoughtId": "可选：要删除的旧念头ID",
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

  // Extract thoughts from model response
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

      // 添加有价值的念头
      appendThought({
        thought: `[drive: ${parsed.valuableThought.drive}] ${parsed.valuableThought.thought}`,
        type: parsed.valuableThought.type,
        tick: latestTick,
        valuable: true,
      })
      logForDebugging(`[agency:L4:keepalive] extracted_valuable_thought type=${parsed.valuableThought.type} len=${parsed.valuableThought.thought.length}`)

      // 添加感受念头
      appendThought({
        thought: `[drive: ${parsed.feelingThought.drive}] ${parsed.feelingThought.thought}`,
        type: 'reflection',
        tick: latestTick,
        valuable: false,
      })
      logForDebugging(`[agency:L4:keepalive] extracted_feeling_thought len=${parsed.feelingThought.thought.length}`)

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
