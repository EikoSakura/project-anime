/**
 * Project: Anime — Bio dossier fields configuration.
 *
 * Registers the world setting that stores the homebrew Bio-tab field list plus a
 * GM-only Settings menu (ApplicationV2 form) to edit it: each row is a dossier field
 * with an icon (a Font Awesome class or an image from the file browser), a display
 * name, a stable key, and a type (single-line or multi-line). Mirrors
 * the other `.ec-*`-styled config dialogs (token fields, creation config, …).
 */
import { defaultBioFields, getBioFields, BIO_FIELDS_SETTING } from "../helpers/bio-fields.mjs";
import { isImageIcon } from "../helpers/config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Reduce a name/key to a stable slug usable as a details object key. */
function slugify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

export class BioFieldConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-bio-field-config",
    // Reuse the shared config-menu chrome (.ec-*); `bio-field-config` adjusts the grid.
    classes: ["project-anime", "config-menu", "bio-field-config"],
    tag: "form",
    position: { width: 600, height: "auto" },
    window: { title: "PROJECTANIME.Settings.bioFields.title", icon: "fa-solid fa-id-card" },
    form: { handler: BioFieldConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addField: BioFieldConfig.#onAdd,
      deleteField: BioFieldConfig.#onDelete,
      restoreDefaults: BioFieldConfig.#onRestore,
      pickIcon: BioFieldConfig.#onPickIcon
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/bio-field-config.hbs", scrollable: [""] }
  };

  /** Working copy of the rows being edited (survives interactive re-renders). */
  #rows = null;

  /** @override */
  async _prepareContext() {
    if (!this.#rows) this.#rows = getBioFields().map((f) => ({ ...f }));
    return { rows: this.#rows.map((f) => ({ ...f, iconImg: isImageIcon(f.icon), isLong: f.type === "long" })) };
  }

  /** @override — live-update each row's icon preview (FA class or image) as typed. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const row of this.element.querySelectorAll(".ec-row")) {
      const input = row.querySelector(".ec-icon");
      const box = row.querySelector(".ec-pick");
      if (!input || !box) continue;
      input.addEventListener("input", () => {
        const val = input.value.trim();
        box.replaceChildren();
        if (isImageIcon(val)) {
          const img = document.createElement("img");
          img.src = val;
          img.alt = "";
          box.append(img);
        } else {
          const i = document.createElement("i");
          i.className = val;
          box.append(i);
        }
      });
    }
  }

  /** Pull the current (possibly unsaved) field values into a rows array. */
  #readForm() {
    if (!this.element) return this.#rows ?? [];
    const data = new foundry.applications.ux.FormDataExtended(this.element).object;
    const obj = foundry.utils.expandObject(data);
    const rows = obj.fields ? Object.values(obj.fields) : [];
    return rows.map((f) => ({
      key: (f.key || "").trim(),
      label: (f.label || "").trim(),
      icon: (f.icon || "").trim(),
      type: f.long ? "long" : "short"
    }));
  }

  static #onAdd() {
    this.#rows = this.#readForm();
    this.#rows.push({ key: "", label: "", icon: "fa-solid fa-tag", type: "short" });
    this.render();
  }

  static #onDelete(event, target) {
    const i = Number(target.dataset.index);
    this.#rows = this.#readForm();
    if (i >= 0 && i < this.#rows.length) this.#rows.splice(i, 1);
    this.render();
  }

  static #onRestore() {
    this.#rows = defaultBioFields();
    this.render();
  }

  /** Open the file browser to pick an image for this field's icon. */
  static async #onPickIcon(event, target) {
    const i = Number(target.dataset.index);
    this.#rows = this.#readForm();
    if (!(i >= 0 && i < this.#rows.length)) return;
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.#rows[i].icon || "",
      callback: (path) => { this.#rows[i].icon = path; this.render(); }
    });
    return fp.browse();
  }

  static async #onSubmit(event, form, formData) {
    const obj = foundry.utils.expandObject(formData.object);
    const raw = obj.fields ? Object.values(obj.fields) : [];
    const seen = new Set();
    const fields = [];
    for (const f of raw) {
      const key = slugify(f.key || f.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      fields.push({ key, label: (f.label || "").trim() || key, icon: (f.icon || "").trim(), type: f.long ? "long" : "short" });
    }
    await game.settings.set("project-anime", BIO_FIELDS_SETTING, fields);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.bioFields.saved"));
  }
}

/** Register the world setting + the GM-only settings menu. Call from `init`. */
export function registerBioFieldSettings() {
  game.settings.register("project-anime", BIO_FIELDS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => {
      // Re-render open Project: Anime sheets so the dossier fields refresh live.
      for (const app of foundry.applications.instances.values()) {
        if (app.element?.classList?.contains("project-anime")) app.render(false);
      }
    }
  });

  game.settings.registerMenu("project-anime", "bioFieldConfigMenu", {
    name: "PROJECTANIME.Settings.bioFields.name",
    label: "PROJECTANIME.Settings.bioFields.label",
    icon: "fa-solid fa-id-card",
    type: BioFieldConfig,
    restricted: true
  });
}
