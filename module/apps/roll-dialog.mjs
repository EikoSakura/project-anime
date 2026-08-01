import { LADDER, ATTRIBUTES } from "../config.mjs";
import { postActionRoll } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* The Action Roll picker. Opened from an Attribute or Technique name on an
   actor sheet; that die is locked as the first die. One dialog per actor. */
export default class RollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, first, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#first = first;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "roll-dialog"],
    position: { width: 380, height: "auto" },
    actions: {
      step: this.#onStep,
      roll: this.#onRoll
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/roll-dialog.hbs" }
  };

  static #instances = new Map();

  #actor;

  /* { kind: "attribute", key } or { kind: "technique", id } */
  #first;

  #second = "";

  #trait = "";

  /* Rank steps applied to [first, second] for this one roll, clamped E..S. */
  #steps = [0, 0];

  #bonus = 0;

  static open(actor, first) {
    this.#instances.get(actor.uuid)?.close();
    const dialog = new this({ actor, first });
    this.#instances.set(actor.uuid, dialog);
    dialog.render(true);
  }

  get title() {
    return game.i18n.localize("PROJECTANIME.Roll.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const first = this.#resolveFirst();
    if (!first) {
      this.close();
      return context;
    }
    const seconds = this.#seconds();
    if (!seconds.some(s => s.value === this.#second)) this.#second = seconds[0]?.value ?? "";
    const traits = [...this.#actor.itemTypes.trait].sort((a, b) => a.sort - b.sort).map(item => ({
      value: item.id,
      label: `${item.name} +${LADDER[item.system.rank].mod}`
    }));
    if (this.#trait && !traits.some(t => t.value === this.#trait)) this.#trait = "";

    const second = this.#resolveSecond();
    const bases = [first.rank, second.rank];
    const ranks = this.#effRanks();
    this.#steps = ranks.map((r, i) => r - bases[i]);
    const stepClass = i => this.#steps[i] > 0 ? "up" : this.#steps[i] < 0 ? "down" : "";

    context.first = {
      name: first.name,
      die: LADDER[ranks[0]].die,
      stepClass: stepClass(0),
      upDisabled: ranks[0] >= 5,
      downDisabled: ranks[0] <= 0,
      isTechnique: first.tech,
      costLabel: first.tech ? game.i18n.format("PROJECTANIME.Technique.Energy", { n: LADDER[first.rank].mod }) : ""
    };
    context.secondDie = {
      die: LADDER[ranks[1]].die,
      stepClass: stepClass(1),
      upDisabled: ranks[1] >= 5,
      downDisabled: ranks[1] <= 0
    };
    context.seconds = seconds.map(s => ({ ...s, selected: s.value === this.#second }));
    context.traits = traits.map(t => ({ ...t, selected: t.value === this.#trait }));
    context.bonus = this.#bonus;
    context.formula = this.#formula();
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    if (RollDialog.#instances.get(this.#actor.uuid) === this) RollDialog.#instances.delete(this.#actor.uuid);
  }

  #resolveFirst() {
    if (this.#first.kind === "attribute") {
      const attribute = ATTRIBUTES.find(a => a.key === this.#first.key);
      if (!attribute) return null;
      return {
        name: game.i18n.localize(attribute.label),
        rank: this.#actor.system.attributes[attribute.key],
        tech: false
      };
    }
    const item = this.#actor.items.get(this.#first.id);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank, tech: true };
  }

  /* From an Attribute: the other four Attributes and the actor's Techniques.
     From a Technique: the five Attributes. */
  #seconds() {
    const attributes = ATTRIBUTES
      .filter(a => !(this.#first.kind === "attribute" && a.key === this.#first.key))
      .map(a => ({
        value: `attribute.${a.key}`,
        label: `${game.i18n.localize(a.label)} · ${LADDER[this.#actor.system.attributes[a.key]].die}`
      }));
    if (this.#first.kind === "technique") return attributes;
    const techniques = [...this.#actor.itemTypes.technique].sort((a, b) => a.sort - b.sort).map(item => {
      const step = LADDER[item.system.rank];
      const cost = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
      return { value: `technique.${item.id}`, label: `${item.name} · ${step.die} · ${cost}` };
    });
    return [...attributes, ...techniques];
  }

  #resolveSecond() {
    const [kind, key] = this.#second.split(".");
    if (kind === "attribute") {
      const attribute = ATTRIBUTES.find(a => a.key === key);
      if (!attribute) return null;
      return { name: game.i18n.localize(attribute.label), rank: this.#actor.system.attributes[key] };
    }
    const item = this.#actor.items.get(key);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank };
  }

  #resolveTrait() {
    if (!this.#trait) return null;
    const item = this.#actor.items.get(this.#trait);
    if (!item) return null;
    return { name: item.name, rank: item.system.rank };
  }

  #effRanks() {
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return null;
    return [first, second].map((d, i) => Math.clamp(d.rank + this.#steps[i], 0, 5));
  }

  #formula() {
    const ranks = this.#effRanks();
    if (!ranks) return "";
    const parts = ranks.map(r => `1${LADDER[r].die}`);
    const trait = this.#resolveTrait();
    if (trait) parts.push(String(LADDER[trait.rank].mod));
    let formula = parts.join(" + ");
    if (this.#bonus > 0) formula += ` + ${this.#bonus}`;
    else if (this.#bonus < 0) formula += ` − ${-this.#bonus}`;
    return formula;
  }

  #onChange(event) {
    const el = event.target.closest("[name]");
    if (!el) return;
    if (el.name === "second") this.#second = el.value;
    else if (el.name === "trait") this.#trait = el.value;
    else if (el.name === "bonus") this.#bonus = Math.trunc(Number(el.value) || 0);
    else return;
    this.render();
  }

  static #onStep(event, target) {
    this.#steps[Number(target.dataset.die)] += Number(target.dataset.delta);
    this.render();
  }

  static async #onRoll() {
    const first = this.#resolveFirst();
    const second = this.#resolveSecond();
    if (!first || !second) return this.close();
    const ranks = this.#effRanks();
    await postActionRoll(
      this.#actor,
      { name: first.name, rank: ranks[0] },
      { name: second.name, rank: ranks[1] },
      this.#resolveTrait(),
      this.#bonus
    );
    this.close();
  }
}
