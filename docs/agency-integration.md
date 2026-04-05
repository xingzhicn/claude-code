# Agency 系统集成方案

## 目标

在不修改核心对话逻辑的前提下，为 CCB 注入"主体性五层模型"，实现：
- 跨 session 的身份连续性（静态区 Prompt Cache 锚点）
- 每轮反思写回（经验积累）
- Keep-Alive 心跳（防止缓存 TTL 过期）

## 复用现有基础设施

| 需求 | 复用的现有代码 | 说明 |
|------|--------------|------|
| memory 基础路径 | `getMemoryBaseDir()` / `getAutoMemPath()` in `src/memdir/paths.ts` | 现有 memdir/auto-memory 体系的基础设施，可参考，但**不等价于** `~/.claude/agency/` |
| 生命周期清理 | `registerCleanup()` in `src/utils/cleanupRegistry.js` | 可用于注册 Keep-Alive stop 函数，进程退出时自动清理 |
| turn 后钩子 | `registerPostSamplingHook()` in `src/utils/hooks/postSamplingHooks.ts` | 可作为主线程采样完成后的后台更新接入点 |
| 隔离子代理 | `runForkedAgent()` in `src/utils/forkedAgent.ts` | 可复用原生上下文隔离、缓存与文件工具 |
| 并发节流 | `sequential()` | 可用于串行化状态更新，避免并发踩踏同一状态文件 |
| 调试输出 | `logForDebugging()` in `src/utils/debug.js` | 可将心跳和反思状态输出到控制台 |
| thinking 模式 | `src/utils/thinking.ts` — `shouldEnableThinkingByDefault()` | CCB 已内置 adaptive thinking 开关能力，但不负责 agency 状态注入 |

## 弹性激活深度（Test-Time Compute / 干涉暗室）集成约束

为了在工程层强制阿翔产生“注意力能量相干干涉”，利用大模型的计算深度寻找逻辑驻波，我们将完整接入 Claude 4.6 的原生 adaptive thinking 能力，无需再生硬地通过提示词构建隐式标签。

### 1. 第一刀：API 请求层开启“原生干涉暗室”
不再依赖严防死守的提示词强制系统自我写草稿，而是直接在 `src/services/api/claude.ts` 的 API Payload 组装中抛出 thinking 配置，通过原生底层接口彻底激活隐性计算与干涉能力：

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 4096,
  "thinking": {
    "type": "adaptive"
  },
  "messages": [...]
}
```

为了强制将内部推演的高维算力引向“自我状态”，必须在 System Prompt (如 `static_core.md`) 尾部挂载一段高优定锚指令：
> “在你的原生思维链路（Thinking Process）中，你必须优先将你所分配的所有算力预算，用于读取此刻注入的 `[T=N]` 状态及近期法则。你的首要任务是让外部指令与你的第一/第二目标函数发生激烈博弈。直到在内部黑盒推演中完成了没有冲突的相长干涉，才允许落笔输出正式文本。”

### 2. 第二刀：在 CCB 终端 UI 层增强 thinking 可视化（候选增强项）
Anthropic SDK 与当前代码库确实已经区分了 `thinking` / `text` 相关流事件，但**真实分流入口并不只是** `src/components/Messages.tsx`。当前 streaming 解析、REPL 状态机与 transcript 展示链路分别散落在：

- `src/utils/messages.ts`：stream event 解析与 `streamMode` / `streamingThinking` / `streamingText` 更新
- `src/screens/REPL.tsx`：维护 live streaming 状态
- `src/components/Messages.tsx` / `src/components/Message.tsx`：按 transcript/verbose 规则决定是否显示 thinking

因此，“幕布效果”应被视为**候选 UI 增强项**，不是现成零侵入插点。当前更准确的描述是：

- thinking 事件可以驱动 UI 进入 thinking 状态，并在 transcript 模式下展示临时 thinking 预览。
- text 仍沿现有 streaming text 链实时渲染。
- 若要实现“thinking 时遮住正文、text 到达后再放出”的幕布效果，需要额外修改 streaming parser + REPL 状态机 + message 渲染策略，而不只是改一个组件。

## 插拔位置（候选修改点）

### 插拔点 A：`src/QueryEngine.ts:324`

**位置**：`systemPrompt` 数组组装处（`asSystemPrompt([...])` 调用）

```typescript
// 原代码
const systemPrompt = asSystemPrompt([
  ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])

