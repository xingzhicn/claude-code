import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const readMock = mock(async (_path: string, _encoding: string) => "");
const staticPath = "/mock/.claude/agency/static_core.md";
const dynamicPath = "/mock/.claude/agency/dynamic_state.md";

mock.module("src/agency/paths.ts", () => ({
  getAgencyStaticCorePath: () => staticPath,
  getAgencyDynamicStatePath: () => dynamicPath,
}));

mock.module("fs/promises", () => ({
  readFile: readMock,
}));

const agency = await import("../index");

describe("getIdentityAnchor", () => {
  beforeEach(() => {
    readMock.mockReset();
    agency.__resetAgencyStateForTests?.();
  });

  afterEach(() => {
    agency.__resetAgencyStateForTests?.();
  });

  test("returns empty string before init", () => {
    expect(agency.getIdentityAnchor()).toBe("");
  });

  test("loads static_core.md into identity anchor cache", async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return "STATIC CORE";
      if (path === dynamicPath) return "DYNAMIC STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();

    expect(agency.getIdentityAnchor()).toBe("STATIC CORE");
    expect(readMock).toHaveBeenCalledWith(staticPath, "utf-8");
  });

  test("uses a stable long-form anchor suitable for cache prefixing", async () => {
    const longAnchor = ["STATIC CORE", "LONG FORM ANCHOR", "CACHE PREFIX BLOCK"]
      .join("\n\n")
      .repeat(40);

    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return longAnchor;
      if (path === dynamicPath) return "DYNAMIC STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();

    expect(agency.getIdentityAnchor().length).toBeGreaterThan(1024);
    expect(agency.getIdentityAnchor()).toContain("LONG FORM ANCHOR");
  });

  test("does not contain any tick/timestamp values", async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return "STATIC CORE";
      if (path === dynamicPath) return "DYNAMIC STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();

    const anchor = agency.getIdentityAnchor();
    expect(anchor).not.toContain("[T=");
    expect(anchor).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("getWakeContext", () => {
  beforeEach(() => {
    readMock.mockReset();
    agency.__resetAgencyStateForTests?.();
  });

  afterEach(() => {
    agency.__resetAgencyStateForTests?.();
  });

  test("includes dynamic_state.md content from in-memory cache", async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return "STATIC CORE";
      if (path === dynamicPath) return "DYNAMIC STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();

    expect(agency.getWakeContext()).toContain("DYNAMIC STATE");
  });

  test("increments tick on each call (in-memory, sync)", async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return "STATIC CORE";
      if (path === dynamicPath) return "DYNAMIC STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();

    expect(agency.getWakeContext()).toContain("[T=0001]");
    expect(agency.getWakeContext()).toContain("[T=0002]");
  });

  test("uses hot-swapped dynamic state after replaceDynamicState", async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === staticPath) return "STATIC CORE";
      if (path === dynamicPath) return "INITIAL STATE";
      throw new Error(`unexpected path: ${path}`);
    });

    await agency.initAgency();
    readMock.mockImplementation(async () => {
      throw new Error("should not reread from disk after init");
    });

    agency.replaceDynamicState("HOT SWAP");

    expect(agency.getWakeContext()).toContain("HOT SWAP");
  });
});
