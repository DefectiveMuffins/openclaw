import type { OpenClawConfig } from "../config/config.js";
import {
  prepareSecretsRuntimeSnapshot,
  activateSecretsRuntimeSnapshot,
} from "../secrets/runtime.js";

export type GatewaySecretsStateEventCode =
  | "SECRETS_RELOADER_DEGRADED"
  | "SECRETS_RELOADER_RECOVERED";

export type GatewaySecretsActivationReason = "startup" | "reload" | "restart-check";

export type GatewaySecretsLogger = {
  warn: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
};

export type GatewaySecretsStateEmitter = (
  code: GatewaySecretsStateEventCode,
  message: string,
  cfg: OpenClawConfig,
) => void;

export type GatewaySecretsSnapshot = Awaited<ReturnType<typeof prepareSecretsRuntimeSnapshot>>;

export type ActivateGatewayRuntimeSecrets = (
  config: OpenClawConfig,
  params: { reason: GatewaySecretsActivationReason; activate: boolean },
) => Promise<GatewaySecretsSnapshot>;

export function createGatewaySecretsActivator(params: {
  logSecrets: GatewaySecretsLogger;
  emitStateEvent: GatewaySecretsStateEmitter;
}): {
  activateRuntimeSecrets: ActivateGatewayRuntimeSecrets;
} {
  let secretsDegraded = false;
  let secretsActivationTail: Promise<void> = Promise.resolve();

  const runWithSecretsActivationLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = secretsActivationTail.then(operation, operation);
    secretsActivationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };

  const activateRuntimeSecrets: ActivateGatewayRuntimeSecrets = async (config, activation) =>
    await runWithSecretsActivationLock(async () => {
      try {
        const prepared = await prepareSecretsRuntimeSnapshot({ config });
        if (activation.activate) {
          activateSecretsRuntimeSnapshot(prepared);
        }
        for (const warning of prepared.warnings) {
          params.logSecrets.warn(`[${warning.code}] ${warning.message}`);
        }
        if (secretsDegraded) {
          const recoveredMessage =
            "Secret resolution recovered; runtime remained on last-known-good during the outage.";
          params.logSecrets.info(`[SECRETS_RELOADER_RECOVERED] ${recoveredMessage}`);
          params.emitStateEvent("SECRETS_RELOADER_RECOVERED", recoveredMessage, prepared.config);
        }
        secretsDegraded = false;
        return prepared;
      } catch (err) {
        const details = String(err);
        if (!secretsDegraded) {
          params.logSecrets.error(`[SECRETS_RELOADER_DEGRADED] ${details}`);
          if (activation.reason !== "startup") {
            params.emitStateEvent(
              "SECRETS_RELOADER_DEGRADED",
              `Secret resolution failed; runtime remains on last-known-good snapshot. ${details}`,
              config,
            );
          }
        } else {
          params.logSecrets.warn(`[SECRETS_RELOADER_DEGRADED] ${details}`);
        }
        secretsDegraded = true;
        if (activation.reason === "startup") {
          throw new Error(`Startup failed: required secrets are unavailable. ${details}`, {
            cause: err,
          });
        }
        throw err;
      }
    });

  return { activateRuntimeSecrets };
}
