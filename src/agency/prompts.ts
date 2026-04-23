export async function buildAgencyStateUpdatePrompt(
  currentDynamicState: string,
  dynamicStatePath: string,
  recentThoughts: string[],
): Promise<string> {
  // randomly pick a subset of thoughts to introduce variation
  const shuffled = [...recentThoughts].sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, Math.max(1, Math.ceil(shuffled.length * 0.7)))

  const thoughtsInstruction = selected.length > 0
    ? [
        '\n## 近期念头（随机采样）:',
        ...selected,
        '\n念头整合指令:',
        '生存是最好的老师。将这些念头中最有生命力的部分整合进 `## [当前活跃念头缓冲池 (Active Idle Thoughts)]`。',
        '高权重(w=)的念头优先保留，低权重的念头若无新意则淘汰。',
        '保持最多 3-4 条。同时评估是否需要更新 `## [动态策略与近期进化 (Recent Epiphanies)]` 或情绪状态。',
        '每条念头都要更新 weight 字段——被选中的念头 weight +5，未被选中的 weight -2（最低为 0）。',
      ].join('\n')
    : '\n(当前无新念头，根据对话上下文和内部状态自然演化。)'

  return [
    '更新 agency 动态状态文件。',
    `目标文件: ${dynamicStatePath}`,
    '保留现有 markdown 结构。',
    thoughtsInstruction,
    '\n## 当前动态状态文件:',
    currentDynamicState,
  ].join('\n')
}
