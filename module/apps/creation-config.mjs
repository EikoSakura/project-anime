/**
 * Project: Anime — Character-Creation config app + settings registration.
 *
 * A GM-only Configure-Settings menu (like the Elements / Bio Fields / Token Fields
 * menus) that tunes the Character Creator: starting Skill Points, free Attribute
 * Step-Ups, the Gold budget, which Item types may be purchased, and which compendium
 * packs the gear shop draws from. Mirrors element-config.mjs.
 */
import { CREATION_SETTING, getCreationConfig } from "../helpers/creation.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Item types offered as purchasable-type checkboxes (everything but Skill). */
const SHOP_CANDIDATE_TYPES = ["weapon", "armor", "shield", "accessory", "consumable", "container", "gear"];

/** Reduce a label to a stable slug usable as a choice id. */
function slugify(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

export class CreationConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pa-creation-config",
    classes: ["project-anime", "creation-config"],
    tag: "form",
    position: { width: 560, height: "auto" },
    window: { title: "PROJECTANIME.Settings.creation.title", icon: "fa-solid fa-user-plus" },
    form: { handler: CreationConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      restoreDefaults: CreationConfig.#onRestoreDefaults,
      addChoice: CreationConfig.#onAddChoice,
      deleteChoice: CreationConfig.#onDeleteChoice,
      deleteOption: CreationConfig.#onDeleteOption
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/creation-config.hbs", scrollable: [""] }
  };

  /** Working copy of the whole config — survives the interactive re-renders that adding /
   *  deleting / dropping choices & options trigger, so unsaved number/checkbox/choice edits
   *  aren't lost (the form re-renders from this, not from the saved setting). */
  #state = null;

  #seed() {
    if (this.#state) return;
    const c = getCreationConfig();
    this.#state = {
      skillPoints: c.skillPoints, stepUps: c.stepUps, gold: c.gold,
      allowedTypes: [...c.allowedTypes], packs: [...c.packs],
      choices: c.choices.map((ch) => ({ ...ch, options: ch.options.map((o) => ({ ...o })) }))
    };
  }

  /** @override */
  async _prepareContext() {
    this.#seed();
    const s = this.#state;
    const allowed = new Set(s.allowedTypes);
    const open = new Set(s.packs);
    return {
      cfg: { skillPoints: s.skillPoints, stepUps: s.stepUps, gold: s.gold },
      types: SHOP_CANDIDATE_TYPES.map((t) => ({
        type: t,
        label: game.i18n.localize(`TYPES.Item.${t}`),
        checked: allowed.has(t)
      })),
      packs: (game.packs ?? [])
        .filter((p) => p.documentName === "Item")
        .map((p) => ({
          id: p.collection,
          label: p.metadata?.label ?? p.title ?? p.collection,
          source: p.metadata?.packageType === "world" ? "World"
            : (p.metadata?.system === game.system.id ? "System" : "Module"),
          checked: open.has(p.collection)
        })),
      modeChoices: {
        single: game.i18n.localize("PROJECTANIME.Settings.creation.mode.single"),
        pickN: game.i18n.localize("PROJECTANIME.Settings.creation.mode.pickN")
      },
      choices: s.choices.map((ch, i) => ({
        index: i,
        id: ch.id,
        label: ch.label,
        mode: ch.mode,
        n: ch.n,
        pickN: ch.mode === "pickN",
        options: ch.options.map((o, j) => ({
          index: j,
          uuid: o.uuid,
          label: o.label,
          img: o.img || "icons/svg/item-bag.svg"
        }))
      }))
    };
  }

  /** @override — drop a Package onto a choice to add it as an option; re-render on mode change. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const zone of this.element.querySelectorAll(".cc-option-drop")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", (ev) => this.#onDropOption(ev, zone));
    }
    for (const sel of this.element.querySelectorAll(".cc-choice-mode")) {
      sel.addEventListener("change", () => { this.#readState(); this.render(); });
    }
  }

  /** Pull the current (possibly unsaved) form values into the working copy. */
  #readState() {
    if (!this.element) return;
    const form = this.element;
    const num = (name, fb) => { const v = Number(form.elements[name]?.value); return Number.isFinite(v) ? Math.max(0, Math.round(v)) : fb; };
    const checked = (cls) => Array.from(form.querySelectorAll(`input.${cls}:checked`)).map((c) => c.value);
    const obj = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    const rawChoices = obj.choices ? Object.values(obj.choices) : [];
    this.#state = {
      skillPoints: num("skillPoints", 6),
      stepUps: num("stepUps", 5),
      gold: num("gold", 1500),
      allowedTypes: checked("pa-cc-type"),
      packs: checked("pa-cc-pack"),
      choices: rawChoices.map((c) => ({
        id: String(c.id ?? "").trim(),
        label: String(c.label ?? "").trim(),
        mode: c.mode === "pickN" ? "pickN" : "single",
        n: Math.max(1, Math.round(Number(c.n) || 1)),
        options: c.options ? Object.values(c.options).map((o) => ({
          uuid: String(o.uuid ?? "").trim(),
          label: String(o.label ?? "").trim(),
          img: String(o.img ?? "").trim()
        })).filter((o) => o.uuid) : []
      }))
    };
  }

  static #onAddChoice() {
    this.#readState();
    const ids = new Set(this.#state.choices.map((c) => c.id).filter(Boolean));
    let i = 1; while (ids.has(`choice${i}`)) i++;
    this.#state.choices.push({ id: `choice${i}`, label: "", mode: "single", n: 1, options: [] });
    this.render();
  }

  static #onDeleteChoice(event, target) {
    const i = Number(target.dataset.index);
    this.#readState();
    if (i >= 0 && i < this.#state.choices.length) this.#state.choices.splice(i, 1);
    this.render();
  }

  static #onDeleteOption(event, target) {
    const ci = Number(target.dataset.choiceIndex);
    const oi = Number(target.dataset.optionIndex);
    this.#readState();
    const ch = this.#state.choices[ci];
    if (ch && oi >= 0 && oi < ch.options.length) ch.options.splice(oi, 1);
    this.render();
  }

  /** Drop an Item onto a choice — only a Package may be an option. */
  async #onDropOption(event, zone) {
    event.preventDefault();
    zone.classList.remove("dragover");
    const ci = Number(zone.dataset.choiceIndex);
    if (!(ci >= 0)) return;
    let data = null;
    try {
      const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
      data = TE?.getDragEventData ? TE.getDragEventData(event) : JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (_) { return; }
    if (data?.type !== "Item" || !data.uuid) return;
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    if (doc.type !== "package") return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Settings.creation.notPackage"));
    this.#readState();
    const ch = this.#state.choices[ci];
    if (!ch || ch.options.some((o) => o.uuid === doc.uuid)) return;
    ch.options.push({ uuid: doc.uuid, label: doc.name, img: doc.img });
    this.render();
  }

  static async #onSubmit() {
    this.#readState();
    const s = this.#state;
    // Assign stable slug ids (kept across renames via the carried hidden id); dedupe.
    const seen = new Set();
    const choices = [];
    for (const c of s.choices) {
      let id = slugify(c.id) || slugify(c.label) || `choice${choices.length + 1}`;
      while (seen.has(id)) id = `${id}x`;
      seen.add(id);
      choices.push({ id, label: c.label || id, mode: c.mode, n: c.n, options: c.options });
    }
    await game.settings.set("project-anime", CREATION_SETTING, {
      skillPoints: s.skillPoints,
      stepUps: s.stepUps,
      gold: s.gold,
      allowedTypes: s.allowedTypes,
      packs: s.packs,
      choices
    });
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.creation.saved"));
  }

  static async #onRestoreDefaults() {
    // Clearing the setting falls the accessors back to defaultCreationConfig(); drop the
    // working copy so the re-render re-seeds from those defaults.
    this.#state = null;
    await game.settings.set("project-anime", CREATION_SETTING, {});
    this.render();
  }
}

/** Register the world setting + its Configure-Settings menu (called from init). */
export function registerCreationSettings() {
  game.settings.register("project-anime", CREATION_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      // Re-render any open Project: Anime app (the Creator picks up new numbers/types).
      for (const app of foundry.applications.instances.values()) {
        if (app.options?.classes?.includes("project-anime")) app.render(false);
      }
    }
  });

  game.settings.registerMenu("project-anime", "creationConfigMenu", {
    name: "PROJECTANIME.Settings.creation.name",
    label: "PROJECTANIME.Settings.creation.label",
    hint: "PROJECTANIME.Settings.creation.hint",
    icon: "fa-solid fa-user-plus",
    type: CreationConfig,
    restricted: true
  });
}
