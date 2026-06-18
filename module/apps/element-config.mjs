/**
 * Project: Anime — Elements (damage types) configuration.
 *
 * Registers the world setting that stores the homebrew element list plus a
 * GM-only Settings menu (ApplicationV2 form) to edit it: each row is an element
 * with an icon (a Font Awesome class or an image from the file browser), a
 * display name, and a stable key.
 */
import { defaultElements, getElements, isImageIcon, ELEMENTS_SETTING } from "../helpers/elements.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Reduce a name/key to a stable slug usable as an affinity/object key. */
function slugify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

export class ElementConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-element-config",
    classes: ["project-anime", "element-config"],
    tag: "form",
    position: { width: 560, height: "auto" },
    window: { title: "PROJECTANIME.Settings.elements.title", icon: "fa-solid fa-fire-flame-curved" },
    form: { handler: ElementConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addRow: ElementConfig.#onAdd,
      deleteRow: ElementConfig.#onDelete,
      restoreList: ElementConfig.#onRestore,
      pickIcon: ElementConfig.#onPickIcon
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/element-config.hbs", scrollable: [""] }
  };

  /** Working copy of the element list being edited (survives interactive re-renders). */
  #rows = null;

  /** @override */
  async _prepareContext() {
    if (!this.#rows) this.#rows = getElements().map((e) => ({ ...e }));
    return { rows: this.#rows.map((e) => ({ ...e, iconImg: isImageIcon(e.icon) })) };
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
    this.#rows = (obj.elements ? Object.values(obj.elements) : [])
      .map((e) => ({ key: (e.key || "").trim(), label: (e.label || "").trim(), icon: (e.icon || "").trim() }));
  }

  static #onAdd() {
    this.#syncFromForm();
    this.#rows.push({ key: "", label: "", icon: "fa-solid fa-star" });
    this.render();
  }

  static #onDelete(event, target) {
    this.#syncFromForm();
    const i = Number(target.dataset.index);
    if (i >= 0 && i < this.#rows.length) this.#rows.splice(i, 1);
    this.render();
  }

  static #onRestore() {
    this.#rows = defaultElements();
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
    for (const e of (obj.elements ? Object.values(obj.elements) : [])) {
      const key = slugify(e.key || e.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: (e.label || "").trim() || key, icon: (e.icon || "").trim() });
    }
    await game.settings.set("project-anime", ELEMENTS_SETTING, out);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.elements.saved"));
  }
}

/** Register the world setting + the GM-only settings menu. Call from `init`. */
export function registerElementSettings() {
  // Re-render open Project: Anime apps so element labels/icons refresh live.
  const reRenderAll = () => {
    for (const app of foundry.applications.instances.values()) {
      if (app.element?.classList?.contains("project-anime")) app.render(false);
    }
  };

  game.settings.register("project-anime", ELEMENTS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: reRenderAll
  });

  game.settings.registerMenu("project-anime", "elementConfigMenu", {
    name: "PROJECTANIME.Settings.elements.name",
    label: "PROJECTANIME.Settings.elements.label",
    icon: "fa-solid fa-fire-flame-curved",
    type: ElementConfig,
    restricted: true
  });
}
