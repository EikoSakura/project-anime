import ProjectAnimeSheet from "./mixin.mjs";
import { LADDER } from "../config.mjs";
import { postItemCard } from "../chat.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;

export default class ProjectAnimeItemSheet extends ProjectAnimeSheet(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["item"],
    position: { width: 520, height: "auto" },
    actions: {
      flipSeal: this.#onFlipSeal,
      stepRank: this.#onStepRank,
      addRuling: this.#onAddRuling,
      deleteRuling: this.#onDeleteRuling,
      postItem: this.#onPostItem
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/item/header.hbs" },
    body: { template: "systems/project-anime/templates/item/body.hbs" }
  };

  /* Whether the seal shows its die or bonus face. Display state only, never stored. */
  #flipped = false;

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "postbtn";
    button.dataset.action = "postItem";
    button.dataset.tooltip = "PROJECTANIME.Chat.Post";
    button.ariaLabel = game.i18n.localize("PROJECTANIME.Chat.Post");
    button.innerHTML = '<i class="fa-solid fa-message"></i>';
    this.window.title.after(button);
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const step = LADDER[system.rank];
    const isTechnique = this.document.type === "technique";
    const alt = isTechnique ? step.die : `+${step.mod}`;

    context.system = system;
    context.name = this.document.name;
    context.editMode = this.isEditMode;
    context.isTechnique = isTechnique;
    context.typeLabel = game.i18n.localize(`TYPES.Item.${this.document.type}`);
    context.seal = {
      text: this.#flipped ? alt : step.rank,
      flipped: this.#flipped,
      size: this.#flipped ? (alt.length > 3 ? "17px" : "26px") : "38px"
    };
    if (isTechnique) {
      context.kindLabel = game.i18n.localize(`PROJECTANIME.Technique.${system.kind}`);
      context.costLabel = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
      context.activated = system.kind === "Activated";
      context.kindOptions = {
        Activated: game.i18n.localize("PROJECTANIME.Technique.Activated"),
        Triggered: game.i18n.localize("PROJECTANIME.Technique.Triggered")
      };
    }
    context.showRulings = context.editMode || system.rulings.length > 0;
    context.enrichedText = await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.text, {
      relativeTo: this.document,
      secrets: this.document.isOwner
    });
    return context;
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if (data.system?.rulings) data.system.rulings = Object.values(data.system.rulings);
    return data;
  }

  static #onFlipSeal() {
    this.#flipped = !this.#flipped;
    this.render({ parts: ["header"] });
  }

  static async #onStepRank(event, target) {
    if (!this.isEditable) return;
    const rank = Math.min(5, Math.max(0, this.document.system.rank + Number(target.dataset.dir)));
    await this.document.update({ "system.rank": rank });
  }

  static async #onAddRuling() {
    if (!this.isEditable) return;
    const rulings = this.document.system.toObject().rulings;
    rulings.push("");
    await this.document.update({ "system.rulings": rulings });
  }

  static async #onDeleteRuling(event, target) {
    if (!this.isEditable) return;
    const rulings = this.document.system.toObject().rulings;
    rulings.splice(Number(target.dataset.j), 1);
    await this.document.update({ "system.rulings": rulings });
  }

  static async #onPostItem() {
    await postItemCard(this.document);
  }
}
