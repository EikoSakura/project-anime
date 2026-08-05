import { ATTRIBUTES, LADDER } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEP_LABELS = [
  "PROJECTANIME.Header.Character",
  "PROJECTANIME.Panel.Attributes",
  "PROJECTANIME.Panel.Traits",
  "PROJECTANIME.Panel.Techniques",
  "PROJECTANIME.Creator.Bond",
  "PROJECTANIME.Creator.Finishing"
];

/* Creator textareas are plain text; the items' Description fields hold HTML. */
export function paragraphs(text) {
  return text.split("\n").map(line => line.trim()).filter(line => line).map(line => {
    const p = document.createElement("p");
    p.textContent = line;
    return p.outerHTML;
  }).join("");
}

/* The Character Creator wizard, opened from a character sheet's title
   bar. Six steps hold display state only; Create Character writes the
   opening actor plus two Traits and two Techniques on the existing
   schemas. One creator per actor. */
export default class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "character-creator"],
    position: { width: 880, height: "auto" },
    actions: {
      goto: this.#onGoto,
      back: this.#onBack,
      next: this.#onNext,
      stepAttr: this.#onStepAttr,
      flipBadge: this.#onFlipBadge,
      setKind: this.#onSetKind,
      stepBond: this.#onStepBond,
      flipSeal: this.#onFlipSeal,
      rollLuck: this.#onRollLuck,
      create: this.#onCreate
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/character-creator.hbs" }
  };

  static #instances = new Map();

  #actor;

  #step = 0;

  #name = "";

  /* Attribute Ranks double as spent Step Ups: all start at E (0), cap C (2). */
  #attrs = { might: 0, agility: 0, mind: 0, spirit: 0, charm: 0 };

  #traits = [{ name: "", text: "" }, { name: "", text: "" }];

  #techs = [{ name: "", kind: "Activated", text: "" }, { name: "", kind: "Activated", text: "" }];

  #bond = { name: "", number: 6, text: "" };

  #luck = [null, null, null];

  #sealFlip = false;

  /* Which rank badges currently show their die or bonus face. Display state only. */
  #flipped = new Set();

  #creating = false;

  static open(actor) {
    const existing = this.#instances.get(actor.uuid);
    if (existing) return existing.bringToFront();
    const creator = new this({ actor });
    this.#instances.set(actor.uuid, creator);
    creator.render(true);
  }

  get title() {
    return game.system.title;
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const dots = document.createElement("div");
    dots.className = "dots";
    for (let i = 0; i < 3; i++) dots.append(document.createElement("span"));
    this.window.title.before(dots);
    const sheetname = document.createElement("span");
    sheetname.className = "sheetname";
    sheetname.textContent = game.i18n.localize("PROJECTANIME.Creator.Title");
    this.window.title.after(sheetname);
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const checks = this.#checks();
    const spent = this.#spent();

    context.obiName = this.#name.trim() || game.i18n.localize("PROJECTANIME.Creator.New");
    context.steps = STEP_LABELS.map((label, index) => ({
      index,
      n: index + 1,
      label: game.i18n.localize(label),
      active: index === this.#step,
      done: checks[index]
    }));
    context.active = STEP_LABELS.map((_, index) => index === this.#step);

    context.name = this.#name;
    context.stepUps = 5 - spent;
    context.attributes = ATTRIBUTES.map(a => {
      const rank = this.#attrs[a.key];
      return {
        key: a.key,
        name: game.i18n.localize(a.label),
        badge: this.#badge(`attributes.${a.key}`, rank, "die"),
        downDisabled: rank <= 0,
        upDisabled: rank >= 2 || spent >= 5
      };
    });
    context.traits = this.#traits.map((t, i) => ({ i, ...t, badge: this.#badge(`trait.${i}`, 1, "mod") }));
    context.techs = this.#techs.map((t, i) => ({
      i,
      ...t,
      activated: t.kind === "Activated",
      badge: this.#badge(`tech.${i}`, 0, "die"),
      costLabel: game.i18n.format("PROJECTANIME.Technique.Energy", { n: LADDER[0].mod })
    }));
    context.bond = {
      ...this.#bond,
      downDisabled: this.#bond.number <= 1,
      upDisabled: this.#bond.number >= 6
    };
    context.seal = this.#sealFlip
      ? { text: String(LADDER[1].grade), label: game.i18n.localize("PROJECTANIME.Ladder.Difficulty") }
      : { text: LADDER[1].rank, label: game.i18n.localize("PROJECTANIME.Header.Grade") };
    context.pips = Array(6).fill(true);
    context.luck = this.#luck.map(value => ({ value, filled: value !== null }));
    context.rolled = this.#luck.every(v => v !== null);

    context.position = game.i18n.format("PROJECTANIME.Creator.Position", { n: this.#step + 1, total: 6 });
    context.first = this.#step === 0;
    context.last = this.#step === 5;
    context.canCreate = checks.every(Boolean);
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("input", this.#onInput.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    if (CharacterCreator.#instances.get(this.#actor.uuid) === this) CharacterCreator.#instances.delete(this.#actor.uuid);
  }

  #spent() {
    return Object.values(this.#attrs).reduce((a, b) => a + b, 0);
  }

  #checks() {
    return [
      this.#name.trim().length > 0,
      this.#spent() === 5,
      this.#traits.every(t => t.name.trim().length > 0),
      this.#techs.every(t => t.name.trim().length > 0),
      this.#bond.name.trim().length > 0,
      this.#luck.every(v => v !== null)
    ];
  }

  #badge(key, rankIndex, face) {
    const step = LADDER[rankIndex];
    const flipped = this.#flipped.has(key);
    const text = flipped ? (face === "mod" ? `+${step.mod}` : step.die) : step.rank;
    return { key, text, flipped, small: flipped && text.length > 3, cssVar: step.cssVar };
  }

  /* Text fields write straight into state; a render here would drop focus
     from the input being typed in, so the obi name, rail checks, and the
     Create button sync in place instead. */
  #onInput(event) {
    const el = event.target;
    if (!el.name) return;
    const [group, i, key] = el.name.split(".");
    if (group === "name") this.#name = el.value;
    else if (group === "bond" && (i === "name" || i === "text")) this.#bond[i] = el.value;
    else if (group === "trait" || group === "tech") {
      const row = (group === "trait" ? this.#traits : this.#techs)[Number(i)];
      if (row && (key === "name" || key === "text")) row[key] = el.value;
    } else return;
    this.#syncLive();
  }

  #syncLive() {
    const checks = this.#checks();
    this.element.querySelector(".obi .cname").textContent =
      this.#name.trim() || game.i18n.localize("PROJECTANIME.Creator.New");
    this.element.querySelectorAll(".crail button").forEach((b, i) => b.classList.toggle("done", checks[i]));
    const create = this.element.querySelector('[data-action="create"]');
    if (create) create.disabled = !checks.every(Boolean);
  }

  #goto(step) {
    this.#step = Math.clamp(step, 0, 5);
    this.render();
  }

  static #onGoto(event, target) {
    this.#goto(Number(target.dataset.step));
  }

  static #onBack() {
    this.#goto(this.#step - 1);
  }

  static #onNext() {
    this.#goto(this.#step + 1);
  }

  static #onStepAttr(event, target) {
    const key = target.dataset.key;
    const dir = Number(target.dataset.dir);
    const rank = this.#attrs[key];
    if (rank === undefined) return;
    if (dir > 0 ? rank >= 2 || this.#spent() >= 5 : rank <= 0) return;
    this.#attrs[key] = rank + dir;
    this.render();
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render();
  }

  static #onSetKind(event, target) {
    const row = this.#techs[Number(target.dataset.i)];
    if (!row) return;
    row.kind = target.dataset.kind === "Triggered" ? "Triggered" : "Activated";
    this.render();
  }

  static #onStepBond(event, target) {
    this.#bond.number = Math.clamp(this.#bond.number + Number(target.dataset.dir), 1, 6);
    this.render();
  }

  static #onFlipSeal() {
    this.#sealFlip = !this.#sealFlip;
    this.render();
  }

  /* Rolled once through the Roll API, recorded, no chat message. */
  static async #onRollLuck() {
    if (this.#luck.every(v => v !== null)) return;
    const roll = await new foundry.dice.Roll("3d6").evaluate();
    this.#luck = roll.dice[0].results.map(r => r.result);
    this.render();
  }

  static async #onCreate() {
    if (this.#creating || !this.#checks().every(Boolean)) return;
    this.#creating = true;
    try {
      const actor = this.#actor;
      await actor.update({
        name: this.#name.trim(),
        system: {
          grade: 1,
          attributes: { ...this.#attrs },
          hearts: { value: 6, max: 6 },
          energy: { value: 6, max: 6 },
          luck: this.#luck.map(value => ({ die: 6, value, spent: false })),
          bonds: [{ name: this.#bond.name.trim(), number: this.#bond.number, text: this.#bond.text.trim() }]
        }
      });
      await actor.createEmbeddedDocuments("Item", [
        ...this.#traits.map(t => ({ name: t.name.trim(), type: "trait", system: { rank: 1, text: paragraphs(t.text) } })),
        ...this.#techs.map(t => ({ name: t.name.trim(), type: "technique", system: { rank: 0, kind: t.kind, text: paragraphs(t.text) } }))
      ]);
      await this.close();
      actor.sheet.render(true);
    } finally {
      this.#creating = false;
    }
  }
}
