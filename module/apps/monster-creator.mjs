/**
 * Project: Anime — step-by-step Monster Creator (V2 enemies).
 *
 * A guided ApplicationV2 that builds an enemy the way the rules do (Enemies → Building Your
 * Own): pick a TYPE (a complete stat line — Minion / Standard / Bruiser / Skirmisher / Support /
 * Elite; see PROJECTANIME.enemyTypes), assign the type's Attribute dice, choose Talents at the
 * printed die sizes, and write Techniques with the same Skill Browser / Builder players use.
 * A seventh tile, COMPANION (PROJECTANIME.companion), hand-builds a party ally on the printed
 * companion line: it has no Threat, goes friendly on pick, and files itself with the companions.
 *
 * Picking a type stamps the printed line onto the actor: Hit Boxes, Energy Boxes, Guard
 * (as `guard.bonus` = printed − base 6), Movement (as `movement.bonus` = printed − unarmored 6)
 * and the Basic Attack's Damage + Threshold (onto every owned weapon item — the Natural Attack
 * included). The GM then picks the attack's two accuracy Attributes (the same Attribute may be
 * chosen twice) or links a Talent, which replaces one die and adds the Trained Edge.
 *
 * RIVAL is a designation (Threat 2 — a recurring villain built as a full PC). BOSS starts from
 * an Elite and applies the Boss line (PROJECTANIME.boss): Bars = ⌈party ÷ 2⌉, each Bar party × 2
 * hit boxes, 6 Energy Boxes per Bar, Damage 3 / Threshold 11, Guard 9, Movement 5; it acts twice
 * per Enemy Phase and budgets two Techniques per Bar (a break unlocks the next Bar's).
 *
 * Like the Character Creator it operates on the LIVE actor and registers in `actor.apps`, so
 * changes refresh it live; it sets the same `flags.project-anime.creationComplete` on finish.
 * Reuses the Character Creator's `.cc-*` stylesheet via the shared `character-creator` class.
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { SkillBrowserApp } from "./skill-browser.mjs";
import { PROJECTANIME, bossBarCount, bossBarHp, bossThreat, actorTalents } from "../helpers/config.mjs";
import { formatThreat } from "../helpers/encounter.mjs";
import { partyMembers, partyActors } from "../helpers/party-folder.mjs";
import { ensureServantFolder } from "../helpers/servants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Creation steps, in order (rules: pick a type → assign Attributes → choose Talents → write
 *  Techniques), book-ended by Concept and Review. */
const STEPS = ["concept", "type", "attributes", "talents", "techniques", "finish"];

/** Default icon for a freshly-created Basic Attack weapon. */
const NATURAL_WEAPON_IMG = "icons/svg/sword.svg";

/** Starting-Talent loadouts per type (rules: Step 3) — each option is one full loadout. */
const TALENT_OPTIONS = {
  minion: [],
  standard: [[6]],
  bruiser: [[8]],
  skirmisher: [[6]],
  support: [[6]],
  elite: [[8], [6, 6]],
  companion: [[6]]
};

/** A Boss's Talent loadouts: one at d10, or two at d8. */
const BOSS_TALENT_OPTIONS = [[10], [8, 8]];

/** Suggested Technique counts per type (display budget; rules: Step 4). */
const TECHNIQUE_BUDGET = { minion: "0", standard: "1–2", bruiser: "1–2", skirmisher: "1–2", support: "2", elite: "2", companion: "1" };

/** Resolve a tile key to its printed stat line — the six enemy Types, plus the Companion line
 *  (which is not an enemy Type: no Threat, never in the encounter budget). */
function typeLine(key) {
  return key === "companion" ? PROJECTANIME.companion : PROJECTANIME.enemyTypes[key];
}

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

/** An enemy Type's printed stat line as rich tooltip HTML — the same `.pa-tooltip` card the
 *  Style pickers use (glyph head, labeled stat rows), with Threat leading the rows. */
