# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This project is an **Agentic Terminal Runtime** built around the Claude AI infrastructure. Far more than a simple command-line script, it serves as a robust TUI (Terminal User Interface) and Agent Runtime Container. It is designed to manage complex multi-turn conversation states, dynamically orchestrate MCP (Model Context Protocol) tools, spawn parallel subagents, and handle recursive context compression.

The codebase provides a highly hackable, high-performance local AI assistant running natively on the Bun engine, enhanced with custom capabilities like flexible authentication, Bing web search, and integrated modular workflows. 

**Important**: Requires Bun >= 1.2.0 (recommend latest via `bun upgrade`).

## Commands

```bash
# Install dependencies
bun install

# Dev mode (runs cli.tsx with MACRO defines injected via -d flags)
bun run dev

# Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# Build (code splitting, outputs dist/cli.js + ~450 chunk files)
bun run build

# Test
bun test                  # run all tests
bun test src/utils/__tests__/hash.test.ts   # run single file
bun test --coverage       # with coverage report

# Lint & Format (Biome)
bun run lint              # check only
bun run lint:fix          # auto-fix
bun run format            # format all src/
```

详细的测试规范、覆盖状态和改进计划见 `docs/testing-spec.md`。

## Architecture

### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `build.ts` 执行 `Bun.build()` with `splitting: true`，入口 `src/entrypoints/cli.tsx`，输出 `dist/cli.js` + ~450 chunk files。构建后自动替换 `import.meta.require` 为 Node.js 兼容版本（产物 bun/node 都可运行）。
- **Dev mode**: `scripts/dev.ts` 通过 Bun `-d` flag 注入 `MACRO.*` defines，运行 `src/entrypoints/cli.tsx`。`scripts/defines.ts` 集中管理 define map。
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — internal packages live in `packages/` resolved via `workspace:*`.
- **Lint/Format**: Biome (`biome.json`)。`bun run lint` / `bun run lint:fix` / `bun run format`。

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint. Sets up runtime globals:
   - `globalThis.MACRO` — build-time macro values (VERSION, BUILD_TIME, etc.)，通过 `scripts/dev.ts` 的 `-d` flags 注入。
   - `BUILD_TARGET`, `BUILD_ENV`, `INTERFACE_TYPE` globals。
   - `feature()` 由 `bun:bundle` 内置模块提供，不需要在此 polyfill。
2. **`src/main.tsx`** — Commander.js CLI definition. Parses args, initializes services (auth, analytics, policy), then launches the REPL or runs in pipe mode.
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog).

### Core Loop

- **`src/query.ts`** — Core conversation state machine. Manages multi-turn iteration, error recovery, tool execution orchestration. Does NOT handle user input parsing, session persistence, or permission checks — those are delegated via callbacks.
- **`src/QueryEngine.ts`** — Session lifecycle manager wrapping `query()`. Owns `mutableMessages`, `readFileState`, `totalUsage` across turns. The `submitMessage()` method is the main entry point for one conversation turn. Does NOT execute tools or make API calls directly.
- **`src/screens/REPL.tsx`** — Interactive TUI screen (React/Ink). Calls `queryEngine.submitMessage()` on user input. **Agency layer insertion point**: replace this call to wrap with `AgencyRuntime.run()`.
- **`src/main.tsx`** — CLI bootstrap. Fast-path dispatch (--version, daemon, bridge). Does NOT handle conversation logic.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events. Supports multiple providers: Anthropic direct, AWS Bedrock, Google Vertex, Azure. Provider selection in `src/utils/model/providers.ts`.
- **`src/utils/api.ts`** — System prompt construction, tool schema conversion, `cache_control` injection. Key functions: `splitSysPromptPrefix()` (splits prompt into cacheable prefix + dynamic suffix), `appendSystemContext()` / `prependUserContext()`. **Agency layer insertion point**: inject `IDENTITY_ANCHOR` as first block here to lock activation pattern.
- **`src/services/compact/`** — Context compression strategies (autocompact, microcompact, snip, reactive). Does NOT make API calls or execute tools.
- **`src/services/mcp/`** — MCP protocol integration, server connections, resource management, OAuth. Does NOT handle tool execution or message orchestration.

