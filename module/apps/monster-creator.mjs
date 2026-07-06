/**
 * Project: Anime — step-by-step Monster Creator.
 *
 * A guided ApplicationV2 that builds a combat NPC ("monster") on the SAME rules as a
 * Player Character — the five Attributes start at d4 and you spend Step-Ups; HP =
 * 6 + ⟪Might⟫×2, Energy = 6 + ⟪Spirit⟫×2 — then scales it by an anime power **Tier** (Minion /
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
import { SkillBrowserApp } from "./skill-browser.mjs";
import { PROJECTANIME, enemyStrongAttrs, enemyVitals, enemyTierDie, bossBarCount, bossBarHp } from "../helpers/config.mjs";
import { partyRailStats } from "../helpers/encounter.mjs";
import { partyTier } from "../helpers/chronicle.mjs";
import { elementLabel } from "../helpers/elements.mjs";
import {
  GEAR_GROUPS, SLOT_ACCEPTS,
  buildGearContext, slotOccupant, equipToSlot, clearSlot, importDroppedItem, readDrag, draggedItem
} from "../helpers/gear.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Creation steps, in order (v0.03). FRAME picks the build path + Role + Tier (I–IV) and reads the
 *  finished statblock off a live card. TUNE is Build-Your-Own: trade stats inside the Four Rails.
 *  ABILITIES adds Skills — from the Skill Browser (incl. the preset Twists) or the Skill Builder. */
const STEPS = ["concept", "frame", "tune", "abilities", "gear", "finish"];

/** The three build paths (rules "Enemies"): copy a tier row, reshape it with a Role + a Twist, or
 *  trade stats yourself. Guidance only — all three write the same Role × Tier statblock; the path just
 *  decides whether the Tune step exposes the trade controls. */
