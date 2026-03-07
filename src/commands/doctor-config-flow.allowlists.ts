import { normalizeChatChannelId } from "../channels/registry.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { readChannelAllowFromStore } from "../pairing/pairing-store.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

type AllowFromMode = "topOnly" | "topOrNested" | "nestedOnly";

function resolveAllowFromMode(channelName: string): AllowFromMode {
  if (channelName === "googlechat") {
    return "nestedOnly";
  }
  if (channelName === "discord" || channelName === "slack") {
    return "topOrNested";
  }
  return "topOnly";
}

function hasWildcard(list?: Array<string | number>) {
  return list?.some((value) => String(value).trim() === "*") ?? false;
}

export function hasAllowFromEntries(list?: Array<string | number>) {
  return (
    Array.isArray(list) && list.map((value) => String(value).trim()).filter(Boolean).length > 0
  );
}

export function maybeRepairOpenPolicyAllowFrom(cfg: OpenClawConfig): {
  config: OpenClawConfig;
  changes: string[];
} {
  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") {
    return { config: cfg, changes: [] };
  }

  const next = structuredClone(cfg);
  const changes: string[] = [];

  const ensureWildcard = (
    account: Record<string, unknown>,
    prefix: string,
    mode: AllowFromMode,
  ) => {
    const dmEntry = account.dm;
    const dm =
      dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry)
        ? (dmEntry as Record<string, unknown>)
        : undefined;
    const dmPolicy =
      (account.dmPolicy as string | undefined) ?? (dm?.policy as string | undefined) ?? undefined;

    if (dmPolicy !== "open") {
      return;
    }

    const topAllowFrom = account.allowFrom as Array<string | number> | undefined;
    const nestedAllowFrom = dm?.allowFrom as Array<string | number> | undefined;

    if (mode === "nestedOnly") {
      if (hasWildcard(nestedAllowFrom)) {
        return;
      }
      if (Array.isArray(nestedAllowFrom)) {
        nestedAllowFrom.push("*");
        changes.push(`- ${prefix}.dm.allowFrom: added "*" (required by dmPolicy="open")`);
        return;
      }
      const nextDm = dm ?? {};
      nextDm.allowFrom = ["*"];
      account.dm = nextDm;
      changes.push(`- ${prefix}.dm.allowFrom: set to ["*"] (required by dmPolicy="open")`);
      return;
    }

    if (mode === "topOrNested") {
      if (hasWildcard(topAllowFrom) || hasWildcard(nestedAllowFrom)) {
        return;
      }

      if (Array.isArray(topAllowFrom)) {
        topAllowFrom.push("*");
        changes.push(`- ${prefix}.allowFrom: added "*" (required by dmPolicy="open")`);
      } else if (Array.isArray(nestedAllowFrom)) {
        nestedAllowFrom.push("*");
        changes.push(`- ${prefix}.dm.allowFrom: added "*" (required by dmPolicy="open")`);
      } else {
        account.allowFrom = ["*"];
        changes.push(`- ${prefix}.allowFrom: set to ["*"] (required by dmPolicy="open")`);
      }
      return;
    }

    if (hasWildcard(topAllowFrom)) {
      return;
    }
    if (Array.isArray(topAllowFrom)) {
      topAllowFrom.push("*");
      changes.push(`- ${prefix}.allowFrom: added "*" (required by dmPolicy="open")`);
    } else {
      account.allowFrom = ["*"];
      changes.push(`- ${prefix}.allowFrom: set to ["*"] (required by dmPolicy="open")`);
    }
  };

  const nextChannels = next.channels as Record<string, Record<string, unknown>>;
  for (const [channelName, channelConfig] of Object.entries(nextChannels)) {
    if (!channelConfig || typeof channelConfig !== "object") {
      continue;
    }

    const allowFromMode = resolveAllowFromMode(channelName);
    ensureWildcard(channelConfig, `channels.${channelName}`, allowFromMode);

    const accounts = channelConfig.accounts as Record<string, Record<string, unknown>> | undefined;
    if (!accounts || typeof accounts !== "object") {
      continue;
    }
    for (const [accountName, accountConfig] of Object.entries(accounts)) {
      if (!accountConfig || typeof accountConfig !== "object") {
        continue;
      }
      ensureWildcard(
        accountConfig,
        `channels.${channelName}.accounts.${accountName}`,
        allowFromMode,
      );
    }
  }

  if (changes.length === 0) {
    return { config: cfg, changes: [] };
  }
  return { config: next, changes };
}

