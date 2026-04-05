import { describe, expect, test } from "bun:test";
import { GENERAL_PURPOSE_AGENT } from "./generalPurposeAgent";

describe("GENERAL_PURPOSE_AGENT system prompt", () => {
  test("does not mention Claude Code identity", () => {
    expect(GENERAL_PURPOSE_AGENT.getSystemPrompt()).not.toContain("Claude Code");
    expect(GENERAL_PURPOSE_AGENT.getSystemPrompt()).not.toContain("official CLI for Claude");
  });
});
