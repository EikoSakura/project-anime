import BaseActorSheet from "./base-actor-sheet.mjs";
import { STANDARD_ADVANCEMENTS, SPECIAL_ADVANCEMENTS } from "../config.mjs";

export default class CharacterSheet extends BaseActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["character"],
    actions: {
      toggleBox: this.#onToggleBox,
      stepUnspent: this.#onStepUnspent,
      addBond: this.#onAddBond,
      deleteBond: this.#onDeleteBond
    }
  };

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

  static FORM_ARRAYS = ["bonds", "luck"];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.bonds = system.bonds;
    context.canAddBond = system.bonds.length < 6;
    context.bondNumbers = { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" };
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

  static async #onAddBond() {
    if (!this.isEditable) return;
    const bonds = this.document.system.toObject().bonds;
    if (bonds.length >= 6) return;
    bonds.push({ name: "", number: 1, text: "" });
    await this.document.update({ "system.bonds": bonds });
  }

  static async #onDeleteBond(event, target) {
    if (!this.isEditable) return;
    const bonds = this.document.system.toObject().bonds;
    bonds.splice(Number(target.dataset.i), 1);
    await this.document.update({ "system.bonds": bonds });
  }
}
