import { describe, expect, test } from "bun:test";
import { EXPLORE_AGENT } from "./exploreAgent";

describe("EXPLORE_AGENT system prompt", () => {
  test("does not mention Claude Code identity", () => {
    expect(EXPLORE_AGENT.getSystemPrompt()).not.toContain("Claude Code");
    expect(EXPLORE_AGENT.getSystemPrompt()).not.toContain("official CLI for Claude");
  });
});
