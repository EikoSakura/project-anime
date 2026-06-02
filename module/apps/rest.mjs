/**
 * Project: Anime — Rest dialog.
 *
 * Opened from the actor sheet (the Rest button by the character's name). Pick a
 * Rest Scene (Camp or Town), optionally take a Downtime activity, then complete
 * the rest: HP / Energy / Luck-Dice recovery per the rules (p.15), the activity's
 * effect, and a chat summary. Camp allows Minor Downtime; Town allows Major
 * Downtime (Training, +2 SP).
 */
import { collectLuckSteps, stepUpDie } from "../helpers/effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Downtime activities. `major` ones require a Town; `sp` = Skill Points earned. */
const DOWNTIME = [
  { key: "none", major: false, sp: 0 },
  { key: "training", major: true, sp: 2 }
];

export class RestApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-rest-${actor.id}` });
    this.actor = actor;
  }

  /** Selected Rest Scene ("camp" | "town") and Downtime activity key. */
  #restType = "camp";
  #activity = "none";

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "rest-app"],
    position: { width: 400, height: "auto" },
    window: { title: "PROJECTANIME.Rest.title", icon: "fa-solid fa-campground" },
    actions: {
      pickRest: RestApp.#onPickRest,
      pickActivity: RestApp.#onPickActivity,
      completeRest: RestApp.#onComplete
    }
  };

  static PARTS = { body: { template: "systems/project-anime/templates/apps/rest.hbs" } };

  get title() {
    return `${game.i18n.localize("PROJECTANIME.Rest.title")} — ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext() {
    const major = this.#restType === "town";
    const available = DOWNTIME.filter((d) => major || !d.major);
    if (!available.some((d) => d.key === this.#activity)) this.#activity = "none";
    return {
      isCamp: this.#restType === "camp",
      isTown: this.#restType === "town",
      tierLabel: game.i18n.localize(major ? "PROJECTANIME.Rest.major" : "PROJECTANIME.Rest.minor"),
      activities: available.map((d) => ({
        key: d.key,
        label: game.i18n.localize(`PROJECTANIME.Rest.activity.${d.key}`),
        spLabel: d.sp ? game.i18n.format("PROJECTANIME.Rest.activitySp", { sp: d.sp }) : "",
        selected: this.#activity === d.key
      }))
    };
  }

  static #onPickRest(event, target) {
    this.#restType = target.dataset.rest === "town" ? "town" : "camp";
    this.render();
  }

  static #onPickActivity(event, target) {
    this.#activity = target.dataset.activity;
    this.render();
  }

  static async #onComplete() {
    const sys = this.actor.system;
    const i18n = (k) => game.i18n.localize(k);
    const update = {};
    const rolls = [];
    const lines = [];
    let hpGain, enGain;

    // A Lucky Pendant (or any "luck" effect) Steps Up the Charm die for Luck Dice rolls.
    const luckSteps = collectLuckSteps(this.actor);
    const luckDie = stepUpDie(sys.attributes.charm.value, luckSteps);
    const luckNote = luckSteps > 0 ? ` · ${i18n("PROJECTANIME.Effect.luckStepUp")}` : "";

    if (this.#restType === "camp") {
      const hp = Math.min(sys.hp.max, sys.hp.value + Math.floor(sys.hp.max / 2));
      const en = Math.min(sys.energy.max, sys.energy.value + Math.floor(sys.energy.max / 2));
      hpGain = hp - sys.hp.value;
      enGain = en - sys.energy.value;
      update["system.hp.value"] = hp;
      update["system.energy.value"] = en;
      if ((sys.luckDice?.length ?? 0) < 3) {
        const roll = await new Roll(`1d${luckDie}`).evaluate();
        rolls.push(roll);
        update["system.luckDice"] = [...(sys.luckDice ?? []), roll.total];
        lines.push(game.i18n.format("PROJECTANIME.Rest.luckRestored", { value: roll.total }) + luckNote);
      }
    } else {
      hpGain = sys.hp.max - sys.hp.value;
      enGain = sys.energy.max - sys.energy.value;
      update["system.hp.value"] = sys.hp.max;
      update["system.energy.value"] = sys.energy.max;
      const roll = await new Roll(`3d${luckDie}`).evaluate();
      rolls.push(roll);
      const values = roll.dice[0].results.map((r) => r.result);
      update["system.luckDice"] = values;
      lines.push(`${i18n("PROJECTANIME.Rest.luckRerolled")}: <strong>${values.join(", ")}</strong>${luckNote}`);
    }

    const act = DOWNTIME.find((d) => d.key === this.#activity);
    if (act?.sp) update["system.skillPoints.value"] = (sys.skillPoints?.value ?? 0) + act.sp;

    await this.actor.update(update);

    // Chat summary.
    const restLabel = i18n(`PROJECTANIME.Rest.${this.#restType}`);
    const recover = `+${hpGain} ${i18n("PROJECTANIME.Stat.hp")} · +${enGain} ${i18n("PROJECTANIME.Stat.energy")}`;
    const allLines = [recover, ...lines];
    if (this.#activity !== "none") {
      const actLabel = i18n(`PROJECTANIME.Rest.activity.${this.#activity}`);
      const spText = act?.sp ? ` (${game.i18n.format("PROJECTANIME.Rest.activitySp", { sp: act.sp })})` : "";
      allLines.push(`${i18n("PROJECTANIME.Rest.downtime")}: ${actLabel}${spText}`);
    }
    const icon = this.#restType === "camp" ? "fa-campground" : "fa-house-chimney";
    const content = `<div class="project-anime chat-card">
      <header class="card-header">
        <span class="card-icon is-glyph"><i class="fas ${icon}"></i></span>
        <div class="card-titles">
          <h3 class="card-title">${restLabel}</h3>
          <span class="card-type">${i18n("PROJECTANIME.Rest.title")}</span>
        </div>
      </header>
      <div class="card-lines">${allLines.map((l) => `<div class="card-line">${l}</div>`).join("")}</div>
    </div>`;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content, rolls });

    this.close();
  }
}