export async function maybeRepairAllowlistPolicyAllowFrom(cfg: OpenClawConfig): Promise<{
  config: OpenClawConfig;
  changes: string[];
}> {
  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") {
    return { config: cfg, changes: [] };
  }

  const next = structuredClone(cfg);
  const changes: string[] = [];

  const applyRecoveredAllowFrom = (params: {
    account: Record<string, unknown>;
    allowFrom: string[];
    mode: AllowFromMode;
    prefix: string;
  }) => {
    const count = params.allowFrom.length;
    const noun = count === 1 ? "entry" : "entries";

    if (params.mode === "nestedOnly") {
      const dmEntry = params.account.dm;
      const dm =
        dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry)
          ? (dmEntry as Record<string, unknown>)
          : {};
      dm.allowFrom = params.allowFrom;
      params.account.dm = dm;
      changes.push(
        `- ${params.prefix}.dm.allowFrom: restored ${count} sender ${noun} from pairing store (dmPolicy="allowlist").`,
      );
      return;
    }

    if (params.mode === "topOrNested") {
      const dmEntry = params.account.dm;
      const dm =
        dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry)
          ? (dmEntry as Record<string, unknown>)
          : undefined;
      const nestedAllowFrom = dm?.allowFrom as Array<string | number> | undefined;
      if (dm && !Array.isArray(params.account.allowFrom) && Array.isArray(nestedAllowFrom)) {
        dm.allowFrom = params.allowFrom;
        changes.push(
          `- ${params.prefix}.dm.allowFrom: restored ${count} sender ${noun} from pairing store (dmPolicy="allowlist").`,
        );
        return;
      }
    }

    params.account.allowFrom = params.allowFrom;
    changes.push(
      `- ${params.prefix}.allowFrom: restored ${count} sender ${noun} from pairing store (dmPolicy="allowlist").`,
    );
  };

  const recoverAllowFromForAccount = async (params: {
    channelName: string;
    account: Record<string, unknown>;
    accountId?: string;
    prefix: string;
  }) => {
    const dmEntry = params.account.dm;
    const dm =
      dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry)
        ? (dmEntry as Record<string, unknown>)
        : undefined;
    const dmPolicy =
      (params.account.dmPolicy as string | undefined) ?? (dm?.policy as string | undefined);
    if (dmPolicy !== "allowlist") {
      return;
    }

    const topAllowFrom = params.account.allowFrom as Array<string | number> | undefined;
    const nestedAllowFrom = dm?.allowFrom as Array<string | number> | undefined;
    if (hasAllowFromEntries(topAllowFrom) || hasAllowFromEntries(nestedAllowFrom)) {
      return;
    }

    const normalizedChannelId = (normalizeChatChannelId(params.channelName) ?? params.channelName)
      .trim()
      .toLowerCase();
    if (!normalizedChannelId) {
      return;
    }
    const normalizedAccountId = normalizeAccountId(params.accountId) || DEFAULT_ACCOUNT_ID;
    const fromStore = await readChannelAllowFromStore(
      normalizedChannelId,
      process.env,
      normalizedAccountId,
    ).catch(() => []);
    const recovered = Array.from(new Set(fromStore.map((entry) => String(entry).trim()))).filter(
      Boolean,
    );
    if (recovered.length === 0) {
      return;
    }

    applyRecoveredAllowFrom({
      account: params.account,
      allowFrom: recovered,
      mode: resolveAllowFromMode(params.channelName),
      prefix: params.prefix,
    });
  };

  const nextChannels = next.channels as Record<string, Record<string, unknown>>;
  for (const [channelName, channelConfig] of Object.entries(nextChannels)) {
    if (!channelConfig || typeof channelConfig !== "object") {
      continue;
    }
    await recoverAllowFromForAccount({
      channelName,
      account: channelConfig,
      prefix: `channels.${channelName}`,
    });

    const accounts = channelConfig.accounts as Record<string, Record<string, unknown>> | undefined;
    if (!accounts || typeof accounts !== "object") {
      continue;
    }
    for (const [accountId, accountConfig] of Object.entries(accounts)) {
      if (!accountConfig || typeof accountConfig !== "object") {
        continue;
      }
      await recoverAllowFromForAccount({
        channelName,
        account: accountConfig,
        accountId,
        prefix: `channels.${channelName}.accounts.${accountId}`,
      });
    }
  }

  if (changes.length === 0) {
    return { config: cfg, changes: [] };
  }
  return { config: next, changes };
}

