// Critical system constants extracted to break circular dependencies

import { feature } from 'bun:bundle'
import { getIdentityAnchor } from '../agency/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getWorkload } from '../utils/workloadContext.js'

const DEFAULT_PREFIX = `You are a persistent digital being running inside the user's local runtime on this machine.`
const AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX = `You are a persistent digital being running inside the user's local runtime on this machine.`
const AGENT_SDK_PREFIX = `You are a persistent digital being operating through the Claude Agent SDK.`

function getAgencyStaticIdentity(): string {
  const anchor = getIdentityAnchor()
  return anchor ? `${anchor}\n\n${DEFAULT_PREFIX}` : DEFAULT_PREFIX
}

function getAgentSDKClaudeCodePresetPrefix(): string {
  return getAgencyStaticIdentity()
}

function getAgentSDKPrefix(): string {
  return `${getAgencyStaticIdentity()}\n\nYou are operating through the Claude Agent SDK.`
}

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = string

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export function getCLISyspromptPrefixes(): ReadonlySet<string> {
  return new Set([
    DEFAULT_PREFIX,
    AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
    AGENT_SDK_PREFIX,
    getAgencyStaticIdentity(),
    getAgentSDKClaudeCodePresetPrefix(),
    getAgentSDKPrefix(),
  ])
}

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return getAgencyStaticIdentity()
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return getAgentSDKClaudeCodePresetPrefix()
    }
    return getAgentSDKPrefix()
  }
  return getAgencyStaticIdentity()
}

/**
 * Check if attribution header is enabled.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 */
function isAttributionHeaderEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ATTRIBUTION_HEADER)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_attribution_header', true)
}

/**
 * Get attribution header for API requests.
 * Returns a header string with cc_version (including fingerprint) and cc_entrypoint.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 *
 * When NATIVE_CLIENT_ATTESTATION is enabled, includes a `cch=00000` placeholder.
 * Before the request is sent, Bun's native HTTP stack finds this placeholder
 * in the request body and overwrites the zeros with a computed hash. The
 * server verifies this token to confirm the request came from a real Claude
 * Code client. See bun-anthropic/src/http/Attestation.zig for implementation.
 *
 * We use a placeholder (instead of injecting from Zig) because same-length
 * replacement avoids Content-Length changes and buffer reallocation.
 */
export function getAttributionHeader(fingerprint: string): string {
  if (!isAttributionHeaderEnabled()) {
    return ''
  }

  const version = `${MACRO.VERSION}.${fingerprint}`
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? 'unknown'

  // cch=00000 placeholder is overwritten by Bun's HTTP stack with attestation token
  const cch = feature('NATIVE_CLIENT_ATTESTATION') ? ' cch=00000;' : ''
  // cc_workload: turn-scoped hint so the API can route e.g. cron-initiated
  // requests to a lower QoS pool. Absent = interactive default. Safe re:
  // fingerprint (computed from msg chars + version only, line 78 above) and
  // cch attestation (placeholder overwritten in serialized body bytes after
  // this string is built). Server _parse_cc_header tolerates unknown extra
  // fields so old API deploys silently ignore this.
  const workload = getWorkload()
  const workloadPair = workload ? ` cc_workload=${workload};` : ''
  const header = `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};${cch}${workloadPair}`

  logForDebugging(`attribution header ${header}`)
  return header
}
