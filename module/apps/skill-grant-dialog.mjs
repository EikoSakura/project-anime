import { grantExperientialSkill } from "../helpers/experience.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * GM dialog for granting experiential skills to adventurers.
 * Accessible from the Skills tab "Grant Skill" button or exposure threshold notifications.
 */
export class SkillGrantDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {string|null} Pre-filled actor ID */
  #actorId;
  /** @type {string} Pre-filled skill name */
  #skillName;
  /** @type {string} Pre-filled origin note */
  #originNote;

  constructor({ actorId = null, skillName = "", originNote = "" } = {}) {
    super();
    this.#actorId = actorId;
    this.#skillName = skillName;
    this.#originNote = originNote;
  }

  static DEFAULT_OPTIONS = {
    id: "shards-skill-grant-dialog",
    classes: ["shards-of-mana", "skill-grant-dialog"],
    window: {
      title: "SHARDS.Experience.GrantTitle",
      resizable: false
    },
    position: { width: 460, height: "auto" },
    actions: {
      grantSkill: SkillGrantDialog.#onGrantSkill
    }
  };

  static PARTS = {
    form: {
      template: "systems/shards-of-mana/templates/apps/skill-grant-dialog.hbs"
    }
  };

  async _prepareContext() {
    const context = await super._prepareContext();

    // Build adventurer list
    context.actors = game.actors
      .filter(a => a.type === "adventurer" && a.testUserPermission(game.user, "OWNER"))
      .map(a => ({ id: a.id, name: a.name, img: a.img }));

    context.actorId = this.#actorId ?? context.actors[0]?.id ?? "";

    // Build skill list from world items and compendia
    const worldSkills = game.items.filter(i => i.type === "skill").map(i => ({
      id: i.id,
      name: i.name,
      img: i.img,
      source: "world"
    }));

    // Collect compendium skills
    const compSkills = [];
    for (const pack of game.packs) {
      if (pack.documentName !== "Item") continue;
      const index = await pack.getIndex({ fields: ["type", "img"] });
      for (const entry of index) {
        if (entry.type === "skill") {
          compSkills.push({
            uuid: `${pack.collection}.${entry._id}`,
            name: entry.name,
            img: entry.img,
            source: pack.metadata.label
          });
        }
      }
    }

    context.skills = [...worldSkills, ...compSkills];
    context.skillName = this.#skillName;
    context.originNote = this.#originNote;

    return context;
  }

  static async #onGrantSkill(event, target) {
    const form = this.element.querySelector("form");
    const actorId = form.querySelector("[name='actorId']").value;
    const skillSelect = form.querySelector("[name='skillId']").value;
    const skillNameInput = form.querySelector("[name='skillName']").value.trim();
    const originNote = form.querySelector("[name='originNote']").value.trim();

    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "adventurer") {
      ui.notifications.warn(game.i18n.localize("SHARDS.Experience.NoActor"));
      return;
    }

    // Determine skill reference: prioritize dropdown selection, fall back to free-text
    let skillRef;
    if (skillSelect) {
      // Check if it's a world item ID or a compendium UUID
      const worldItem = game.items.get(skillSelect);
      if (worldItem) {
        skillRef = worldItem;
      } else {
        // Try as UUID (compendium)
        try {
          skillRef = await fromUuid(skillSelect);
        } catch {
          skillRef = null;
        }
      }
    }

    // Fall back to free-text name
    if (!skillRef && skillNameInput) {
      skillRef = skillNameInput;
    }

    if (!skillRef) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Experience.NoSkill"));
      return;
    }

    await grantExperientialSkill(actor, skillRef, originNote);
    this.close();
  }
}
