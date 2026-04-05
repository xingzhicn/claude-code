import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("fs/promises", () => ({
  rm: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  readFile: async () => "",
  writeFile: async () => {},
  stat: async () => ({ isDirectory: () => false }),
  lstat: async () => ({ isSymbolicLink: () => false }),
  realpath: async (p: string) => p,
}));
mock.module("node:fs/promises", () => ({
  rm: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  readFile: async () => "",
  writeFile: async () => {},
  stat: async () => ({ isDirectory: () => false }),
  lstat: async () => ({ isSymbolicLink: () => false }),
  realpath: async (p: string) => p,
}));

type HookContext = {
  messages: Array<{ type: string; uuid?: string }>;
  systemPrompt: string[];
  userContext: Record<string, string>;
  systemContext: Record<string, string>;
  toolUseContext: {
    readFileState: Map<string, string>;
  };
  querySource?: string;
};

const registerPostSamplingHookMock = mock((_hook: unknown) => {});
const fileReadToolCallMock = mock(async () => ({
  data: {
    type: "text",
    file: { content: "CURRENT DYNAMIC STATE" },
  },
}));
const createSubagentContextMock = mock((toolUseContext: HookContext["toolUseContext"]) => ({
  ...toolUseContext,
  readFileState: new Map(toolUseContext.readFileState),
}));
const createCacheSafeParamsMock = mock((context: HookContext) => ({
  systemPrompt: context.systemPrompt,
  userContext: context.userContext,
  systemContext: context.systemContext,
  toolUseContext: context.toolUseContext,
  forkContextMessages: context.messages,
}));
const runForkedAgentMock = mock(async () => ({ messages: [], totalUsage: {} }));
const saveCacheSafeParamsMock = mock((_params: unknown) => {});
const getLastCacheSafeParamsMock = mock(() => null);
const createUserMessageMock = mock(({ content }: { content: string }) => ({
  type: "user",
  message: { content },
}));
const buildPromptMock = mock(async () => "UPDATE AGENCY STATE");
const replaceDynamicStateMock = mock((_next: string) => {});
const sequentialMock = mock(<T extends (...args: any[]) => any>(fn: T) => fn);

const dynamicStatePath = "/mock/.claude/agency/dynamic_state.md";

mock.module("src/utils/hooks/postSamplingHooks.js", () => ({
  registerPostSamplingHook: registerPostSamplingHookMock,
}));

mock.module("src/tools/FileReadTool/FileReadTool.js", () => ({
  FileReadTool: { call: fileReadToolCallMock },
}));

mock.module("src/utils/forkedAgent.js", () => ({
  createSubagentContext: createSubagentContextMock,
  createCacheSafeParams: createCacheSafeParamsMock,
  runForkedAgent: runForkedAgentMock,
  saveCacheSafeParams: saveCacheSafeParamsMock,
  getLastCacheSafeParams: getLastCacheSafeParamsMock,
}));

mock.module("../utils/messages", () => ({
  createUserMessage: createUserMessageMock,
}));

mock.module("src/agency/paths.js", () => ({
  getAgencyDynamicStatePath: () => dynamicStatePath,
}));

mock.module("src/agency/index.js", () => ({
  replaceDynamicState: replaceDynamicStateMock,
}));

mock.module("src/agency/prompts.js", () => ({
  buildAgencyStateUpdatePrompt: buildPromptMock,
}));

mock.module("src/utils/sequential.js", () => ({
  sequential: sequentialMock,
}));

const stateUpdater = await import("../stateUpdater");

