/**
 * Project: Anime — step-by-step Monster Creator.
 *
 * A guided ApplicationV2 that builds a combat NPC ("monster") on the SAME rules as a
 * Player Character — the five Attributes start at d4 and you spend Step-Ups; HP =
 * ⟪Might⟫×2, Energy = ⟪Spirit⟫×2 — then scales it by an anime power **Tier** (Minion /
 * Standard / Elite / Solo; see PROJECTANIME.monsterTiers). The Tier sets the Step-Up
 * budget, multiplies HP / Energy, grants flat Evasion / Defense, and hands out Skill
 * Points to build the monster's powers with the in-game Skill Builder.
 *
 * It is a deliberately simple STARTING point — generate a reasonable statblock fast,
 * then hand-tune any number on the sheet afterwards (the Tier values live in config and
 * are meant to be rebalanced). Like the Character Creator it operates on the LIVE actor
 * and registers in `actor.apps`, so changes refresh it live; it sets the same
 * `flags.project-anime.creationComplete` on finish.
 *
 * Reuses the Character Creator's `.cc-*` stylesheet via the shared `character-creator`
 * class (plus `monster-creator` for the Tier-specific bits).
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { tierScaling, starOrDialPower, npcVitals } from "../helpers/config.mjs";
import { setSquadSize } from "../helpers/squad.mjs";
import { elementLabel } from "../helpers/elements.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Creation steps, in order. The FRAME step merges the old Tier + Combat-Stats steps: you pick
 *  ★ / Tier / Role and read the finished statblock off a live card (no multiplication). TUNE is the
 *  old Attributes step — now optional, since Role pre-fills the dice. */
const STEPS = ["concept", "frame", "tune", "abilities", "finish"];

/** Default icon for a freshly-created Basic Attack (natural weapon). */
const NATURAL_WEAPON_IMG = "icons/svg/sword.svg";

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

