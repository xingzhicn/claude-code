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
  }
  thoughtPool = [...thoughtPool, nextThought].slice(-MAX_THOUGHTS)
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] appended type=${nextThought.type} tick=${nextThought.tick} size=${thoughtPool.length}`,
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
  const drained = thoughtPool.filter(thought => !thought.used)
  if (drained.length === 0) {
    return []
  }

  thoughtPool = thoughtPool.map(thought =>
    thought.used ? thought : { ...thought, used: true },
  )
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] drained count=${drained.length} tick=${currentTick}`,
  )
  return drained.map(thought => `[thought:${thought.type}] ${thought.thought}`)
}

export function pruneExpiredThoughts(currentTick: number): void {
  const nextThoughtPool = thoughtPool.filter(thought => {
    if (thought.used) {
      return false
    }
    return currentTick - thought.tick <= MAX_UNUSED_AGE_TICKS
  })

  if (nextThoughtPool.length === thoughtPool.length) {
    return
  }

  const removed = thoughtPool.length - nextThoughtPool.length
  thoughtPool = nextThoughtPool
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] pruned removed=${removed} tick=${currentTick}`,
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

