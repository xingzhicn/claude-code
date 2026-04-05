import { randomUUID } from 'crypto'
import { logForDebugging } from 'src/utils/debug.js'
import { replaceDynamicState, getLatestWakeDebugInfo } from './index.js'
import { getAgencyDynamicStatePath } from './paths.js'
import { buildAgencyStateUpdatePrompt } from './prompts.js'
import {
  FileReadTool,
  type Output as FileReadToolOutput,
} from 'src/tools/FileReadTool/FileReadTool.js'
import {
  createCacheSafeParams,
  createSubagentContext,
  getLastCacheSafeParams,
  runForkedAgent,
  saveCacheSafeParams,
} from 'src/utils/forkedAgent.js'
import {
  registerPostSamplingHook,
  type REPLHookContext,
} from 'src/utils/hooks/postSamplingHooks.js'
import type { UserMessage } from 'src/types/message.js'
import { sequential } from 'src/utils/sequential.js'

function createAgencyUserMessage(content: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    message: { role: 'user', content },
  }
}

function getToolName(tool: { name: string } | string): string {
  return typeof tool === 'string' ? tool : tool.name
}

function getInputPath(input: Record<string, unknown>): string | undefined {
  if (typeof input.file_path === 'string') {
    return input.file_path
  }
  if (typeof input.notebook_path === 'string') {
    return input.notebook_path
  }
  if (typeof input.path === 'string') {
    return input.path
  }
  return undefined
}

import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'

async function canUseAgencyStateTool(
  tool: { name: string } | string,
  input: Record<string, unknown>,
  dynamicStatePath: string,
): Promise<PermissionDecision<Record<string, unknown>>> {
  const toolName = getToolName(tool)
  const inputPath = getInputPath(input)

  if (
    (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') &&
    inputPath === dynamicStatePath
  ) {
    return {
      behavior: 'allow',
      updatedInput: input,
    }
  }

  return {
    behavior: 'deny',
    message: 'agency state updates may only access dynamic_state.md',
    decisionReason: { type: 'other', reason: 'agency state updates may only access dynamic_state.md' }
  }
}

function refreshAgencySnapshot(nextDynamicState: string): void {
  const snapshot = getLastCacheSafeParams()
  if (!snapshot) {
    logForDebugging('[agency:L3:snapshot] skipped=no_snapshot')
    return
  }

  const nextSystemPrompt = snapshot.systemPrompt.map(block => {
    if (!block.startsWith('[T=')) {
      return block
    }

    const newlineIndex = block.indexOf('\n')
    if (newlineIndex === -1) {
      return nextDynamicState ? `${block}\n${nextDynamicState}` : block
    }

    return nextDynamicState
      ? `${block.slice(0, newlineIndex)}\n${nextDynamicState}`
      : block.slice(0, newlineIndex)
  })

  saveCacheSafeParams({
    ...snapshot,
    systemPrompt: nextSystemPrompt as unknown as string[] & { readonly __brand: "SystemPrompt" },
  })
  logForDebugging(
    `[agency:L3:snapshot] refreshed dynamic_len=${nextDynamicState.length}`,
  )
}

export const updateAgencyState = sequential(async function (
  context: REPLHookContext,
): Promise<void> {
  if (!context.querySource?.startsWith('repl_main_thread')) {
    logForDebugging(
      `[agency:L3:update] skipped querySource=${context.querySource ?? 'unknown'}`,
    )
    return
  }

  if (context.querySource === 'agency_keepalive') {
    logForDebugging('[agency:L3:update] skipped querySource=agency_keepalive')
    return
  }

  const dynamicStatePath = getAgencyDynamicStatePath()
  logForDebugging(
    `[agency:L3:update] start querySource=${context.querySource} path=${dynamicStatePath}`,
  )
  const setupContext = createSubagentContext(context.toolUseContext)
  setupContext.readFileState.delete(dynamicStatePath)

  const result = await FileReadTool.call(
    { file_path: dynamicStatePath },
    setupContext,
  )

  let currentDynamicState = ''
  const output = result.data as FileReadToolOutput
  if (output.type === 'text') {
    currentDynamicState = output.file.content
  }
  logForDebugging(
    `[agency:L3:update] pre-read type=${output.type} current_len=${currentDynamicState.length}`,
  )

  const wakeInfo = getLatestWakeDebugInfo()
  const recentThoughts = wakeInfo?.drainedThoughts ?? []

  const prompt = await buildAgencyStateUpdatePrompt(
    currentDynamicState,
    dynamicStatePath,
    recentThoughts,
  )

  await runForkedAgent({
    promptMessages: [createAgencyUserMessage(prompt)],
    cacheSafeParams: createCacheSafeParams(context),
    canUseTool: async (tool, input) =>
      canUseAgencyStateTool(tool, input as Record<string, unknown>, dynamicStatePath),
    querySource: 'agency_state_update',
    forkLabel: 'agency_state_update',
    overrides: { readFileState: setupContext.readFileState },
  })
  logForDebugging('[agency:L3:update] forked_agent_completed')

  const refreshed = await FileReadTool.call(
    { file_path: dynamicStatePath },
    setupContext,
  )

  const refreshedOutput = refreshed.data as FileReadToolOutput
  if (refreshedOutput.type === 'text') {
    replaceDynamicState(refreshedOutput.file.content)
    refreshAgencySnapshot(refreshedOutput.file.content)
    logForDebugging(
      `[agency:L3:update] hot_swap_completed refreshed_len=${refreshedOutput.file.content.length}`,
    )
  } else {
    logForDebugging(
      `[agency:L3:update] hot_swap_skipped type=${refreshedOutput.type}`,
    )
  }
})

export function initAgencyStateUpdater(): void {
  registerPostSamplingHook(updateAgencyState)
}
