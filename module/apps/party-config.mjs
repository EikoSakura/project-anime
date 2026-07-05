/**
 * Project: Anime — Headquarters Settings.
 *
 * One grouped Settings menu for the HQ / campaign rules: the Codex Factions + Home panes toggle,
 * the Lethal Dispatch variant, and the Workshop facility-requirements knob — three world rules in
 * one GM dialog instead of loose checkboxes. All config:false, edited through this dialog.
 * Mirrors apps/token-config.mjs and reuses the shared .ec-* config chrome.
 */
import { DEATH_STRIKES_SETTING, CRAFT_REQUIRE_SETTING } from "../helpers/factions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** World setting: show the Factions + Home panes in the Codex (default on). */
export const PARTY_FACTIONS_SETTING = "partyFactionsTab";

export class PartySettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-party-settings",
    // Reuse the Elements config chrome (.ec-body / .ec-footer / .ec-save) like the Token Settings dialog.
    classes: ["project-anime", "element-config", "party-settings-config"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "PROJECTANIME.Settings.partySettings.title", icon: "fa-solid fa-users-gear" },
    form: { handler: PartySettingsConfig.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/party-settings.hbs" }
  };

  /** @override */
  async _prepareContext() {
    return {
      factionsTab: game.settings.get("project-anime", PARTY_FACTIONS_SETTING),
      deathStrikes: game.settings.get("project-anime", DEATH_STRIKES_SETTING),
      craftRequire: game.settings.get("project-anime", CRAFT_REQUIRE_SETTING)
    };
  }

  static async #onSubmit(event, form, formData) {
    await game.settings.set("project-anime", PARTY_FACTIONS_SETTING, !!formData.object.factionsTab);
    await game.settings.set("project-anime", DEATH_STRIKES_SETTING, !!formData.object.deathStrikes);
    await game.settings.set("project-anime", CRAFT_REQUIRE_SETTING, !!formData.object.craftRequire);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.partySettings.saved"));
  }
}

/** Register the Party-Sheet world setting + the GM-only menu. Call from `init`. */
export function registerPartySettings() {
  game.settings.register("project-anime", PARTY_FACTIONS_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => {
      // Show/hide the Factions + Home panes on every open Codex at once.
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "pa-codex") app.render(false);
      }
    }
  });

  game.settings.registerMenu("project-anime", "partySettingsMenu", {
    name: "PROJECTANIME.Settings.partySettings.name",
    label: "PROJECTANIME.Settings.partySettings.label",
    hint: "PROJECTANIME.Settings.partySettings.hint",
    icon: "fa-solid fa-users-gear",
    type: PartySettingsConfig,
    restricted: true
  });
}
