import { randomUUID } from "node:crypto";
import {
  ensureHostedProviderAllowlisted,
  resolveHostedProvidersForUi,
  type HostedProvidersUiResolution,
} from "../agents/hosted-routing.js";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile, type AuthProfileCredential } from "../agents/auth-profiles.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { loadConfig, type OpenClawConfig, writeConfigFile } from "../config/config.js";
import {
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "../commands/auth-choice.api-key.js";
import { ensureApiKeyFromEnvOrPrompt } from "../commands/auth-choice.apply-helpers.js";
import { loginOpenAICodexOAuth } from "../commands/openai-codex-oauth.js";
import {
  applyAuthProfileConfig,
  setGeminiApiKey,
  setKimiCodingApiKey,
  setMoonshotApiKey,
  writeOAuthCredentials,
} from "../commands/onboard-auth.js";
import { createVpsAwareOAuthHandlers } from "../commands/oauth-flow.js";
import {
  mergeConfigPatch,
  pickAuthMethod,
  resolveProviderMatch,
} from "../commands/provider-auth-helpers.js";
import { createNonExitingRuntime } from "../runtime.js";
import { loginGitHubCopilotDeviceToken } from "../providers/github-copilot-auth.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { resolvePluginProviders } from "../plugins/providers.js";
import { WizardSession } from "../wizard/session.js";
import type { WizardPrompter } from "../wizard/prompts.js";

function credentialMode(credential: AuthProfileCredential): "api_key" | "oauth" | "token" {
  if (credential.type === "api_key") {
    return "api_key";
  }
  if (credential.type === "token") {
    return "token";
  }
  return "oauth";
}

function resolveHostedAgentContext(config: OpenClawConfig) {
  const agentId = resolveDefaultAgentId(config);
  const agentDir = agentId ? resolveAgentDir(config, agentId) : resolveOpenClawAgentDir();
  const workspaceDir =
    (agentId ? resolveAgentWorkspaceDir(config, agentId) : null) ??
    resolveDefaultAgentWorkspaceDir();
  return {
    agentDir,
    workspaceDir,
  };
}

async function promptClientOpenUrl(session: WizardSession, providerLabel: string, url: string) {
  await session.awaitAnswer({
    id: randomUUID(),
    type: "action",
    title: `${providerLabel} sign-in`,
    message: "Open this URL in your browser, finish the provider step, then continue here.",
    initialValue: url,
    executor: "client",
  });
}

async function persistHostedProviderConfig(params: {
  providerId: string;
  apply: (config: OpenClawConfig) => OpenClawConfig;
}) {
  const latestConfig = loadConfig();
  const nextConfig = params.apply(latestConfig);
  await writeConfigFile(ensureHostedProviderAllowlisted(nextConfig, params.providerId));
}

function createHostedProviderPluginLoadConfig(
  config: OpenClawConfig,
  pluginId: string,
): OpenClawConfig {
  return {
    ...config,
    plugins: {
      ...config.plugins,
      enabled: config.plugins?.enabled !== false,
      allow: [pluginId],
      entries: {
        ...config.plugins?.entries,
        [pluginId]: {
          ...config.plugins?.entries?.[pluginId],
          enabled: true,
        },
      },
    },
  };
}

async function runApiKeyProviderAuth(params: {
  providerId: "google" | "moonshot" | "kimi-coding";
  label: string;
  envLabel: string;
  promptMessage: string;
  noteMessage?: string;
  prompter: WizardPrompter;
}) {
  const initialConfig = loadConfig();
  const { agentDir } = resolveHostedAgentContext(initialConfig);

  if (params.noteMessage) {
    await params.prompter.note(params.noteMessage, params.label);
  }

  const sharedParams = {
    config: initialConfig,
    envLabel: params.envLabel,
    promptMessage: params.promptMessage,
    normalize: normalizeApiKeyInput,
    validate: validateApiKeyInput,
    prompter: params.prompter,
  };

  if (params.providerId === "google") {
    await ensureApiKeyFromEnvOrPrompt({
      ...sharedParams,
      provider: "google",
      setCredential: async (key, mode) =>
        setGeminiApiKey(key, agentDir, { secretInputMode: mode }),
    });
  } else if (params.providerId === "moonshot") {
    await ensureApiKeyFromEnvOrPrompt({
      ...sharedParams,
      provider: "moonshot",
      setCredential: async (key, mode) =>
        setMoonshotApiKey(key, agentDir, { secretInputMode: mode }),
    });
  } else {
    await ensureApiKeyFromEnvOrPrompt({
      ...sharedParams,
      provider: "kimi-coding",
      setCredential: async (key, mode) =>
        setKimiCodingApiKey(key, agentDir, { secretInputMode: mode }),
    });
  }

  await persistHostedProviderConfig({
    providerId: params.providerId,
    apply: (config) =>
      applyAuthProfileConfig(config, {
        profileId: `${params.providerId}:default`,
        provider: params.providerId,
        mode: "api_key",
      }),
  });

  await params.prompter.note(
    `${params.label} is ready for hosted rotation.`,
    "Provider configured",
  );
}

async function runPluginProviderAuth(params: {
  session: WizardSession;
  prompter: WizardPrompter;
  providerId: string;
  pluginId: string;
  label: string;
  methodId?: string;
}) {
  const initialConfig = loadConfig();
  const runtime = createNonExitingRuntime();
  const { agentDir, workspaceDir } = resolveHostedAgentContext(initialConfig);

  const enableResult = enablePluginInConfig(initialConfig, params.pluginId);
  if (!enableResult.enabled) {
    await params.prompter.note(
      `${params.label} plugin is disabled (${enableResult.reason ?? "blocked"}).`,
      params.label,
    );
    return;
  }

  const authPluginConfig = createHostedProviderPluginLoadConfig(
    enableResult.config,
    params.pluginId,
  );
  const providers = resolvePluginProviders({ config: authPluginConfig, workspaceDir });
  const provider = resolveProviderMatch(providers, params.providerId);
  if (!provider) {
    await params.prompter.note(
      `${params.label} auth plugin is not available. Enable it and try again.`,
      params.label,
    );
    return;
  }

  const method =
    pickAuthMethod(provider, params.methodId) ??
    (provider.auth.length === 1
      ? provider.auth[0]
      : await params.prompter
          .select({
            message: `Auth method for ${provider.label}`,
            options: provider.auth.map((entry) => ({
              value: entry.id,
              label: entry.label,
              hint: entry.hint,
            })),
          })
          .then((selected) => provider.auth.find((entry) => entry.id === String(selected))));

  if (!method) {
    await params.prompter.note(`${params.label} auth method is unavailable.`, params.label);
    return;
  }

  const result = await method.run({
    config: authPluginConfig,
    agentDir,
    workspaceDir,
    prompter: params.prompter,
    runtime,
    isRemote: true,
    openUrl: async (url) => {
      await promptClientOpenUrl(params.session, params.label, url);
    },
    oauth: {
      createVpsAwareHandlers: (options) => createVpsAwareOAuthHandlers(options),
    },
  });

  for (const profile of result.profiles) {
    upsertAuthProfile({
      profileId: profile.profileId,
      credential: profile.credential,
      agentDir,
    });
  }

  await persistHostedProviderConfig({
    providerId: params.providerId,
    apply: (config) => {
      let mergedConfig = enablePluginInConfig(config, params.pluginId).config;
      if (result.configPatch) {
        mergedConfig = mergeConfigPatch(mergedConfig, result.configPatch);
      }
      for (const profile of result.profiles) {
        mergedConfig = applyAuthProfileConfig(mergedConfig, {
          profileId: profile.profileId,
          provider: profile.credential.provider,
          mode: credentialMode(profile.credential),
          ...("email" in profile.credential && profile.credential.email
            ? { email: profile.credential.email }
            : {}),
        });
      }
      return mergedConfig;
    },
  });

  if (result.notes && result.notes.length > 0) {
    await params.prompter.note(result.notes.join("\n"), "Provider notes");
  }

  await params.prompter.note(
    `${params.label} is ready for hosted rotation.`,
    "Provider configured",
  );
}

async function runOpenAICodexAuth(session: WizardSession, prompter: WizardPrompter) {
  const initialConfig = loadConfig();
  const runtime = createNonExitingRuntime();
  const { agentDir } = resolveHostedAgentContext(initialConfig);

  const creds = await loginOpenAICodexOAuth({
    prompter,
    runtime,
    isRemote: true,
    openUrl: async (url) => {
      await promptClientOpenUrl(session, "OpenAI Codex", url);
    },
    localBrowserMessage: "Open the OpenAI sign-in page in your browser...",
  });
  if (!creds) {
    return;
  }

  const profileId = await writeOAuthCredentials("openai-codex", creds, agentDir, {
    syncSiblingAgents: true,
  });

  await persistHostedProviderConfig({
    providerId: "openai-codex",
    apply: (config) =>
      applyAuthProfileConfig(config, {
        profileId,
        provider: "openai-codex",
        mode: "oauth",
      }),
  });

  await prompter.note("OpenAI Codex is ready for hosted rotation.", "Provider configured");
}

async function runGitHubCopilotAuth(session: WizardSession, prompter: WizardPrompter) {
  const initialConfig = loadConfig();
  const { agentDir } = resolveHostedAgentContext(initialConfig);

  await prompter.note(
    [
      "This opens a GitHub device login to authorize Copilot.",
      "GitHub Copilot requires an active Copilot subscription.",
    ].join("\n"),
    "GitHub Copilot",
  );

  const token = await loginGitHubCopilotDeviceToken({
    prompter,
    openUrl: async (url) => {
      await promptClientOpenUrl(session, "GitHub Copilot", url);
    },
  });

  upsertAuthProfile({
    profileId: "github-copilot:github",
    credential: {
      type: "token",
      provider: "github-copilot",
      token,
    },
    agentDir,
  });

  await persistHostedProviderConfig({
    providerId: "github-copilot",
    apply: (config) =>
      applyAuthProfileConfig(config, {
        profileId: "github-copilot:github",
        provider: "github-copilot",
        mode: "token",
      }),
  });

  await prompter.note("GitHub Copilot is ready for hosted rotation.", "Provider configured");
}

export const __testing = {
  createHostedProviderPluginLoadConfig,
};

export async function loadHostedProvidersForUi(): Promise<HostedProvidersUiResolution> {
  const config = loadConfig();
  const { agentDir } = resolveHostedAgentContext(config);
  return await resolveHostedProvidersForUi({ cfg: config, agentDir });
}

function createHostedProviderAuthRunnerInternal(params: {
  providerId: string;
  getSession: () => WizardSession;
}) {
  return async (prompter: WizardPrompter) => {
    const session = params.getSession();
    switch (params.providerId) {
      case "google-gemini-cli": {
        await prompter.note(
          [
            "This is an unofficial integration and is not endorsed by Google.",
            "Some users have reported account restrictions or suspensions after using third-party Gemini CLI OAuth clients.",
            "Proceed only if you understand and accept this risk.",
          ].join("\n"),
          "Google Gemini CLI caution",
        );
        const proceed = await prompter.confirm({
          message: "Continue with Google Gemini CLI OAuth?",
          initialValue: false,
        });
        if (!proceed) {
          await prompter.note("Skipped Google Gemini CLI OAuth setup.", "Setup skipped");
          return;
        }
        await runPluginProviderAuth({
          session,
          prompter,
          providerId: "google-gemini-cli",
          pluginId: "google-gemini-cli-auth",
          label: "Google Gemini CLI",
          methodId: "oauth",
        });
        return;
      }
      case "google":
        await runApiKeyProviderAuth({
          providerId: "google",
          label: "Google Gemini",
          envLabel: "GEMINI_API_KEY",
          promptMessage: "Enter Gemini API key",
          prompter,
        });
        return;
      case "qwen-portal":
        await runPluginProviderAuth({
          session,
          prompter,
          providerId: "qwen-portal",
          pluginId: "qwen-portal-auth",
          label: "Qwen",
          methodId: "device",
        });
        return;
      case "moonshot":
        await runApiKeyProviderAuth({
          providerId: "moonshot",
          label: "Moonshot",
          envLabel: "MOONSHOT_API_KEY",
          promptMessage: "Enter Moonshot API key",
          prompter,
        });
        return;
      case "kimi-coding":
        await runApiKeyProviderAuth({
          providerId: "kimi-coding",
          label: "Kimi Coding",
          envLabel: "KIMI_API_KEY",
          promptMessage: "Enter Kimi Coding API key",
          noteMessage: "Get your API key at https://www.kimi.com/code/en",
          prompter,
        });
        return;
      case "minimax-portal":
        await runPluginProviderAuth({
          session,
          prompter,
          providerId: "minimax-portal",
          pluginId: "minimax-portal-auth",
          label: "MiniMax",
        });
        return;
      case "openai-codex":
        await runOpenAICodexAuth(session, prompter);
        return;
      case "github-copilot":
        await runGitHubCopilotAuth(session, prompter);
        return;
      default:
        await prompter.note(
          `Provider \"${params.providerId}\" is not supported in the Control UI yet.`,
          "Unsupported provider",
        );
    }
  };
}

export function createHostedProviderAuthSession(providerId: string): WizardSession {
  const holder: { session?: WizardSession } = {};
  const session = new WizardSession(async (prompter) => {
    await Promise.resolve();
    const currentSession = holder.session;
    if (!currentSession) {
      throw new Error("provider auth session unavailable");
    }
    const runner = createHostedProviderAuthRunnerInternal({
      providerId,
      getSession: () => currentSession,
    });
    await runner(prompter);
  });
  holder.session = session;
  return session;
}