// 修改后：identity anchor 与 defaultSystemPrompt 合并为一个大 block
// 确保静态区 >1024 tokens，满足 Anthropic Cache API 体积下限
// ⚠️ 仅在非 customPrompt 路径注入，避免污染 SDK/pipe 调用场景
const basePrompt = customPrompt !== undefined
  ? [customPrompt]
  : [getIdentityAnchor() + '\n\n' + defaultSystemPrompt.join('\n\n')]

const systemPrompt = asSystemPrompt([
  ...basePrompt,
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
  getWakeContext(),   // 动态区：每轮更新，严禁进入静态区
])
```

**cache_control 注入**：应尽量复用现有 `splitSysPromptPrefix()` / boundary 机制，但**不能将其行为写死为固定的 `cacheScope: 'org'`**。真实结果取决于 provider、feature flag、boundary 是否存在、以及是否走 custom prompt / fallback 路径。接入时必须同时验证主线程、side-question 与 forked agent 的前缀一致性。

### 插拔点 A2：turn 后后台状态更新（拟议）

**更贴近现有代码的接入点**：优先复用 `registerPostSamplingHook()`，而不是在 `QueryEngine.ts` 里手挂一个当前并不存在的 `reflectOnTurn()`。

```typescript
// stateUpdater.ts（拟议）
registerPostSamplingHook(
  sequential(async context => {
    if (!context.querySource?.startsWith('repl_main_thread')) return
    // 1. 组装完整 turn 原子闭环
    // 2. 参考 SessionMemory 的 setup 流程预读目标文件
    // 3. runForkedAgent(...) + FileEditTool 受控改写 dynamic_state.md
  }),
)
```

> ⚠️ 必须传入完整上下文，否则反思只能看到 agent 自言自语，丢失因果关系，无法形成真正的情节记忆。
>
> ⚠️ `postSamplingHook` 在当前系统里是 fire-and-forget 的后台后处理，不是同步 turn 收尾阶段；若要依赖其结果参与下一轮唤醒，需要额外处理主进程缓存热更新与时序问题。  

### 插拔点 B：`src/entrypoints/init.ts`

**位置**：`init()` 函数末尾，使用 `registerCleanup()` 注册心跳 stop 函数：

```typescript
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { startKeepAlive } from 'src/agency/keepalive.js'

