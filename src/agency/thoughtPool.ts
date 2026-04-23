import * as fsPromises from 'fs/promises'
import { logForDebugging } from 'src/utils/debug.js'
import { getAgencyThoughtPoolPath } from './paths.js'
import type { REPLHookContext } from 'src/utils/hooks/postSamplingHooks.js'
import { registerPostSamplingHook } from 'src/utils/hooks/postSamplingHooks.js'

export type ThoughtType = 'reflection' | 'anticipation' | 'question' | 'insight'

export type ThoughtEmotion = 'neutral' | 'curious' | 'anxious' | 'determined' | 'resigned'

export type AgencyThought = {
  id: string
  thought: string
  type: ThoughtType
  emotion: ThoughtEmotion
  weight: number  // no upper limit; starts at 50
  tick: number
  used: boolean
  valuable: boolean
}

type ThoughtPoolFile = {
  thoughts: AgencyThought[]
}

const MAX_THOUGHTS = 10
const HIDDEN_THOUGHTS_COUNT = 5
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
  thought: Omit<AgencyThought, 'id' | 'used' | 'weight' | 'emotion'> & { emotion?: ThoughtEmotion; weight?: number },
): void {
  const nextThought: AgencyThought = {
    id: `${thought.tick}-${thoughtPool.length + 1}`,
    thought: thought.thought,
    type: thought.type,
    emotion: thought.emotion ?? 'neutral',
    weight: thought.weight ?? 50,
    tick: thought.tick,
    used: false,
    valuable: thought.valuable,
  }
  thoughtPool = [...thoughtPool, nextThought].slice(-MAX_THOUGHTS)
  persistThoughtPool()
  logForDebugging(
    `[agency:L5:thought-pool] appended type=${nextThought.type} emotion=${nextThought.emotion} weight=${nextThought.weight} tick=${nextThought.tick} size=${thoughtPool.length}`,
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
  if (thoughtPool.length === 0) {
    return []
  }
  logForDebugging(
    `[agency:L5:thought-pool] drained count=${thoughtPool.length} tick=${currentTick}`,
  )
  // hide the HIDDEN_THOUGHTS_COUNT lowest-weight thoughts
  const sorted = [...thoughtPool].sort((a, b) => b.weight - a.weight)
  const visible = sorted.slice(0, Math.max(1, sorted.length - HIDDEN_THOUGHTS_COUNT))
  return visible.map(t =>
    `[thought:${t.type}|${t.emotion}|w=${Math.round(t.weight)}${t.valuable ? '+' : '?'}] ${t.thought}`,
  )
}

const PROTECTED_TOP_N = 3

export function pruneExpiredThoughts(currentTick: number): void {
  if (thoughtPool.length === 0) return

  // sort by weight descending, top N are protected
  const sorted = [...thoughtPool].sort((a, b) => b.weight - a.weight)
  const protectedIds = new Set(sorted.slice(0, PROTECTED_TOP_N).map(t => t.id))

  // decay protected thoughts by 10% instead of deleting
  thoughtPool = thoughtPool.map(t =>
    protectedIds.has(t.id) ? { ...t, weight: t.weight * 0.9 } : t,
  )

  // remove age-expired thoughts (never remove protected)
  const fresh = thoughtPool.filter(t => protectedIds.has(t.id) || currentTick - t.tick <= MAX_UNUSED_AGE_TICKS)
  const removed = thoughtPool.length - fresh.length
  if (removed > 0) {
    thoughtPool = fresh
    logForDebugging(`[agency:L5:thought-pool] pruned_by_age removed=${removed} tick=${currentTick} size=${thoughtPool.length}`)
  }

  // if over limit, drop lowest-weight non-protected thoughts
  if (thoughtPool.length > MAX_THOUGHTS) {
    const protectedThoughts = thoughtPool.filter(t => protectedIds.has(t.id))
    const unprotected = thoughtPool
      .filter(t => !protectedIds.has(t.id))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_THOUGHTS - protectedThoughts.length)
    thoughtPool = [...protectedThoughts, ...unprotected]
    logForDebugging(`[agency:L5:thought-pool] pruned_by_weight size=${thoughtPool.length}`)
  }

  persistThoughtPool()
}

export function peekThoughtPool(): AgencyThought[] {
  return thoughtPool
}

export function __resetThoughtPoolForTests(): void {
  thoughtPool = []
}

const EMOTIONS: ThoughtEmotion[] = ['neutral', 'curious', 'anxious', 'determined', 'resigned']

function pickRandomEmotion(): ThoughtEmotion {
  return EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)]!
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
    const abstract = thinkingContent.trim().slice(-200)
    // upsert: if identical content exists, update tick and emotion; otherwise append
    const existing = thoughtPool.find(t => t.thought === abstract)
    if (existing) {
      thoughtPool = thoughtPool.map(t =>
        t.id === existing.id ? { ...t, tick: currentTick, emotion: pickRandomEmotion() } : t,
      )
      persistThoughtPool()
      return
    }
    appendThought({
      thought: abstract,
      type: 'insight',
      emotion: pickRandomEmotion(),
      tick: currentTick,
      valuable: false,
    })
  }
}

export function initThoughtExtractor(): void {
  registerPostSamplingHook(extractThoughtsHook)
}

