import BaseActorSheet from "./base-actor-sheet.mjs";
import AdversaryBuilder from "../apps/adversary-builder.mjs";

export default class AdversarySheet extends BaseActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["adversary"],
    position: { height: 840 },
    actions: {
      openBuilder: this.#onOpenBuilder
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/actor/adversary-header.hbs" },
    main: { template: "systems/project-anime/templates/actor/adversary-main.hbs" }
  };

  /* The Adversary Builder button in the title bar, beside the mode
     toggle. Storyteller only. */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if (this.isEditable && game.user.isGM) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "creatorbtn";
      button.dataset.action = "openBuilder";
      button.dataset.tooltip = "PROJECTANIME.Builder.Title";
      button.setAttribute("aria-label", game.i18n.localize("PROJECTANIME.Builder.Title"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-skull";
      icon.inert = true;
      button.append(icon);
      this.window.title.after(button);
    }
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.showLuck = this.document.system.rival;
    context.showRivalToggle = context.editMode;
    return context;
  }

  static #onOpenBuilder() {
    if (!this.isEditable || !game.user.isGM) return;
    AdversaryBuilder.open(this.document);
  }
}