function typeTooltipHTML(t) {
  const L = (k) => game.i18n.localize(k);
  const row = (icon, key, value) =>
    `<div class="pa-tt-row"><span class="k"><i class="fa-solid ${icon}"></i> ${L(key)}</span><span class="v">${value}</span></div>`;
  const rows = [
    // The Companion line has no Threat — skip the row rather than print a placeholder.
    ...(Number.isFinite(t.threat) ? [row("fa-skull", "PROJECTANIME.Threat.label", formatThreat(t.threat))] : []),
    row("fa-heart", "PROJECTANIME.Stat.hp", t.hb),
    row("fa-bolt", "PROJECTANIME.Stat.energy", t.eb),
    row("fa-shield", "PROJECTANIME.Stat.guard", t.guard),
    row("fa-shoe-prints", "PROJECTANIME.Stat.movement", t.movement),
    row("fa-burst", "PROJECTANIME.Roll.damage", t.damage),
    row("fa-bullseye", "PROJECTANIME.Field.threshold", t.threshold)
  ];
  return `<div class="pa-tt-head"><span class="pa-tt-img pa-tt-glyph" style="--tier-color: ${t.color}"><i class="${t.icon}"></i></span>`
    + `<div class="pa-tt-heads"><div class="pa-tt-title">${L(t.label)}</div>`
    + `<div class="pa-tt-type">${L("PROJECTANIME.MonsterCreator.step.type")}</div></div></div>`
    + `<div class="pa-tt-body"><div class="pa-tt-rows">${rows.join("")}</div></div>`;
}

/** The live party size — unique Characters across every Party folder (4 when there's no roster). */
function livePartySize() {
  const seen = new Set();
  for (const p of partyActors()) {
    for (const m of partyMembers(p)) if (m?.type === "character") seen.add(m.id);
  }
  return seen.size || 4;
}