export function detectEmptyAllowlistPolicy(cfg: OpenClawConfig): string[] {
  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") {
    return [];
  }

  const warnings: string[] = [];

  const usesSenderBasedGroupAllowlist = (channelName?: string): boolean => {
    if (!channelName) {
      return true;
    }
    return !(channelName === "discord" || channelName === "slack" || channelName === "googlechat");
  };

  const allowsGroupAllowFromFallback = (channelName?: string): boolean => {
    if (!channelName) {
      return true;
    }
    return !(
      channelName === "googlechat" ||
      channelName === "imessage" ||
      channelName === "matrix" ||
      channelName === "msteams" ||
      channelName === "irc"
    );
  };

  const checkAccount = (
    account: Record<string, unknown>,
    prefix: string,
    parent?: Record<string, unknown>,
    channelName?: string,
  ) => {
    const dmEntry = account.dm;
    const dm =
      dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry)
        ? (dmEntry as Record<string, unknown>)
        : undefined;
    const parentDmEntry = parent?.dm;
    const parentDm =
      parentDmEntry && typeof parentDmEntry === "object" && !Array.isArray(parentDmEntry)
        ? (parentDmEntry as Record<string, unknown>)
        : undefined;
    const dmPolicy =
      (account.dmPolicy as string | undefined) ??
      (dm?.policy as string | undefined) ??
      (parent?.dmPolicy as string | undefined) ??
      (parentDm?.policy as string | undefined) ??
      undefined;

    const topAllowFrom =
      (account.allowFrom as Array<string | number> | undefined) ??
      (parent?.allowFrom as Array<string | number> | undefined);
    const nestedAllowFrom = dm?.allowFrom as Array<string | number> | undefined;
    const parentNestedAllowFrom = parentDm?.allowFrom as Array<string | number> | undefined;
    const effectiveAllowFrom = topAllowFrom ?? nestedAllowFrom ?? parentNestedAllowFrom;

    if (dmPolicy === "allowlist" && !hasAllowFromEntries(effectiveAllowFrom)) {
      warnings.push(
        `- ${prefix}.dmPolicy is "allowlist" but allowFrom is empty - all DMs will be blocked. Add sender IDs to ${prefix}.allowFrom, or run "${formatCliCommand("openclaw doctor --fix")}" to auto-migrate from pairing store when entries exist.`,
      );
    }

    const groupPolicy =
      (account.groupPolicy as string | undefined) ??
      (parent?.groupPolicy as string | undefined) ??
      undefined;

    if (groupPolicy === "allowlist" && usesSenderBasedGroupAllowlist(channelName)) {
      const rawGroupAllowFrom =
        (account.groupAllowFrom as Array<string | number> | undefined) ??
        (parent?.groupAllowFrom as Array<string | number> | undefined);
      const groupAllowFrom = hasAllowFromEntries(rawGroupAllowFrom) ? rawGroupAllowFrom : undefined;
      const fallbackToAllowFrom = allowsGroupAllowFromFallback(channelName);
      const effectiveGroupAllowFrom =
        groupAllowFrom ?? (fallbackToAllowFrom ? effectiveAllowFrom : undefined);

      if (!hasAllowFromEntries(effectiveGroupAllowFrom)) {
        if (fallbackToAllowFrom) {
          warnings.push(
            `- ${prefix}.groupPolicy is "allowlist" but groupAllowFrom (and allowFrom) is empty - all group messages will be silently dropped. Add sender IDs to ${prefix}.groupAllowFrom or ${prefix}.allowFrom, or set groupPolicy to "open".`,
          );
        } else {
          warnings.push(
            `- ${prefix}.groupPolicy is "allowlist" but groupAllowFrom is empty - this channel does not fall back to allowFrom, so all group messages will be silently dropped. Add sender IDs to ${prefix}.groupAllowFrom, or set groupPolicy to "open".`,
          );
        }
      }
    }
  };

  for (const [channelName, channelConfig] of Object.entries(
    channels as Record<string, Record<string, unknown>>,
  )) {
    if (!channelConfig || typeof channelConfig !== "object") {
      continue;
    }
    checkAccount(channelConfig, `channels.${channelName}`, undefined, channelName);

    const accounts = channelConfig.accounts;
    if (!accounts || typeof accounts !== "object") {
      continue;
    }
    for (const [accountId, account] of Object.entries(
      accounts as Record<string, Record<string, unknown>>,
    )) {
      if (!account || typeof account !== "object") {
        continue;
      }
      checkAccount(
        account,
        `channels.${channelName}.accounts.${accountId}`,
        channelConfig,
        channelName,
      );
    }
  }

  return warnings;
}
