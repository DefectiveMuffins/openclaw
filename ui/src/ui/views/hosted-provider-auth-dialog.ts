import { html, nothing } from "lit";
import type { GatewayWizardStep } from "../types.ts";

export type HostedProviderAuthDialogProps = {
  providerId: string | null;
  step: GatewayWizardStep | null;
  value: unknown;
  busy: boolean;
  error: string | null;
  onValueChange: (value: unknown) => void;
  onSubmit: (value?: unknown) => void;
  onCancel: () => void;
};

function formatTitle(step: GatewayWizardStep | null, providerId: string | null): string {
  if (step?.title?.trim()) {
    return step.title.trim();
  }
  if (providerId?.trim()) {
    return `Configure ${providerId}`;
  }
  return "Provider setup";
}

function openWizardUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function renderHostedProviderAuthDialog(props: HostedProviderAuthDialogProps) {
  const { step, providerId, value, busy, error, onValueChange, onSubmit, onCancel } = props;
  if (!step) {
    return nothing;
  }

  const title = formatTitle(step, providerId);
  const message = step.message?.trim() ?? "";
  const actionUrl = typeof step.initialValue === "string" ? step.initialValue.trim() : "";
  const textValue = typeof value === "string" ? value : "";
  const selectValue = value ?? "";
  const multiselectValue = Array.isArray(value) ? value.map((entry) => String(entry)) : [];

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card hosted-auth-dialog">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${title}</div>
            ${providerId ? html`<div class="exec-approval-sub mono">${providerId}</div>` : nothing}
          </div>
        </div>
        ${message ? html`<div class="hosted-auth-message">${message}</div>` : nothing}
        ${
          error ? html`<div class="callout danger" style="margin-top: 12px;">${error}</div>` : nothing
        }

        ${
          step.type === "note"
            ? html``
            : step.type === "text"
              ? html`
                  <form
                    class="hosted-auth-form"
                    @submit=${(event: Event) => {
                      event.preventDefault();
                      onSubmit();
                    }}
                  >
                    <input
                      class="input"
                      type=${step.sensitive ? "password" : "text"}
                      .value=${textValue}
                      placeholder=${step.placeholder ?? ""}
                      ?disabled=${busy}
                      @input=${(event: Event) =>
                        onValueChange((event.target as HTMLInputElement).value)}
                    />
                  </form>
                `
              : step.type === "select"
                ? html`
                    <label class="field hosted-auth-form">
                      <select
                        .value=${String(selectValue)}
                        ?disabled=${busy}
                        @change=${(event: Event) =>
                          onValueChange((event.target as HTMLSelectElement).value)}
                      >
                        ${(step.options ?? []).map(
                          (option) => html`
                            <option .value=${String(option.value)}>${option.label}</option>
                          `,
                        )}
                      </select>
                    </label>
                  `
                : step.type === "multiselect"
                  ? html`
                      <div class="hosted-auth-multiselect">
                        ${(step.options ?? []).map((option) => {
                          const optionValue = String(option.value);
                          const checked = multiselectValue.includes(optionValue);
                          return html`
                            <label class="hosted-provider-checkbox-row">
                              <input
                                type="checkbox"
                                .checked=${checked}
                                ?disabled=${busy}
                                @change=${(event: Event) => {
                                  const next = new Set(multiselectValue);
                                  if ((event.target as HTMLInputElement).checked) {
                                    next.add(optionValue);
                                  } else {
                                    next.delete(optionValue);
                                  }
                                  onValueChange([...next]);
                                }}
                              />
                              <span>${option.label}</span>
                            </label>
                          `;
                        })}
                      </div>
                    `
                  : step.type === "action"
                    ? html`
                        <div class="hosted-auth-action-row">
                          ${actionUrl ? html`<div class="mono hosted-auth-url">${actionUrl}</div>` : nothing}
                          ${
                            actionUrl
                              ? html`
                                  <button
                                    class="btn"
                                    type="button"
                                    ?disabled=${busy}
                                    @click=${() => openWizardUrl(actionUrl)}
                                  >
                                    Open sign-in page
                                  </button>
                                `
                              : nothing
                          }
                        </div>
                      `
                    : nothing
        }

        <div class="exec-approval-actions">
          ${
            step.type === "confirm"
              ? html`
                  <button
                    class="btn primary"
                    type="button"
                    ?disabled=${busy}
                    @click=${() => onSubmit(true)}
                  >
                    Continue
                  </button>
                  <button
                    class="btn"
                    type="button"
                    ?disabled=${busy}
                    @click=${() => onSubmit(false)}
                  >
                    Cancel setup
                  </button>
                `
              : html`
                  <button
                    class="btn primary"
                    type="button"
                    ?disabled=${busy}
                    @click=${() => onSubmit()}
                  >
                    ${step.type === "action" ? "I finished this step" : "Continue"}
                  </button>
                  <button class="btn" type="button" ?disabled=${busy} @click=${onCancel}>
                    Cancel
                  </button>
                `
          }
        </div>
      </div>
    </div>
  `;
}