### Tool System

- **`src/Tool.ts`** — Tool interface (`Tool` type), `buildTool()` factory with safe defaults, `ToolUseContext` (the full execution context passed to every tool call), `findToolByName`, `toolMatchesName`.
- **`src/tools.ts`** — Tool registry. `getAllBaseTools()` is the source of truth. `getTools()` filters by permission context and mode. `assembleToolPool()` merges built-in + MCP tools (sorted for prompt-cache stability). Conditional loading via `feature()` flags and `process.env.USER_TYPE`.
- **`src/tools/<ToolName>/`** — Each tool in its own directory. Structure: `<Name>.ts` (logic) + `UI.tsx` (optional React renderer) + `prompt.ts` (description strings) + `constants.ts`.
- Tools with feature flag gates: `SleepTool` (PROACTIVE/KAIROS), `WebBrowserTool` (WEB_BROWSER_TOOL), `MonitorTool` (MONITOR_TOOL), `RemoteTriggerTool` (AGENT_TRIGGERS_REMOTE), `SnipTool` (HISTORY_SNIP), `WorkflowTool` (WORKFLOW_SCRIPTS).
- Tools gated by `USER_TYPE=ant`: `REPLTool`, `SuggestBackgroundPRTool`, `ConfigTool`, `TungstenTool`.
- **AgentTool** — Spawns forked subagents with isolated context. Used for parallel exploration. The `agentId` in `ToolUseContext` distinguishes subagent calls from main thread.

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`src/ink/`** — Custom Ink framework (forked/internal): custom reconciler, hooks (`useInput`, `useTerminalSize`, `useSearchHighlight`), virtual list rendering.
- **`src/components/`** — React components rendered in terminal via Ink. Key ones:
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics).
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering.
  - `PromptInput/` — User input handling.
  - `permissions/` — Tool permission approval UI.
- Components use React Compiler runtime (`react/compiler-runtime`) for heavy memoization optimization.

### State Management

- **`src/state/AppState.tsx`** — Central React state container (`DeepImmutable` type). Contains settings, tasks, MCP state, notifications, tool permission context. Read via `useAppState(selector)`, write via `useSetAppState()`. Does NOT own message history or file content.
- **`src/state/store.ts`** — Simple pub-sub store with `Object.is` dedup. Used by AppState.
- **`src/bootstrap/state.ts`** — Session-global singletons initialized once at startup. Owns: `sessionId`, `projectRoot`, `cwd`, `totalCostUSD`, `modelUsage`, `lastInteractionTime`, telemetry providers, `sessionCronTasks`. Accessed via plain getter/setter functions (not React hooks). Does NOT own UI interaction state.

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files). Both `getSystemContext()` and `getUserContext()` are memoized — call `setSystemPromptInjection()` to bust the cache. Does NOT participate in the conversation loop.
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy. `getMemoryFiles()` auto-discovers `~/.claude/**/*.md` — **writing files here is the zero-modification way to inject persistent context into every conversation**.
- **`src/memdir/`** — Memory directory management. `loadMemoryPrompt()` loads structured memory files into context.

### Module Boundaries (Quick Reference)

