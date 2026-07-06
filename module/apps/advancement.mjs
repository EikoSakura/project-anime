/**
 * Project: Anime — Advancement dialog (the "level-up" status window).
 *
 * A standalone ApplicationV2 opened from the actor sheet. Everything STAGES
 * first: +/− marks pending raises (attribute die steps, combat-stat buys,
 * Skill Enhancements) against the live SP pool, and CONFIRM commits the lot —
 * one atomic actor update carrying one refundable ledger entry per purchase,
 * plus one item update for the enhanced Skill. Nothing is spent until Confirm,
 * and − only takes back staged (unconfirmed) points.
 *
 * Skill Enhancement lives HERE now (moved out of the Skill Builder hub): pick
 * a Skill in the paged icon grid, then raise Power / Accuracy / Duration /
 * Efficiency / Range / Area on pip tracks, or stage an Expansion (add a
 * Modifier) through the picker overlay. The ledger metadata written on Confirm
 * is identical to what the Builder used to write (kind "improve", data.op),
 * so the Skill Point Log refunds enhancements exactly as before.
 *
 * Setup utilities (Calculate HP/Energy, Roll Luck Dice) stay instant — they
 * cost nothing and stage nothing.
 */
import { collectLuckSteps, stepUpDie } from "../helpers/effects.mjs";
import { postRollCard } from "../helpers/dice.mjs";
import {
  rangeHasTiles, skillNeedsAccuracy, isHeavyModifier,
  modifierBarredByType, skillDuration, rankRow, tierFromRank
} from "../helpers/config.mjs";
import { tierNumeral } from "../helpers/chronicle.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Skill-Point cost to raise a base attribute one step up FROM this die value. */
const ATTR_STEP_COST = { 4: 1, 6: 2, 8: 3, 10: 4 };

/** Skill-Point cost to learn a crafting Specialty (v0.03: 1 SP, one per character). */
const SPECIALTY_SP = 1;

/** The attribute die ladder, one node per step on the track. */
const DIE_LADDER = [4, 6, 8, 10, 12];

/** Skill icon-grid page size. */
const PAGE_SIZE = 8;

/** The four combat-stat buys: SP cost, points gained per buy, and a row icon. */
const STAT_BUYS = {
  hp: { cost: 1, per: 2, icon: "fa-solid fa-heart" },
  energy: { cost: 1, per: 2, icon: "fa-solid fa-bolt" },
  carryingCapacity: { cost: 1, per: 1, icon: "fa-solid fa-weight-hanging" },
  movement: { cost: 3, per: 1, icon: "fa-solid fa-person-running" }
};

