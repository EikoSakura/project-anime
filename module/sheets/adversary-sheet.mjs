import BaseActorSheet from "./base-actor-sheet.mjs";

export default class AdversarySheet extends BaseActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["adversary"],
    position: { height: 840 }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/actor/adversary-header.hbs" },
    main: { template: "systems/project-anime/templates/actor/adversary-main.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.showLuck = this.document.system.rival;
    context.showRivalToggle = context.editMode;
    return context;
  }
}
