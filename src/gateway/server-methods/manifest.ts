import type {
  GatewayRequestHandlerManifest,
  GatewayRequestHandlerManifestEntry,
  GatewayRequestHandlerAuthMode,
  GatewayRequestHandlers,
} from "./types.js";

export type GatewayHandlerGroupDefinition = {
  handlers: GatewayRequestHandlers;
  auth?: GatewayRequestHandlerAuthMode;
  methodAuth?: Readonly<Record<string, GatewayRequestHandlerAuthMode>>;
  controlPlaneWriteMethods?: readonly string[];
};

function createEntry(params: {
  method: string;
  handler: GatewayRequestHandlers[string];
  auth?: GatewayRequestHandlerAuthMode;
  controlPlaneWrite?: boolean;
}): GatewayRequestHandlerManifestEntry {
  return {
    method: params.method,
    handler: params.handler,
    ...(params.auth ? { auth: params.auth } : {}),
    ...(params.controlPlaneWrite ? { controlPlaneWrite: true } : {}),
  };
}

export function buildGatewayHandlerManifest(
  groups: readonly GatewayHandlerGroupDefinition[],
): GatewayRequestHandlerManifest {
  const entries = new Map<string, GatewayRequestHandlerManifestEntry>();

  for (const group of groups) {
    const controlPlaneWriteMethods = new Set(group.controlPlaneWriteMethods ?? []);
    for (const [method, handler] of Object.entries(group.handlers)) {
      entries.set(
        method,
        createEntry({
          method,
          handler,
          auth: group.methodAuth?.[method] ?? group.auth,
          controlPlaneWrite: controlPlaneWriteMethods.has(method),
        }),
      );
    }
  }

  return Array.from(entries.values());
}

export function handlersFromGatewayHandlerManifest(
  manifest: GatewayRequestHandlerManifest,
): GatewayRequestHandlers {
  return Object.fromEntries(manifest.map((entry) => [entry.method, entry.handler]));
}

export function findGatewayHandlerManifestEntry(
  manifest: GatewayRequestHandlerManifest,
  method: string,
): GatewayRequestHandlerManifestEntry | undefined {
  return manifest.find((entry) => entry.method === method);
}
