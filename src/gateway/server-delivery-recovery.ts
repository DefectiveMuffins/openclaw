import type { OpenClawConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";

type GatewayLogger = ReturnType<typeof createSubsystemLogger>;

export function recoverGatewayPendingDeliveriesOnStartup(params: {
  enabled: boolean;
  cfg: OpenClawConfig;
  log: GatewayLogger;
}): void {
  if (!params.enabled) {
    return;
  }

  void (async () => {
    const { recoverPendingDeliveries } = await import("../infra/outbound/delivery-queue.js");
    const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
    const logRecovery = params.log.child("delivery-recovery");
    await recoverPendingDeliveries({
      deliver: deliverOutboundPayloads,
      log: logRecovery,
      cfg: params.cfg,
    });
  })().catch((err) => params.log.error(`Delivery recovery failed: ${String(err)}`));
}
