/**
 * Project: Anime — Discord Settings.
 *
 * A GM-only Settings menu holding the channel webhook URL that quests post to. The URL is a
 * world setting stored config:false and edited only through this restricted dialog, so it never
 * shows up in the shared Configure Settings list for players. Mirrors apps/token-config.mjs and
 * reuses the shared .ec-* config chrome.
 */
import { DISCORD_WEBHOOK_SETTING, DISCORD_ROLE_SETTING } from "../helpers/discord.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DiscordSettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-discord-settings",
    classes: ["project-anime", "config-menu", "discord-settings-config"],
    tag: "form",
    position: { width: 520, height: "auto" },
    window: { title: "PROJECTANIME.Settings.discord.title", icon: "fa-brands fa-discord" },
    form: { handler: DiscordSettingsConfig.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/discord-settings.hbs" }
  };

  /** @override */
  async _prepareContext() {
    return {
      webhook: game.settings.get("project-anime", DISCORD_WEBHOOK_SETTING) ?? "",
      role: game.settings.get("project-anime", DISCORD_ROLE_SETTING) ?? ""
    };
  }

  static async #onSubmit(event, form, formData) {
    const o = formData.object;
    await game.settings.set("project-anime", DISCORD_WEBHOOK_SETTING, String(o.webhook ?? "").trim());
    await game.settings.set("project-anime", DISCORD_ROLE_SETTING, String(o.role ?? "").trim());
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.discord.saved"));
  }
}

/** Register the Discord webhook world setting + the GM-only menu. Call from `init`. */
export function registerDiscordSettings() {
  for (const key of [DISCORD_WEBHOOK_SETTING, DISCORD_ROLE_SETTING]) {
    game.settings.register("project-anime", key, {
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  game.settings.registerMenu("project-anime", "discordSettingsMenu", {
    name: "PROJECTANIME.Settings.discord.name",
    label: "PROJECTANIME.Settings.discord.label",
    hint: "PROJECTANIME.Settings.discord.hint",
    icon: "fa-brands fa-discord",
    type: DiscordSettingsConfig,
    restricted: true
  });
}
