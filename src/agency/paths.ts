import { join } from 'path'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'

export function getAgencyDir(): string {
  return join(getClaudeConfigHomeDir(), 'agency')
}

export function getAgencyStaticCorePath(): string {
  return join(getAgencyDir(), 'static_core.md')
}

export function getAgencyDynamicStatePath(): string {
  return join(getAgencyDir(), 'dynamic_state.md')
}

export function getAgencyThoughtPoolPath(): string {
  return join(getAgencyDir(), 'thought-pool.json')
}

export function isAllowedAgencyFilePath(absPath: string): boolean {
  return (
    absPath === getAgencyStaticCorePath() ||
    absPath === getAgencyDynamicStatePath() ||
    absPath === getAgencyThoughtPoolPath()
  )
}
