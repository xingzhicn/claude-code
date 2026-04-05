import * as fsPromises from 'fs/promises'
import { logForDebugging } from 'src/utils/debug.js'
import { getAgencyThoughtPoolPath } from './paths.js'
import type { REPLHookContext } from 'src/utils/hooks/postSamplingHooks.js'
import { registerPostSamplingHook } from 'src/utils/hooks/postSamplingHooks.js'

export type ThoughtType = 'reflection' | 'anticipation' | 'question' | 'insight'

export type AgencyThought = {
  id: string
  thought: string
  type: ThoughtType
  tick: number
  used: boolean
  valuable: boolean
}

type ThoughtPoolFile = {
  thoughts: AgencyThought[]
}

const MAX_THOUGHTS = 5
const MAX_UNUSED_AGE_TICKS = 5

let thoughtPool: AgencyThought[] = []

async function readThoughtPoolFile(): Promise<ThoughtPoolFile> {
  try {
    const raw = await fsPromises.readFile(getAgencyThoughtPoolPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ThoughtPoolFile>
    return {
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [],
    }
  } catch {
    return { thoughts: [] }
  }
}

async function writeThoughtPoolFile(pool: ThoughtPoolFile): Promise<void> {
  await fsPromises.writeFile(
    getAgencyThoughtPoolPath(),
    JSON.stringify(pool, null, 2),
    'utf-8',
  )
}

function persistThoughtPool(): void {
  void writeThoughtPoolFile({ thoughts: thoughtPool })
}

export async function initThoughtPool(): Promise<void> {
  const pool = await readThoughtPoolFile()
  thoughtPool = pool.thoughts
  logForDebugging(
    `[agency:L5:thought-pool] init size=${thoughtPool.length}`,
  )
}

export function appendThought(
  thought: Omit<AgencyThought, 'id' | 'used'>,
): void {
  const nextThought: AgencyThought = {
    id: `${thought.tick}-${thoughtPool.length + 1}`,
    thought: thought.thought,
    type: thought.type,
    tick: thought.tick,
    used: false,
    valuable: thought.valuable,
  }
  thoughtPool = [...thoughtPool, nextThought].slice(-MAX_THOUGHTS)
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] appended type=${nextThought.type} valuable=${nextThought.valuable} tick=${nextThought.tick} size=${thoughtPool.length}`,
  )
}

export function removeThought(thoughtId: string): void {
  const beforeSize = thoughtPool.length
  thoughtPool = thoughtPool.filter(t => t.id !== thoughtId)
  if (thoughtPool.length < beforeSize) {
    persistThoughtPool()
    logForDebugging(
      `[agency:L5:thought-pool] removed id=${thoughtId} size=${thoughtPool.length}`,
    )
  }
}

export function drainThoughtsForWakeContext(currentTick: number): string[] {
  // 返回所有念头，不标记 used（让念头可以被多次读取）
  if (thoughtPool.length === 0) {
    return []
  }

  logForDebugging(
    `[agency:L5:thought-pool] drained count=${thoughtPool.length} tick=${currentTick}`,
  )
  return thoughtPool.map(thought => `[thought:${thought.type}${thought.valuable ? '+' : '?'}] ${thought.thought}`)
}

export function pruneExpiredThoughts(currentTick: number): void {
  // 优先删除 valuable=false 的念头
  const trivialThoughts = thoughtPool.filter(t => !t.valuable)
  const valuableThoughts = thoughtPool.filter(t => t.valuable)

  // 如果超过 MAX_THOUGHTS，优先删除平庸念头
  if (thoughtPool.length > MAX_THOUGHTS) {
    const toRemove = thoughtPool.length - MAX_THOUGHTS
    const removedTrivial = trivialThoughts.slice(0, toRemove)
    thoughtPool = thoughtPool.filter(t => !removedTrivial.includes(t))
    persistThoughtPool()
    logForDebugging(
      `[agency:L5:thought-pool] pruned_by_size removed=${toRemove} (trivial) size=${thoughtPool.length}`,
    )
    return
  }

  // 删除过期的念头（超过 MAX_UNUSED_AGE_TICKS）
  const nextThoughtPool = thoughtPool.filter(thought => {
    return currentTick - thought.tick <= MAX_UNUSED_AGE_TICKS
  })

  if (nextThoughtPool.length === thoughtPool.length) {
    return
  }

  const removed = thoughtPool.length - nextThoughtPool.length
  thoughtPool = nextThoughtPool
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] pruned_by_age removed=${removed} tick=${currentTick} size=${thoughtPool.length}`,
  )
}

export function peekThoughtPool(): AgencyThought[] {
  return thoughtPool
}

export function __resetThoughtPoolForTests(): void {
  thoughtPool = []
}

export const extractThoughtsHook = async (context: REPLHookContext): Promise<void> => {
  if (!context.querySource?.startsWith('repl_main_thread')) {
    return
  }

  const lastMessage = context.messages[context.messages.length - 1]
  if (!lastMessage || lastMessage.type !== 'assistant') {
    return
  }

  const tickLabelBlock = context.systemPrompt.find(block => block.startsWith('[T='))
  const tickMatch = tickLabelBlock?.match(/^\[T=(\d+)\]/)
  const currentTick = tickMatch ? Number.parseInt(tickMatch[1]!, 10) : 0

  let thinkingContent = ''
  if (typeof lastMessage.message.content === 'string') {
    const thinkingMatches = [...lastMessage.message.content.matchAll(/<thinking>([\s\S]*?)<\/thinking>/g)]
    for (const match of thinkingMatches) {
      if (match[1]) thinkingContent += match[1].trim() + '\n'
    }
  } else {
    for (const block of lastMessage.message.content) {
      if (typeof block !== 'string' && block.type === 'text') {
        const thinkingMatches = [...block.text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/g)]
        for (const match of thinkingMatches) {
          if (match[1]) thinkingContent += match[1].trim() + '\n'
        }
      }
    }
  }

  if (thinkingContent.trim()) {
    // We only want to preserve a small summary of the thought, not hundreds of lines.
    // For now we just take the last 200 chars or summary if needed. 
    // Ideally the model produces succinct thoughts. 
    const abstract = thinkingContent.trim().slice(-200)
    appendThought({
      thought: abstract,
      type: 'insight',
      tick: currentTick,
    })
  }
}

export function initThoughtExtractor(): void {
  registerPostSamplingHook(extractThoughtsHook)
}

