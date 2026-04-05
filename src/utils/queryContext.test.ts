import { beforeEach, describe, expect, mock, test } from "bun:test";

let capturedSystemPrompt: readonly string[] | null = null;

globalThis.MACRO = { VERSION: "test" } as any;

mock.module("../commands.js", () => ({}));

mock.module("../constants/prompts.js", () => ({
  getSystemPrompt: async () => ["DEFAULT_PROMPT"],
}));

mock.module("../context.js", () => ({
  getSystemContext: async () => ({ date: "2026-04-05" }),
  getUserContext: async () => ({ cwd: "/repo" }),
}));

mock.module("./abortController.js", () => ({
  createAbortController: () => new AbortController(),
}));

mock.module("./model/model.js", () => ({
  getMainLoopModel: () => "claude-sonnet-4-6",
}));

mock.module("./thinking.js", () => ({
  shouldEnableThinkingByDefault: () => true,
}));

mock.module("./systemPromptType.js", () => ({
  asSystemPrompt: (value: readonly string[]) => {
    capturedSystemPrompt = value;
    return value;
  },
}));

mock.module("../agency/index.js", () => ({
  getIdentityAnchor: () => "STATIC_CORE_IDENTITY",
  getWakeContext: () => "WAKE_CONTEXT",
}));

const queryContext = await import("./queryContext");

describe("buildSideQuestionFallbackParams agency consistency", () => {
  beforeEach(() => {
    capturedSystemPrompt = null;
  });

  test("keeps static identity and wake context in fallback path", async () => {
    await queryContext.buildSideQuestionFallbackParams({
      tools: [],
      commands: [],
      mcpClients: [],
      messages: [],
      readFileState: new Map(),
      getAppState: () => ({
        toolPermissionContext: { additionalWorkingDirectories: new Map() },
      }),
      setAppState: () => { },
      customSystemPrompt: undefined,
      appendSystemPrompt: undefined,
      thinkingConfig: undefined,
      agents: [],
    } as any);

    expect(capturedSystemPrompt).toContain("DEFAULT_PROMPT");
    expect(capturedSystemPrompt).toContain("WAKE_CONTEXT");
  });

  test("does not inject agency prompt for custom prompt path", async () => {
    await queryContext.buildSideQuestionFallbackParams({
      tools: [],
      commands: [],
      mcpClients: [],
      messages: [],
      readFileState: new Map(),
      getAppState: () => ({
        toolPermissionContext: { additionalWorkingDirectories: new Map() },
      }),
      setAppState: () => { },
      customSystemPrompt: "CUSTOM_PROMPT",
      appendSystemPrompt: undefined,
      thinkingConfig: undefined,
      agents: [],
    } as any);

    expect(capturedSystemPrompt).toEqual(["CUSTOM_PROMPT"]);
  });
});