describe("updateAgencyState", () => {
  beforeEach(() => {
    registerPostSamplingHookMock.mockReset();
    fileReadToolCallMock.mockReset();
    fileReadToolCallMock.mockImplementation(async () => ({
      data: {
        type: "text",
        file: { content: "CURRENT DYNAMIC STATE" },
      },
    }));
    createSubagentContextMock.mockReset();
    createSubagentContextMock.mockImplementation(
      (toolUseContext: HookContext["toolUseContext"]) => ({
        ...toolUseContext,
        readFileState: new Map(toolUseContext.readFileState),
      }),
    );
    createCacheSafeParamsMock.mockReset();
    createCacheSafeParamsMock.mockImplementation((context: HookContext) => ({
      systemPrompt: context.systemPrompt,
      userContext: context.userContext,
      systemContext: context.systemContext,
      toolUseContext: context.toolUseContext,
      forkContextMessages: context.messages,
    }));
    runForkedAgentMock.mockReset();
    saveCacheSafeParamsMock.mockReset();
    getLastCacheSafeParamsMock.mockReset();
    createUserMessageMock.mockReset();
    buildPromptMock.mockReset();
    buildPromptMock.mockResolvedValue("UPDATE AGENCY STATE");
    replaceDynamicStateMock.mockReset();
    sequentialMock.mockClear();
  });

  const makeContext = (querySource?: string): HookContext => ({
    messages: [{ type: "user", uuid: "u1" }, { type: "assistant", uuid: "a1" }],
    systemPrompt: ["SYSTEM"],
    userContext: { cwd: "/repo" },
    systemContext: { date: "2026-04-04" },
    toolUseContext: {
      readFileState: new Map([[dynamicStatePath, "stale-cache"]]),
    },
    querySource,
  });

  test("pre-reads dynamic_state.md via FileReadTool before forked edit", async () => {
    const context = makeContext("repl_main_thread");

    await stateUpdater.updateAgencyState(context as never);

    expect(fileReadToolCallMock).toHaveBeenCalled();
    expect(fileReadToolCallMock.mock.calls[0]?.[0]).toEqual({ file_path: dynamicStatePath });
  });

  test("passes setup readFileState into runForkedAgent overrides", async () => {
    const context = makeContext("repl_main_thread");

    await stateUpdater.updateAgencyState(context as never);

    expect(runForkedAgentMock).toHaveBeenCalled();
    const call = runForkedAgentMock.mock.calls[0]?.[0];
    expect(call.overrides.readFileState).toBeDefined();
    expect(call.overrides.readFileState).not.toBe(context.toolUseContext.readFileState);
  });

  test("skips non-main-thread querySource values", async () => {
    await stateUpdater.updateAgencyState(makeContext("session_memory") as never);

    expect(fileReadToolCallMock).not.toHaveBeenCalled();
    expect(runForkedAgentMock).not.toHaveBeenCalled();
  });

  test("skips agency_keepalive querySource", async () => {
    await stateUpdater.updateAgencyState(makeContext("agency_keepalive") as never);

    expect(fileReadToolCallMock).not.toHaveBeenCalled();
    expect(runForkedAgentMock).not.toHaveBeenCalled();
  });

  test("passes a write-capable tool gate for the target dynamic state file", async () => {
    const context = makeContext("repl_main_thread");

    await stateUpdater.updateAgencyState(context as never);

    expect(runForkedAgentMock).toHaveBeenCalled();
    const call = runForkedAgentMock.mock.calls[0]?.[0];
    expect(call.canUseTool).toBeDefined();

    const decision = await call.canUseTool("Edit", {
      file_path: dynamicStatePath,
    });
    expect(decision.behavior).toBe("allow");
  });

  test("hot-swapped state is observable through subsequent wake context reads", async () => {
    const context = makeContext("repl_main_thread");
    fileReadToolCallMock
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "CURRENT DYNAMIC STATE" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "UPDATED DYNAMIC STATE" },
        },
      });

    await stateUpdater.updateAgencyState(context as never);

    expect(replaceDynamicStateMock).toHaveBeenCalledWith("UPDATED DYNAMIC STATE");
  });


  test("does not hot-swap stale content when no new state is produced", async () => {
    const context = makeContext("repl_main_thread");
    fileReadToolCallMock
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "CURRENT DYNAMIC STATE" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          type: "binary",
        },
      });

    await stateUpdater.updateAgencyState(context as never);

    expect(replaceDynamicStateMock).not.toHaveBeenCalled();
  });

  test("does not update in-memory state when forked agent fails", async () => {
    const context = makeContext("repl_main_thread");
    runForkedAgentMock.mockRejectedValueOnce(new Error("write failed"));

    await expect(stateUpdater.updateAgencyState(context as never)).rejects.toThrow(
      "write failed",
    );
    expect(replaceDynamicStateMock).not.toHaveBeenCalled();
  });

  test("refreshes cache-safe snapshot after dynamic state hot-swap", async () => {
    const context = makeContext("repl_main_thread");
    const snapshot = {
      systemPrompt: ["SYSTEM", "IDENTITY", "[T=0001]\nCURRENT DYNAMIC STATE"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [{ type: "user", message: { content: "hi" } }],
    };
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);
    fileReadToolCallMock
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "CURRENT DYNAMIC STATE" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "UPDATED DYNAMIC STATE" },
        },
      });

    await stateUpdater.updateAgencyState(context as never);

    expect(saveCacheSafeParamsMock).toHaveBeenCalledTimes(1);
    expect(saveCacheSafeParamsMock.mock.calls[0]?.[0]).toEqual({
      ...snapshot,
      systemPrompt: ["SYSTEM", "IDENTITY", "[T=0001]\nUPDATED DYNAMIC STATE"],
    });
  });

  test("does not refresh cache-safe snapshot when no prior snapshot exists", async () => {
    const context = makeContext("repl_main_thread");
    getLastCacheSafeParamsMock.mockReturnValue(null);
    fileReadToolCallMock
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "CURRENT DYNAMIC STATE" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "UPDATED DYNAMIC STATE" },
        },
      });

    await stateUpdater.updateAgencyState(context as never);

    expect(saveCacheSafeParamsMock).not.toHaveBeenCalled();
  });

  test("does not refresh cache-safe snapshot when refreshed output is non-text", async () => {
    const context = makeContext("repl_main_thread");
    getLastCacheSafeParamsMock.mockReturnValue({
      systemPrompt: ["SYSTEM", "IDENTITY", "[T=0001]\nCURRENT DYNAMIC STATE"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    });
    fileReadToolCallMock
      .mockResolvedValueOnce({
        data: {
          type: "text",
          file: { content: "CURRENT DYNAMIC STATE" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          type: "binary",
        },
      });

    await stateUpdater.updateAgencyState(context as never);

    expect(saveCacheSafeParamsMock).not.toHaveBeenCalled();
  });

  test("registers post-sampling hook", () => {
    stateUpdater.initAgencyStateUpdater();

    expect(registerPostSamplingHookMock).toHaveBeenCalledTimes(1);
  });
});
