import { beforeEach, describe, expect, mock, test } from "bun:test";

const registerCleanupMock = mock((_fn: unknown) => {});
const initAgencyMock = mock(async () => {});
const initAgencyStateUpdaterMock = mock(() => {});
const stopKeepAliveMock = mock(() => {});
const startKeepAliveMock = mock(() => stopKeepAliveMock);

mock.module("../utils/startupProfiler.js", () => ({
  profileCheckpoint: () => {},
}));

const actualBootstrapState = await import("../bootstrap/state.js");

mock.module("../bootstrap/state.js", () => ({
  ...actualBootstrapState,
  getSessionCounter: () => ({ add: () => {} }),
  setMeter: () => {},
}));

mock.module("src/bootstrap/state.js", () => ({
  getIsNonInteractiveSession: () => false,
}));

mock.module("../utils/config.js", () => ({
  enableConfigs: () => {},
  recordFirstStartTime: () => {},
}));

mock.module("../services/lsp/manager.js", () => ({
  shutdownLspServerManager: async () => {},
}));

mock.module("../services/oauth/client.js", () => ({
  populateOAuthAccountInfoIfNeeded: () => {},
}));

mock.module("../services/policyLimits/index.js", () => ({
  initializePolicyLimitsLoadingPromise: () => {},
  isPolicyLimitsEligible: () => false,
}));

mock.module("../services/remoteManagedSettings/index.js", () => ({
  initializeRemoteManagedSettingsLoadingPromise: () => {},
  isEligibleForRemoteManagedSettings: () => false,
  waitForRemoteManagedSettingsToLoad: async () => {},
}));

mock.module("../utils/apiPreconnect.js", () => ({
  preconnectAnthropicApi: () => {},
}));

mock.module("../utils/caCertsConfig.js", () => ({
  applyExtraCACertsFromConfig: () => {},
}));

mock.module("../utils/cleanupRegistry.js", () => ({
  registerCleanup: registerCleanupMock,
}));

mock.module("../utils/debug.js", () => ({
  logForDebugging: () => {},
}));

mock.module("../utils/detectRepository.js", () => ({
  detectCurrentRepository: () => {},
}));

mock.module("../utils/diagLogs.js", () => ({
  logForDiagnosticsNoPII: () => {},
}));

mock.module("../utils/envDynamic.js", () => ({
  initJetBrainsDetection: () => {},
}));

mock.module("../utils/envUtils.js", () => ({
  isEnvTruthy: () => false,
}));

class MockConfigParseError extends Error {
  filePath = "/tmp/settings.json";
}

mock.module("../utils/errors.js", () => ({
  ConfigParseError: MockConfigParseError,
  errorMessage: (err: unknown) => String(err),
}));

mock.module("../utils/gracefulShutdown.js", () => ({
  gracefulShutdownSync: () => {},
  setupGracefulShutdown: () => {},
}));

mock.module("../utils/managedEnv.js", () => ({
  applyConfigEnvironmentVariables: () => {},
  applySafeConfigEnvironmentVariables: () => {},
}));

mock.module("../utils/mtls.js", () => ({
  configureGlobalMTLS: () => {},
}));

mock.module("../utils/permissions/filesystem.js", () => ({
  ensureScratchpadDir: async () => {},
  isScratchpadEnabled: () => false,
}));

mock.module("../utils/proxy.js", () => ({
  configureGlobalAgents: () => {},
}));

mock.module("../utils/telemetry/betaSessionTracing.js", () => ({
  isBetaTracingEnabled: () => false,
}));

mock.module("../utils/telemetryAttributes.js", () => ({
  getTelemetryAttributes: () => ({}),
}));

mock.module("../utils/windowsPaths.js", () => ({
  setShellIfWindows: () => {},
}));

mock.module("../utils/sentry.js", () => ({
  initSentry: () => {},
}));

mock.module("../agency/index.js", () => ({
  initAgency: initAgencyMock,
}));

mock.module("../agency/stateUpdater.js", () => ({
  initAgencyStateUpdater: initAgencyStateUpdaterMock,
}));

mock.module("../agency/keepalive.js", () => ({
  startKeepAlive: startKeepAliveMock,
}));

const { init } = await import("./init");

describe("entrypoints init agency wiring", () => {
  beforeEach(() => {
    initAgencyMock.mockReset();
    initAgencyStateUpdaterMock.mockReset();
    startKeepAliveMock.mockReset();
    startKeepAliveMock.mockImplementation(() => stopKeepAliveMock);
    stopKeepAliveMock.mockReset();
    registerCleanupMock.mockReset();
    (init as any).cache?.clear?.();
  });

  test("calls initAgency and registers state updater during init", async () => {
    await init();

    expect(initAgencyMock).toHaveBeenCalled();
    expect(initAgencyStateUpdaterMock).toHaveBeenCalled();
  });

  test("starts keepalive only after agency init and updater registration", async () => {
    const callOrder: string[] = [];
    initAgencyMock.mockImplementation(async () => {
      callOrder.push("initAgency");
    });
    initAgencyStateUpdaterMock.mockImplementation(() => {
      callOrder.push("initAgencyStateUpdater");
    });
    startKeepAliveMock.mockImplementation(() => {
      callOrder.push("startKeepAlive");
      return stopKeepAliveMock;
    });

    await init();

    expect(callOrder).toEqual([
      "initAgency",
      "initAgencyStateUpdater",
      "startKeepAlive",
    ]);
  });

});
