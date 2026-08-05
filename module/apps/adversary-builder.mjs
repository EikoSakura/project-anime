import { ATTRIBUTES, LADDER } from "../config.mjs";
import { paragraphs } from "./character-creator.mjs";
import { createTrack } from "./tracks.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEP_LABELS = [
  "TYPES.Actor.adversary",
  "PROJECTANIME.Builder.Stats",
  "PROJECTANIME.Panel.Traits",
  "PROJECTANIME.Panel.Techniques",
  "PROJECTANIME.Creator.Finishing"
];

/* The Adversary Builder wizard, opened by the Storyteller from an
   adversary sheet's title bar. Five steps hold display state only;
   Create Adversary writes the actor, its Trait and Technique Items, and
   the optional Desire Track on the existing schemas. One builder per
   actor. */
export default class AdversaryBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "adversary-builder"],
    position: { width: 880, height: "auto" },
    actions: {
      goto: this.#onGoto,
      back: this.#onBack,
      next: this.#onNext,
      flipSeal: this.#onFlipSeal,
      stepGrade: this.#onStepGrade,
      stepAttr: this.#onStepAttr,
      flipBadge: this.#onFlipBadge,
      stepPool: this.#onStepPool,
      addRow: this.#onAddRow,
      removeRow: this.#onRemoveRow,
      stepRank: this.#onStepRank,
      setKind: this.#onSetKind,
      toggleTrack: this.#onToggleTrack,
      stepSegments: this.#onStepSegments,
      toggleRival: this.#onToggleRival,
      rollLuck: this.#onRollLuck,
      create: this.#onCreate
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/adversary-builder.hbs" }
  };

  static #instances = new Map();

  #actor;

  #step = 0;

  #name = "";

  #desire = "";

  #fear = "";

  #grade = 0;

  #sealFlip = false;

  #attrs = { might: 0, agility: 0, mind: 0, spirit: 0, charm: 0 };

  #hearts = 6;

  #energy = 6;

  #traits = [];

  #techs = [];

  #track = false;

  #segments = 4;

  #rival = false;

  #luck = [null, null, null];

  /* Which attribute badges currently show their die face. Card badges
     keep their flip on the row so removes stay aligned. Display state only. */
  #flipped = new Set();

  #creating = false;

  static open(actor) {
    if (!game.user.isGM) return;
    const existing = this.#instances.get(actor.uuid);
    if (existing) return existing.bringToFront();
    const builder = new this({ actor });
    this.#instances.set(actor.uuid, builder);
    builder.render(true);
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
    sheetname.textContent = game.i18n.localize("PROJECTANIME.Builder.Title");
    this.window.title.after(sheetname);
    return frame;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const checks = this.#checks();
    const gradeStep = LADDER[this.#grade];

    context.obiName = this.#name.trim() || game.i18n.localize("PROJECTANIME.Builder.New");
    context.steps = STEP_LABELS.map((label, index) => ({
      index,
      n: index + 1,
      label: game.i18n.localize(label),
      active: index === this.#step,
      done: checks[index]
    }));
    context.active = STEP_LABELS.map((_, index) => index === this.#step);

    context.name = this.#name;
    context.desire = this.#desire;
    context.fear = this.#fear;

    context.seal = this.#sealFlip
      ? { text: String(gradeStep.grade), label: game.i18n.localize("PROJECTANIME.Ladder.Difficulty") }
      : { text: gradeStep.rank, label: game.i18n.localize("PROJECTANIME.Header.Grade") };
    context.gradeDownDisabled = this.#grade <= 0;
    context.gradeUpDisabled = this.#grade >= 5;
    context.attributes = ATTRIBUTES.map(a => {
      const rank = this.#attrs[a.key];
      const key = `attributes.${a.key}`;
      return {
        key: a.key,
        name: game.i18n.localize(a.label),
        badge: this.#badge(key, rank, "die", this.#flipped.has(key)),
        downDisabled: rank <= 0,
        upDisabled: rank >= 5
      };
    });
    context.hearts = {
      value: this.#hearts,
      pips: Array(this.#hearts).fill(true),
      downDisabled: this.#hearts <= 1,
      upDisabled: this.#hearts >= 12
    };
    context.energy = {
      value: this.#energy,
      pips: Array(this.#energy).fill(true),
      downDisabled: this.#energy <= 0,
      upDisabled: this.#energy >= 12
    };

    context.traits = this.#traits.map((t, i) => ({
      i,
      ...t,
      badge: this.#badge(`trait.${i}`, t.rank, "mod", t.flip),
      downDisabled: t.rank <= 0,
      upDisabled: t.rank >= 5
    }));
    context.techs = this.#techs.map((t, i) => ({
      i,
      ...t,
      activated: t.kind === "Activated",
      badge: this.#badge(`tech.${i}`, t.rank, "die", t.flip),
      downDisabled: t.rank <= 0,
      upDisabled: t.rank >= 5,
      costLabel: game.i18n.format("PROJECTANIME.Technique.Energy", { n: LADDER[t.rank].mod })
    }));

    context.track = {
      on: this.#track,
      segments: this.#segments,
      cells: Array(this.#segments).fill(true),
      downDisabled: this.#segments <= 1,
      upDisabled: this.#segments >= 12
    };
    context.rival = this.#rival;
    context.luck = this.#luck.map(value => ({ value, filled: value !== null }));
    context.rolled = this.#luck.every(v => v !== null);

    context.position = game.i18n.format("PROJECTANIME.Creator.Position", { n: this.#step + 1, total: 5 });
    context.first = this.#step === 0;
    context.last = this.#step === 4;
    context.canCreate = checks.every(Boolean);
    return context;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("input", this.#onInput.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    if (AdversaryBuilder.#instances.get(this.#actor.uuid) === this) AdversaryBuilder.#instances.delete(this.#actor.uuid);
  }

  #checks() {
    return [
      this.#name.trim().length > 0 && this.#desire.trim().length > 0,
      true,
      this.#traits.every(t => t.name.trim().length > 0),
      this.#techs.every(t => t.name.trim().length > 0),
      !this.#rival || this.#luck.every(v => v !== null)
    ];
  }

  #badge(key, rankIndex, face, flipped) {
    const step = LADDER[rankIndex];
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
    else if (group === "desire") this.#desire = el.value;
    else if (group === "fear") this.#fear = el.value;
    else if (group === "trait" || group === "tech") {
      const row = (group === "trait" ? this.#traits : this.#techs)[Number(i)];
      if (row && (key === "name" || key === "text")) row[key] = el.value;
    } else return;
    this.#syncLive();
  }

  #syncLive() {
    const checks = this.#checks();
    this.element.querySelector(".obi .cname").textContent =
      this.#name.trim() || game.i18n.localize("PROJECTANIME.Builder.New");
    this.element.querySelectorAll(".crail button").forEach((b, i) => b.classList.toggle("done", checks[i]));
    const create = this.element.querySelector('[data-action="create"]');
    if (create) create.disabled = !checks.every(Boolean);
  }

  #goto(step) {
    this.#step = Math.clamp(step, 0, 4);
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

  static #onFlipSeal() {
    this.#sealFlip = !this.#sealFlip;
    this.render();
  }

  static #onStepGrade(event, target) {
    this.#grade = Math.clamp(this.#grade + Number(target.dataset.dir), 0, 5);
    this.render();
  }

  static #onStepAttr(event, target) {
    const key = target.dataset.key;
    if (this.#attrs[key] === undefined) return;
    this.#attrs[key] = Math.clamp(this.#attrs[key] + Number(target.dataset.dir), 0, 5);
    this.render();
  }

  static #onFlipBadge(event, target) {
    const key = target.dataset.key;
    const [group, i] = key.split(".");
    if (group === "trait" || group === "tech") {
      const row = (group === "trait" ? this.#traits : this.#techs)[Number(i)];
      if (row) row.flip = !row.flip;
    } else if (this.#flipped.has(key)) this.#flipped.delete(key);
    else this.#flipped.add(key);
    this.render();
  }

  static #onStepPool(event, target) {
    const dir = Number(target.dataset.dir);
    if (target.dataset.kind === "hearts") this.#hearts = Math.clamp(this.#hearts + dir, 1, 12);
    else if (target.dataset.kind === "energy") this.#energy = Math.clamp(this.#energy + dir, 0, 12);
    else return;
    this.render();
  }

  static #onAddRow(event, target) {
    if (target.dataset.group === "trait") this.#traits.push({ name: "", rank: 0, text: "", flip: false });
    else if (target.dataset.group === "tech") this.#techs.push({ name: "", kind: "Activated", rank: 0, text: "", flip: false });
    else return;
    this.render();
  }

  static #onRemoveRow(event, target) {
    const rows = target.dataset.group === "trait" ? this.#traits
      : target.dataset.group === "tech" ? this.#techs : null;
    if (!rows) return;
    rows.splice(Number(target.dataset.i), 1);
    this.render();
  }

  static #onStepRank(event, target) {
    const rows = target.dataset.group === "trait" ? this.#traits
      : target.dataset.group === "tech" ? this.#techs : null;
    const row = rows?.[Number(target.dataset.i)];
    if (!row) return;
    row.rank = Math.clamp(row.rank + Number(target.dataset.dir), 0, 5);
    this.render();
  }

  static #onSetKind(event, target) {
    const row = this.#techs[Number(target.dataset.i)];
    if (!row) return;
    row.kind = target.dataset.kind === "Triggered" ? "Triggered" : "Activated";
    this.render();
  }

  static #onToggleTrack() {
    this.#track = !this.#track;
    this.render();
  }

  static #onStepSegments(event, target) {
    this.#segments = Math.clamp(this.#segments + Number(target.dataset.dir), 1, 12);
    this.render();
  }

  static #onToggleRival() {
    this.#rival = !this.#rival;
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
      const name = this.#name.trim();
      const system = {
        desire: this.#desire.trim(),
        fear: this.#fear.trim(),
        grade: this.#grade,
        attributes: { ...this.#attrs },
        hearts: { value: this.#hearts, max: this.#hearts },
        energy: { value: this.#energy, max: this.#energy },
        rival: this.#rival
      };
      if (this.#rival) system.luck = this.#luck.map(value => ({ die: 6, value, spent: false }));
      await actor.update({ name, system });
      const items = [
        ...this.#traits.map(t => ({ name: t.name.trim(), type: "trait", system: { rank: t.rank, text: paragraphs(t.text) } })),
        ...this.#techs.map(t => ({ name: t.name.trim(), type: "technique", system: { rank: t.rank, kind: t.kind, text: paragraphs(t.text) } }))
      ];
      if (items.length) await actor.createEmbeddedDocuments("Item", items);
      if (this.#track) await createTrack(name, this.#segments);
      await this.close();
      actor.sheet.render(true);
    } finally {
      this.#creating = false;
    }
  }
}
