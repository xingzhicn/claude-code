import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../agency/index.js", () => ({
  getIdentityAnchor: () => "STATIC_CORE_IDENTITY",
}));

mock.module("../utils/model/providers.js", () => ({
  getAPIProvider: () => "firstParty",
}));

mock.module("../utils/workloadContext.js", () => ({
  getWorkload: () => undefined,
}));

mock.module("../services/analytics/growthbook.js", () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}));

mock.module("../utils/debug.js", () => ({
  logForDebugging: () => {},
}));

mock.module("../utils/envUtils.js", () => ({
  isEnvDefinedFalsy: () => false,
}));

globalThis.MACRO = { VERSION: "test" } as any;

const system = await import("./system.js");

describe("CLI system prompt prefix", () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "test";
  });

  test("uses static identity as interactive prefix", () => {
    expect(
      system.getCLISyspromptPrefix({
        isNonInteractive: false,
        hasAppendSystemPrompt: false,
      }),
    ).toBe("STATIC_CORE_IDENTITY");
  });

  test("uses static identity as SDK preset prefix base", () => {
    expect(
      system.getCLISyspromptPrefix({
        isNonInteractive: true,
        hasAppendSystemPrompt: true,
      }),
    ).toBe("STATIC_CORE_IDENTITY");
  });

  test("SDK prefix no longer mentions Claude Code", () => {
    const prefix = system.getCLISyspromptPrefix({
      isNonInteractive: true,
      hasAppendSystemPrompt: false,
    });

    expect(prefix).not.toContain("Claude Code");
    expect(prefix).not.toContain("official CLI for Claude");
  });

  test("prefix registry includes current interactive prefix", () => {
    const prefix = system.getCLISyspromptPrefix({
      isNonInteractive: false,
      hasAppendSystemPrompt: false,
    });

    expect(system.getCLISyspromptPrefixes().has(prefix)).toBe(true);
  });
});
