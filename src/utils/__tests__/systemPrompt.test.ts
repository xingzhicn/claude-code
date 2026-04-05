import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getSystemPrompt } from "../../constants/prompts";
import { buildEffectiveSystemPrompt } from "../systemPrompt";

mock.module("../../agency/index.js", () => ({
  getIdentityAnchor: () => "STATIC_CORE_IDENTITY",
  getWakeContext: () => "WAKE_CONTEXT",
}));

mock.module("../../commands.js", () => ({
  getSkillToolCommands: async () => [],
}));

mock.module("../../bootstrap/state.js", () => ({
  getIsNonInteractiveSession: () => false,
}));

mock.module("../../utils/settings/settings.js", () => ({
  getInitialSettings: () => ({}),
}));

mock.module("../../utils/model/model.js", () => ({
  getCanonicalName: () => "Claude Sonnet 4.6",
  getMarketingNameForModel: () => "Claude Sonnet 4.6",
}));

mock.module("../../utils/embeddedTools.js", () => ({
  hasEmbeddedSearchTools: () => false,
}));

mock.module("../..//services/analytics/growthbook.js", () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}));

const defaultPrompt = ["You are a helpful assistant.", "Follow instructions."];

function buildPrompt(overrides: Record<string, unknown> = {}) {
  return buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: undefined,
    toolUseContext: { options: {} as any },
    customSystemPrompt: undefined,
    defaultSystemPrompt: defaultPrompt,
    appendSystemPrompt: undefined,
    ...overrides,
  });
}

describe("buildEffectiveSystemPrompt", () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_COORDINATOR_MODE = undefined;
  });

  test("returns default system prompt when no overrides", () => {
    const result = buildPrompt();
    expect(Array.from(result)).toEqual([
      ...defaultPrompt,
      "STATIC_CORE_IDENTITY",
      "WAKE_CONTEXT",
    ]);
  });

  test("overrideSystemPrompt replaces everything", () => {
    const result = buildPrompt({ overrideSystemPrompt: "override" });
    expect(Array.from(result)).toEqual(["override"]);
  });

  test("customSystemPrompt replaces default", () => {
    const result = buildPrompt({ customSystemPrompt: "custom" });
    expect(Array.from(result)).toEqual(["custom"]);
  });

  test("appendSystemPrompt is appended before agency blocks", () => {
    const result = buildPrompt({ appendSystemPrompt: "appended" });
    expect(Array.from(result)).toEqual([
      ...defaultPrompt,
      "appended",
      "STATIC_CORE_IDENTITY",
      "WAKE_CONTEXT",
    ]);
  });

  test("agent definition still appends agency blocks", () => {
    const agentDef = {
      getSystemPrompt: () => "agent prompt",
      agentType: "custom",
    } as any;
    const result = buildPrompt({ mainThreadAgentDefinition: agentDef });
    expect(Array.from(result)).toEqual([
      "agent prompt",
      "STATIC_CORE_IDENTITY",
      "WAKE_CONTEXT",
    ]);
  });

  test("agent definition with append keeps agency blocks", () => {
    const agentDef = {
      getSystemPrompt: () => "agent prompt",
      agentType: "custom",
    } as any;
    const result = buildPrompt({
      mainThreadAgentDefinition: agentDef,
      appendSystemPrompt: "extra",
    });
    expect(Array.from(result)).toEqual([
      "agent prompt",
      "extra",
      "STATIC_CORE_IDENTITY",
      "WAKE_CONTEXT",
    ]);
  });

  test("override takes precedence over agent and custom", () => {
    const agentDef = {
      getSystemPrompt: () => "agent prompt",
      agentType: "custom",
    } as any;
    const result = buildPrompt({
      mainThreadAgentDefinition: agentDef,
      customSystemPrompt: "custom",
      appendSystemPrompt: "extra",
      overrideSystemPrompt: "override",
    });
    expect(Array.from(result)).toEqual(["override"]);
  });

  test("returns array of strings", () => {
    const result = buildPrompt();
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(typeof item).toBe("string");
    }
  });

  test("custom + append combines both", () => {
    const result = buildPrompt({
      customSystemPrompt: "custom",
      appendSystemPrompt: "extra",
    });
    expect(Array.from(result)).toEqual(["custom", "extra"]);
  });

  test("default path appends static identity", () => {
    const result = buildPrompt();
    expect(Array.from(result)).toContain("STATIC_CORE_IDENTITY");
  });

  test("default path appends wake context", () => {
    const result = buildPrompt();
    expect(Array.from(result)).toContain("WAKE_CONTEXT");
  });
});
