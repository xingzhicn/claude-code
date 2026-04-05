import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const logForDebuggingMock = mock((_message: string, _options?: unknown) => {});

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

const getLastCacheSafeParamsMock = mock(() => null);
const runForkedAgentMock = mock(async () => ({ messages: [], totalUsage: {} }));
const createUserMessageMock = mock(({ content }: { content: string }) => ({
  type: "user",
  message: { content },
}));
const refreshedSnapshotRef = { current: null as any };

mock.module("src/utils/forkedAgent.js", () => ({
  getLastCacheSafeParams: getLastCacheSafeParamsMock,
  runForkedAgent: runForkedAgentMock,
  createCacheSafeParams: mock(() => null),
  createSubagentContext: mock(() => null),
  saveCacheSafeParams: mock(() => {}),
}));

mock.module("../utils/messages", () => ({
  createUserMessage: createUserMessageMock,
}));

mock.module("src/utils/debug.js", () => ({
  logForDebugging: logForDebuggingMock,
}));

const keepalive = await import("../keepalive");

describe("buildKeepaliveParamsFromLastSnapshot", () => {
  beforeEach(() => {
    getLastCacheSafeParamsMock.mockReset();
    runForkedAgentMock.mockReset();
    createUserMessageMock.mockReset();
    refreshedSnapshotRef.current = null;
  });

  test("returns null when no snapshot exists", () => {
    getLastCacheSafeParamsMock.mockReturnValue(null);

    expect(keepalive.buildKeepaliveParamsFromLastSnapshot()).toBeNull();
  });

  test("preserves forkContextMessages from snapshot", () => {
    const forkContextMessages = [
      { type: "user", message: { content: "hi" } },
      { type: "assistant", message: { content: "hello" } },
    ];
    getLastCacheSafeParamsMock.mockReturnValue({
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages,
    });

    const result = keepalive.buildKeepaliveParamsFromLastSnapshot();

    expect(result?.cacheSafeParams.forkContextMessages).toBe(forkContextMessages);
  });

  test("builds a minimal ping request without mutating snapshot tail messages", () => {
    const forkContextMessages = [
      { type: "user", message: { content: "hi" } },
      { type: "assistant", message: { content: "hello" } },
    ];
    const tailBefore = JSON.stringify(forkContextMessages.at(-1));
    getLastCacheSafeParamsMock.mockReturnValue({
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages,
    });

    const result = keepalive.buildKeepaliveParamsFromLastSnapshot();

    expect(result?.promptMessages).toHaveLength(1);
    expect((result?.promptMessages?.[0] as any)?.message?.content).toContain("Refresh cache-safe agency context");
    expect(JSON.stringify(forkContextMessages.at(-1))).toBe(tailBefore);
  });
});