| Module | Owns | Does NOT own |
|--------|------|-------------|
| `query.ts` | Turn state machine, tool orchestration | User input, session persistence, permissions |
| `QueryEngine.ts` | Session state across turns, message history | API calls, tool execution, compression decisions |
| `REPL.tsx` | TUI rendering, user input, keyboard shortcuts | Conversation logic, API calls |
| `utils/api.ts` | System prompt construction, cache_control injection | API calls, message flow, MCP connections |
| `services/api/` | API client, error handling, provider selection | Message orchestration, tool execution |
| `services/compact/` | Context compression, token optimization | API calls, tool execution |
| `services/mcp/` | MCP connections, resource management, auth | Tool execution, message orchestration |
| `context.ts` | Static context building (git, CLAUDE.md) | Conversation loop participation |
| `tools.ts` | Tool registry assembly | Tool execution (delegated to each tool's `call()`) |

### Feature Flag System

Feature flags control which functionality is enabled at runtime. The system works as follows:

- **在代码中使用**: 统一通过 `import { feature } from 'bun:bundle'` 导入，调用 `feature('FLAG_NAME')` 返回 `boolean`。**不要**在 `cli.tsx` 或其他文件里自己定义 `feature` 函数或覆盖这个 import。
- **启用方式**: 通过环境变量 `FEATURE_<FLAG_NAME>=1`。例如 `FEATURE_BUDDY=1 bun run dev` 启用 BUDDY 功能。
- **Dev 模式**: `scripts/dev.ts` 自动扫描所有 `FEATURE_*` 环境变量，转换为 Bun 的 `--feature` 参数传递给运行时。
- **Build 模式**: `build.ts` 同样读取 `FEATURE_*` 环境变量，传入 `Bun.build({ features })` 数组。
- **默认行为**: 不设置任何 `FEATURE_*` 环境变量时，所有 `feature()` 调用返回 `false`，即所有 feature-gated 代码不执行。
- **常见 flag 名称**: `BUDDY`、`FORK_SUBAGENT`、`PROACTIVE`、`KAIROS`、`VOICE_MODE`、`DAEMON` 等（见 `src/commands.ts` 中的使用）。
- **类型声明**: `src/types/internal-modules.d.ts` 中声明了 `bun:bundle` 模块的 `feature` 函数签名。

**新增功能的正确做法**: 如果要让某个 feature-gated 模块（如 buddy）永久启用，应保留代码中 `import { feature } from 'bun:bundle'` + `feature('FLAG_NAME')` 的标准模式，在运行时通过环境变量或配置控制，而不是绕过 feature flag 直接 import。

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Stub packages in `packages/@ant/` |
| `*-napi` packages (audio, image, url, modifiers) | Stubs in `packages/` (except `color-diff-napi` which is fully implemented) |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / Voice Mode / LSP Server | Removed |
| Plugins / Marketplace | Removed |
| MCP OAuth | Simplified |

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Testing

- **框架**: `bun:test`（内置断言 + mock）
- **单元测试**: 就近放置于 `src/**/__tests__/`，文件名 `<module>.test.ts`
- **集成测试**: `tests/integration/`，共享 mock/fixture 在 `tests/mocks/`
- **命名**: `describe("functionName")` + `test("behavior description")`，英文
- **Mock 模式**: 对重依赖模块使用 `mock.module()` + `await import()` 解锁（必须内联在测试文件中，不能从共享 helper 导入）
- **当前状态**: 1286 tests / 67 files / 0 fail（详见 `docs/testing-spec.md` 的覆盖状态表和评分）

## Working with This Codebase

- **Feature flags** — 默认全部关闭（`feature()` 返回 `false`）。启用方式见上方 Feature Flag System 章节。不要在 `cli.tsx` 中重定义 `feature` 函数。
- **React Compiler output** — Components use compiler memoization boilerplate (`const $ = _c(N)`). This is expected.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` 是 Bun 内置模块，由运行时/构建器解析。不要用自定义函数替代它。
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
- **MACRO defines** — 集中管理在 `scripts/defines.ts`。Dev mode 通过 `bun -d` 注入，build 通过 `Bun.build({ define })` 注入。修改版本号等常量只改这个文件。
- **构建产物兼容 Node.js** — `build.ts` 会自动后处理 `import.meta.require`，产物可直接用 `node dist/cli.js` 运行。
