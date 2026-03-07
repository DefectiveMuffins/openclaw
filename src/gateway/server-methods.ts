import { formatControlPlaneActor, resolveControlPlaneActor } from "./control-plane-audit.js";
import { consumeControlPlaneWriteBudget } from "./control-plane-rate-limit.js";
import { ADMIN_SCOPE, authorizeOperatorScopesForMethod } from "./method-scopes.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { isRoleAuthorizedForMethod, parseGatewayRole } from "./role-policy.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { doctorHandlers } from "./server-methods/doctor.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import {
  buildGatewayHandlerManifest,
  findGatewayHandlerManifestEntry,
  handlersFromGatewayHandlerManifest,
} from "./server-methods/manifest.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { pushHandlers } from "./server-methods/push.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { toolsCatalogHandlers } from "./server-methods/tools-catalog.js";
import { ttsHandlers } from "./server-methods/tts.js";
import type {
  GatewayRequestHandlerManifestEntry,
  GatewayRequestHandlers,
  GatewayRequestOptions,
} from "./server-methods/types.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";

function authorizeGatewayMethod(
  entry: GatewayRequestHandlerManifestEntry,
  client: GatewayRequestOptions["client"],
) {
  if (entry.auth === "none") {
    return null;
  }
  if (!client?.connect) {
    return null;
  }
  const roleRaw = client.connect.role ?? "operator";
  const role = parseGatewayRole(roleRaw);
  if (!role) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${roleRaw}`);
  }
  const scopes = client.connect.scopes ?? [];
  if (!isRoleAuthorizedForMethod(role, entry.method)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return null;
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  const scopeAuth = authorizeOperatorScopesForMethod(entry.method, scopes);
  if (!scopeAuth.allowed) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${scopeAuth.missingScope}`);
  }
  return null;
}

export const coreGatewayHandlerManifest = buildGatewayHandlerManifest([
  { handlers: connectHandlers },
  { handlers: logsHandlers },
  { handlers: voicewakeHandlers },
  { handlers: healthHandlers, methodAuth: { health: "none" } },
  { handlers: channelsHandlers },
  { handlers: chatHandlers },
  { handlers: cronHandlers },
  { handlers: deviceHandlers },
  { handlers: doctorHandlers },
  { handlers: execApprovalsHandlers },
  { handlers: webHandlers },
  { handlers: modelsHandlers },
  { handlers: configHandlers, controlPlaneWriteMethods: ["config.apply", "config.patch"] },
  { handlers: wizardHandlers },
  { handlers: talkHandlers },
  { handlers: toolsCatalogHandlers },
  { handlers: ttsHandlers },
  { handlers: skillsHandlers },
  { handlers: sessionsHandlers },
  { handlers: systemHandlers },
  { handlers: updateHandlers, controlPlaneWriteMethods: ["update.run"] },
  { handlers: nodeHandlers },
  { handlers: pushHandlers },
  { handlers: sendHandlers },
  { handlers: usageHandlers },
  { handlers: agentHandlers },
  { handlers: agentsHandlers },
  { handlers: browserHandlers },
]);

export const coreGatewayHandlers: GatewayRequestHandlers = handlersFromGatewayHandlerManifest(
  coreGatewayHandlerManifest,
);

function resolveGatewayHandlerEntry(
  method: string,
  extraHandlers?: GatewayRequestHandlers,
): GatewayRequestHandlerManifestEntry | undefined {
  const extraHandler = extraHandlers?.[method];
  if (extraHandler) {
    return {
      method,
      handler: extraHandler,
    };
  }
  return findGatewayHandlerManifestEntry(coreGatewayHandlerManifest, method);
}

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const handlerEntry = resolveGatewayHandlerEntry(req.method, opts.extraHandlers);
  if (!handlerEntry) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }

  const authError = authorizeGatewayMethod(handlerEntry, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  if (handlerEntry.controlPlaneWrite) {
    const budget = consumeControlPlaneWriteBudget({ client });
    if (!budget.allowed) {
      const actor = resolveControlPlaneActor(client);
      context.logGateway.warn(
        `control-plane write rate-limited method=${req.method} ${formatControlPlaneActor(actor)} retryAfterMs=${budget.retryAfterMs} key=${budget.key}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `rate limit exceeded for ${req.method}; retry after ${Math.ceil(budget.retryAfterMs / 1000)}s`,
          {
            retryable: true,
            retryAfterMs: budget.retryAfterMs,
            details: {
              method: req.method,
              limit: "3 per 60s",
            },
          },
        ),
      );
      return;
    }
  }
  await handlerEntry.handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    isWebchatConnect,
    respond,
    context,
  });
}