const BUILD_PATHS = ["row", "reshape", "custom"];

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
      pickPath: MonsterCreatorApp.#onPickPath,
      pickRole: MonsterCreatorApp.#onPickRole,
      pickTier: MonsterCreatorApp.#onPickTier,
      toggleRival: MonsterCreatorApp.#onToggleRival,
      toggleBoss: MonsterCreatorApp.#onToggleBoss,
      pickStrong: MonsterCreatorApp.#onPickStrong,
      recalcVitals: MonsterCreatorApp.#onRecalcVitals,
      browseSkills: MonsterCreatorApp.#onBrowseSkills,
      addAttack: MonsterCreatorApp.#onAddAttack,
      editAttack: MonsterCreatorApp.#onEditAttack,
      removeAttack: MonsterCreatorApp.#onRemoveAttack,
      openSkillBuilder: MonsterCreatorApp.#onOpenSkillBuilder,
      removeSkill: MonsterCreatorApp.#onRemoveSkill,
      // Gear step — the same loadout actions the actor sheet's Gear drawer uses.
      selectBag: MonsterCreatorApp.#onSelectBag,
      toggleEquip: MonsterCreatorApp.#onToggleEquip,
      unequipSlot: MonsterCreatorApp.#onUnequipSlot,
      cycleShieldUse: MonsterCreatorApp.#onCycleShieldUse,
      pickSlot: MonsterCreatorApp.#onPickSlot,
      createItem: MonsterCreatorApp.#onCreateItem,
      createMenu: MonsterCreatorApp.#onCreateMenu,
      editItem: MonsterCreatorApp.#onEditItem,
      deleteItem: MonsterCreatorApp.#onDeleteItem,
      rollItem: MonsterCreatorApp.#onRollItem,
      finish: MonsterCreatorApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/monster-creator.hbs", scrollable: [""] }
  };

  /** Current step index. */
  #step = 0;

  /** Selected inventory bag (container id, "" = backpack) on the Gear step. */
  #selectedBag = "";

  /** Chosen build path (row / reshape / custom) — guidance + gates the Tune trade controls. */
  #path = "row";

  get title() {
    return `${game.i18n.localize("PROJECTANIME.MonsterCreator.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Role / Tier helpers                         */
  /* -------------------------------------------- */

  /** The selected Role's config entry, or null while unset. */
  #role() {
    const key = this.actor.system.enemyRole;
    return key ? PROJECTANIME.enemyRoles[key] : null;
  }

  /** The selected Tier (1–4; 0 = unpicked). */
  #tierNum() {
    return Number(this.actor.system.enemyTier) || 0;
  }

  /** The resolved Strong-Attribute set (Role's fixed pair, or the Elite's stored three). */
  #strong() {
    return enemyStrongAttrs(this.actor.system.enemyRole, this.actor.system.strongAttrs);
  }

  /** This monster's derived HP / EP under the v0.03 Role × Tier model. */
  #vitals() {
    return enemyVitals(this.actor.system.enemyRole, this.#tierNum(), this.#strong());
  }

  /** The party size for Boss Bars + the Four Rails (live roster, else an assumed 4). */
  #partySize() {
    return partyRailStats()?.size ?? 4;
  }

  /** Both Role AND Tier chosen — the minimum for a real statblock. */
  #framed() {
    return !!this.#role() && this.#tierNum() >= 1;
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
    ctx.onGear = stepKey === "gear";
    ctx.onFinish = stepKey === "finish";

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.disposition = sys.disposition ?? "hostile";

    const L = (k) => game.i18n.localize(k);

    // Build path — guidance + gates the Tune trade controls (Build Your Own).
    ctx.path = this.#path;
    ctx.pathCustom = this.#path === "custom";
    ctx.paths = BUILD_PATHS.map((k) => ({ key: k, label: L(`PROJECTANIME.MonsterCreator.path.${k}`), selected: this.#path === k }));

    // Role cards — the 7 Roles, each with its Threat and Strong Attributes.
    ctx.enemyRole = sys.enemyRole ?? "";
    ctx.roles = cfg.enemyRoleKeys.map((k) => {
      const r = cfg.enemyRoles[k];
      const strong = Array.isArray(r.strong) ? r.strong : null;
      return {
        key: k, label: L(r.label), icon: r.icon, color: r.color,
        threat: r.threat,
        strong: (strong ?? []).map((a) => L(cfg.attributes[a])),
        anyThree: !strong,
        selected: sys.enemyRole === k
      };
    });

    // Tier buttons I–IV — the Strong / Weak dice each grants.
    ctx.enemyTier = this.#tierNum();
    ctx.tiers = cfg.enemyTierKeys.map((t) => ({
      key: t, numeral: cfg.enemyTierNumerals[t],
      strong: `d${enemyTierDie(t, true)}`, weak: `d${enemyTierDie(t, false)}`,
      selected: this.#tierNum() === t
    }));

    // Rival / Boss flags + whether the frame is complete.
    ctx.rival = !!sys.rival;
    ctx.boss = !!sys.boss?.enabled;
    ctx.framed = this.#framed();

    // Elite (or Boss) picks three Strong Attributes.
    const strongSet = this.#strong();
    ctx.picksStrong = (sys.enemyRole === "elite") || ctx.boss;
    ctx.strongPicks = cfg.attributeKeys.map((k) => ({
      key: k, label: L(cfg.attributes[k]), icon: cfg.attributeIcons?.[k] ?? "", on: strongSet.includes(k)
    }));

    // Derived statblock — the finished numbers this build stores (read the chart).
    ctx.stat = {
      hp: sys.hp.max,
      energy: sys.energy.base ?? sys.energy.max,
      atk: sys.atk.value, matk: sys.matk.value,
      defense: sys.defense.value, res: sys.res.value,
      evasion: sys.evasion.value, as: sys.as.value, movement: sys.movement.value
    };
    ctx.magic = !!this.#role()?.magic;   // Caster attacks target RES
    // A stored statblock drifts from the Role × Tier chart only if a stat was hand-edited then the Role
    // changed; the Recalc button re-seeds HP/EP + role deltas.
    const fresh = this.#framed() ? this.#vitals() : null;
    ctx.vitalsStale = !!fresh && ((sys.energy.base ?? sys.energy.max) !== fresh.energy);

    // Four Rails audit vs the party (or a Tempered tier row when there are no sheets).
    ctx.rails = this.#framed() ? this.#railsAudit() : null;

    // Boss Bars readout.
    ctx.bossBars = ctx.boss ? {
      count: Number(sys.boss.bars) || 0,
      barHp: Number(sys.boss.barHp) || 0,
      total: (Number(sys.boss.bars) || 0) * (Number(sys.boss.barHp) || 0)
    } : null;

    // Basic Attacks — natural weapons. The rules' "Basic Attack" strikes with an equipped
    // weapon and costs NO Energy (and no Skill Points); these roll through rollAttack from
    // the NPC's quick-attack panel. Built/renamed inline here, fully tunable on the item sheet.
    ctx.attacks = this.actor.items
      .filter((i) => i.type === "weapon")
      .sort(bySort)
      .map((i) => ({ id: i.id, name: i.name, img: i.img, summary: this.#attackSummary(i) }));
    ctx.attackCount = ctx.attacks.length;

    // Abilities — the Skills on this monster (built, browsed, or the preset Twists). Enemies have no
    // Skill Points; EP fuels active Skills. Twist-flagged Skills wear a small marker in the list.
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        cost: i.system.actionType === "passive" ? L("PROJECTANIME.Skill.passive")
          : (i.system.perConflict ? L("PROJECTANIME.Skill.perConflict") : `${i.system.energyCost ?? 0} EP`),
        actionLabel: L(cfg.actionTypes[i.system.actionType] ?? ""),
        passive: i.system.actionType === "passive",
        twist: !!i.getFlag("project-anime", "twist")
      }));
    ctx.skillCount = ctx.skills.length;

    // Review (last step) — a compact summary badge (Role · Tier + Rival/Boss + Threat).
    ctx.reviewBadge = this.#role()
      ? { label: L(this.#role().label), icon: this.#role().icon, color: this.#role().color,
          tierNumeral: cfg.enemyTierNumerals[this.#tierNum()],
          rival: ctx.rival, boss: ctx.boss,
          threat: ctx.rival ? 3 : (ctx.boss ? this.#partySize() : this.#role().threat) }
      : null;

    // Gear step — the same carried-gear UI players get on the actor sheet (paperdoll + bags + grid,
    // via helpers/gear.mjs → gear-body.hbs), plus a live Defense/Evasion readout so the GM sees armor
    // take effect. Only built while on the step; buildGearContext also corrects a stale selected bag.
    if (ctx.onGear) {
      ctx.actor = this.actor;
      ctx.system = sys;
      ctx.editable = this.actor.isOwner;
      const gear = buildGearContext(this.actor, { selectedBag: this.#selectedBag });
      this.#selectedBag = gear.selectedBag;
      Object.assign(ctx, gear);   // paperdoll, bags, bagItems, selectedBag
      ctx.defense = sys.defense.value;
      ctx.evasion = sys.evasion.value;
    }

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
    // Gear step: wire drag-drop (compendium/sidebar copy + paperdoll/bag equip zones).
    if (this.actor.isOwner && STEPS[this.#step] === "gear") this.#bindGearDnD();
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

  /** Block leaving the Frame step until both a Role AND a Tier are chosen (the minimum statblock). */
  #validateStep() {
    const key = STEPS[this.#step];
    if ((key === "frame" || key === "tune") && !this.#framed()) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.pickRoleTierFirst"));
      return false;
    }
    return true;
  }

  /** No per-step side effects — the Role/Tier picks already write the statblock live. */
  async #onEnterStep() {}

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
  /*  Frame — build path, Role, Tier              */
  /* -------------------------------------------- */

  /** Pick a build path (guidance only; gates the Tune trade controls). */
  static #onPickPath(event, target) {
    const key = target.closest("[data-path]")?.dataset.path;
    if (BUILD_PATHS.includes(key)) { this.#path = key; this.render(); }
  }

  /** Pick a Role: stamp it (reset the Elite strong-pick when leaving Elite) and re-derive the block. */
  static async #onPickRole(event, target) {
    const key = target.closest("[data-role]")?.dataset.role;
    if (!PROJECTANIME.enemyRoles[key]) return;
    const update = { "system.enemyRole": key };
    // A fixed Role owns its Strong set; clear a stale Elite pick so the derived dice don't linger.
    if (key !== "elite") update["system.strongAttrs"] = [];
    await this.actor.update(update);
    await this.#applyRoleTier();
    this.render();
  }

  /** Pick a Tier I–IV (toggle off by clicking the current one) and re-derive the block. */
  static async #onPickTier(event, target) {
    const t = Number(target.closest("[data-tier]")?.dataset.tier) || 0;
    if (!(t >= 1 && t <= 4)) return;
    const next = (t === this.#tierNum()) ? 0 : t;
    await this.actor.update({ "system.enemyTier": next });
    await this.#applyRoleTier();
    this.render();
  }

  /** Toggle the Rival flag (a full-PC-rules villain; Elite + 1 Threat). */
  static async #onToggleRival() {
    await this.actor.update({ "system.rival": !this.actor.system.rival });
    this.render();
  }

  /** Toggle the Boss flag — a Boss is an Elite whose HP becomes Bars. Enabling it sets the Role to
   *  Elite and computes Bars (⌈party ÷ 2⌉) + Bar HP (8/10/12/14 × party by Tier); disabling restores
   *  normal HP from the Role × Tier chart. */
  static async #onToggleBoss() {
    const on = !this.actor.system.boss?.enabled;
    const update = { "system.boss.enabled": on };
    if (on && this.actor.system.enemyRole !== "elite") update["system.enemyRole"] = "elite";
    await this.actor.update(update);
    await this.#applyRoleTier();
    this.render();
  }

  /** Toggle one of an Elite's three Strong Attributes (exactly three; ignore a 4th pick). */
  static async #onPickStrong(event, target) {
    const key = target.closest("[data-attr]")?.dataset.attr;
    if (!PROJECTANIME.attributeKeys.includes(key)) return;
    const cur = new Set(this.#strong());
    if (cur.has(key)) cur.delete(key);
    else { if (cur.size >= 3) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.EnemyRole.strongPickHint")); cur.add(key); }
    await this.actor.update({ "system.strongAttrs": [...cur] });
    await this.#applyRoleTier();
    this.render();
  }

  static async #onRecalcVitals() {
    await this.#applyRoleTier();
    this.render();
  }

  /**
   * Write the finished statblock from the Role × Tier: the attribute dice derive live (data model), so
   * here we only stamp the Role's flat stat DELTAS onto the `.bonus` fields, store HP / EP, flip a
   * Caster's Basic Attacks to a magical (Mind) accuracy so they target RES, and (for a Boss) compute
   * the Bars. No-op until both Role and Tier are chosen.
   */
  async #applyRoleTier() {
    if (!this.#framed()) return;
    const role = this.#role();
    const d = role.deltas ?? {};
    const { hp, energy } = this.#vitals();
    const boss = !!this.actor.system.boss?.enabled;
    const update = {
      // Role deltas → the derived-stat bonuses (overwrite, so re-picking a Role never stacks).
      "system.atk.bonus": Number(d.atk) || 0,
      "system.matk.bonus": Number(d.atk) || 0,
      "system.defense.bonus": Number(d.defense) || 0,
      "system.res.bonus": Number(d.res) || 0,
      "system.evasion.bonus": Number(d.evasion) || 0,
      "system.as.bonus": Number(d.as) || 0,
      "system.movement.bonus": Number(d.movement) || 0,
      "system.energy.max": energy,
      "system.energy.value": energy
    };
    if (boss) {
      // Boss: HP becomes Bars. hp.max shows ONE Bar; the Bar count + per-Bar HP drive the rest.
      const size = this.#partySize();
      const bars = bossBarCount(size);
      const barHp = bossBarHp(this.#tierNum(), size);
      update["system.boss.bars"] = bars;
      update["system.boss.barHp"] = barHp;
      update["system.boss.remaining"] = bars;
      update["system.boss.broken"] = 0;
      update["system.boss.resolveUsed"] = false;
      update["system.hp.max"] = barHp;
      update["system.hp.value"] = barHp;
    } else {
      update["system.hp.max"] = hp;
      update["system.hp.value"] = hp;
    }
    await this.actor.update(update);
    // Caster: its Basic Attacks target RES — a magical strike rolls off Mind (dice.mjs keys defenseKey
    // to the accuracy Attributes). Flip any natural/equipped weapon's accuracy to Mind + Spirit.
    if (role.magic) await this.#retuneAttacksMagical(true);
    else await this.#retuneAttacksMagical(false);
  }

  /** Point every Basic Attack's accuracy at Mind+Spirit (magical → targets RES) or Might+Agility
   *  (physical → targets DEF), matching the Role. Only touches weapons on this monster. */
  async #retuneAttacksMagical(magical) {
    const updates = [];
    for (const it of this.actor.items) {
      if (it.type !== "weapon") continue;
      const acc = it.system?.accuracy ?? {};
      const want = magical ? { attrA: "mind", attrB: "spirit" } : { attrA: "might", attrB: "agility" };
      if (acc.attrA !== want.attrA || acc.attrB !== want.attrB) {
        updates.push({ _id: it.id, "system.accuracy.attrA": want.attrA, "system.accuracy.attrB": want.attrB });
      }
    }
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * The Four Rails audit vs the party (rules "Build Your Own"): ATK ≤ lowest party DEF + 6 · DEF ≤
   * lowest party ATK − 2 · AS ≤ slowest party AS + 4 (a deliberate Skirmisher is exempt) · EVA ≤
   * 7 + party Tier (doc v0.03 revised). With no party sheets, run against a Tempered tier row (a
   * same-Tier Grunt + 1 ATK/DEF at Tier III, +2 at IV; the EVA rail reads the monster's own Tier).
   * Returns one row per rail {key, ok, actual, limit, exempt}. This IS the Forecast for now.
   */
  #railsAudit() {
    const sys = this.actor.system;
    const tier = this.#tierNum();
    const skirmisher = this.actor.system.enemyRole === "skirmisher";
    const enemyAtk = this.#role()?.magic ? sys.matk.value : sys.atk.value;
    let ref = partyRailStats();
    let evaTier = partyTier();
    if (!ref) {
      // Tempered tier row = a same-Tier Grunt (Might/Agility strong), + temper at Tier III/IV.
      const strong = enemyTierDie(tier, true);
      const temper = tier >= 4 ? 2 : (tier >= 3 ? 1 : 0);
      ref = {
        lowestDef: Math.floor(strong / 2) + temper,   // Grunt DEF = floor(Might/2)
        lowestAtk: strong + 3 + temper,               // Might + a basic weapon
        slowestAs: strong                             // Agility, no bulk
      };
      evaTier = tier;
    }
    const rails = [
      { key: "damageIn",  actual: enemyAtk,        limit: ref.lowestDef + 6 },
      { key: "damageOut", actual: sys.defense.value, limit: ref.lowestAtk - 2 },
      { key: "speed",     actual: sys.as.value,    limit: ref.slowestAs + 4, exempt: skirmisher },
      { key: "evasion",   actual: sys.evasion.value, limit: 7 + evaTier }
    ];
    return rails.map((r) => ({
      key: r.key,
      label: game.i18n.localize(`PROJECTANIME.MonsterCreator.rail.${r.key}`),
      actual: r.actual,
      limit: r.limit,
      exempt: !!r.exempt,
      ok: r.exempt || r.actual <= r.limit
    }));
  }

  /* -------------------------------------------- */
  /*  Abilities (Browser + Skill Builder)         */
  /* -------------------------------------------- */

  /** Open the Skill Browser — an MMO-inventory-bag picker of every world/compendium Skill (including
   *  the preset Twists) to hand to this monster. It writes straight to the actor, so this creator (in
   *  actor.apps) refreshes live. */
  static #onBrowseSkills() {
    SkillBrowserApp.open(this.actor);
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
    // A Caster's Basic Attack is magical (Mind + Spirit → targets RES); everyone else is a Might strike.
    const magic = !!this.#role()?.magic;
    const acc = magic ? { attrA: "mind", attrB: "spirit", mod: 0 } : { attrA: "might", attrB: "agility", mod: 0 };
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("PROJECTANIME.MonsterCreator.basicAttackName"),
      type: "weapon",
      img: NATURAL_WEAPON_IMG,
      system: {
        accuracy: acc,
        // Blade-tier on the v0.03 absolute DMG scale, so a fresh Basic Attack keeps pace with rebased
        // party gear; tune the exact DMG on the item sheet.
        damage: { mod: 3, type: "physical" },
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
  /*  Gear (loadout — same as the actor sheet)    */
  /* -------------------------------------------- */

  /** Resolve the item a gear row/tile belongs to (by the closest [data-item-id]). */
  #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  /** Select a bag (container) → re-render so the inventory grid shows its contents. */
  static #onSelectBag(event, target) {
    this.#selectedBag = target.dataset.bagId || "";
    this.render();
  }

  static async #onToggleEquip(event, target) {
    const item = this.#getItem(target);
    if (!item || !("equipped" in item.system)) return;
    await item.update({ "system.equipped": !item.system.equipped });
  }

  static async #onUnequipSlot(event, target) {
    await clearSlot(this.actor, target.dataset.slot);
  }

  static async #onCycleShieldUse(event, target) {
    const item = this.#getItem(target);
    if (!item || item.type !== "shield") return;
    await item.update({ "system.use": item.system.use === "dual" ? "shield" : "dual" });
  }

  static #onPickSlot(event, target) {
    this.#openSlotPicker(target.dataset.slot, target);
  }

  static #onCreateMenu(event, target) {
    this.#openCreateMenu(target);
  }

  static async #onCreateItem(event, target) {
    event.preventDefault();
    await this.#createGearItem(target.dataset.type || "gear");
  }

  static #onEditItem(event, target) {
    this.#getItem(target)?.sheet?.render(true);
  }

  static async #onDeleteItem(event, target) {
    await this.#getItem(target)?.deleteDialog();
  }

  static async #onRollItem(event, target) {
    this.#getItem(target)?.roll({ event });
  }

  /** Create one gear item of `type`, filed into the bag currently being viewed. */
  async #createGearItem(type) {
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) });
    const data = { name, type };
    if (this.#selectedBag && GEAR_GROUPS.includes(type)) data["system.container"] = this.#selectedBag;
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Open the click-to-equip popover for a paperdoll slot: eligible items + an Unequip row. */
  #openSlotPicker(slotKey, anchor) {
    if (!this.actor.isOwner || !slotKey) return;
    this.element.querySelector(".pd-picker")?.remove();

    const base = slotKey.startsWith("accessory") ? "accessory" : slotKey;
    const accepts = SLOT_ACCEPTS[base] ?? [];
    const equipped = this.actor.items.filter((i) => i.system?.equipped);
    const occupant = slotOccupant(slotKey, equipped);
    const candidates = this.actor.items.filter((i) => accepts.includes(i.type)).sort(bySort);

    const menu = document.createElement("div");
    menu.className = "pd-picker";
    menu.setAttribute("popover", "auto");

    const addRow = (cls, build, onClick) => {
      const row = document.createElement("div");
      row.className = cls;
      build(row);
      row.addEventListener("click", () => { menu.hidePopover(); onClick(); });
      menu.appendChild(row);
    };

    if (occupant) addRow("pd-empty", (r) => (r.textContent = game.i18n.localize("PROJECTANIME.Equipment.empty")), () => clearSlot(this.actor, slotKey));
    for (const it of candidates) {
      addRow(`pd-option${occupant && it.id === occupant.id ? " is-selected" : ""}`, (r) => {
        const img = document.createElement("img");
        img.src = it.img;
        const span = document.createElement("span");
        span.textContent = it.name;
        r.append(img, span);
      }, () => equipToSlot(this.actor, it, slotKey));
    }
    if (!menu.children.length) addRow("pd-empty", (r) => (r.textContent = game.i18n.localize("PROJECTANIME.Empty")), () => {});

    this.element.appendChild(menu);
    menu.addEventListener("toggle", (ev) => {
      if (ev.newState === "open") this.#placePopover(menu, anchor);
      else menu.remove();
    });
    menu.showPopover();
  }

  /** Item-creation type picker (the + tile in the flat inventory grid). */
  #openCreateMenu(anchor) {
    if (!this.actor.isOwner) return;
    this.element.querySelector(".pd-picker")?.remove();
    const icons = { weapon: "fa-khanda", armor: "fa-shirt", shield: "fa-shield-halved", accessory: "fa-ring", consumable: "fa-flask", gear: "fa-box-archive" };

    const menu = document.createElement("div");
    menu.className = "pd-picker";
    menu.setAttribute("popover", "auto");
    for (const type of GEAR_GROUPS) {
      const row = document.createElement("div");
      row.className = "pd-option";
      const i = document.createElement("i");
      i.className = `fas ${icons[type] ?? "fa-box"}`;
      const span = document.createElement("span");
      span.textContent = game.i18n.localize(`TYPES.Item.${type}`);
      row.append(i, span);
      row.addEventListener("click", () => { menu.hidePopover(); this.#createGearItem(type); });
      menu.appendChild(row);
    }
    this.element.appendChild(menu);
    menu.addEventListener("toggle", (ev) => {
      if (ev.newState === "open") this.#placePopover(menu, anchor);
      else menu.remove();
    });
    menu.showPopover();
  }

  /** Fixed-position a popover beside its anchor (flips above if it won't fit below). */
  #placePopover(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { position: "fixed", inset: "auto", margin: "0", left: `${Math.round(r.left)}px`, minWidth: `${Math.max(r.width, 170)}px` });
    const h = menu.offsetHeight;
    const fitsBelow = r.bottom + 4 + h <= window.innerHeight;
    menu.style.top = `${Math.round(fitsBelow || r.top - h - 4 < 0 ? r.bottom + 4 : r.top - h - 4)}px`;
  }

  /** Native drag-and-drop for the Gear step: drop a gear item from a compendium / sidebar / another
   *  sheet onto the step to copy it here; drag a tile onto a paperdoll slot to equip, onto the bag to
   *  unequip, onto a bag tab to refile. Mirrors the actor sheet's #bindPaperdoll + #onSheetDrop —
   *  standalone, since the creator is not an ActorSheetV2 (no base ondrop to fight). */
  #bindGearDnD() {
    const root = this.element;
    if (!root) return;

    // Root copy target lives on the persistent window root → bind once.
    if (!root.dataset.paCreatorDrop) {
      root.dataset.paCreatorDrop = "1";
      root.addEventListener("dragover", (ev) => { ev.preventDefault(); });
      root.addEventListener("drop", (ev) => this.#onGearDrop(ev));
    }

    // Per-render: (re)mark tiles draggable + (re)wire the paperdoll / bag drop zones.
    for (const el of root.querySelectorAll("[data-item-id][draggable='true']")) {
      for (const img of el.querySelectorAll("img")) img.setAttribute("draggable", "false");
      el.addEventListener("dragstart", (ev) => {
        const uuid = this.actor?.items.get(el.dataset.itemId)?.uuid;
        ev.dataTransfer.setData("text/plain", JSON.stringify({ paItem: el.dataset.itemId, type: "Item", uuid }));
        ev.dataTransfer.effectAllowed = "copyMove";
      });
    }

    for (const slot of root.querySelectorAll(".pd-slot")) {
      slot.addEventListener("dragover", (ev) => { ev.preventDefault(); slot.classList.add("drag-over"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
      slot.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        slot.classList.remove("drag-over");
        // Own item → equip it; foreign item → copy it onto this monster first, then equip the copy.
        const item = draggedItem(this.actor, ev) ?? await importDroppedItem(this.actor, readDrag(ev));
        if (item) equipToSlot(this.actor, item, slot.dataset.slot);
      });
    }

    const bag = root.querySelector(".pd-bag");
    if (bag) {
      bag.addEventListener("dragover", (ev) => ev.preventDefault());
      bag.addEventListener("drop", (ev) => {
        const item = draggedItem(this.actor, ev);
        if (item?.system?.equipped) {
          ev.preventDefault();
          ev.stopPropagation();
          item.update({ "system.equipped": false });
        }
      });
    }

    for (const tab of root.querySelectorAll(".bag-tab")) {
      tab.addEventListener("dragover", (ev) => { ev.preventDefault(); tab.classList.add("drag-over"); });
      tab.addEventListener("dragleave", () => tab.classList.remove("drag-over"));
      tab.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        tab.classList.remove("drag-over");
        const bagId = tab.dataset.bagId || "";
        const item = draggedItem(this.actor, ev);
        if (item) {
          // Own item → just refile it into this bag.
          if (item.type !== "container" && (item.system.container || "") !== bagId) {
            await item.update({ "system.container": bagId });
          }
          return;
        }
        // Foreign item → copy it straight into this bag.
        await importDroppedItem(this.actor, readDrag(ev), { container: bagId });
      });
    }
  }

  /** Root drop: copy a dropped foreign gear item onto the monster (own-tile drops are handled by the
   *  paperdoll/bag zones, which stopPropagation). No-op off the Gear step. */
  async #onGearDrop(ev) {
    if (STEPS[this.#step] !== "gear") return;
    if (ev.target?.closest?.("prose-mirror, .ProseMirror, .editor-content")) return;
    const data = readDrag(ev);
    if (data?.type !== "Item" || !data.uuid) return;
    if (data.paItem && this.actor.items.has(data.paItem)) return; // own tile → its zone handles it
    ev.preventDefault();
    await importDroppedItem(this.actor, data);
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
