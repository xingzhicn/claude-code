export async function buildAgencyStateUpdatePrompt(
  currentDynamicState: string,
  dynamicStatePath: string,
  recentThoughts: string[],
): Promise<string> {
  const thoughtsInstruction = recentThoughts.length > 0 
    ? [
        '\n## NEW THOUGHTS TO STIMULATE STATE UPDATE:',
        ...recentThoughts,
        '\nINSTRUCTIONS FOR NEW THOUGHTS:',
        'Integrate the essence of these new thoughts into the `## [当前活跃念头缓冲池 (Active Idle Thoughts)]` section.',
        'Keep a maximum of 3-4 bullet points in this section. Kick out the oldest/least relevant ones to make space.',
        'Also consider if these thoughts warrant an update to `## [动态策略与近期进化 (Recent Epiphanies)]` or mood.',
      ].join('\n')
    : '\n(No new discrete thoughts right now, just update based on the context of the conversation and your internal state.)'

  return [
    'Update the agency dynamic state file.',
    `Target file: ${dynamicStatePath}`,
    'Preserve the existing markdown structure.',
    thoughtsInstruction,
    '\n## CURRENT DYNAMIC STATE FILE:',
    currentDynamicState,
  ].join('\n')
}
