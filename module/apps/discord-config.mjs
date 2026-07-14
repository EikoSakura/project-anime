/**
 * Project: Anime — Discord Settings.
 *
 * A GM-only Settings menu holding the two channel webhooks (quest board + #rewards), the quest
 * ping role, and the Character Mentions map. The URLs are world settings stored config:false and
 * edited only through this restricted dialog, so they never show up in the shared Configure
 * Settings list for players. Character → Discord links are saved as a flag on each character
 * (`flags.project-anime.discordId`), so they travel with the actor through party churn and are
 * resolved live at post time. Mirrors apps/token-config.mjs and reuses the shared .ec-* chrome.
 */
import {
  DISCORD_WEBHOOK_SETTING,
  DISCORD_ROLE_SETTING,
  DISCORD_REWARDS_WEBHOOK_SETTING,
  extractSnowflake,
  characterOwner
} from "../helpers/discord.mjs";

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
    // One mention row per player-owned Character, tinted by the owning player's color.
    const characters = game.actors
      .filter((a) => a.type === "character" && a.hasPlayerOwner)
      .map((a) => {
        const owner = characterOwner(a);
        return {
          id: a.id,
          name: a.name,
          player: owner?.name ?? "",
          color: owner?.color?.css ?? "#999999",
          discordId: a.getFlag("project-anime", "discordId") ?? ""
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      webhook: game.settings.get("project-anime", DISCORD_WEBHOOK_SETTING) ?? "",
      rewards: game.settings.get("project-anime", DISCORD_REWARDS_WEBHOOK_SETTING) ?? "",
      role: game.settings.get("project-anime", DISCORD_ROLE_SETTING) ?? "",
      characters
    };
  }

  static async #onSubmit(event, form, formData) {
    // expandObject: FormDataExtended#object keeps names FLAT, so "discord.{actorId}" needs the
    // explicit dot-expansion (actor ids are alphanumeric — never contain dots).
    const o = foundry.utils.expandObject(formData.object);
    await game.settings.set("project-anime", DISCORD_WEBHOOK_SETTING, String(o.webhook ?? "").trim());
    await game.settings.set("project-anime", DISCORD_REWARDS_WEBHOOK_SETTING, String(o.rewardsWebhook ?? "").trim());
    await game.settings.set("project-anime", DISCORD_ROLE_SETTING, String(o.role ?? "").trim());

    // Character Mentions → actor flags. Input is forgiving (a raw id or a pasted <@…> mention both
    // save the bare snowflake); blank clears the link.
    const updates = [];
    for (const [id, raw] of Object.entries(o.discord ?? {})) {
      const actor = game.actors.get(id);
      if (!actor) continue;
      const val = extractSnowflake(raw);
      const cur = actor.getFlag("project-anime", "discordId") ?? "";
      if (val && val !== cur) updates.push({ _id: id, "flags.project-anime.discordId": val });
      else if (!val && cur) updates.push({ _id: id, "flags.project-anime.-=discordId": null });
    }
    if (updates.length) await Actor.updateDocuments(updates);

    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.discord.saved"));
  }
}

/** Register the Discord webhook world settings + the GM-only menu. Call from `init`. */
export function registerDiscordSettings() {
  for (const key of [DISCORD_WEBHOOK_SETTING, DISCORD_ROLE_SETTING, DISCORD_REWARDS_WEBHOOK_SETTING]) {
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
