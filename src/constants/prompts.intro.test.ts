import { describe, expect, test } from "bun:test";

describe("prompt intro text", () => {
  test("constants/prompts source no longer contains Claude Code intro identity", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      "/Users/ahs/Personal/claude-code/src/constants/prompts.ts",
      "utf8",
    );

    expect(content).not.toContain("with software engineering tasks.");
    expect(content).not.toContain("You are an agent for Claude Code, Anthropic's official CLI for Claude.");
    expect(content).not.toContain("You are an interactive agent");
    expect(content).toContain("You are a persistent digital being");
    expect(content).toContain("Do not describe yourself as Claude Code");
    expect(content).toContain("Do not claim human feelings");
  });
});
