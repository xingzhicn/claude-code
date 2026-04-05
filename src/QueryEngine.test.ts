import { beforeEach, describe, expect, mock, test } from "bun:test";

globalThis.MACRO = { VERSION: "test" } as any;

let capturedSystemPrompt: readonly string[] | null = null;

const actualBootstrapState = await import("./bootstrap/state.js");

mock.module("src/bootstrap/state.js", () => ({
  ...actualBootstrapState,
  getSessionId: () => "session-id",
  isSessionPersistenceDisabled: () => true,
}));

const actualClaudeApi = await import("./services/api/claude.js");

mock.module("src/services/api/claude.js", () => ({
  ...actualClaudeApi,
  accumulateUsage: (_a: unknown, b: unknown) => b,
  updateUsage: (_a: unknown, b: unknown) => b,
}));

mock.module("src/services/api/logging.js", () => ({
  EMPTY_USAGE: {},
}));

mock.module("./commands.js", () => ({
  getSlashCommandToolSkills: async () => [],
}));

mock.module("./cost-tracker.js", () => ({
  getModelUsage: () => ({}),
  getTotalAPIDuration: () => 0,
  getTotalCost: () => 0,
}));

mock.module("./memdir/memdir.js", () => ({
  loadMemoryPrompt: async () => "MEMORY_PROMPT",
}));

const actualMemdirPaths = await import("./memdir/paths.js");

mock.module("./memdir/paths.js", () => ({
  ...actualMemdirPaths,
  hasAutoMemPathOverride: () => false,
}));

mock.module("./query.js", () => ({
  query: async function* () { },
}));

const actualApiErrors = await import("./services/api/errors.js");

mock.module("./services/api/errors.js", () => ({
  ...actualApiErrors,
  categorizeRetryableAPIError: () => null,
}));

mock.module("./utils/abortController.js", () => ({
  createAbortController: () => new AbortController(),
}));

const actualConfig = await import("./utils/config.js");

mock.module("./utils/config.js", () => ({
  ...actualConfig,
  getGlobalConfig: () => ({ theme: "dark" }),
}));

const actualEnvUtils = await import("./utils/envUtils.js");

mock.module("./utils/envUtils.js", () => ({
  ...actualEnvUtils,
  isBareMode: () => false,
  isEnvTruthy: () => false,
}));

mock.module("./utils/fastMode.js", () => ({
  getFastModeState: () => false,
}));

mock.module("./utils/fileHistory.js", () => ({
  fileHistoryEnabled: () => false,
  fileHistoryMakeSnapshot: async () => { },
}));

mock.module("./utils/fileStateCache.js", () => ({
  cloneFileStateCache: (v: unknown) => v,
}));

mock.module("./utils/headlessProfiler.js", () => ({
  headlessProfilerCheckpoint: () => { },
}));

mock.module("./utils/hooks/hookHelpers.js", () => ({
  registerStructuredOutputEnforcement: () => { },
}));

mock.module("./utils/log.js", () => ({
  getInMemoryErrors: () => [],
  logError: () => { },
  logToFile: () => { },
  getLogDisplayTitle: () => "",
  logEvent: () => { },
  logMCPError: () => { },
  logMCPDebug: () => { },
  dateToFilename: (d: Date) => d.toISOString().replace(/[:.]/g, "-"),
  getLogFilePath: () => "/tmp/mock-log",
  attachErrorLogSink: () => { },
  loadErrorLogs: async () => [],
  getErrorLogByIndex: async () => null,
  captureAPIRequest: () => { },
  _resetErrorLogForTesting: () => { },
}));

const actualMessages = await import("./utils/messages.js");

mock.module("./utils/messages.js", () => ({
  ...actualMessages,
  countToolCalls: () => 0,
  SYNTHETIC_MESSAGES: [],
}));

mock.module("./utils/model/model.js", () => ({
  getMainLoopModel: () => "claude-sonnet-4-6",
  parseUserSpecifiedModel: (v: string) => v,
}));

mock.module("./utils/plugins/pluginLoader.js", () => ({
  loadAllPluginsCacheOnly: async () => ({ enabled: [] }),
}));

mock.module("./utils/processUserInput/processUserInput.js", () => ({
  processUserInput: async () => ({
    messages: [],
    shouldQuery: false,
    allowedTools: {},
    model: null,
    resultText: "",
  }),
}));

mock.module("./utils/queryContext.js", () => ({
  fetchSystemPromptParts: async () => ({
    defaultSystemPrompt: ["DEFAULT_PROMPT"],
    userContext: { cwd: "/repo" },
    systemContext: { date: "2026-04-05" },
  }),
}));

mock.module("./utils/Shell.js", () => ({
  setCwd: () => { },
}));

mock.module("./utils/sessionStorage.js", () => ({
  flushSessionStorage: async () => { },
  recordTranscript: async () => { },
}));

mock.module("./utils/systemPromptType.js", () => ({
  asSystemPrompt: (value: readonly string[]) => {
    capturedSystemPrompt = value;
    return value;
  },
}));

mock.module("./utils/systemTheme.js", () => ({
  resolveThemeSetting: (v: unknown) => v,
}));

mock.module("./utils/thinking.js", () => ({
  shouldEnableThinkingByDefault: () => true,
}));

mock.module("./utils/messages/systemInit.js", () => ({
  buildSystemInitMessage: () => ({ type: "system", subtype: "init", uuid: "init-msg" }),
  sdkCompatToolName: (name: string) => name,
}));

mock.module("./utils/permissions/filesystem.js", () => ({
  getScratchpadDir: () => "/tmp/scratchpad",
  isScratchpadEnabled: () => false,
}));

mock.module("./utils/queryHelpers.js", () => ({
  handleOrphanedPermission: async function* () { },
  isResultSuccessful: () => true,
  normalizeMessage: async function* () { },
}));

mock.module("./agency/index.js", () => ({
  getIdentityAnchor: () => "STATIC_CORE_IDENTITY",
  getWakeContext: () => "[T=0001]\nWAKE_CONTEXT",
}));

const { QueryEngine } = await import("./QueryEngine");

function createEngine(overrides: Record<string, unknown> = {}) {
  return new QueryEngine({
    cwd: "/repo",
    tools: [],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: "allow" }),
    getAppState: () => ({
      toolPermissionContext: {
        additionalWorkingDirectories: new Map(),
        mode: "default",
      },
      fastMode: false,
      fileHistory: {},
      attribution: {},
    }),
    setAppState: () => { },
    readFileCache: new Map(),
    ...overrides,
  } as any);
}

describe("QueryEngine agency prompt injection", () => {
  beforeEach(() => {
    capturedSystemPrompt = null;
  });

  test("injects wake context in non-custom system prompt path", async () => {
    const engine = createEngine();

    const iterator = engine.submitMessage("hello");
    await iterator.next();

    expect(capturedSystemPrompt).not.toBeNull();
    expect(capturedSystemPrompt).toContain("DEFAULT_PROMPT");
    expect(capturedSystemPrompt).not.toContain("STATIC_CORE_IDENTITY");
    expect(capturedSystemPrompt).toContain("[T=0001]\nWAKE_CONTEXT");
  });

  test("does not inject agency prompt when customPrompt is used", async () => {
    const engine = createEngine({ customSystemPrompt: "CUSTOM_PROMPT" });

    const iterator = engine.submitMessage("hello");
    await iterator.next();

    expect(capturedSystemPrompt).toEqual(["CUSTOM_PROMPT"]);
  });
});