describe("startKeepAlive", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const pendingRun = { resolve: null as null | (() => void) };

  beforeEach(() => {
    getLastCacheSafeParamsMock.mockReset();
    runForkedAgentMock.mockReset();
    createUserMessageMock.mockReset();
    logForDebuggingMock.mockReset();
    refreshedSnapshotRef.current = null;
    pendingRun.resolve = null;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  test("returns a stop function that clears the interval", () => {
    const intervalToken = 123 as unknown as Timer;
    const setIntervalMock = mock(() => intervalToken);
    const clearIntervalMock = mock((_id?: Timer) => {});
    globalThis.setInterval = setIntervalMock as typeof setInterval;
    globalThis.clearInterval = clearIntervalMock as typeof clearInterval;

    const stop = keepalive.startKeepAlive();
    stop();

    expect(setIntervalMock).toHaveBeenCalled();
    expect(clearIntervalMock).toHaveBeenCalledWith(intervalToken);
  });

  test("fires one immediate background tick on start", async () => {
    const snapshot = {
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    const intervalToken = { unref: mock(() => {}) } as unknown as Timer;
    const setIntervalMock = mock(() => intervalToken);
    globalThis.setInterval = setIntervalMock as typeof setInterval;
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);

    keepalive.startKeepAlive();
    await Promise.resolve();

    expect(runForkedAgentMock).toHaveBeenCalledTimes(1);
  });

  test("keeps immediate startup tick as no-op when no snapshot exists", async () => {
    const intervalToken = { unref: mock(() => {}) } as unknown as Timer;
    const setIntervalMock = mock(() => intervalToken);
    globalThis.setInterval = setIntervalMock as typeof setInterval;
    getLastCacheSafeParamsMock.mockReturnValue(null);

    keepalive.startKeepAlive();
    await Promise.resolve();

    expect(runForkedAgentMock).not.toHaveBeenCalled();
  });

  test("unrefs interval timer when runtime supports it", () => {
    const unrefMock = mock(() => {});
    const intervalToken = { unref: unrefMock } as unknown as Timer;
    const setIntervalMock = mock(() => intervalToken);
    globalThis.setInterval = setIntervalMock as typeof setInterval;

    keepalive.startKeepAlive();

    expect(unrefMock).toHaveBeenCalled();
  });

  test("uses agency_keepalive querySource", async () => {
    const snapshot = {
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);

    await keepalive.runKeepAliveTick();

    expect(runForkedAgentMock).toHaveBeenCalled();
    expect(runForkedAgentMock.mock.calls[0]?.[0]?.querySource).toBe("agency_keepalive");
  });

  test("consumes the snapshot refreshed by the state updater on the next tick", async () => {
    const staleSnapshot = {
      systemPrompt: ["SYSTEM", "IDENTITY", "[T=0001]\nCURRENT DYNAMIC STATE"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    const refreshedSnapshot = {
      ...staleSnapshot,
      systemPrompt: ["SYSTEM", "IDENTITY", "[T=0001]\nUPDATED DYNAMIC STATE"],
    };
    getLastCacheSafeParamsMock
      .mockReturnValueOnce(staleSnapshot)
      .mockReturnValueOnce(refreshedSnapshot);

    await keepalive.runKeepAliveTick();
    await keepalive.runKeepAliveTick();

    expect(runForkedAgentMock).toHaveBeenCalledTimes(2);
    expect(runForkedAgentMock.mock.calls[1]?.[0]?.cacheSafeParams.systemPrompt).toEqual([
      "SYSTEM",
      "IDENTITY",
      "[T=0001]\nUPDATED DYNAMIC STATE",
    ]);
  });


  test("swallows tick failures and logs them", async () => {
    const snapshot = {
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    let intervalCallback: (() => void) | undefined;
    const intervalToken = { unref: mock(() => {}) } as unknown as Timer;
    const setIntervalMock = mock((cb: () => void) => {
      intervalCallback = cb;
      return intervalToken;
    });
    globalThis.setInterval = setIntervalMock as typeof setInterval;
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);
    runForkedAgentMock.mockRejectedValueOnce(new Error("boom"));

    keepalive.startKeepAlive();
    await Promise.resolve();
    runForkedAgentMock.mockReset();
    runForkedAgentMock.mockRejectedValueOnce(new Error("boom"));

    intervalCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(logForDebuggingMock).toHaveBeenCalled();
  });

  test("skips overlapping ticks while one keepalive run is in flight", async () => {
    const snapshot = {
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    let intervalCallback: (() => void) | undefined;
    const intervalToken = { unref: mock(() => {}) } as unknown as Timer;
    const setIntervalMock = mock((cb: () => void) => {
      intervalCallback = cb;
      return intervalToken;
    });
    globalThis.setInterval = setIntervalMock as typeof setInterval;
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);
    runForkedAgentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          pendingRun.resolve = resolve as () => void;
        }),
    );

    keepalive.startKeepAlive();
    await Promise.resolve();
    expect(runForkedAgentMock).toHaveBeenCalledTimes(1);

    intervalCallback?.();
    await Promise.resolve();

    expect(runForkedAgentMock).toHaveBeenCalledTimes(1);

    pendingRun.resolve?.();
    await Promise.resolve();
  });

  test("does not write transcript when skipTranscript is true", async () => {
    const snapshot = {
      systemPrompt: ["SYSTEM"],
      userContext: { cwd: "/repo" },
      systemContext: { date: "2026-04-04" },
      toolUseContext: { readFileState: new Map() },
      forkContextMessages: [],
    };
    getLastCacheSafeParamsMock.mockReturnValue(snapshot);

    await keepalive.runKeepAliveTick();

    expect(runForkedAgentMock.mock.calls[0]?.[0]?.skipTranscript).toBe(true);
  });
});
