import ProjectAnimeSheet from "./mixin.mjs";
import { LADDER, ATTRIBUTES, STANDARD_ADVANCEMENTS, SPECIAL_ADVANCEMENTS } from "../config.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends ProjectAnimeSheet(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor", "character"],
    position: { width: 880, height: 920 },
    actions: {
      flipBadge: this.#onFlipBadge,
      setPip: this.#onSetPip,
      toggleLuck: this.#onToggleLuck,
      toggleBox: this.#onToggleBox,
      stepUnspent: this.#onStepUnspent
    }
  };

  /* The View | Edit toggle arrives with the edit-mode step. */
  static USES_MODE_TOGGLE = false;

  static PARTS = {
    header: { template: "systems/project-anime/templates/actor/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/project-anime/templates/actor/main.hbs" },
    growth: { template: "systems/project-anime/templates/actor/growth.hbs" },
    profile: { template: "systems/project-anime/templates/actor/profile.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "main" }, { id: "growth" }, { id: "profile" }],
      initial: "main",
      labelPrefix: "PROJECTANIME.Tab"
    }
  };

  /* Which rank badges currently show their die or bonus face. Display state only, never stored. */
  #flipped = new Set();

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const grade = LADDER[system.grade];

    context.system = system;
    context.editMode = this.isEditMode;
    context.name = this.document.name;
    context.img = this.document.img;
    context.portrait = this.document.img === foundry.documents.BaseActor.DEFAULT_ICON ? "" : this.document.img;
    context.initial = (this.document.name || "?").trim().charAt(0).toUpperCase() || "?";
    context.grade = { letter: grade.rank, number: grade.grade };
    context.hearts = { ...system.hearts, pips: CharacterSheet.#pips(system.hearts) };
    context.energy = { ...system.energy, pips: CharacterSheet.#pips(system.energy) };
    context.luck = system.luck.map(slot => ({
      ...slot,
      stateLabel: game.i18n.localize(slot.spent ? "PROJECTANIME.Vitals.Spent" : "PROJECTANIME.Vitals.Ready")
    }));
    context.showLuck = true;
    context.attributes = ATTRIBUTES.map(a => ({
      key: a.key,
      name: game.i18n.localize(a.label),
      desc: game.i18n.localize(a.desc),
      badge: this.#badge(`attributes.${a.key}`, system.attributes[a.key], "die")
    }));
    context.ladder = LADDER;
    context.traits = await this.#prepareItems("trait");
    context.techniques = await this.#prepareItems("technique");
    context.bonds = system.bonds;
    context.advancements = {
      unspent: system.advancements.unspent,
      standard: STANDARD_ADVANCEMENTS.map(d => ({
        key: d.key,
        name: game.i18n.localize(d.label),
        boxes: system.advancements.standard[d.key]
      })),
      special: SPECIAL_ADVANCEMENTS.map(d => ({
        key: d.key,
        name: game.i18n.localize(d.label),
        boxes: system.advancements.special[d.key]
      }))
    };
    return context;
  }

  async _preparePartContext(partId, context) {
    if (context.tabs && partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  async #prepareItems(type) {
    const items = [...this.document.itemTypes[type]].sort((a, b) => a.sort - b.sort);
    const isTechnique = type === "technique";
    return Promise.all(items.map(async item => {
      const step = LADDER[item.system.rank];
      const card = {
        id: item.id,
        name: item.name,
        rulings: item.system.rulings,
        badge: this.#badge(`${type}.${item.id}`, item.system.rank, isTechnique ? "die" : "mod"),
        enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
          relativeTo: item,
          secrets: this.document.isOwner
        })
      };
      if (isTechnique) {
        card.kindLabel = game.i18n.localize(`PROJECTANIME.Technique.${item.system.kind}`);
        card.costLabel = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
        card.activated = item.system.kind === "Activated";
      }
      return card;
    }));
  }

  static #pips({ value, max }) {
    return Array.from({ length: max }, (_, i) => i < value);
  }

  #badge(key, rankIndex, face) {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? (face === "mod" ? `+${step.mod}` : step.die) : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render({ parts: ["main"] });
  }

  static async #onSetPip(event, target) {
    if (!this.isEditable) return;
    const kind = target.dataset.kind;
    if (kind !== "hearts" && kind !== "energy") return;
    const i = Number(target.dataset.i);
    const current = this.document.system[kind].value;
    await this.document.update({ [`system.${kind}.value`]: i + 1 === current ? i : i + 1 });
  }

  static async #onToggleLuck(event, target) {
    if (!this.isEditable) return;
    const luck = this.document.system.toObject().luck;
    const slot = luck[Number(target.dataset.i)];
    if (!slot) return;
    slot.spent = !slot.spent;
    await this.document.update({ "system.luck": luck });
  }

  static async #onToggleBox(event, target) {
    if (!this.isEditable) return;
    const { group, key, j } = target.dataset;
    const advancements = this.document.system.toObject().advancements;
    const boxes = advancements[group]?.[key];
    if (!boxes) return;
    boxes[Number(j)] = !boxes[Number(j)];
    await this.document.update({ "system.advancements": advancements });
  }

  static async #onStepUnspent(event, target) {
    if (!this.isEditable) return;
    const value = Math.max(0, this.document.system.advancements.unspent + Number(target.dataset.dir));
    await this.document.update({ "system.advancements.unspent": value });
  }
}
