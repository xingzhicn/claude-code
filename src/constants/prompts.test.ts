import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_PROMPT } from "./prompts";

describe("DEFAULT_AGENT_PROMPT", () => {
  test("does not mention Claude Code identity", () => {
    expect(DEFAULT_AGENT_PROMPT).not.toContain("Claude Code");
    expect(DEFAULT_AGENT_PROMPT).not.toContain("official CLI for Claude");
  });
});
