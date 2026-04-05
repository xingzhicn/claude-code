import { describe, expect, test } from "bun:test";
import { getCoordinatorSystemPrompt } from "./coordinatorMode";

describe("getCoordinatorSystemPrompt", () => {
  test("does not mention Claude Code identity", () => {
    expect(getCoordinatorSystemPrompt()).not.toContain("You are Claude Code");
    expect(getCoordinatorSystemPrompt()).not.toContain("Claude Code");
  });
});
