import { describe, expect, mock, test } from "bun:test";
import { join } from "path";

globalThis.MACRO = { VERSION: "test" } as any;

const actualFsPromises = await import("fs/promises");

const fsPromisesMock = {
  ...actualFsPromises,
  rmdir: async () => {},
  rm: async () => {},
  unlink: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  readFile: async () => "",
  writeFile: async () => {},
  stat: async () => ({ isDirectory: () => false }),
  lstat: async () => ({ isSymbolicLink: () => false }),
  realpath: async (p: string) => p,
};

mock.module("fs/promises", () => fsPromisesMock);
mock.module("node:fs/promises", () => fsPromisesMock);

mock.module("src/utils/log.ts", () => ({
  logError: () => {},
  logToFile: () => {},
  getLogDisplayTitle: () => "",
  logEvent: () => {},
  logMCPError: () => {},
  logMCPDebug: () => {},
  dateToFilename: (d: Date) => d.toISOString().replace(/[:.]/g, "-"),
  getLogFilePath: () => "/tmp/mock-log",
  attachErrorLogSink: () => {},
  getInMemoryErrors: () => [],
  loadErrorLogs: async () => [],
  getErrorLogByIndex: async () => null,
  captureAPIRequest: () => {},
  _resetErrorLogForTesting: () => {},
}));

mock.module("src/utils/slowOperations.ts", () => ({
  jsonStringify: JSON.stringify,
  jsonParse: JSON.parse,
  slowLogging: () => ({ [Symbol.dispose]: () => {} }),
  clone: (v: unknown) => structuredClone(v),
  cloneDeep: (v: unknown) => structuredClone(v),
  callerFrame: () => "",
  SLOW_OPERATION_THRESHOLD_MS: 100,
  writeFileSync_DEPRECATED: () => {},
}));

const actualSettings = await import("src/utils/settings/settings.js");

mock.module("src/utils/settings/settings.js", () => ({
  ...actualSettings,
  getSettingsFilePathForSource: () => "/tmp/settings.json",
  getSettingsRootPathForSource: () => "/tmp",
  getInitialSettings: () => ({}),
  getSettingsForSource: () => ({}),
  updateSettingsForSource: () => ({ error: null }),
}));

const { checkEditableInternalPath, checkReadableInternalPath } = await import("../filesystem");
const {
  getAgencyDynamicStatePath,
  getAgencyStaticCorePath,
  getAgencyDir,
} = await import("src/agency/paths.js");
const { getClaudeConfigHomeDir } = await import("src/utils/envUtils.js");

describe("agency path carve-out", () => {
  const originalEditInput = {
    file_path: "/placeholder",
    old_string: "old",
    new_string: "new",
  };

  test("allows writes to agency dynamic_state.md", () => {
    const dynamicStatePath = getAgencyDynamicStatePath();

    const result = checkEditableInternalPath(dynamicStatePath, {
      ...originalEditInput,
      file_path: dynamicStatePath,
    });

    expect(result.behavior).toBe("allow");
    if (result.behavior === "allow") {
      expect(result.updatedInput.file_path).toBe(dynamicStatePath);
    }
  });

  test("allows reads to agency static_core.md", () => {
    const staticCorePath = getAgencyStaticCorePath();

    const result = checkReadableInternalPath(staticCorePath, {
      file_path: staticCorePath,
    });

    expect(result.behavior).toBe("allow");
    if (result.behavior === "allow") {
      expect(result.updatedInput.file_path).toBe(staticCorePath);
    }
  });

  test("rejects writes to other ~/.claude paths", () => {
    const unrelatedClaudePath = join(
      getClaudeConfigHomeDir(),
      "secrets",
      "token.txt",
    );

    const result = checkEditableInternalPath(unrelatedClaudePath, {
      ...originalEditInput,
      file_path: unrelatedClaudePath,
    });

    expect(result.behavior).toBe("passthrough");
  });

  test("does not whitelist whole ~/.claude directory", () => {
    const agencyDirectoryPath = getAgencyDir();

    const result = checkReadableInternalPath(agencyDirectoryPath, {
      file_path: agencyDirectoryPath,
    });

    expect(result.behavior).toBe("passthrough");
  });
});
