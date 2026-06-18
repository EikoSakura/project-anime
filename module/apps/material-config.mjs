/**
 * Project: Anime — Material Categories configuration.
 *
 * Registers the world setting that stores the homebrew material-category list plus a GM-only
 * Settings menu (ApplicationV2 form) to edit it: each row is a category with an icon (a Font
 * Awesome class or an image from the file browser), a display name, and a stable key.
 *
 * Structurally a twin of apps/element-config.mjs; it carries the `element-config` class so it
 * reuses that dialog's `.ec-*` styling verbatim (categories share the icon/name/key columns).
 */
import { defaultMaterialCategories, getMaterialCategories, MATERIAL_CATEGORIES_SETTING } from "../helpers/materials.mjs";
import { isImageIcon } from "../helpers/elements.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Reduce a name/key to a stable slug usable as a category key. */
function slugify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

export class MaterialCategoryConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-material-config",
    classes: ["project-anime", "element-config", "material-config"],
    tag: "form",
    position: { width: 560, height: "auto" },
    window: { title: "PROJECTANIME.Settings.materialCategories.title", icon: "fa-solid fa-cubes" },
    form: { handler: MaterialCategoryConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addRow: MaterialCategoryConfig.#onAdd,
      deleteRow: MaterialCategoryConfig.#onDelete,
      restoreList: MaterialCategoryConfig.#onRestore,
      pickIcon: MaterialCategoryConfig.#onPickIcon
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/material-config.hbs", scrollable: [""] }
  };

  /** Working copy of the category list being edited (survives interactive re-renders). */
  #rows = null;

  /** @override */
  async _prepareContext() {
    if (!this.#rows) this.#rows = getMaterialCategories().map((c) => ({ ...c }));
    return { rows: this.#rows.map((c) => ({ ...c, iconImg: isImageIcon(c.icon) })) };
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

  /** Read the current (possibly unsaved) field values back into the working copy. */
  #syncFromForm() {
    if (!this.element) return;
    const obj = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    this.#rows = (obj.materialCategories ? Object.values(obj.materialCategories) : [])
      .map((c) => ({ key: (c.key || "").trim(), label: (c.label || "").trim(), icon: (c.icon || "").trim() }));
  }

  static #onAdd() {
    this.#syncFromForm();
    this.#rows.push({ key: "", label: "", icon: "fa-solid fa-cube" });
    this.render();
  }

  static #onDelete(event, target) {
    this.#syncFromForm();
    const i = Number(target.dataset.index);
    if (i >= 0 && i < this.#rows.length) this.#rows.splice(i, 1);
    this.render();
  }

  static #onRestore() {
    this.#rows = defaultMaterialCategories();
    this.render();
  }

  /** Open the file browser to pick an image for a row's icon. */
  static async #onPickIcon(event, target) {
    this.#syncFromForm();
    const i = Number(target.dataset.index);
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
    const seen = new Set();
    const out = [];
    for (const c of (obj.materialCategories ? Object.values(obj.materialCategories) : [])) {
      const key = slugify(c.key || c.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: (c.label || "").trim() || key, icon: (c.icon || "").trim() });
    }
    await game.settings.set("project-anime", MATERIAL_CATEGORIES_SETTING, out);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.materialCategories.saved"));
  }
}

/** Register the world setting + the GM-only settings menu. Call from `init`. */
export function registerMaterialSettings() {
  // Re-render open Project: Anime apps so category labels/icons refresh live.
  const reRenderAll = () => {
    for (const app of foundry.applications.instances.values()) {
      if (app.element?.classList?.contains("project-anime")) app.render(false);
    }
  };

  game.settings.register("project-anime", MATERIAL_CATEGORIES_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: reRenderAll
  });

  game.settings.registerMenu("project-anime", "materialConfigMenu", {
    name: "PROJECTANIME.Settings.materialCategories.name",
    label: "PROJECTANIME.Settings.materialCategories.label",
    icon: "fa-solid fa-cubes",
    type: MaterialCategoryConfig,
    restricted: true
  });
}
