/**
 * Project: Anime — Advancement dialog.
 *
 * A standalone ApplicationV2 opened from the actor sheet (the button by the
 * character's name). Spends Skill Points to raise attributes and buy combat
 * stats, and holds the setup & rest actions (calculate vitals, roll luck dice,
 * camp, town). Registers itself in `actor.apps` so it re-renders live as the
 * actor changes (SP totals and raise costs update after each purchase).
 */
import { collectLuckSteps, stepUpDie } from "../helpers/effects.mjs";
import { postRollCard } from "../helpers/dice.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Skill-Point cost to raise a base attribute one step up from this value. */
const ATTR_STEP_COST = { 4: 1, 6: 2, 8: 3, 10: 4 };

export class AdvancementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-advancement-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "advancement-app"],
    position: { width: 380, height: "auto" },
    window: { title: "PROJECTANIME.Advancement.title", icon: "fa-solid fa-arrow-up-right-dots" },
    actions: {
      raiseAttribute: AdvancementApp.#onRaise,
      buyStat: AdvancementApp.#onBuyStat,
      calcVitals: AdvancementApp.#onCalcVitals,
      rollLuck: AdvancementApp.#onRollLuck
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/advancement.hbs" }
  };

  get title() {
    return `${game.i18n.localize("PROJECTANIME.Advancement.title")} — ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    return {
      sp: sys.skillPoints?.value ?? 0,
      // Luck Dice are a PC-only resource (NPCs have no `luckDice` field), so the roll action is
      // hidden for them — attribute raises, stat buys, and Calculate Vitals apply to both.
      isCharacter: this.actor.type === "character",
      attributes: cfg.attributeKeys.map((k) => {
        const a = sys.attributes[k];
        return {
          key: k,
          label: game.i18n.localize(cfg.attributes[k]),
          icon: cfg.attributeIcons?.[k] ?? "",
          die: a.die ?? `d${a.value}`,
          maxed: a.base >= 12,
          cost: a.base >= 12 ? null : ATTR_STEP_COST[a.base]
        };
      })
    };
  }

  /** Live-refresh as the actor changes by joining the document's app registry. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.actor.apps[this.id] = this;
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onRaise(event, target) {
    const key = target.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr) return;
    if (attr.base >= 12) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.maxed"));
    const cost = ATTR_STEP_COST[attr.base] ?? 99;
    const sp = this.actor.system.skillPoints.value;
    if (sp < cost) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.notEnough"));
    const label = game.i18n.format("PROJECTANIME.SkillLog.entry.attribute", {
      attr: game.i18n.localize(CONFIG.PROJECTANIME.attributes[key] ?? key),
      from: `d${attr.base}`, to: `d${attr.base + 2}`
    });
    await this.actor.recordSkillPointSpend({
      amount: cost, kind: "attribute", ref: key, label,
      data: { from: attr.base, to: attr.base + 2 },
      changes: { [`system.attributes.${key}.base`]: attr.base + 2 }
    });
  }

  static async #onBuyStat(event, target) {
    const sys = this.actor.system;
    const sp = sys.skillPoints.value;
    const buys = {
      hp: { cost: 1, update: { "system.hp.max": sys.hp.max + 2, "system.hp.value": sys.hp.value + 2 } },
      energy: { cost: 1, update: { "system.energy.max": sys.energy.max + 2, "system.energy.value": sys.energy.value + 2 } },
      carryingCapacity: { cost: 1, update: { "system.carryingCapacity.bonus": (sys.carryingCapacity.bonus ?? 0) + 1 } },
      movement: { cost: 3, update: { "system.movement.bonus": (sys.movement.bonus ?? 0) + 1 } }
    };
    const stat = target.dataset.stat;
    const buy = buys[stat];
    if (!buy) return;
    if (sp < buy.cost) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.notEnough"));
    await this.actor.recordSkillPointSpend({
      amount: buy.cost, kind: "stat", ref: stat,
      label: game.i18n.localize(`PROJECTANIME.SkillLog.entry.${stat}`),
      changes: buy.update
    });
  }

  static async #onCalcVitals() {
    const a = this.actor.system.attributes;
    const hp = a.might.value * 2;
    const energy = a.spirit.value * 2;
    await this.actor.update({
      "system.hp.max": hp, "system.hp.value": hp,
      "system.energy.max": energy, "system.energy.value": energy
    });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Advancement.vitalsSet", { hp, energy }));
  }

  static async #onRollLuck() {
    // A Lucky Pendant (or any "luck" effect) Steps Up the Charm die for this roll.
    const steps = collectLuckSteps(this.actor);
    const die = stepUpDie(this.actor.system.attributes.charm.value, steps);
    const roll = await new Roll(`3d${die}`).evaluate();
    const values = roll.dice[0].results.map((r) => r.result);
    await this.actor.update({ "system.luckDice": values });
    const lines = [`${game.i18n.localize("PROJECTANIME.Stat.luckDice")}: <strong>${values.join(", ")}</strong>`];
    if (steps > 0) lines.push(`<em class="muted">${game.i18n.localize("PROJECTANIME.Effect.luckStepUp")}</em>`);
    await postRollCard(this.actor, {
      title: game.i18n.localize("PROJECTANIME.Advancement.rollLuck"),
      roll, lines
    });
  }
}