export class AdvancementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-advancement-${actor.id}` });
    this.actor = actor;
  }

  /** Pending (unconfirmed) purchases. Tracks key on the enhancement op ("accuracy", "damage",
   *  "duration", "energy", "range", "growth:<modifier>"); mods hold staged Expansion picks. */
  #staged = { attrs: {}, stats: {}, tracks: {}, mods: [], specialty: null };
  /** The Skill selected in the enhancement grid (sticky across re-renders). */
  #skillId = null;
  /** Current page of the skill icon grid. */
  #page = 0;
  /** Whether the Expansion modifier-picker overlay is open. */
  #picker = false;
  /** One reminder per session of this window: Skill Enhancement is earned with the Refine
   *  downtime activity (rest.mjs sets `refineReady`). Soft — never blocks. */
  #refineWarned = false;

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "advancement-app"],
    position: { width: 440, height: "auto" },
    window: { title: "PROJECTANIME.Advancement.title", icon: "fa-solid fa-arrow-up-right-dots" },
    actions: {
      stage: AdvancementApp.#onStage,
      selectSkill: AdvancementApp.#onSelectSkill,
      pageSkills: AdvancementApp.#onPageSkills,
      openPicker: AdvancementApp.#onOpenPicker,
      closePicker: AdvancementApp.#onClosePicker,
      stageMod: AdvancementApp.#onStageMod,
      stageSpecialty: AdvancementApp.#onStageSpecialty,
      unstageMod: AdvancementApp.#onUnstageMod,
      confirmAdvance: AdvancementApp.#onConfirm,
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

  /* -------------------------------------------- */
  /*  Staging helpers                             */
  /* -------------------------------------------- */

  #resetStaged() {
    this.#staged = { attrs: {}, stats: {}, tracks: {}, mods: [], specialty: null };
  }

  /** Drop only the Skill-side staging (used when the selected Skill changes). */
  #resetSkillStage() {
    this.#staged.tracks = {};
    this.#staged.mods = [];
  }

  /** Total SP the current staging would spend. */
  #stagedCost() {
    let total = 0;
    for (const [k, steps] of Object.entries(this.#staged.attrs)) {
      const base = this.actor.system.attributes[k]?.base ?? 12;
      for (let i = 0; i < steps; i++) total += ATTR_STEP_COST[base + 2 * i] ?? 99;
    }
    for (const [stat, n] of Object.entries(this.#staged.stats)) total += (STAT_BUYS[stat]?.cost ?? 99) * n;
    for (const steps of Object.values(this.#staged.tracks)) total += steps;
    for (const m of this.#staged.mods) total += m.cost;
    if (this.#staged.specialty) total += SPECIALTY_SP;
    return total;
  }

  /** The Skill selected for enhancement (null if missing / not a skill). */
  #selectedSkill() {
    const item = this.actor.items.get(this.#skillId);
    return item && item.type === "skill" ? item : null;
  }

  /** The crafting Specialty row (v0.03): the learned one (locked), or the 5 choices to learn one for
   *  1 SP. Characters only; one per character. */
  #specialtyRow(cfg, sys, spLeft) {
    if (this.actor.type !== "character") return null;
    const L = (k) => game.i18n.localize(k);
    const current = sys.specialty || "";
    const staged = this.#staged.specialty || "";
    return {
      learned: !!current,
      currentLabel: current ? L(`PROJECTANIME.Specialty.name.${current}`) : "",
      currentBenefit: current ? L(`PROJECTANIME.Specialty.benefit.${current}`) : "",
      cost: SPECIALTY_SP,
      options: cfg.craftSpecialtyKeys.map((k) => ({
        key: k,
        label: L(`PROJECTANIME.Specialty.name.${k}`),
        benefit: L(`PROJECTANIME.Specialty.benefit.${k}`),
        staged: k === staged,
        // Selectable if not yet learned, and either already staged (to unstage) or affordable.
        canPick: !current && (k === staged || spLeft >= SPECIALTY_SP)
      }))
    };
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    const sp = sys.skillPoints?.value ?? 0;

    // The pool moved under our staging (a Skill bought in the Builder, a GM edit) — staging can no
    // longer be honored as-is, so drop it rather than guess which pieces still fit.
    if (this.#stagedCost() > sp) this.#resetStaged();

    const skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort((a, b) => a.name.localeCompare(b.name));
    if (this.#skillId && !skills.some((s) => s.id === this.#skillId)) {
      this.#skillId = null;
      this.#resetSkillStage();
    }
    if (!this.#skillId && skills.length) this.#skillId = skills[0].id;
    const item = this.#selectedSkill();

    const spLeft = sp - this.#stagedCost();
    const stagedTotal = this.#stagedCost();

    // Rank F–S (Characters): the header line under the SP pool — letter, own Tier, lifetime
    // earned, and the next threshold (null at S).
    let rank = null;
    if (this.actor.type === "character") {
      const idx = Number(sys.rank) || 0;
      const next = cfg.ranks[idx + 1];
      rank = {
        letter: rankRow(idx).key,
        tier: tierNumeral(tierFromRank(idx)),
        earned: sys.skillPoints?.earned ?? 0,
        next: next ? next.sp : null
      };
    }

    return {
      spLeft,
      stagedTotal,
      hasStaged: stagedTotal > 0,
      rank,
      isCharacter: this.actor.type === "character",
      attributes: this.#attributeRows(cfg, sys, spLeft),
      stats: this.#statRows(sys, spLeft),
      specialty: this.#specialtyRow(cfg, sys, spLeft),
      ...this.#skillGrid(skills),
      ...(item ? this.#skillPanel(cfg, item, spLeft) : { skill: null }),
      picker: this.#picker && item ? this.#pickerList(cfg, item, spLeft) : null
    };
  }

  /** The five attribute rows: d4→d12 node track + staged die + stepper. */
  #attributeRows(cfg, sys, spLeft) {
    return cfg.attributeKeys.map((k) => {
      const base = sys.attributes[k].base;
      const lockIdx = Math.max(0, Math.min(4, (base - 4) / 2));
      const staged = this.#staged.attrs[k] ?? 0;
      const at = base + 2 * staged;
      const cost = at >= 12 ? null : ATTR_STEP_COST[at];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        die: `d${at}`,
        staged: staged > 0,
        cost,
        canPlus: cost !== null && spLeft >= cost,
        canMinus: staged > 0,
        nodes: DIE_LADDER.map((d, i) => ({
          cls: i <= lockIdx ? "lk" : i <= lockIdx + staged ? "on" : "",
          linkCls: i < lockIdx + staged ? "lk" : "",
          last: i === DIE_LADDER.length - 1
        }))
      };
    });
  }

  /** The four combat-stat rows: live value preview + stepper. */
  #statRows(sys, spLeft) {
    const current = {
      hp: sys.hp.max,
      energy: sys.energy.max,
      carryingCapacity: sys.carryingCapacity?.max ?? 0,
      movement: sys.movement?.value ?? 0
    };
    return Object.entries(STAT_BUYS).map(([stat, b]) => {
      const staged = this.#staged.stats[stat] ?? 0;
      return {
        stat,
        icon: b.icon,
        label: game.i18n.localize(`PROJECTANIME.Stat.${stat}`),
        per: b.per,
        cost: b.cost,
        value: current[stat] + b.per * staged,
        stagedAmount: staged ? `+${b.per * staged}` : "",
        canPlus: spLeft >= b.cost,
        canMinus: staged > 0
      };
    });
  }

  /** The paged skill icon grid (8 per page, empty slots pad the page). */
  #skillGrid(skills) {
    const pages = Math.max(1, Math.ceil(skills.length / PAGE_SIZE));
    this.#page = Math.max(0, Math.min(this.#page, pages - 1));
    const start = this.#page * PAGE_SIZE;
    const slice = skills.slice(start, start + PAGE_SIZE);
    return {
      hasSkills: skills.length > 0,
      skillTiles: slice.map((s) => ({ id: s.id, img: s.img, name: s.name, sel: s.id === this.#skillId })),
      emptyTiles: Array.from({ length: PAGE_SIZE - slice.length }),
      canPrev: this.#page > 0,
      canNext: this.#page < pages - 1,
      pageDots: pages > 1 ? Array.from({ length: pages }, (_, i) => ({ idx: i, on: i === this.#page })) : []
    };
  }

  /** The selected Skill's header line + enhancement tracks + modifier chips. */
  #skillPanel(cfg, item, spLeft) {
    const sys = item.system;
    const afford = spLeft >= 1;
    const tracks = [];
    const pips = (lock, staged, max) => Array.from({ length: max }, (_, i) => ({
      cls: i < lock ? "lk" : i < lock + staged ? "on" : ""
    }));
    const t = (op) => this.#staged.tracks[op] ?? 0;

    // Power (+1 damage / healing, max +3) — only Skills with a rolled output.
    if ((cfg.dieEffects ?? []).includes(sys.effect)) {
      const lock = sys.damageMod ?? 0, staged = t("damage");
      tracks.push({
        op: "damage", icon: "fa-solid fa-hand-fist",
        label: game.i18n.localize(sys.effect === "mend" ? "PROJECTANIME.SkillBuilder.sharpenHealing" : "PROJECTANIME.SkillBuilder.sharpenDamage"),
        hint: game.i18n.localize(sys.effect === "mend" ? "PROJECTANIME.Advancement.hintHealing" : "PROJECTANIME.Advancement.hintPower"),
        pips: pips(lock, staged, 3),
        canPlus: afford && lock + staged < 3, canMinus: staged > 0
      });
    }
    // Accuracy (+1 to hit, max +3) — only Skills that make an Accuracy Check.
    if (skillNeedsAccuracy(sys)) {
      const lock = sys.accuracyMod ?? 0, staged = t("accuracy");
      tracks.push({
        op: "accuracy", icon: "fa-solid fa-crosshairs",
        label: game.i18n.localize("PROJECTANIME.SkillBuilder.sharpen"),
        hint: game.i18n.localize("PROJECTANIME.Advancement.hintAccuracy"),
        pips: pips(lock, staged, 3),
        canPlus: afford && lock + staged < 3, canMinus: staged > 0
      });
    }
    // Duration (+1 round per buy, hard cap +3 per Skill) — only a round-counted (Standard) Duration
    // has rounds to add. durationMod counts the committed raises; staged is this session's.
    if (sys.actionType !== "passive" && skillDuration(sys) === "standard") {
      const cur = sys.effectDuration ?? cfg.standardDurationTurns, staged = t("duration");
      const bought = sys.durationMod ?? 0;
      tracks.push({
        op: "duration", icon: "fa-solid fa-clock",
        label: game.i18n.localize("PROJECTANIME.SkillBuilder.raiseDuration"),
        hint: game.i18n.localize("PROJECTANIME.Advancement.hintDuration"),
        display: `${cur + staged}`, staged: staged > 0,
        canPlus: afford && bought + staged < 3, canMinus: staged > 0
      });
    }
    // Efficiency (−1 EP, min half base).
    {
      const cur = sys.energyCost ?? 0;
      const min = sys.minEnergy ?? Math.ceil((sys.baseEnergy ?? 2) / 2);
      const staged = t("energy");
      if (cur > min || staged) tracks.push({
        op: "energy", icon: "fa-solid fa-bolt",
        label: game.i18n.localize("PROJECTANIME.SkillBuilder.lowerEnergy"),
        hint: game.i18n.localize("PROJECTANIME.Advancement.hintEfficiency"),
        display: `${cur - staged}`, staged: staged > 0,
        canPlus: afford && cur - staged > min, canMinus: staged > 0
      });
    }
    // Range (+1 tile) — only a tile-ranged Skill has a count to raise.
    if (rangeHasTiles(sys.range?.scope ?? "weapon")) {
      const cur = sys.range?.tiles ?? 0, staged = t("range");
      tracks.push({
        op: "range", icon: "fa-solid fa-arrows-left-right",
        label: game.i18n.localize("PROJECTANIME.SkillBuilder.raiseRange"),
        hint: game.i18n.localize("PROJECTANIME.Advancement.hintRange"),
        display: `${cur + staged}`, staged: staged > 0,
        canPlus: afford, canMinus: staged > 0
      });
    }
    // Area (+1 tile to a Burst/Aura size, max +3) — one track per area Modifier carried.
    const growMax = cfg.modifierGrowthMax ?? 3;
    for (const key of (cfg.areaGrowModifiers ?? []).filter((k) => (sys.modifiers ?? []).includes(k))) {
      const lock = Math.min(growMax, sys.modifierGrowth?.[key] ?? 0);
      const staged = t(`growth:${key}`);
      tracks.push({
        op: `growth:${key}`, icon: "fa-solid fa-circle-dot",
        label: `${game.i18n.localize("PROJECTANIME.SkillBuilder.raiseArea")} — ${game.i18n.localize(cfg.skillModifiers[key] ?? key)}`,
        hint: game.i18n.localize("PROJECTANIME.Advancement.hintArea"),
        pips: pips(lock, staged, growMax),
        canPlus: afford && lock + staged < growMax, canMinus: staged > 0
      });
    }

    const energyStaged = t("energy") > 0;
    return {
      skill: {
        name: item.name,
        sp: sys.spCost ?? 0,
        actionLabel: game.i18n.localize(cfg.actionTypes[sys.actionType] ?? ""),
        showEnergy: sys.actionType !== "passive",
        energy: (sys.energyCost ?? 0) - t("energy"),
        energyStaged
      },
      tracks,
      modChips: (sys.modifiers ?? []).map((m) => game.i18n.localize(cfg.skillModifiers[m] ?? m)),
      stagedChips: this.#staged.mods.map((m) => ({ key: m.key, label: m.label })),
      canExpand: spLeft >= 1
    };
  }

  /** The Expansion picker list — the Builder's compatibility rules, applied against the
   *  EFFECTIVE modifier set (current + staged) so staged picks gate later ones. */
  #pickerList(cfg, item, spLeft) {
    const sys = item.system;
    const stagedKeys = this.#staged.mods.map((m) => m.key);
    const mods = [...(sys.modifiers ?? []), ...stagedKeys];
    const noMods = (cfg.noModifierEffects ?? []).includes(sys.effect);
    return Object.entries(cfg.skillModifiers)
      // The free "None" marker is never a buyable advancement Modifier.
      .filter(([key]) => !(cfg.freeModifiers ?? []).includes(key))
      .filter(([key]) => !mods.includes(key) || (cfg.multiTakeModifiers ?? []).includes(key))
      .map(([key, label]) => {
        const heavy = isHeavyModifier(key, sys);
        const cost = heavy ? 2 : 1;
        const incompatible = noMods
          || modifierBarredByType(key, sys)
          || (key === "channeled" && (mods.includes("aura") || mods.includes("scene")))
          || (key === "scene" && mods.includes("channeled"))
          || (key === "aura" && mods.includes("channeled"));
        return {
          key,
          label: game.i18n.localize(label),
          desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
          heavy,
          cost,
          disabled: incompatible || spLeft < cost
        };
      });
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

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
  /*  Staging actions                             */
  /* -------------------------------------------- */

  /** One handler for every +/− stepper: data-kind picks the pool, data-delta the direction.
   *  Guards mirror what _prepareContext disables — a stale click stages nothing. */
  static #onStage(event, target) {
    const { kind, key } = target.dataset;
    const delta = Number(target.dataset.delta) || 0;
    const sys = this.actor.system;
    const spLeft = (sys.skillPoints?.value ?? 0) - this.#stagedCost();

    if (kind === "attr") {
      const base = sys.attributes[key]?.base;
      if (base === undefined) return;
      const staged = this.#staged.attrs[key] ?? 0;
      if (delta > 0) {
        const at = base + 2 * staged;
        const cost = at >= 12 ? null : ATTR_STEP_COST[at];
        if (cost === null || spLeft < cost) return;
        this.#staged.attrs[key] = staged + 1;
      } else if (staged > 0) this.#staged.attrs[key] = staged - 1;
    } else if (kind === "stat") {
      const buy = STAT_BUYS[key];
      if (!buy) return;
      const staged = this.#staged.stats[key] ?? 0;
      if (delta > 0) {
        if (spLeft < buy.cost) return;
        this.#staged.stats[key] = staged + 1;
      } else if (staged > 0) this.#staged.stats[key] = staged - 1;
    } else if (kind === "track") {
      const item = this.#selectedSkill();
      if (!item) return;
      const staged = this.#staged.tracks[key] ?? 0;
      if (delta > 0) {
        if (spLeft < 1 || !this.#trackCanRaise(item, key, staged)) return;
        this.#staged.tracks[key] = staged + 1;
        this.#maybeRefineWarn();
      } else if (staged > 0) this.#staged.tracks[key] = staged - 1;
    }
    this.render();
  }

  /** Skill Enhancement is earned with the Refine activity during a rest (doc v0.03). Staging one
   *  without the rest flag gets a one-time reminder — advisory only, nothing is blocked. */
  #maybeRefineWarn() {
    if (this.#refineWarned || this.actor.getFlag("project-anime", "refineReady")) return;
    this.#refineWarned = true;
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.refineWarn"));
  }

  /** Whether enhancement op `op` can take one MORE staged step on top of `staged`. */
  #trackCanRaise(item, op, staged) {
    const cfg = CONFIG.PROJECTANIME;
    const sys = item.system;
    if (op === "damage") return (cfg.dieEffects ?? []).includes(sys.effect) && (sys.damageMod ?? 0) + staged < 3;
    if (op === "accuracy") return skillNeedsAccuracy(sys) && (sys.accuracyMod ?? 0) + staged < 3;
    if (op === "duration") return sys.actionType !== "passive" && skillDuration(sys) === "standard";
    if (op === "energy") {
      const min = sys.minEnergy ?? Math.ceil((sys.baseEnergy ?? 2) / 2);
      return (sys.energyCost ?? 0) - staged > min;
    }
    if (op === "range") return rangeHasTiles(sys.range?.scope ?? "weapon");
    if (op.startsWith("growth:")) {
      const key = op.slice(7);
      if (!(cfg.areaGrowModifiers ?? []).includes(key) || !(sys.modifiers ?? []).includes(key)) return false;
      return (sys.modifierGrowth?.[key] ?? 0) + staged < (cfg.modifierGrowthMax ?? 3);
    }
    return false;
  }

  static #onSelectSkill(event, target) {
    const id = target.dataset.skillId;
    if (!id || id === this.#skillId) return;
    this.#skillId = id;
    this.#resetSkillStage();
    this.#picker = false;
    this.render();
  }

  static #onPageSkills(event, target) {
    if (target.dataset.page !== undefined) this.#page = Number(target.dataset.page) || 0;
    else this.#page += Number(target.dataset.delta) || 0;
    this.render();
  }

  static #onOpenPicker() {
    if (!this.#selectedSkill()) return;
    this.#picker = true;
    this.render();
  }

  static #onClosePicker() {
    this.#picker = false;
    this.render();
  }

  static #onStageMod(event, target) {
    const item = this.#selectedSkill();
    const key = target.dataset.key;
    if (!item || !key) return;
    const cfg = CONFIG.PROJECTANIME;
    const pick = this.#pickerList(cfg, item, (this.actor.system.skillPoints?.value ?? 0) - this.#stagedCost())
      .find((p) => p.key === key);
    if (!pick || pick.disabled) return;
    this.#staged.mods.push({ key, label: pick.label, cost: pick.cost });
    this.#maybeRefineWarn();
    this.#picker = false;
    this.render();
  }

  /** Stage (or, if already staged, unstage) a crafting Specialty for 1 SP. Characters only; one per
   *  character — barred once one is learned. */
  static #onStageSpecialty(event, target) {
    if (this.actor.type !== "character" || this.actor.system.specialty) return;
    const key = target.dataset.key;
    if (!key || !CONFIG.PROJECTANIME.craftSpecialties[key]) return;
    if (this.#staged.specialty === key) { this.#staged.specialty = null; this.render(); return; }
    // Staging replaces any prior specialty stage; ensure the pool still covers it.
    const withoutSpec = this.#stagedCost() - (this.#staged.specialty ? SPECIALTY_SP : 0);
    if ((this.actor.system.skillPoints?.value ?? 0) - withoutSpec < SPECIALTY_SP) return;
    this.#staged.specialty = key;
    this.render();
  }

  static #onUnstageMod(event, target) {
    const key = target.dataset.key;
    const ix = this.#staged.mods.findIndex((m) => m.key === key);
    if (ix < 0) return;
    this.#staged.mods.splice(ix, 1);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Confirm                                     */
  /* -------------------------------------------- */

  /** Ledger metadata for one Enhancement purchase (identical to the Builder's old entries,
   *  so the Skill Point Log's Refund reverses them the same way). */
  #improveMeta(item, op, key = "") {
    const cfg = CONFIG.PROJECTANIME;
    if (op.startsWith("growth:")) { key = op.slice(7); op = "growth"; }
    let labelKey = { range: "improveRange", duration: "improveDuration", energy: "improveEnergy", accuracy: "improveAccuracy", modifier: "improveModifier", growth: "improveArea" }[op];
    if (op === "damage") labelKey = item.system.effect === "mend" ? "improveHealing" : "improveDamage";
    return {
      kind: "improve", ref: item.id, data: { op, key },
      label: game.i18n.format(`PROJECTANIME.SkillLog.entry.${labelKey}`, {
        skill: item.name,
        mod: key ? game.i18n.localize(cfg.skillModifiers[key] ?? key) : ""
      })
    };
  }

  static async #onConfirm() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    const entries = [];
    const changes = {};

    // Attributes — one refundable entry per die step (the Log's cascade-refund reads from/to).
    for (const [k, steps] of Object.entries(this.#staged.attrs)) {
      if (!steps) continue;
      const base = sys.attributes[k].base;
      for (let i = 0; i < steps; i++) {
        const from = base + 2 * i;
        entries.push({
          amount: ATTR_STEP_COST[from] ?? 99, kind: "attribute", ref: k,
          data: { from, to: from + 2 },
          label: game.i18n.format("PROJECTANIME.SkillLog.entry.attribute", {
            attr: game.i18n.localize(cfg.attributes[k] ?? k),
            from: `d${from}`, to: `d${from + 2}`
          })
        });
      }
      changes[`system.attributes.${k}.base`] = base + 2 * steps;
    }

    // Combat stats — one entry per buy, merged into single update paths.
    for (const [stat, n] of Object.entries(this.#staged.stats)) {
      if (!n) continue;
      const buy = STAT_BUYS[stat];
      for (let i = 0; i < n; i++) {
        entries.push({
          amount: buy.cost, kind: "stat", ref: stat,
          label: game.i18n.localize(`PROJECTANIME.SkillLog.entry.${stat}`)
        });
      }
      if (stat === "hp") {
        changes["system.hp.max"] = sys.hp.max + 2 * n;
        changes["system.hp.value"] = sys.hp.value + 2 * n;
      } else if (stat === "energy") {
        changes["system.energy.max"] = (sys.energy.base ?? sys.energy.max) + 2 * n;
        changes["system.energy.value"] = sys.energy.value + 2 * n;
      } else if (stat === "carryingCapacity") {
        changes["system.carryingCapacity.bonus"] = (sys.carryingCapacity.bonus ?? 0) + n;
      } else if (stat === "movement") {
        changes["system.movement.bonus"] = (sys.movement.bonus ?? 0) + n;
      }
    }

    // Skill enhancements — one item update; entries mirror the Builder's per-purchase logs.
    const item = this.#selectedSkill();
    const itemUpdate = {};
    if (item) {
      const s = item.system;
      for (const [op, steps] of Object.entries(this.#staged.tracks)) {
        if (!steps) continue;
        if (op === "accuracy") itemUpdate["system.accuracyMod"] = (s.accuracyMod ?? 0) + steps;
        else if (op === "damage") itemUpdate["system.damageMod"] = (s.damageMod ?? 0) + steps;
        else if (op === "duration") {
          itemUpdate["system.effectDuration"] = (s.effectDuration ?? cfg.standardDurationTurns) + steps;
          itemUpdate["system.durationMod"] = (s.durationMod ?? 0) + steps;   // track the +3-cap enhancement count
        }
        else if (op === "energy") itemUpdate["system.energyReduction"] = (s.energyReduction ?? 0) + steps;
        else if (op === "range") itemUpdate["system.range.tiles"] = (s.range?.tiles ?? 0) + steps;
        else if (op.startsWith("growth:")) {
          const key = op.slice(7);
          itemUpdate[`system.modifierGrowth.${key}`] = (s.modifierGrowth?.[key] ?? 0) + steps;
        } else continue;
        for (let i = 0; i < steps; i++) entries.push({ amount: 1, ...this.#improveMeta(item, op) });
      }
      if (this.#staged.mods.length) {
        const mods = [...(s.modifiers ?? [])];
        const affD = [...(s.affinityDamages ?? [])];
        const affS = [...(s.affinityStatusIds ?? [])];
        let flipPassive = false;
        for (const m of this.#staged.mods) {
          if (!mods.includes(m.key)) mods.push(m.key);
          // A multi-take Modifier records its new (blank) take — the Element/Status gets picked
          // the next time the Skill is rebuilt in the wizard (same as the Builder's Expansion).
          if (m.key === "affinityDamage") affD.push({ type: "", level: "resist" });
          if (m.key === "affinityStatus") affS.push("");
          if ((cfg.passiveOnlyModifiers ?? []).includes(m.key)) flipPassive = true;
          entries.push({ amount: m.cost, ...this.#improveMeta(item, "modifier", m.key) });
        }
        itemUpdate["system.modifiers"] = mods;
        if (affD.length !== (s.affinityDamages ?? []).length) itemUpdate["system.affinityDamages"] = affD;
        if (affS.length !== (s.affinityStatusIds ?? []).length) itemUpdate["system.affinityStatusIds"] = affS;
        if (flipPassive) itemUpdate["system.actionType"] = "passive";
      }
    }

    // Specialty (v0.03) — a single 1-SP purchase, one per character.
    if (this.#staged.specialty && !sys.specialty) {
      entries.push({
        amount: SPECIALTY_SP, kind: "specialty", ref: this.#staged.specialty,
        label: game.i18n.format("PROJECTANIME.SkillLog.entry.specialty", {
          name: game.i18n.localize(`PROJECTANIME.Specialty.name.${this.#staged.specialty}`)
        })
      });
      changes["system.specialty"] = this.#staged.specialty;
    }

    if (!entries.length) return;
    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    if (total > (sys.skillPoints?.value ?? 0)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.notEnough"));
    }

    // Item changes first, then the atomic pool-drop + ledger write (recordSkillPointSpend's contract).
    if (Object.keys(itemUpdate).length) await item.update(itemUpdate);
    await this.actor.recordSkillPointSpends(entries, changes);
    // Committing an Enhancement/Expansion spends the Refine rest flag (rest.mjs sets it).
    const enhanced = Object.values(this.#staged.tracks).some((n) => n > 0) || this.#staged.mods.length > 0;
    if (enhanced && this.actor.getFlag("project-anime", "refineReady")) {
      await this.actor.unsetFlag("project-anime", "refineReady");
      this.#refineWarned = false;
    }
    this.#resetStaged();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Setup actions (instant, no SP)              */
  /* -------------------------------------------- */

  static async #onCalcVitals() {
    const a = this.actor.system.attributes;
    const hp = 6 + a.might.value * 2;
    const energy = 6 + a.spirit.value * 2;
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
