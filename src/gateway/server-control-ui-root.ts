import path from "node:path";
import {
  ensureControlUiAssetsBuilt,
  resolveControlUiRootOverrideSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import type { RuntimeEnv } from "../runtime.js";
import type { ControlUiRootState } from "./control-ui.js";

export type GatewayControlUiRootLogger = {
  warn: (message: string) => void;
};

export async function resolveGatewayControlUiRootState(params: {
  controlUiRootOverride?: string;
  controlUiEnabled: boolean;
  runtime: RuntimeEnv;
  log: GatewayControlUiRootLogger;
  moduleUrl: string;
  argv1?: string;
  cwd: string;
}): Promise<ControlUiRootState | undefined> {
  if (params.controlUiRootOverride) {
    const resolvedOverride = resolveControlUiRootOverrideSync(params.controlUiRootOverride);
    const resolvedOverridePath = path.resolve(params.controlUiRootOverride);
    if (!resolvedOverride) {
      params.log.warn(`gateway: controlUi.root not found at ${resolvedOverridePath}`);
      return { kind: "invalid", path: resolvedOverridePath };
    }
    return { kind: "resolved", path: resolvedOverride };
  }

  if (!params.controlUiEnabled) {
    return undefined;
  }

  let resolvedRoot = resolveControlUiRootSync({
    moduleUrl: params.moduleUrl,
    argv1: params.argv1,
    cwd: params.cwd,
  });
  if (!resolvedRoot) {
    const ensureResult = await ensureControlUiAssetsBuilt(params.runtime);
    if (!ensureResult.ok && ensureResult.message) {
      params.log.warn(`gateway: ${ensureResult.message}`);
    }
    resolvedRoot = resolveControlUiRootSync({
      moduleUrl: params.moduleUrl,
      argv1: params.argv1,
      cwd: params.cwd,
    });
  }
  return resolvedRoot ? { kind: "resolved", path: resolvedRoot } : { kind: "missing" };
}
