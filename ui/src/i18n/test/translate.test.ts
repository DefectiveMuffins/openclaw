import { beforeEach, describe, expect, it } from "vitest";
import { i18n, t } from "../lib/translate.ts";

const HEALTH_ZH_CN = "\u5065\u5eb7\u72b6\u51b5";

async function waitFor(condition: () => boolean) {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

describe("i18n", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.setLocale("en");
  });

  it("should return the key if translation is missing", () => {
    expect(t("non.existent.key")).toBe("non.existent.key");
  });

  it("should return the correct English translation", () => {
    expect(t("common.health")).toBe("Health");
  });

  it("should replace parameters correctly", () => {
    expect(t("overview.stats.cronNext", { time: "10:00" })).toBe("Next wake 10:00");
  });

  it("should fallback to English if key is missing in another locale", async () => {
    await i18n.setLocale("zh-CN");
    expect(t("common.health")).toBeDefined();
  });

  it("loads translations even when setting the same locale again", async () => {
    const internal = i18n as unknown as {
      locale: string;
      translations: Record<string, unknown>;
    };
    internal.locale = "zh-CN";
    delete internal.translations["zh-CN"];

    await i18n.setLocale("zh-CN");
    expect(t("common.health")).toBe(HEALTH_ZH_CN);
  });

  it("loads saved non-English locale on startup", async () => {
    localStorage.setItem("openclaw.i18n.locale", "zh-CN");
    const internal = i18n as unknown as {
      locale: string;
      translations: Record<string, unknown>;
      loadLocale: () => void;
    };
    internal.locale = "en";
    delete internal.translations["zh-CN"];

    internal.loadLocale();
    await waitFor(() => i18n.getLocale() === "zh-CN" && t("common.health") === HEALTH_ZH_CN);

    expect(i18n.getLocale()).toBe("zh-CN");
    expect(t("common.health")).toBe(HEALTH_ZH_CN);
  });
});