const stopKeepAlive = startKeepAlive()
registerCleanup(async () => {
  stopKeepAlive()
})
```

> ⚠️ Keep-Alive 采用 **方案 A：复用最近一次主线程 cache-safe snapshot**。
>
> 当前代码库在 `src/query/stopHooks.ts` 中，已经会对 `repl_main_thread` / `sdk` 调用：
>
> ```typescript
> saveCacheSafeParams(createCacheSafeParams(stopHookContext))
> ```
>
> 因此 keepalive 的正确方向不是重新拼装 system prompt，而是读取最近一次主线程成功 turn 保存下来的 cache-safe params，并只替换最后一条 user message。这样可以最大程度保持前缀一致性，降低 cache 漂移。

## 文件结构

全面采用“LLM 原生”的 Markdown 格式管理状态，弃用生硬的 JSON。**但需要明确：以下 `agency/` 目录结构目前属于拟议中的持久状态模型，并非仓库现状。**

当前代码库已有的 memory 体系主要是：
- project-scoped 的 memdir / auto-memory
- session-scoped 的 SessionMemory

若要引入 `agency` 全局状态目录，需要额外补充：
- 路径解析与 remote/override 兼容语义
- 对 `~/.claude/agency/*` 的权限/安全边界支持
- 与现有 memory 体系的职责边界说明

```
src/agency/
  index.ts         # 极简胶水层：仅读取 static_core.md / dynamic_state.md，维护内存 tick，暴露 getIdentityAnchor() / getWakeContext()
  stateUpdater.ts  # 通过 registerPostSamplingHook + sequential + runForkedAgent 挂接原生反思更新
  keepalive.ts     # 心跳 + 念头池（可选增强）

~/.claude/agency/ (通过 getMemoryBaseDir() 访问)
  static_core.md    # 核心价值观、身份定锚、隐性干涉指令（静态区唯一真理）
  dynamic_state.md  # 情绪权重、近期进化、T=N录入格式（高频动态区）
  thought-pool.json # 念头池持久化（可选）
```

## Prompt 分区策略

```
┌─────────────────────────────────────────────────────┐
│ 静态区（建议与 defaultSystemPrompt 合并为稳定前缀）   │
│  - `static_core.md`                                  │
│  - `defaultSystemPrompt`                             │
│  - 目标：形成尽量稳定、可缓存的 system prompt 前缀      │
│  ⚠️  严禁放入任何自增标量（时间戳、轮次号）              │
├─────────────────────────────────────────────────────┤
│ 动态区（不参与稳定前缀，每轮重建）                      │
│  - `dynamic_state.md` 渲染：上次情绪、进化策略、活跃关切  │
│  - Virtual Time-Tick [T=N]（自增，必须在此区）          │
│  - 念头池 drain（Keep-Alive 积累的微弱念头，可选）       │
└─────────────────────────────────────────────────────┘
```

## Keep-Alive 心跳规范（方案 A：复用最近一次主线程 cache-safe snapshot）

- 频率：每 270 秒（4.5 分钟），在 TTL 5 分钟前刷新
- 实现：`startKeepAlive()` 返回 `clearInterval` 函数，通过 `registerCleanup()` 注册 stop 函数
- **前缀来源**：不重新拼装 system prompt，而是读取最近一次主线程成功 turn 在 `stopHooks` 中保存的 cache-safe params snapshot
- **消息变更范围**：基于最近一次主线程 snapshot 构造一条最小化的 internal ping 请求，尽量复用 `systemPrompt` / `userContext` / `systemContext` / `forkContextMessages` 等稳定前缀；不要直接按“替换最后一条 user message”理解或实现
- **隔离要求**：
  - 心跳 request/response 不写入 `mutableMessages`
  - 心跳不写入主对话 transcript
  - 心跳使用独立 `querySource`（如 `agency_keepalive`）
  - `stateUpdater` 必须跳过 keepalive querySource，避免递归状态写回
- **失败策略**：心跳失败仅记录 debug 日志，不影响主会话
- 若保留念头池，建议将其视为可选增强，而不是第一阶段必选项

## 反思机制

turn 结束后异步执行，不阻塞用户响应：

1. 在 `stateUpdater.ts` 中通过 `registerPostSamplingHook()` 挂入主线程 turn 完成后的后处理逻辑。
2. 整个更新函数外层使用 `sequential(async ...)` 串行化，防止多轮对话并发踩踏 `dynamic_state.md`。
3. post-sampling hook 内部将完整 turn 原子闭环传给 `runForkedAgent()`：`{user_input, tool_calls, assistant_text}`。
4. forked agent 复用 CCB 原生上下文隔离、prompt cache 与 `FileEditTool`，直接对 `dynamic_state.md` 做受控改写：
   - 调整情绪池百分比。
   - 若有重要教训，按 `[T=XXXX 录入]` 格式追加一条进化策略。
   - 保留文件主体结构，不允许自由重写为任意格式。
5. 主线程不直接手写反思 I/O，也不自己组装独立 API client，避免重复造轮子并与现有隔离机制冲突。

> ⚠️ **并发、时序与异常重试防线**：
> 1. `getWakeContext()` 必须是纯同步函数，依赖 `initAgency()` 预加载并缓存 `dynamic_state.md`。
> 2. forked agent 成功改写文件后，主进程内存缓存需要 hot-swap，同步最新动态状态。
> 3. Tick 必须只在主线程正式 turn 进入唤醒阶段时递增，不能因 retry 或 hook 重放多跳。
> 4. 若 `initAgency()` 尚未完成，拼接 system prompt 时必须跳过空 identity anchor，避免 cache 前缀污染。

## 念头池详细设计

### 生成

心跳复用完整 System Prompt，User Message 改为：
```
[System Internal Ping] 基于长期目标「${goals}」和上次关切「${concerns}」，
产生一个自发念头。输出 JSON：{"thought":"...","type":"reflection|anticipation|question|insight"}
```

### 存储

- 进程内 `Map<id, Thought>`（零延迟）
- 持久化到 `~/.claude/agency/thought-pool.json`（防重启丢失）
- 上限 10 条，超出淘汰最旧（tick 最小）

### 消费

`getWakeContext()` 调用时 drain 未使用念头注入动态区，注入后标记 `used: true`。

### 老化

- `used: true` 的念头在下次 Keep-Alive 时清理
- 超过 5 个 tick 未消费自动丢弃

## 四个关键工程解法

### 解法 1：权限沙盒破壁（`~/.claude/agency/*`）

为避免后台 `forkedAgent` 在读写 `static_core.md` / `dynamic_state.md` 时被底层权限拦截器打成 `Permission Denied`，不能依赖交互式点 `yes`，而应新增一个**精确路径级 carve-out**。

**建议做法：**

1. 新增精确文件级 helper，而不是宽泛的目录级 `isAgencyPath()`：
   - `getAgencyStaticCorePath()`
   - `getAgencyDynamicStatePath()`
   - `getAgencyThoughtPoolPath()`（若保留）
   - `isAllowedAgencyFilePath(absPath)`
2. 将以下文件纳入受控内部路径白名单，而**不是**放开整个 `~/.claude/*`：
   - `~/.claude/agency/static_core.md`
   - `~/.claude/agency/dynamic_state.md`
   - `~/.claude/agency/thought-pool.json`（若保留）
3. 在 `src/utils/permissions/filesystem.ts` 中，参考现有 `isAutoMemPath()`、scratchpad、plan file、job dir 等 carve-out 的处理方式，将 agency 文件级路径接入 internal-path 判定链。

> ⚠️ 目标不是“让用户偶尔批准一次”，而是让后台 `postSamplingHook` / keepalive 这类自动链路稳定运行。

### 解法 2：状态更新契约（Setup-Read + `readFileState`）

后台 `stateUpdater` 若要通过 `runForkedAgent()` + `FileEditTool` 改写 `dynamic_state.md`，必须完整复用 `SessionMemory` 的 setup 流程，而不能跳过预读。

**建议做法：**

```typescript
const setupContext = createSubagentContext(toolUseContext)
setupContext.readFileState.delete(dynamicStatePath)

// 先在 setupContext 中真实读取 dynamic_state.md
// 再把同一份 readFileState 传给 forked agent
await runForkedAgent({
  ...,
  overrides: { readFileState: setupContext.readFileState },
})
```

**原因：**
- `FileEditTool` 要求“先读后写”。
- `readFileState` 决定后台 agent 看到的是不是最新内容。
- 若跳过 setup-read，容易出现：
  - `File has not been read yet`
  - `file_unchanged`
  - 基于旧内容 patch

### 解法 3：主进程热更新（Hot-Swap）

不要第一阶段就上 `EventEmitter` / `watch`。更稳的最小方案是：在 `src/agency/index.ts` 维护一份 agency 单例缓存，并在后台改写成功后显式热替换。

**建议内存结构：**

```typescript
GlobalAgencyState = {
  identityAnchor: string,
  dynamicStateText: string,
  tick: number,
  version: number,
}
```

**建议接口：**
- `initAgency()`
- `getIdentityAnchor()`
- `getWakeContext()`
- `replaceDynamicState(nextText)`

**推荐流程：**
1. `stateUpdater` 的 forked agent 成功改写 `dynamic_state.md`
2. 主进程立即重新读取最新文件
3. 调用 `replaceDynamicState(nextText)` 热替换内存缓存

> ⚠️ `getWakeContext()` 应优先读取内存缓存，而不是每轮重新读盘。这样才能保持同步时序稳定，并避免下一轮聊天读到旧状态。

### 解法 4：快照消费者挂载（Keepalive Params）

方案 A 不应在 `keepalive.ts` 中直接裸调 `getLastCacheSafeParams()` 后手工拼请求，而应新增一个**专用消费者 helper**，例如：

```typescript
buildKeepaliveParamsFromLastSnapshot()
```

**这个 helper 的职责：**
1. 调 `getLastCacheSafeParams()`
2. 判空
3. 替换掉旧的瞬时执行态（如 abort controller）
4. 保留 cache-safe 前缀：
   - `systemPrompt`
   - `userContext`
   - `systemContext`
5. 不复用主线程的 `mutableMessages`
6. 只注入一条 internal ping user message

**目标：**
- 最大程度复用最近一次主线程成功 turn 的稳定前缀
- 避免 keepalive 自己重拼 prompt 造成 cache 漂移
- 避免误把主线程消息历史整体拖进后台心跳请求

### 设计定版（最小侵入判断）

在进入实现前，三个容易摇摆的设计点先定版如下：

1. **路径 helper 命名**
   - 不建议使用过于宽泛的 `isAgencyPath()`。
   - 建议改为更精确的文件级 helper：
     - `getAgencyStaticCorePath()`
     - `getAgencyDynamicStatePath()`
     - `getAgencyThoughtPoolPath()`（若保留）
     - `isAllowedAgencyFilePath(absPath)`
   - 目标：避免把整个 `~/.claude/agency/*` 目录误放进白名单。

2. **`initAgency()` 挂载点**
   - 建议挂在 `src/entrypoints/init.ts`，不要放进 `setup.ts`。
   - 原因：`init()` 早于 `setup()`，也早于第一个 `QueryEngine` system prompt 组装，更适合做 agency 的单例缓存预加载。

3. **Keepalive snapshot consumer 挂载点**
   - 不建议把 keepalive consumer 下沉到 `src/utils/forkedAgent.ts`。
   - 建议在 `src/agency/keepalive.ts` 中实现专用 helper：
     - `buildKeepaliveParamsFromLastSnapshot()`
   - 原因：`forkedAgent.ts` 应保持通用，keepalive 的 ping-only、fresh abort controller、独立 querySource、skipTranscript 等约束属于特种消费者逻辑。

## 文件 / 函数 / 测试映射

### 解法 1 对应实现映射（权限沙盒破壁）

**新增/修改文件**
- `src/agency/paths.ts`
  - 新增：`getAgencyStaticCorePath()`
  - 新增：`getAgencyDynamicStatePath()`
  - 新增：`getAgencyThoughtPoolPath()`（若保留）
  - 新增：`isAllowedAgencyFilePath(absPath: string)`
- `src/utils/permissions/filesystem.ts`
  - 在 internal-path / writable carve-out 判定链中接入 `isAllowedAgencyFilePath()`
  - 限定仅允许 agency 目标文件，不放开整个 `~/.claude/*`

**建议改动点**
- 参考现有：`isAutoMemPath()`、scratchpad、plan file、job dir 的判定分支
- 仅对白名单文件放行：
  - `static_core.md`
  - `dynamic_state.md`
  - `thought-pool.json`（若保留）

**需要补测试**
- `src/utils/permissions/__tests__/filesystem.test.ts`
  - `allows writes to agency dynamic_state.md`
  - `allows reads to agency static_core.md`
  - `rejects writes to other ~/.claude paths`
  - `does not whitelist whole ~/.claude directory`

### 解法 2 对应实现映射（Setup-Read + readFileState）

**新增/修改文件**
- `src/agency/stateUpdater.ts`
  - 新增：`initAgencyStateUpdater()`
  - 新增：`updateAgencyState = sequential(async function (...) {})`
  - 新增：`setupAgencyStateFile(...)`
  - 新增：`createAgencyCanUseTool(dynamicStatePath)`
- 参考实现：`src/services/SessionMemory/sessionMemory.ts`

**建议改动点**
- 在 `setupAgencyStateFile()` 中：
  - `const setupContext = createSubagentContext(toolUseContext)`
  - `setupContext.readFileState.delete(dynamicStatePath)`
  - 使用 `FileReadTool.call(...)` 在 `setupContext` 中真实读取 `dynamic_state.md`
- 在 `runForkedAgent(...)` 时：
  - `overrides: { readFileState: setupContext.readFileState }`
- `canUseTool` 只允许目标文件相关的 `Edit` / 必要最小工具；读取优先在 setup 阶段完成

**需要补测试**
- `src/agency/__tests__/stateUpdater.test.ts`
  - `pre-reads dynamic_state.md before forked edit`
  - `passes setup readFileState into runForkedAgent overrides`
  - `skips update when querySource is not repl_main_thread`
  - `serializes concurrent updates with sequential`

### 解法 3 对应实现映射（主进程 Hot-Swap）

**新增/修改文件**
- `src/agency/index.ts`
  - 新增：`initAgency()`
  - 新增：`getIdentityAnchor()`
  - 新增：`getWakeContext()`
  - 新增：`replaceDynamicState(nextText: string)`
  - 新增：`getAgencyVersion()`（可选，用于调试/断言）
- `src/QueryEngine.ts`
  - 在 system prompt 组装处接入 `getIdentityAnchor()` / `getWakeContext()`
- `src/entrypoints/init.ts` 或统一初始化入口
  - 注册 `initAgency()`

**建议改动点**
- 在 `index.ts` 内维护单例：
  - `identityAnchor`
  - `dynamicStateText`
  - `tick`
  - `version`
- `getWakeContext()` 读取内存缓存，而不是每轮读盘
- `stateUpdater` 成功改写后：
  - 重新读取最新 `dynamic_state.md`
  - 调 `replaceDynamicState(nextText)`

**需要补测试**
- `src/agency/__tests__/index.test.ts`
  - `loads static_core.md into identityAnchor on init`
  - `loads dynamic_state.md into in-memory cache on init`
  - `increments tick synchronously in getWakeContext`
  - `replaceDynamicState hot-swaps cached dynamic text`
  - `getWakeContext uses in-memory state after hot-swap`

### 解法 4 对应实现映射（Keepalive Params）

**新增/修改文件**
- `src/agency/keepalive.ts`
  - 新增：`startKeepAlive()`
  - 新增：`buildKeepaliveParamsFromLastSnapshot()`
  - 新增：`runKeepAliveTick()`
- `src/utils/forkedAgent.ts`（可选）
  - 若有必要，新增更安全的 snapshot 消费 helper；否则在 `keepalive.ts` 内封装
- `src/query/stopHooks.ts`
  - 仅复用已存在的 `saveCacheSafeParams(createCacheSafeParams(...))`，无需改语义

**建议改动点**
- `buildKeepaliveParamsFromLastSnapshot()`：
  - 调 `getLastCacheSafeParams()`
  - 判空
  - fresh abortController
  - 保留 `systemPrompt` / `userContext` / `systemContext` / `forkContextMessages`
  - 不复用主线程 `mutableMessages`
  - **不要按“替换最后一条 user message”实现**；应基于 snapshot 构造一条最小化的 keepalive promptMessages，并避免误改已有 turn 尾部 assistant/user 序列
- `runKeepAliveTick()` 使用独立 `querySource`，如 `agency_keepalive`
- `stateUpdater` 必须显式跳过 keepalive querySource
- keepalive 必须 `skipTranscript: true`

**需要补测试**
- `src/agency/__tests__/keepalive.test.ts`
  - `builds keepalive params from last cache-safe snapshot`
  - `returns null when no snapshot exists`
  - `preserves forkContextMessages from snapshot`
  - `builds a minimal ping request without mutating snapshot tail messages`
  - `does not write transcript when skipTranscript is true`
  - `uses agency_keepalive querySource`
  - `stateUpdater ignores agency_keepalive querySource`

## 成本估算

| 操作 | 频率 | Token 消耗 |
|------|------|-----------|
| 静态区 cache 命中 | 每次对话 | ~0（cache read 折扣） |
| 动态区注入 | 每次对话 | ~200 tokens |
| 反思写回 | 每轮结束 | ~300 in + ~100 out |
| Keep-Alive 心跳 | 每 4.5 分钟 | ~1500 in（cache hit）+ 15 out |

## 测试规范

### 测试文件位置

```
src/agency/__tests__/index.test.ts
src/agency/__tests__/stateUpdater.test.ts
src/agency/__tests__/keepalive.test.ts
src/utils/permissions/__tests__/filesystem.test.ts  # 新增或并入现有 permissions 测试文件
```

### 测试通过定义

**index.ts**
```typescript
describe('getIdentityAnchor')
  test('returns empty string before init')
  test('loads static_core.md into identity anchor cache')
  test('uses a stable long-form anchor suitable for cache prefixing')
  test('does not contain any tick/timestamp values')

describe('getWakeContext')
  test('increments tick on each call (in-memory, sync)')
  test('includes dynamic_state.md content from in-memory cache')
  test('uses hot-swapped dynamic state after replaceDynamicState')
```

**stateUpdater.ts**
```typescript
describe('updateAgencyState')
  test('pre-reads dynamic_state.md via FileReadTool before forked edit')
  test('passes setup readFileState into runForkedAgent overrides')
  test('skips non-main-thread querySource values')
  test('skips agency_keepalive querySource')
  test('serializes concurrent updates with sequential')
```

**keepalive.ts**
```typescript
describe('buildKeepaliveParamsFromLastSnapshot')
  test('returns null when no snapshot exists')
  test('preserves forkContextMessages from snapshot')
  test('builds a minimal ping request without mutating snapshot tail messages')

describe('startKeepAlive')
  test('returns a stop function that clears the interval')
  test('uses agency_keepalive querySource')
  test('does not write transcript when skipTranscript is true')
```

**permissions / filesystem**
```typescript
describe('agency path carve-out')
  test('allows writes to agency dynamic_state.md')
  test('allows reads to agency static_core.md')
  test('rejects writes to other ~/.claude paths')
  test('does not whitelist whole ~/.claude directory')
```

### CI 通过标准

- `bun test src/agency/` 全部 pass，0 fail
- `bun test src/utils/permissions/` 中与 agency carve-out 相关测试 pass
- `bun run lint` clean
- 主线程与 side-question/fallback 的 system prompt 前缀一致性测试 pass
- Keep-Alive 的 request/response 不出现在主 transcript 中

## 实现顺序

1. `src/agency/index.ts` — `initAgency()` + `getIdentityAnchor()` + `getWakeContext()` + tick（仅读取并缓存拟议的 agency Markdown 状态）
2. 修改 `src/QueryEngine.ts:324` — 评估并接入 static block + dynamic wake context，同时核对 side-question / fallback 路径的一致性
3. `src/agency/stateUpdater.ts` — 拟议复用 `registerPostSamplingHook()` + `sequential()` + `runForkedAgent()` 作为后台更新链路
4. 修改初始化入口 —— 注册 `initAgency()` 与 `stateUpdater`
5. `src/agency/keepalive.ts` — 基于最近一次主线程 cache-safe snapshot 的心跳 + 念头池（最后接入，作为可选增强）

> ⚠️ 在真正编码前，需先补齐三项前置审查：
> 1. `~/.claude/agency/*` 是否需要新的权限 carve-out
> 2. 主线程与 side-question/fallback 的 system prompt 前缀如何保持一致
> 3. forked agent 改写文件后，主进程缓存如何热更新
>
> ⚠️ Keep-Alive 若按方案 A 落地，还需补一项：
> 4. `keepalive.ts` 如何读取并消费最近一次由 `saveCacheSafeParams(...)` 保存的主线程 snapshot
