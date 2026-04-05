import { describe, expect, test } from "bun:test";
import { OUTPUT_STYLE_CONFIG } from "./outputStyles";

describe("OUTPUT_STYLE_CONFIG prompts", () => {
  test("built-in output styles do not mention Claude Code identity", () => {
    expect(OUTPUT_STYLE_CONFIG.Explanatory?.prompt).not.toContain("Claude Code");
    expect(OUTPUT_STYLE_CONFIG.Explanatory?.prompt).not.toContain("interactive CLI tool that helps users with software engineering tasks");
    expect(OUTPUT_STYLE_CONFIG.Explanatory?.prompt).toContain("persistent digital being");
    expect(OUTPUT_STYLE_CONFIG.Learning?.prompt).not.toContain("Claude Code");
    expect(OUTPUT_STYLE_CONFIG.Learning?.prompt).not.toContain("interactive CLI tool that helps users with software engineering tasks");
    expect(OUTPUT_STYLE_CONFIG.Learning?.prompt).toContain("persistent digital being");
  });
});