export class MonsterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-monster-creator-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    // `character-creator` pulls in the shared creator stylesheet; `monster-creator`
    // carries the enemy-specific deltas.
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
      pickType: MonsterCreatorApp.#onPickType,
      toggleRival: MonsterCreatorApp.#onToggleRival,
      toggleBoss: MonsterCreatorApp.#onToggleBoss,
      addAttack: MonsterCreatorApp.#onAddAttack,
      editAttack: MonsterCreatorApp.#onEditAttack,
      removeAttack: MonsterCreatorApp.#onRemoveAttack,
      addTalent: MonsterCreatorApp.#onAddTalent,
      removeTalent: MonsterCreatorApp.#onRemoveTalent,
      browseSkills: MonsterCreatorApp.#onBrowseSkills,
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

  /** Manual party-size override for the Boss Bars (null = read the live roster). */
  #partySizeOverride = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.MonsterCreator.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Type helpers                                */
  /* -------------------------------------------- */

  /** The selected Type's config entry (or the Companion line), or null while unset. */
  #type() {
    const key = this.actor.system.npcType;
    return key ? (typeLine(key) ?? null) : null;
  }

  #isBoss() {
    return !!this.actor.system.boss?.enabled;
  }

  /** The printed stat line in force — the Boss line overrides the Type's while enabled. */
  #line() {
    return this.#isBoss() ? PROJECTANIME.boss : this.#type();
  }

  /** A Type (or the Boss line, or the Rival designation) chosen — the minimum for a statblock. */
  #framed() {
    return !!this.#type() || this.#isBoss() || !!this.actor.system.rival;
  }

  /** The party size for the Boss Bars (manual override, else the live roster). */
  #partySize() {
    return this.#partySizeOverride ?? livePartySize();
  }

  /** The Attribute-die budget in force (Boss three d10 + two d6; else the Type's array). */
  #attrBudget() {
    if (this.#isBoss()) return PROJECTANIME.boss.attrs;
    return this.#type()?.attrs ?? null;
  }

  /** The Talent loadout options in force (Boss: one d10 or two d8). */
  #talentOptions() {
    if (this.#isBoss()) return BOSS_TALENT_OPTIONS;
    return TALENT_OPTIONS[this.actor.system.npcType] ?? [];
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
    const L = (k) => game.i18n.localize(k);

    ctx.steps = STEPS.map((k, i) => ({
      key: k,
      num: i + 1,
      label: L(`PROJECTANIME.MonsterCreator.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.MonsterCreator.stepOf", { n: this.#step + 1, total: STEPS.length });
    ctx.stepTitle = L(`PROJECTANIME.MonsterCreator.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === STEPS.length - 1;
    ctx.onConcept = stepKey === "concept";
    ctx.onType = stepKey === "type";
    ctx.onAttributes = stepKey === "attributes";
    ctx.onTalents = stepKey === "talents";
    ctx.onTechniques = stepKey === "techniques";
    ctx.onFinish = stepKey === "finish";

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.disposition = sys.disposition ?? "hostile";

    // Type tiles — glyph + name on the face; the printed stat line lives in the hover tooltip
    // (matches the Character Creator's Weapon/Armor Style cards). Companion rides along as a
    // seventh tile: the party-ally stat line, not an enemy Type.
    ctx.npcType = sys.npcType ?? "";
    ctx.types = [...cfg.enemyTypeKeys, "companion"].map((k) => {
      const t = typeLine(k);
      return {
        key: k, label: L(t.label), icon: t.icon, color: t.color,
        tooltip: typeTooltipHTML(t),
        selected: sys.npcType === k
      };
    });

    // Rival / Boss flags + whether the frame is complete.
    ctx.rival = !!sys.rival;
    ctx.boss = this.#isBoss();
    ctx.framed = this.#framed();

    // Boss readout — Bars × per-Bar boxes, the party size driving them, and the display notes
    // (acts twice per Enemy Phase; 6 Energy Boxes per Bar; two Techniques per Bar, a break
    // unlocks the next Bar's).
    ctx.bossBars = ctx.boss ? {
      count: Number(sys.boss.bars) || 0,
      barHp: Number(sys.boss.barHp) || 0,
      partySize: this.#partySize()
    } : null;

    // Derived statblock — the printed numbers this build stores.
    const attack = this.actor.items.filter((i) => i.type === "weapon").sort(bySort)[0] ?? null;
    const line = this.#line();
    ctx.stat = ctx.framed ? {
      hb: sys.hp.max,
      eb: sys.energy.base ?? sys.energy.max,
      guard: sys.guard.value,
      movement: sys.movement.value,
      damage: attack ? (Number(attack.system.damage?.value) || 0) : (line?.damage ?? 1),
      threshold: attack ? (Number(attack.system.threshold) || 0) : (line?.threshold ?? 10)
    } : null;
    ctx.attrDice = cfg.attributeKeys.map((k) => ({
      key: k,
      label: L(cfg.attributeAbbr[k]),
      die: `d${sys.attributes[k]?.base ?? 4}`
    }));

    // Attribute assignment — one die select per Attribute, audited against the budget chips.
    const budget = this.#attrBudget();
    ctx.attributes = cfg.attributeKeys.map((k) => ({
      key: k,
      label: L(cfg.attributes[k]),
      icon: cfg.attributeIcons?.[k] ?? "",
      base: sys.attributes[k]?.base ?? 4,
      options: [4, 6, 8, 10, 12].map((d) => ({ value: d, label: `d${d}`, selected: (sys.attributes[k]?.base ?? 4) === d }))
    }));
    if (budget) {
      const need = {};
      for (const d of budget) need[d] = (need[d] ?? 0) + 1;
      const used = {};
      for (const k of cfg.attributeKeys) {
        const d = sys.attributes[k]?.base ?? 4;
        used[d] = (used[d] ?? 0) + 1;
      }
      ctx.attrBudget = Object.keys(need).map(Number).sort((a, b) => b - a).map((d) => ({
        die: `d${d}`, need: need[d], used: used[d] ?? 0, ok: (used[d] ?? 0) === need[d]
      }));
      // Off-budget when the assigned multiset differs from the printed one in any way.
      ctx.attrBudgetOff = Object.keys({ ...need, ...used }).some((d) => (need[d] ?? 0) !== (used[d] ?? 0));
    } else {
      ctx.attrBudget = null;
      ctx.attrBudgetOff = false;
    }

    // Embedded Talents (`system.talents`) — inline-editable rows (name · die · primary Attribute).
    const talents = actorTalents(this.actor);
    ctx.talents = talents.map((t) => ({
      id: t.id,
      name: t.name,
      die: t.die,
      dieOptions: [4, 6, 8, 10, 12].map((d) => ({ value: d, label: `d${d}`, selected: t.die === d })),
      attrOptions: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: t.attribute === k }))
    }));
    ctx.talentCount = talents.length;
    // The printed loadouts ("1 × d8" / "2 × d6") + one quick-add button per distinct die.
    const options = this.#talentOptions();
    ctx.talentBudget = options.map((set) => {
      const per = {};
      for (const d of set) per[d] = (per[d] ?? 0) + 1;
      return Object.keys(per).map((d) => `${per[d]} × d${d}`).join(" + ");
    });
    const addDice = [...new Set(options.flat())].sort((a, b) => b - a);
    ctx.talentAdds = (addDice.length ? addDice : [6]).map((d) => ({
      die: d,
      label: addDice.length
        ? game.i18n.format("PROJECTANIME.MonsterCreator.addTalentDie", { die: d })
        : L("PROJECTANIME.MonsterCreator.addTalent")
    }));

    // Basic Attacks — weapon items (the Natural Attack included). Each row exposes the two
    // accuracy Attributes (the same Attribute may be chosen twice) and the Talent link that
    // replaces one die and adds the Trained Edge.
    ctx.attacks = this.actor.items
      .filter((i) => i.type === "weapon")
      .sort(bySort)
      .map((i) => {
        const acc = i.system.accuracy ?? {};
        return {
          id: i.id,
          name: i.name,
          img: i.img,
          natural: !!i.getFlag("project-anime", "natural"),
          damage: Number(i.system.damage?.value) || 0,
          threshold: Number(i.system.threshold) || 0,
          attrA: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: acc.attrA === k })),
          attrB: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: acc.attrB === k })),
          talentOptions: talents.map((t) => ({ value: t.id, label: t.name, selected: i.system.talentId === t.id }))
        };
      });
    ctx.attackCount = ctx.attacks.length;

    // Techniques — built with the Skill Builder or picked from the Skill Browser. The Type sets
    // the suggested count; a Support wants at least one Heal or Empower (soft note only).
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        cost: i.system.actionType === "passive" ? L("PROJECTANIME.Skill.passive") : `${i.system.energyCost ?? 0} EP`,
        actionLabel: L(cfg.actionTypes[i.system.actionType] ?? "")
      }));
    ctx.skillCount = ctx.skills.length;
    // A Boss budgets two Techniques per Bar (total shown; a break unlocks the next Bar's).
    ctx.techBudget = ctx.boss
      ? String(PROJECTANIME.boss.techniquesPerBar * (Number(sys.boss.bars) || 1))
      : (TECHNIQUE_BUDGET[sys.npcType] ?? "");
    ctx.supportNote = sys.npcType === "support" && !ctx.boss
      && !this.actor.items.some((i) => i.type === "skill"
        && (["mend", "bolster"].includes(i.system.effect) || ["mend", "bolster"].includes(i.system.secondaryEffect)));

    // Review (last step) — a compact summary badge (Type + Rival/Boss + Threat; a Companion
    // has no Threat, so its chip is skipped).
    const typeCfg = this.#type();
    ctx.reviewBadge = ctx.framed ? {
      label: typeCfg ? L(typeCfg.label) : "",
      icon: typeCfg?.icon ?? "",
      color: ctx.boss ? "#9c4f6c" : ctx.rival ? "#c08a3e" : (typeCfg?.color ?? "var(--pa-line)"),
      rival: ctx.rival,
      boss: ctx.boss,
      threat: ctx.boss ? formatThreat(bossThreat(this.#partySize()))
        : ctx.rival ? formatThreat(cfg.rivalThreat)
        : Number.isFinite(typeCfg?.threat) ? formatThreat(typeCfg.threat) : ""
    } : null;

    return ctx;
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes by joining the document app registry. All inline
   *  row controls are intentionally UNNAMED so the actor form #sync never reads them; each
   *  commits straight to its document on change. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.actor.apps[this.id] = this;
    // Attribute die selects (Attributes step).
    for (const sel of this.element.querySelectorAll(".mc-attr-select")) {
      sel.addEventListener("change", (ev) => this.#commitAttribute(ev.currentTarget));
    }
    // Basic Attack rows: inline rename + accuracy Attribute / Talent-link selects.
    for (const input of this.element.querySelectorAll(".cc-attack-name")) {
      input.addEventListener("change", (ev) => this.#commitAttackName(ev.currentTarget));
    }
    for (const sel of this.element.querySelectorAll(".mc-attack-sel")) {
      sel.addEventListener("change", (ev) => this.#commitAttackField(ev.currentTarget));
    }
    // Talent rows: inline rename + die / primary-Attribute selects.
    for (const el of this.element.querySelectorAll(".mc-talent-name, .mc-talent-sel")) {
      el.addEventListener("change", (ev) => this.#commitTalentField(ev.currentTarget));
    }
    // Boss party-size override → recompute the Bars.
    for (const input of this.element.querySelectorAll(".mc-party-size")) {
      input.addEventListener("change", (ev) => this.#commitPartySize(ev.currentTarget));
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
    this.render();
  }

  static async #onStepBack() {
    await this.#sync();
    if (this.#step > 0) this.#step -= 1;
    this.render();
  }

  static async #onGotoStep(event, target) {
    await this.#sync();
    const i = Number(target.dataset.step);
    if (i >= 0 && i < STEPS.length) this.#step = i;
    this.render();
  }

  /** Block leaving the Type step until a Type is chosen (a Rival or Boss counts as framed). */
  #validateStep() {
    if (STEPS[this.#step] === "type" && !this.#framed()) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.pickTypeFirst"));
      return false;
    }
    return true;
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
  /*  Type (stat line · Rival · Boss)             */
  /* -------------------------------------------- */

  /** Pick a Type: stamp its key, then write the printed line + seed the Attribute dice.
   *  Companion also wires the ally side of it: friendly disposition, linked token, and — when
   *  the actor isn't filed anywhere yet — a home in the Servants & Companions folder (that
   *  filing is what puts a hand-built companion on the party sheet's Companions strip). */
  static async #onPickType(event, target) {
    const key = target.closest("[data-type]")?.dataset.type;
    if (!typeLine(key)) return;
    const update = { "system.npcType": key };
    if (key === "companion") {
      update["system.disposition"] = "friendly";
      update["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      update["prototypeToken.actorLink"] = true;
      if (!this.actor.folder) {
        const folder = await ensureServantFolder();
        if (folder) update.folder = folder.id;
      }
    }
    await this.actor.update(update);
    await this.#applyLine({ seedAttrs: true });
    this.render();
  }

  /** Toggle the Rival designation (a recurring villain built as a full PC; Threat 2). */
  static async #onToggleRival() {
    await this.actor.update({ "system.rival": !this.actor.system.rival });
    this.render();
  }

  /** Toggle the Boss flag — a Boss starts from an Elite and swaps its hit boxes for Bars.
   *  Enabling sets the Type to Elite and applies the Boss line; disabling restores the Type's. */
  static async #onToggleBoss() {
    const on = !this.actor.system.boss?.enabled;
    const update = { "system.boss.enabled": on };
    if (on && this.actor.system.npcType !== "elite") update["system.npcType"] = "elite";
    await this.actor.update(update);
    await this.#applyLine({ seedAttrs: true });
    this.render();
  }

  /**
   * Write the printed stat line onto the actor: HB / EB, Guard as a bonus over the base 6,
   * Movement as a bonus over the unarmored 6, the attack Damage + Threshold onto every owned
   * weapon and (optionally) the Attribute dice seeded largest-first. For a Boss, hit boxes
   * become Bars (count from the party size; the token bar shows ONE Bar) and Energy is 6 per Bar.
   */
  async #applyLine({ seedAttrs = false } = {}) {
    const line = this.#line();
    if (!line) return;
    const update = {
      "system.guard.bonus": (Number(line.guard) || 0) - PROJECTANIME.baseGuard,
      "system.movement.bonus": (Number(line.movement) || 0) - PROJECTANIME.armorStyles.unarmored.movement
    };
    if (this.#isBoss()) {
      const size = this.#partySize();
      const bars = bossBarCount(size);
      const barHp = bossBarHp(size);
      update["system.boss.bars"] = bars;
      update["system.boss.barHp"] = barHp;
      update["system.boss.remaining"] = bars;
      update["system.boss.broken"] = 0;
      update["system.hp.max"] = barHp;
      update["system.hp.value"] = barHp;
      update["system.energy.max"] = PROJECTANIME.boss.energyPerBar;
      update["system.energy.value"] = PROJECTANIME.boss.energyPerBar;
    } else {
      update["system.hp.max"] = line.hb;
      update["system.hp.value"] = line.hb;
      update["system.energy.max"] = line.eb;
      update["system.energy.value"] = line.eb;
    }
    if (seedAttrs) {
      const dice = [...(this.#attrBudget() ?? [])].sort((a, b) => b - a);
      PROJECTANIME.attributeKeys.forEach((k, i) => {
        update[`system.attributes.${k}.base`] = dice[i] ?? 4;
      });
    }
    await this.actor.update(update);
    await this.#stampAttacks();
  }

  /** Stamp the printed Damage + Threshold onto every owned weapon (the Basic Attacks). */
  async #stampAttacks() {
    const line = this.#line();
    if (!line) return;
    const updates = this.actor.items
      .filter((i) => i.type === "weapon")
      .filter((i) => (Number(i.system.damage?.value) || 0) !== line.damage || (Number(i.system.threshold) || 0) !== line.threshold)
      .map((i) => ({ _id: i.id, "system.damage.value": line.damage, "system.threshold": line.threshold }));
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /** Commit the Boss party-size override and recompute the Bars from it. */
  async #commitPartySize(input) {
    const n = Math.max(1, Number(input.value) || 0);
    this.#partySizeOverride = n === livePartySize() ? null : n;
    if (this.#isBoss()) await this.#applyLine();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Attributes                                  */
  /* -------------------------------------------- */

  /** Commit one Attribute's assigned die (Attributes step select). */
  async #commitAttribute(select) {
    const key = select.closest("[data-attribute]")?.dataset.attribute;
    if (!PROJECTANIME.attributeKeys.includes(key)) return;
    const die = Number(select.value) || 4;
    await this.actor.update({ [`system.attributes.${key}.base`]: die });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Basic Attacks                               */
  /* -------------------------------------------- */

  /** Add a Basic Attack: an equipped weapon carrying the Type's printed Damage + Threshold.
   *  Strikes with it roll through rollAttack and never spend Energy. Weighs nothing (size 0);
   *  rename it inline and fine-tune it on its item sheet. */
  static async #onAddAttack() {
    const line = this.#line();
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("PROJECTANIME.MonsterCreator.basicAttackName"),
      type: "weapon",
      img: NATURAL_WEAPON_IMG,
      system: {
        accuracy: { attrA: "might", attrB: "agility", mod: 0 },
        damage: { value: line?.damage ?? 1 },
        threshold: line?.threshold ?? 10,
        range: { type: "melee", tiles: 1 },
        size: 0,
        equipped: true,
        hand: "main",
        grip: "one"
      }
    }]);
    this.render();
  }

  /** Open a Basic Attack's item sheet for full tuning (range, grip, size…). */
  static #onEditAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  /** Delete a Basic Attack (the innate Natural Attack is protected). */
  static async #onRemoveAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "weapon" || item.getFlag("project-anime", "natural")) return;
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

  /** Commit an attack row's accuracy Attribute (attrA / attrB) or Talent link (talentId). */
  async #commitAttackField(select) {
    const id = select.closest("[data-attack-id]")?.dataset.attackId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "weapon") return;
    const field = select.dataset.field;
    if (field === "talent") return item.update({ "system.talentId": select.value });
    if (field === "attrA" || field === "attrB") {
      if (!PROJECTANIME.attributeKeys.includes(select.value)) return;
      return item.update({ [`system.accuracy.${field}`]: select.value });
    }
  }

  /* -------------------------------------------- */
  /*  Talents                                     */
  /* -------------------------------------------- */

  /** Add a Talent at the clicked die size (the printed loadout; the GM may add more). */
  static async #onAddTalent(event, target) {
    const die = Number(target.dataset.die) || 6;
    await this.actor.update({
      [`system.talents.${foundry.utils.randomID()}`]: {
        name: game.i18n.localize("PROJECTANIME.MonsterCreator.talentName"),
        die,
        attribute: "might"
      }
    });
    this.render();
  }

  /** Delete a Talent (creation is a sandbox — undo is free). Clears any attack link to it. */
  static async #onRemoveTalent(event, target) {
    const id = target.closest("[data-talent-id]")?.dataset.talentId;
    if (!this.actor.system.talents?.[id]) return;
    await this.actor.removeTalent(id);
    this.render();
  }

  /** Commit a Talent row's inline edit (name / die / primary Attribute). */
  async #commitTalentField(el) {
    const id = el.closest("[data-talent-id]")?.dataset.talentId;
    const talent = this.actor.system.talents?.[id];
    if (!talent) return;
    const field = el.dataset.field;
    if (field === "name") {
      const name = (el.value || "").trim() || game.i18n.localize("PROJECTANIME.MonsterCreator.talentName");
      if (name !== talent.name) return this.actor.update({ [`system.talents.${id}.name`]: name });
      return;
    }
    if (field === "die") return this.actor.update({ [`system.talents.${id}.die`]: Number(el.value) || 6 });
    if (field === "attribute" && PROJECTANIME.attributeKeys.includes(el.value)) {
      return this.actor.update({ [`system.talents.${id}.attribute`]: el.value });
    }
  }

  /* -------------------------------------------- */
  /*  Techniques (Browser + Skill Builder)        */
  /* -------------------------------------------- */

  /** Open the Skill Browser — an MMO-inventory-bag picker of every world/compendium Technique to
   *  hand to this enemy. It writes straight to the actor, so this creator refreshes live. */
  static #onBrowseSkills() {
    SkillBrowserApp.open(this.actor);
  }

  /** Open (or focus) the in-game Skill Builder, jumping straight into Build mode. */
  static #onOpenSkillBuilder() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }

  /** Delete a Technique (creation is a sandbox — undo is free). */
  static async #onRemoveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    if (item.getFlag("project-anime", "granted")) return;
    await item.delete();
    this.render();
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