export class MonsterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-monster-creator-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    // `character-creator` pulls in the shared creator stylesheet; `monster-creator`
    // carries the Tier-specific deltas.
    classes: ["project-anime", "character-creator", "monster-creator"],
    tag: "form",
    position: { width: 660, height: "auto" },
    window: { title: "PROJECTANIME.MonsterCreator.title", icon: "fa-solid fa-dragon" },
    form: { handler: MonsterCreatorApp.#onFormSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      stepNext: MonsterCreatorApp.#onStepNext,
      stepBack: MonsterCreatorApp.#onStepBack,
      gotoStep: MonsterCreatorApp.#onGotoStep,
      pickImage: MonsterCreatorApp.#onPickImage,
      pickTier: MonsterCreatorApp.#onPickTier,
      pickStars: MonsterCreatorApp.#onPickStars,
      pickArchetype: MonsterCreatorApp.#onPickArchetype,
      raiseAttr: MonsterCreatorApp.#onRaiseAttr,
      lowerAttr: MonsterCreatorApp.#onLowerAttr,
      recalcVitals: MonsterCreatorApp.#onRecalcVitals,
      incSquad: MonsterCreatorApp.#onIncSquad,
      decSquad: MonsterCreatorApp.#onDecSquad,
      addAttack: MonsterCreatorApp.#onAddAttack,
      editAttack: MonsterCreatorApp.#onEditAttack,
      removeAttack: MonsterCreatorApp.#onRemoveAttack,
      openSkillBuilder: MonsterCreatorApp.#onOpenSkillBuilder,
      removeSkill: MonsterCreatorApp.#onRemoveSkill,
      finish: MonsterCreatorApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/monster-creator.hbs", scrollable: [""] }
  };

  /** Current step index. */
  #step = 0;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.MonsterCreator.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Tier helpers                                */
  /* -------------------------------------------- */

  /** The local power this monster builds against: its ★ rating's power, else the global dial. The
   *  whole build pipeline (SP grant, HP/EN multiplier) keys off this one number. */
  #power() {
    return starOrDialPower(this.actor);
  }

  /** The selected Tier's EFFECTIVE entry at this monster's local power (scaled Skill Points + HP
   *  multiplier, fixed knobs spread through), or null while untiered. */
  #tier() {
    return this.actor.system.tier ? tierScaling(this.actor.system.tier, this.#power()) : null;
  }

  /** The selected Role/archetype template (spread / lean / signature kit), or null when unset. */
  #archetype() {
    return CONFIG.PROJECTANIME.monsterArchetypes[this.actor.system.archetype] ?? null;
  }

  /** Attribute Step-Up budget = the selected Tier's allotment (0 until one is picked). */
  #budget() {
    return this.#tier()?.stepUps ?? 0;
  }

  /** This monster's derived HP / Energy under the Fabula-Ultima additive model (config npcVitals):
   *  round5(Level + 2.5·attr) × the Tier rank. For a Minion `hp` is the PER-MEMBER pool. */
  #vitals() {
    const a = this.actor.system.attributes;
    return npcVitals(this.actor.system.tier, this.actor.system.stars, a.might.base, a.spirit.base);
  }

  /** Step-Ups already spent = sum over attributes of (steps above d4). */
  #stepsUsed() {
    const attrs = this.actor.system.attributes;
    return CONFIG.PROJECTANIME.attributeKeys.reduce(
      (n, k) => n + Math.max(0, ((attrs[k].base ?? 4) - 4) / 2),
      0
    );
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    const stepKey = STEPS[this.#step];
    const ctx = { config: cfg };

    ctx.steps = STEPS.map((k, i) => ({
      key: k,
      num: i + 1,
      label: game.i18n.localize(`PROJECTANIME.MonsterCreator.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.MonsterCreator.stepOf", { n: this.#step + 1, total: STEPS.length });
    ctx.stepTitle = game.i18n.localize(`PROJECTANIME.MonsterCreator.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === STEPS.length - 1;
    ctx.onConcept = stepKey === "concept";
    ctx.onFrame = stepKey === "frame";
    ctx.onTune = stepKey === "tune";
    ctx.onAbilities = stepKey === "abilities";
    ctx.onFinish = stepKey === "finish";

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.disposition = sys.disposition ?? "hostile";

    // Star rating — the per-NPC power LEVEL (1..maxStars). It drives the local power that scales the
    // Tier cards below; 0 = unrated, in which case the build falls back to the global dial.
    const stars = Number(sys.stars) || 0;
    ctx.stars = stars;
    ctx.starButtons = Array.from({ length: cfg.maxStars }, (_, i) => ({ n: i + 1, filled: i < stars }));

    // Tier — the cards (Skill Points + HP multiplier scaled to THIS monster's local power: its ★
    // rating's power, else the global dial) + the selected key. The readout shows the basis.
    const power = this.#power();
    ctx.encounterPower = power;
    ctx.starRated = stars >= 1;
    ctx.tierKey = sys.tier ?? "";
    // Tier cards show FINISHED HP / EN at the current attributes (read a chart, never multiply): each
    // tier's Fabula-Ultima vitals (config npcVitals) resolved at this monster's ★ Level and attributes,
    // same formula as #applyVitals — so the headline numbers on the card are exactly what gets stored.
    const cardMight = sys.attributes.might.base;
    const cardSpirit = sys.attributes.spirit.base;
    ctx.tiers = cfg.monsterTierKeys.map((k) => {
      const t = cfg.monsterTiers[k];
      const s = tierScaling(k, power);
      const v = npcVitals(k, stars, cardMight, cardSpirit);
      return {
        key: k,
        label: game.i18n.localize(t.label),
        icon: t.icon,
        color: t.color,
        stepUps: t.stepUps,
        hp: v.hp,
        energy: v.energy,
        evasion: t.evasion,
        defense: t.defense,
        skillPoints: s.skillPoints,
        worth: game.i18n.localize(`PROJECTANIME.Worth.${k}`),   // encounter-budget worth (Party-Equivalents)
        selected: sys.tier === k
      };
    });

    // Role — the archetype cards (power-neutral templates) + the selected key. Picked alongside
    // Tier/★ on the Frame step; auto-spreads the budget and grants a signature kit (#onPickArchetype).
    ctx.archetypeKey = sys.archetype ?? "";
    ctx.archetypes = cfg.monsterArchetypeKeys.map((k) => ({
      key: k,
      label: game.i18n.localize(cfg.monsterArchetypes[k].label),
      icon: cfg.monsterArchetypes[k].icon,
      selected: sys.archetype === k
    }));

    // Attributes — Step-Ups against the Tier budget.
    const used = this.#stepsUsed();
    const budget = this.#budget();
    ctx.hasTier = !!this.#tier();
    ctx.stepsUsed = used;
    ctx.stepsTotal = budget;
    ctx.stepsLeft = Math.max(0, budget - used);
    ctx.overSpent = used > budget;
    ctx.attributes = cfg.attributeKeys.map((k) => {
      const a = sys.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        base: a.base,
        die: `d${a.base}`,
        canRaise: a.base < 12 && used < budget,
        canLower: a.base > 4
      };
    });

    // Combat Stats — the FINISHED statblock read off the Frame card (no multiplier shown). Derived
    // from the ★ Level + attributes + Tier rank (config npcVitals) and surfaced as final numbers.
    const fresh = this.#vitals();          // the HP/Energy this build would store right now
    ctx.tierName = this.#tier() ? game.i18n.localize(this.#tier().label) : game.i18n.localize("PROJECTANIME.MonsterCreator.noTier");
    ctx.vitals = {
      hp: sys.hp.max,
      energy: sys.energy.base ?? sys.energy.max,
      evasion: sys.evasion.value,
      defense: sys.defense.value,
      movement: sys.movement.value,
      carry: sys.carryingCapacity.max,
      sp: sys.skillPoints?.value ?? 0
    };
    // A Minion is a SQUAD member: its derived HP is the PER-MEMBER pool, so "stale" compares the
    // per-member value (memberHp) rather than the pooled max; everyone else compares hp.max directly.
    const isMinion = sys.tier === "minion";
    const perMemberHP = fresh.hp;
    const storedPer = isMinion ? (Number(sys.squad?.memberHp) || sys.hp.max) : sys.hp.max;
    ctx.vitalsStale = storedPer !== perMemberHP || (sys.energy.base ?? sys.energy.max) !== fresh.energy;
    // Squad controls (Minion Tier only): size stepper + the pooled-HP breakdown (per-member × size).
    ctx.isMinion = isMinion;
    ctx.squadSize = Math.max(1, Number(sys.squad?.size) || 1);
    ctx.squadMemberHp = Number(sys.squad?.memberHp) || perMemberHP;
    ctx.squadTotalHp = ctx.squadMemberHp * ctx.squadSize;

    // Basic Attacks — natural weapons. The rules' "Basic Attack" strikes with an equipped
    // weapon and costs NO Energy (and no Skill Points); these roll through rollAttack from
    // the NPC's quick-attack panel. Built/renamed inline here, fully tunable on the item sheet.
    ctx.attacks = this.actor.items
      .filter((i) => i.type === "weapon")
      .sort(bySort)
      .map((i) => ({ id: i.id, name: i.name, img: i.img, summary: this.#attackSummary(i) }));
    ctx.attackCount = ctx.attacks.length;

    // Abilities — the Tier's Skill Points and what's been built.
    ctx.sp = sys.skillPoints?.value ?? 0;
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        stars: cfg.skillRanks[i.system.rank]?.stars ?? "",
        actionLabel: game.i18n.localize(cfg.actionTypes[i.system.actionType] ?? ""),
        energyCost: i.system.energyCost ?? 0,
        passive: i.system.actionType === "passive",
        // A granted Role move is package-managed (free, removed/rebuilt by the Role picker), so it
        // hides its trash button — it isn't a hand-built skill the GM deletes for a refund.
        granted: !!i.getFlag("project-anime", "granted")
      }));

    // Review (last step) — a compact summary card.
    const arch = this.#archetype();
    ctx.tierBadge = this.#tier()
      ? { label: ctx.tierName, icon: this.#tier().icon, color: this.#tier().color, stars: stars >= 1 ? Array.from({ length: stars }, (_, i) => i) : null,
          worth: game.i18n.localize(`PROJECTANIME.Worth.${this.actor.system.tier}`) }
      : null;
    // Role badge — rides alongside the ★-Tier badge wherever it shows (review here, NPC sheet header).
    ctx.roleBadge = arch ? { label: game.i18n.localize(arch.label), icon: arch.icon } : null;
    ctx.skillCount = ctx.skills.length;

    return ctx;
  }

  /** A compact "⟪A⟫ + ⟪B⟫ · Type · Melee N" line describing a Basic Attack (natural weapon). */
  #attackSummary(item) {
    const cfg = CONFIG.PROJECTANIME;
    const s = item.system ?? {};
    const acc = s.accuracy ?? {};
    const a = game.i18n.localize(cfg.attributes[acc.attrA] ?? acc.attrA ?? "");
    const b = game.i18n.localize(cfg.attributes[acc.attrB] ?? acc.attrB ?? "");
    const accMod = Number(acc.mod) || 0;
    const accStr = `⟪${a}⟫ + ⟪${b}⟫${accMod ? ` ${accMod > 0 ? "+" : "−"}${Math.abs(accMod)}` : ""}`;
    const dmgMod = Number(s.damage?.mod) || 0;
    const dmgStr = `${dmgMod ? `${dmgMod > 0 ? "+" : "−"}${Math.abs(dmgMod)} ` : ""}${elementLabel(s.damage?.type)}`;
    const rangeType = game.i18n.localize(cfg.rangeTypes[s.range?.type] ?? s.range?.type ?? "");
    const rangeStr = `${rangeType} ${Number(s.range?.tiles) || 0}`;
    return `${accStr} · ${dmgStr} · ${rangeStr}`;
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes by joining the document app registry. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.actor.apps[this.id] = this;
    // Inline rename for Basic Attack rows. The input is intentionally unnamed so the actor
    // form #sync never reads it; commit straight to the weapon item on change (blur).
    for (const input of this.element.querySelectorAll(".cc-attack-name")) {
      input.addEventListener("change", (ev) => this.#commitAttackName(ev.currentTarget));
    }
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Form persistence                            */
  /* -------------------------------------------- */

  static #onFormSubmit() {
    return this.#sync();
  }

  /** Persist the open step's text inputs (name + any system.* fields) to the actor. */
  async #sync() {
    if (!this.element || !this.actor.isOwner) return;
    const data = foundry.utils.flattenObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    const update = {};
    if (typeof data.name === "string" && data.name !== this.actor.name) update.name = data.name;
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith("system.")) update[key] = val;
    }
    if (Object.keys(update).length) await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  static async #onStepNext() {
    await this.#sync();
    if (!this.#validateStep()) return;
    if (this.#step < STEPS.length - 1) this.#step += 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onStepBack() {
    await this.#sync();
    if (this.#step > 0) this.#step -= 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onGotoStep(event, target) {
    await this.#sync();
    const i = Number(target.dataset.step);
    if (i >= 0 && i < STEPS.length) this.#step = i;
    await this.#onEnterStep();
    this.render();
  }

  /** Block leaving a step that isn't legal yet: a Tier must be chosen, then all of its
   *  Step-Ups distributed (exactly — no under- or over-spend). */
  #validateStep() {
    const key = STEPS[this.#step];
    // A Tier gates the Step-Up budget — require one before leaving either step (the step dots allow
    // free jumping, so guard Tune too, not just the Frame step where the Tier is picked).
    if ((key === "frame" || key === "tune") && !this.#tier()) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.pickTierFirst"));
      return false;
    }
    if (key === "tune") {
      const left = this.#budget() - this.#stepsUsed();
      if (left !== 0) {
        ui.notifications.warn(game.i18n.format("PROJECTANIME.MonsterCreator.stepsRemaining", { n: Math.abs(left) }));
        return false;
      }
    }
    return true;
  }

  /** Side effect on entering the Abilities step: re-sync HP/Energy to the (possibly hand-tuned)
   *  attributes × the Tier multiplier, so the finished statblock is current before Review (creation
   *  only — don't clobber later hand-tuning). Tier/★/Role picks already derive vitals on the Frame
   *  step; this catches dice nudged on the Tune step in between. */
  async #onEnterStep() {
    const key = STEPS[this.#step];
    if ((key === "abilities" || key === "finish") && !this.actor.getFlag("project-anime", "creationComplete")) {
      await this.#applyVitals();
    }
  }

  /** Set HP and Energy to full from the Fabula-Ultima vitals (config npcVitals): round5(★ Level +
   *  2.5·attr) × the Tier rank. For a Minion the value is the PER-MEMBER pool (the squad pools it). */
  async #applyVitals() {
    const { hp, energy } = this.#vitals();
    const update = {
      "system.hp.max": hp,
      "system.energy.max": energy,
      "system.energy.value": energy
    };
    // A Minion fields as a SQUAD: the derived HP is its PER-MEMBER pool. Record it (the data model
    // derives the EFFECTIVE max = memberHp × size at size ≥ 2) and fill the pooled bar; non-minions
    // store HP straight. So re-deriving vitals rescales the whole squad without losing its size.
    if (this.actor.system.tier === "minion") {
      const size = Math.max(1, Number(this.actor.system.squad?.size) || 1);
      update["system.squad.memberHp"] = hp;
      update["system.hp.value"] = hp * size;
    } else {
      update["system.hp.value"] = hp;
    }
    await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Concept                                     */
  /* -------------------------------------------- */

  static async #onPickImage() {
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.actor.img || "",
      callback: (path) => this.actor.update({ img: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  /* -------------------------------------------- */
  /*  Tier                                        */
  /* -------------------------------------------- */

  /** Pick a Tier: stamp it, apply its flat Evasion/Defense, grant its Skill Points,
   *  re-fit the Step-Up budget, and re-derive HP/Energy (all while still creating). */
  static async #onPickTier(event, target) {
    const key = target.closest("[data-tier]")?.dataset.tier;
    if (!CONFIG.PROJECTANIME.monsterTiers[key]) return;
    const creating = !this.actor.getFlag("project-anime", "creationComplete");
    const update = { "system.tier": key };
    // An unrated monster gets its Tier's "on-level" star by default the first time a Tier is picked
    // (minion ★1 … solo ★4), so the rating reads sensibly out of the box; the picker overrides it.
    if (!(Number(this.actor.system.stars) >= 1)) update["system.stars"] = CONFIG.PROJECTANIME.tierOnLevelStar[key] ?? 2;
    await this.actor.update(update);
    // A new Tier has a new Step-Up budget — re-pour the Role spread so the attributes refill to fit it
    // (the budget is Tier-fixed, so this only triggers on a Tier change, never a ★ change, preserving
    // any hand-tuning across star picks). #applyTierBuild then derives vitals from the fresh spread.
    if (creating && this.#archetype()) await this.#applyRoleSpread(this.actor.system.archetype);
    await this.#applyTierBuild(creating);
    this.render();
  }

  /** Pick a Star rating (the per-NPC power level): stamp it, then re-grant SP / re-derive vitals
   *  against the new local power (only while creating, so a finished monster keeps its spent SP). */
  static async #onPickStars(event, target) {
    const n = Number(target.closest("[data-stars]")?.dataset.stars);
    if (!(n >= 1 && n <= CONFIG.PROJECTANIME.maxStars)) return;
    // Click the current top star again to clear the rating back to unrated (fall to the global dial).
    const next = (n === Number(this.actor.system.stars)) ? 0 : n;
    await this.actor.update({ "system.stars": next });
    await this.#applyTierBuild(!this.actor.getFlag("project-anime", "creationComplete"));
    this.render();
  }

  /** Pick a Role (the archetype): stamp it, then (while creating) auto-spread the Step-Up budget down
   *  the Role's priority, swap in its signature kit, and recompute Eva/Def + SP + vitals. Clicking the
   *  selected Role again clears it back to a custom build. Finished monsters only restamp the field
   *  (the Phase-3 badge) — no re-spread or kit churn. */
  static async #onPickArchetype(event, target) {
    const key = target.closest("[data-archetype]")?.dataset.archetype;
    if (!CONFIG.PROJECTANIME.monsterArchetypes[key]) return;
    const creating = !this.actor.getFlag("project-anime", "creationComplete");
    const next = (key === this.actor.system.archetype) ? "" : key;   // re-click clears
    await this.actor.update({ "system.archetype": next });
    if (creating) {
      await this.#clearRoleKit();
      if (next) { await this.#applyRoleSpread(next); await this.#buildRoleKit(next); }
      else await this.actor.setFlag("project-anime", "roleKitSP", 0);
    }
    await this.#applyTierBuild(creating);
    this.render();
  }

  /** Pour the Tier's Step-Up budget down the Role's attribute PRIORITY: every attribute resets to d4,
   *  then each is filled to d12 in priority order until the budget is spent. The spread lists all five
   *  attributes, and 5×d12 capacity exceeds any Tier budget, so the budget always spends out exactly —
   *  which the attributes-step exact-spend gate requires. No-op without a Tier (budget 0 → all d4). */
  async #applyRoleSpread(key) {
    const arch = CONFIG.PROJECTANIME.monsterArchetypes[key];
    if (!arch) return;
    const keys = CONFIG.PROJECTANIME.attributeKeys;
    const dice = Object.fromEntries(keys.map((k) => [k, 4]));
    let left = this.#budget();
    for (const k of arch.spread) {
      while (left > 0 && dice[k] < 12) { dice[k] += 2; left -= 1; }
      if (left <= 0) break;
    }
    const update = {};
    for (const k of keys) update[`system.attributes.${k}.base`] = dice[k];
    await this.actor.update(update);
  }

  /** Remove the current Role's granted kit (flagged `roleKit` items) before a re-pick. The granted
   *  move carries no SP-ledger entry, so deleting it refunds nothing — no race with the SP reseed. The
   *  natural weapon is NOT roleKit-flagged (it persists and is reconfigured in place), so it survives. */
  async #clearRoleKit() {
    const ids = this.actor.items.filter((i) => i.getFlag("project-anime", "roleKit")).map((i) => i.id);
    if (ids.length) await this.actor.deleteEmbeddedDocuments("Item", ids);
  }

  /** Build a Role's signature kit: (a) pre-fill the EXISTING natural weapon as the Basic Attack
   *  (accuracy Attributes, damage type, range) — no duplicate weapon; (b) create its one signature
   *  Skill as free granted kit (flagged `roleKit` so a re-pick sweeps it) and reserve the move's
   *  nominal SP via the `roleKitSP` flag so the displayed budget stays honest. */
  async #buildRoleKit(key) {
    const arch = CONFIG.PROJECTANIME.monsterArchetypes[key];
    if (!arch) return;
    const a = arch.attack;
    const nat = this.actor.items.find((i) => i.type === "weapon" && i.getFlag("project-anime", "natural"));
    if (nat) await nat.update({
      "system.accuracy.attrA": a.attrA,
      "system.accuracy.attrB": a.attrB,
      "system.damage.type": a.type,
      "system.range.type": a.rangeType,
      "system.range.tiles": a.tiles
    });
    const m = arch.move;
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize(m.name),
      type: "skill",
      img: m.img ?? "icons/svg/upgrade.svg",
      system: {
        rank: m.rank,
        actionType: m.actionType ?? "action",
        attributes: { attrA: m.attrA, attrB: m.attrB },
        damageAttr: m.damageAttr ?? "attrA",
        range: { scope: m.scope, tiles: m.tiles ?? 0 },
        effect: m.effect,
        target: m.target ?? "any",
        damageType: m.damageType ?? "",
        damagePool: m.damagePool ?? "hp",
        modifiers: m.modifiers ?? [],
        effectAttrs: m.effectAttrs ?? [],
        retaliationType: m.retaliationType ?? ""
      },
      flags: { "project-anime": { granted: true, roleKit: true } }
    }]);
    const sp = CONFIG.PROJECTANIME.skillRanks[m.rank]?.sp ?? 0;
    await this.actor.setFlag("project-anime", "roleKitSP", sp);
  }

  /** Re-apply the Tier build at this monster's current local power: flat Eva/Def, the (re-)granted
   *  Skill-Point pool while creating, the re-fit Step-Up budget, and the re-derived HP/Energy. Shared
   *  by Tier and Star picks so the two axes always recompute together. No-op without a Tier. */
  async #applyTierBuild(creating) {
    const tier = this.#tier();   // scaled to the current local power (star or dial)
    if (!tier) return;
    // Flat Evasion / Defense = the Tier's grant + the Role's frame lean (clamped at 0 so a fragile
    // role never derives a negative stat). Role unset → lean 0, so nothing shifts.
    const lean = this.#archetype()?.lean ?? {};
    const update = {
      "system.evasion.bonus": Math.max(0, tier.evasion + (Number(lean.evasion) || 0)),
      "system.defense.bonus": Math.max(0, tier.defense + (Number(lean.defense) || 0))
    };
    // Re-seed the unspent Skill-Point pool to the (scaled) grant MINUS what's already on the ledger
    // AND minus the Role kit's reserved cost (its granted move is free but its nominal SP is held back
    // so the budget stays honest) — only while creating, so changing Tier/★ rescales the budget
    // without refunding skills already built this session (and re-opening a finished monster never
    // wipes its spent points at all).
    if (creating) {
      const sp = this.actor.system.skillPoints ?? {};
      const spent = Array.isArray(sp.log) ? sp.log.reduce((s, e) => s + (Number(e.amount) || 0), 0) : (sp.spent ?? 0);
      const roleKitSP = Number(this.actor.getFlag("project-anime", "roleKitSP")) || 0;
      update["system.skillPoints.value"] = Math.max(0, tier.skillPoints - spent - roleKitSP);
    }
    await this.actor.update(update);
    // If the Tier's budget is smaller than what's already spent on dice, trim the excess.
    await this.#fitStepUps(tier.stepUps);
    if (creating) await this.#applyVitals();
  }

  /** Lower the largest dice (one step at a time) until spent Step-Ups fit `budget`. */
  async #fitStepUps(budget) {
    const keys = CONFIG.PROJECTANIME.attributeKeys;
    const update = {};
    const baseOf = (key) => update[`system.attributes.${key}.base`] ?? this.actor.system.attributes[key].base;
    const usedNow = () => keys.reduce((n, key) => n + Math.max(0, (baseOf(key) - 4) / 2), 0);
    while (usedNow() > budget) {
      const highest = keys.filter((key) => baseOf(key) > 4).sort((a, b) => baseOf(b) - baseOf(a))[0];
      if (!highest) break;
      update[`system.attributes.${highest}.base`] = baseOf(highest) - 2;
    }
    if (Object.keys(update).length) await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Attributes (Step-Ups)                       */
  /* -------------------------------------------- */

  static async #onRaiseAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base >= 12) return;
    if (this.#stepsUsed() >= this.#budget()) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.noStepsLeft"));
    }
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base + 2 });
  }

  static async #onLowerAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base <= 4) return;
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base - 2 });
  }

  /* -------------------------------------------- */
  /*  Combat Stats                                */
  /* -------------------------------------------- */

  static async #onRecalcVitals() {
    await this.#applyVitals();
  }

  static async #onIncSquad() { await this.#resizeSquad(+1); }
  static async #onDecSquad() { await this.#resizeSquad(-1); }

  /** Grow/shrink the Minion's squad: ensure the per-member pool is recorded first (so the very first
   *  resize on a fresh minion derives from its current HP), then setSquadSize refills the pooled bar. */
  async #resizeSquad(delta) {
    if (this.actor.system.tier !== "minion") return;
    if (!(Number(this.actor.system.squad?.memberHp) > 0)) await this.#applyVitals();
    await setSquadSize(this.actor, (Number(this.actor.system.squad?.size) || 1) + delta);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Abilities (Skill Builder hand-off)          */
  /* -------------------------------------------- */

  /** Open (or focus) the in-game Skill Builder, jumping straight into Build mode. */
  static #onOpenSkillBuilder() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }

  /** Delete a built ability (creation is a sandbox — undo is free). */
  static async #onRemoveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    if (item.getFlag("project-anime", "granted")) return;
    await item.delete();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Basic Attacks (no-Energy natural weapons)   */
  /* -------------------------------------------- */

  /** Add a Basic Attack: a natural weapon, equipped so it surfaces in the NPC's quick-attack
   *  panel and rolls through rollAttack — which never spends Energy (the rules' "A Basic Attack
   *  costs no Energy"). Weighs nothing (size 0) and costs no Skill Points. A sensible Might +
   *  Agility melee strike by default; rename it inline and fine-tune it on its item sheet. */
  static async #onAddAttack() {
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("PROJECTANIME.MonsterCreator.basicAttackName"),
      type: "weapon",
      img: NATURAL_WEAPON_IMG,
      system: {
        accuracy: { attrA: "might", attrB: "agility", mod: 0 },
        damage: { mod: 0, type: "physical" },
        range: { type: "melee", tiles: 1 },
        size: 0,
        equipped: true,
        hand: "main",
        grip: "one"
      }
    }]);
    this.render();
  }

  /** Open a Basic Attack's item sheet for full tuning (grip / two-handed, size, cost…). */
  static #onEditAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  /** Delete a Basic Attack (creation is a sandbox — undo is free). */
  static async #onRemoveAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "weapon") return;
    await item.delete();
    this.render();
  }

  /** Commit an inline Basic Attack rename to its weapon item (empty falls back to the default). */
  async #commitAttackName(input) {
    const id = input.closest("[data-attack-id]")?.dataset.attackId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "weapon") return;
    const name = (input.value || "").trim() || game.i18n.localize("PROJECTANIME.MonsterCreator.basicAttackName");
    if (name !== item.name) await item.update({ name });
  }

  /* -------------------------------------------- */
  /*  Finish                                      */
  /* -------------------------------------------- */

  static async #onFinish() {
    await this.#sync();
    await this.actor.setFlag("project-anime", "creationComplete", true);
    ui.notifications.info(game.i18n.format("PROJECTANIME.MonsterCreator.done", { name: this.actor.name }));
    this.close();
  }
}
