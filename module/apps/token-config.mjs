/**
 * Project: Anime — Token Settings.
 *
 * One grouped Settings menu ("Token Settings") gathering the token-display options:
 *   • who may see tokens' on-canvas HP / Energy bars (everyone, or allies only); and
 *   • the hover Token Info Panel on / off (moved here from a standalone checkbox).
 * Both are world settings stored config:false and edited through this dialog. Mirrors the other
 * config apps (apps/token-field-config.mjs) and reuses the shared .ec-* chrome.
 */
// The bar-visibility setting key + choices live with the shared `canSeeTokenVitals` gate in
// token-info.mjs (used by the on-canvas bars, the hover panel, and the dossier); this module owns
// the GM dialog + registration only.
import { TOKEN_INFO_SETTING, TOKEN_BARS_SETTING, TOKEN_BARS_MODES } from "./token-info.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TokenSettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-token-settings",
    // Reuse the shared config-menu chrome (.ec-body / .ec-footer / .ec-save); add our own field layout.
    classes: ["project-anime", "config-menu", "token-settings-config"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "PROJECTANIME.Settings.tokenSettings.title", icon: "fa-solid fa-people-group" },
    form: { handler: TokenSettingsConfig.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/token-settings.hbs" }
  };

  /** @override */
  async _prepareContext() {
    const L = (k) => game.i18n.localize(k);
    return {
      bars: game.settings.get("project-anime", TOKEN_BARS_SETTING),
      barsChoices: Object.fromEntries(Object.entries(TOKEN_BARS_MODES).map(([k, v]) => [k, L(v)])),
      tokenInfo: game.settings.get("project-anime", TOKEN_INFO_SETTING)
    };
  }

  static async #onSubmit(event, form, formData) {
    const obj = formData.object;
    const bars = obj.bars in TOKEN_BARS_MODES ? obj.bars : "everyone";
    await game.settings.set("project-anime", TOKEN_BARS_SETTING, bars);
    await game.settings.set("project-anime", TOKEN_INFO_SETTING, !!obj.tokenInfo);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.tokenSettings.saved"));
  }
}

/** Register the Token Settings world setting + the GM-only menu. Call from `init`. */
export function registerTokenSettings() {
  game.settings.register("project-anime", TOKEN_BARS_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: "everyone",
    onChange: () => {
      // Re-evaluate every on-canvas token's bars for the current viewer (paDrawBar reads the setting).
      for (const t of canvas.tokens?.placeables ?? []) t.renderFlags?.set?.({ refreshBars: true });
    }
  });

  game.settings.registerMenu("project-anime", "tokenSettingsMenu", {
    name: "PROJECTANIME.Settings.tokenSettings.name",
    label: "PROJECTANIME.Settings.tokenSettings.label",
    hint: "PROJECTANIME.Settings.tokenSettings.hint",
    icon: "fa-solid fa-people-group",
    type: TokenSettingsConfig,
    restricted: true
  });
}
