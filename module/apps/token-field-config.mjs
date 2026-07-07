/**
 * Project: Anime — Token Info custom-fields configuration.
 *
 * Registers the world setting that stores the GM's custom Token-Info field list plus a
 * GM-only Settings menu (ApplicationV2 form) to edit it. Each row is a free-form field:
 * a display label, a DATA PATH read off the actor (e.g. "system.rank", "flags.mod.rank",
 * "name"), a gate (always / owner-only / unlocked by a Reveal category), and a surface
 * (hover panel or right-click dossier). This is the extensibility hook so a module that
 * adds e.g. a Rank can be surfaced in the token readout. Mirrors apps/bio-field-config.mjs
 * and reuses its `.ec-*` styling.
 */
import {
  TOKEN_INFO_FIELDS_SETTING, TOKEN_FIELD_GATES, TOKEN_FIELD_SURFACES, tokenFields, foldFieldGate
} from "./token-info.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TokenFieldConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-token-field-config",
    // Reuse the shared config-menu chrome (.ec-*); `token-field-config` sets its own grid.
    classes: ["project-anime", "config-menu", "token-field-config"],
    tag: "form",
    position: { width: 640, height: "auto" },
    window: { title: "PROJECTANIME.Settings.tokenFields.title", icon: "fa-solid fa-table-list" },
    form: { handler: TokenFieldConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addField: TokenFieldConfig.#onAdd,
      deleteField: TokenFieldConfig.#onDelete
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/token-field-config.hbs", scrollable: [""] }
  };

  /** Working copy of the rows being edited (survives interactive add/delete re-renders). */
  #rows = null;

  /** @override */
  async _prepareContext() {
    if (!this.#rows) this.#rows = tokenFields().map((f) => ({ ...f }));
    const L = (k) => game.i18n.localize(k);
    const map = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, L(v)]));
    return {
      rows: this.#rows.map((f) => ({
        label: f.label ?? "",
        path: f.path ?? "",
        gate: foldFieldGate(f.gate),
        surface: f.surface ?? "dossier"
      })),
      gateChoices: map(TOKEN_FIELD_GATES),
      surfaceChoices: map(TOKEN_FIELD_SURFACES)
    };
  }

  /** Pull the current (possibly unsaved) field values into a rows array. */
  #readForm() {
    if (!this.element) return this.#rows ?? [];
    const obj = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    const rows = obj.fields ? Object.values(obj.fields) : [];
    return rows.map((f) => ({
      label: (f.label || "").trim(),
      path: (f.path || "").trim(),
      gate: foldFieldGate(f.gate) in TOKEN_FIELD_GATES ? foldFieldGate(f.gate) : "always",
      surface: f.surface in TOKEN_FIELD_SURFACES ? f.surface : "dossier"
    }));
  }

  static #onAdd() {
    this.#rows = this.#readForm();
    this.#rows.push({ label: "", path: "", gate: "always", surface: "dossier" });
    this.render();
  }

  static #onDelete(event, target) {
    const i = Number(target.dataset.index);
    this.#rows = this.#readForm();
    if (i >= 0 && i < this.#rows.length) this.#rows.splice(i, 1);
    this.render();
  }

  static async #onSubmit(event, form, formData) {
    const obj = foundry.utils.expandObject(formData.object);
    const raw = obj.fields ? Object.values(obj.fields) : [];
    const seen = new Set();
    const fields = [];
    for (const f of raw) {
      const path = (f.path || "").trim();
      if (!path) continue;
      const surface = f.surface in TOKEN_FIELD_SURFACES ? f.surface : "dossier";
      const sig = `${path}|${surface}`; // allow the same path on both surfaces, dedupe exact repeats
      if (seen.has(sig)) continue;
      seen.add(sig);
      fields.push({
        label: (f.label || "").trim() || path,
        path,
        gate: foldFieldGate(f.gate) in TOKEN_FIELD_GATES ? foldFieldGate(f.gate) : "always",
        surface
      });
    }
    await game.settings.set("project-anime", TOKEN_INFO_FIELDS_SETTING, fields);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.tokenFields.saved"));
  }
}

/** Register the world setting + the GM-only settings menu. Call from `init`. */
export function registerTokenFieldSettings() {
  game.settings.register("project-anime", TOKEN_INFO_FIELDS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      // Re-render open Project: Anime apps (the dossier) so custom fields refresh live.
      for (const app of foundry.applications.instances.values()) {
        if (app.element?.classList?.contains("project-anime")) app.render(false);
      }
    }
  });

  game.settings.registerMenu("project-anime", "tokenFieldConfigMenu", {
    name: "PROJECTANIME.Settings.tokenFields.name",
    label: "PROJECTANIME.Settings.tokenFields.label",
    icon: "fa-solid fa-table-list",
    type: TokenFieldConfig,
    restricted: true
  });
}
