/**
 * Project: Anime — step-by-step Monster Creator (Tier × EXP enemies).
 *
 * A guided ApplicationV2 that builds an enemy the way the rules do (Enemies): pick a TIER
 * (Minion / Standard / Elite / Champion / Villain — see PROJECTANIME.enemyTiers), which sets the
 * EXP budget (base EXP + the party's earned XP), start from the shared base line (1 hit box,
 * 1 energy box, all Attributes at d4, Guard 6), build the Attacks off the Weapon Style table
 * (each click adds an attack carrying that Style's printed line — any number, the same Style
 * more than once), pick one Armor Style (+ an optional Shield), then SPEND EXP: Attribute steps, hit/energy
 * boxes, Talents, Techniques — and, for a Villain, Luck Die steps. Spends are DERIVED from the
 * built statblock (npcSpentExp), so the budget pill audits live and nothing needs a ledger.
 * A seventh tile, COMPANION (PROJECTANIME.companion), hand-builds a party ally the same way
 * (rules: Building a Companion): the same shared base line and Styles, 8 starting EXP on the
 * same buy list (no Luck steps), and one free Talent at d6 named at creation. It has no
 * Threat, goes friendly on pick, and files itself with the companions.
 *
 * A VILLAIN records three Luck Dice (base d6, stepped up with EXP) and may be built WITH GATES:
 * its purchased hit boxes divide across ⌈party ÷ 2⌉ Gates (no hit-box cap while gated), energy
 * stays one pool, it acts twice per Enemy Phase, and each Gate budgets two Techniques (a break
 * unlocks the next Gate's — Techniques carry a `gate` flag the roll path enforces).
 *
 * Like the Character Creator it operates on the LIVE actor and registers in `actor.apps`, so
 * changes refresh it live; it sets the same `flags.project-anime.creationComplete` on finish.
 * Reuses the Character Creator's `.cc-*` stylesheet via the shared `character-creator` class.
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { SkillBrowserApp } from "./skill-browser.mjs";
import { PROJECTANIME, gateCount, actorTalents, npcTotalExp, npcSpentExp, styleTooltipHTML, physicalRangeLabel } from "../helpers/config.mjs";
import { formatThreat } from "../helpers/encounter.mjs";
import { partyMembers, partyActors } from "../helpers/party-folder.mjs";
import { ensureServantFolder } from "../helpers/servants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Creation steps, in order (rules: pick a Tier → pick the Styles → spend EXP on Attributes and
 *  boxes → Talents → Techniques), book-ended by Concept and Review. */
const STEPS = ["concept", "tier", "styles", "attributes", "talents", "techniques", "finish"];

/** Default icons for the stamped Style gear. */
const ARMOR_IMG = "icons/svg/shield.svg";

/** Talent die sizes purchasable with EXP (a Talent enters at d6; steps go up from there). */
const TALENT_DICE = [6, 8, 10, 12];

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

/** Divide a Villain's total hit boxes across its Gates — as evenly as the rules allow, the
 *  remainder marking up the earliest Gates ("Divide the Villain's total hit boxes across its
 *  Gates"). SUM-PRESERVING: with fewer boxes than Gates the count shrinks instead of minting
 *  boxes that were never bought, so every Gate still holds at least 1 box. */
export function distributeGates(total, count) {
  const t = Math.max(1, Number(total) || 0);
  const n = Math.max(1, Math.min(Number(count) || 1, t));
  const base = Math.floor(t / n);
  const rem = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** An enemy Tier's line as rich tooltip HTML — the same `.pa-tooltip` card the Style pickers
 *  use (glyph head, labeled stat rows): Threat + Base EXP (a Companion has no Threat — just
 *  its starting EXP). */
function tierTooltipHTML(key, t) {
  const L = (k) => game.i18n.localize(k);
  const row = (icon, label, value) =>
    `<div class="pa-tt-row"><span class="k"><i class="fa-solid ${icon}"></i> ${label}</span><span class="v">${value}</span></div>`;
  const rows = key === "companion"
    ? [row("fa-coins", L("PROJECTANIME.Exp.base"), t.startingExp)]
    : [
      row("fa-skull", L("PROJECTANIME.Threat.label"),
        t.threat != null ? formatThreat(t.threat) : L("PROJECTANIME.Threat.fullBudget")),
      row("fa-coins", L("PROJECTANIME.Exp.base"), t.baseExp)
    ];
  return `<div class="pa-tt-head"><span class="pa-tt-img pa-tt-glyph" style="--tier-color: ${t.color}"><i class="${t.icon}"></i></span>`
    + `<div class="pa-tt-heads"><div class="pa-tt-title">${L(t.label)}</div>`
    + `<div class="pa-tt-type">${L("PROJECTANIME.MonsterCreator.step.tier")}</div></div></div>`
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

/** The party's earned XP, read off the roster: the most advancements any member Character has
 *  EARNED (unspent + every ledger spend) — the party earns milestones together, so one member's
 *  earned total is the party's. 0 with no roster. */
function rosterPartyXp() {
  let best = 0;
  const seen = new Set();
  for (const p of partyActors()) {
    for (const m of partyMembers(p)) {
      if (m?.type !== "character" || seen.has(m.id)) continue;
      seen.add(m.id);
      const adv = m.system?.advancement ?? {};
      const earned = (Number(adv.value) || 0)
        + (adv.log ?? []).reduce((n, e) => n + (Number(e.amount) || 1), 0);
      best = Math.max(best, earned);
    }
  }
  return best;
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
      pickTier: MonsterCreatorApp.#onPickTier,
      pullPartyXp: MonsterCreatorApp.#onPullPartyXp,
      rollLuck: MonsterCreatorApp.#onRollLuck,
      toggleGates: MonsterCreatorApp.#onToggleGates,
      addStyleAttack: MonsterCreatorApp.#onAddStyleAttack,
      pickArmorStyle: MonsterCreatorApp.#onPickArmorStyle,
      pickShieldStyle: MonsterCreatorApp.#onPickShieldStyle,
      boxPlus: MonsterCreatorApp.#onBoxPlus,
      boxMinus: MonsterCreatorApp.#onBoxMinus,
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

  /** Manual party-size override for the Villain Gates (null = read the live roster). */
  #partySizeOverride = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.MonsterCreator.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Tier helpers                                */
  /* -------------------------------------------- */

  /** The selected Tier's config entry (or the Companion line), or null while unset. */
  #tier() {
    const key = this.actor.system.npcType;
    if (!key) return null;
    return key === "companion" ? PROJECTANIME.companion : (PROJECTANIME.enemyTiers[key] ?? null);
  }

  #isCompanion() {
    return this.actor.system.npcType === "companion";
  }

  #isVillain() {
    return this.actor.system.npcType === "villain";
  }

  /** A Tier chosen — the minimum for a statblock. */
  #framed() {
    return !!this.#tier();
  }

  /** The party size driving the Villain Gates + Threat readouts (manual override, else live). */
  #partySize() {
    return this.#partySizeOverride ?? livePartySize();
  }

  /** Gates on (Villain only, with a laid-out hb array). */
  #gatesOn() {
    const g = this.actor.system.gates;
    return this.#isVillain() && !!g?.enabled && (g.hb?.length ?? 0) > 0;
  }

  /** The purchased hit-box TOTAL — across all Gates when gated, else the authored max. */
  #hbTotal() {
    if (this.#gatesOn()) return this.actor.system.gates.hb.reduce((n, v) => n + (Number(v) || 0), 0);
    return Number(this.actor._source.system.hp.max) || 1;
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
    ctx.onTier = stepKey === "tier";
    ctx.onStyles = stepKey === "styles";
    ctx.onAttributes = stepKey === "attributes";
    ctx.onTalents = stepKey === "talents";
    ctx.onTechniques = stepKey === "techniques";
    ctx.onFinish = stepKey === "finish";

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.disposition = sys.disposition ?? "hostile";

    // Tier tiles — glyph + name on the face; Threat + Base EXP in the hover tooltip. Companion
    // rides along as a seventh tile: the party-ally stat line, not an enemy Tier.
    ctx.npcType = sys.npcType ?? "";
    ctx.framed = this.#framed();
    ctx.isCompanion = this.#isCompanion();
    ctx.isVillain = this.#isVillain();
    ctx.tiers = [...cfg.enemyTierKeys, "companion"].map((k) => {
      const t = k === "companion" ? cfg.companion : cfg.enemyTiers[k];
      return {
        key: k, label: L(t.label), icon: t.icon, color: t.color,
        tooltip: tierTooltipHTML(k, t),
        selected: sys.npcType === k
      };
    });

    // The EXP budget pill — total (base + party XP; a Companion budgets its 8 starting EXP),
    // spent (derived off the build), remaining. Advisory: chips turn "over" but nothing blocks
    // an over-budget build.
    const spend = ctx.framed ? npcSpentExp(this.actor) : null;
    ctx.exp = spend ? {
      total: npcTotalExp(this.actor),
      spent: spend.total,
      remaining: npcTotalExp(this.actor) - spend.total,
      over: spend.total > npcTotalExp(this.actor),
      parts: spend
    } : null;
    ctx.partyXp = Number(sys.exp?.party) || 0;
    ctx.rosterXp = rosterPartyXp();
    ctx.partySize = this.#partySize();

    // Villain frame (tier step): the Luck Die (base d6, stepped with EXP — 2 per step) + the
    // recorded Luck Dice, and the Gates toggle with the live layout readout.
    if (ctx.isVillain) {
      const luckDie = Number(sys.luckDie) || 6;
      ctx.villainLuck = {
        die: luckDie,
        dieOptions: [6, 8, 10, 12].map((d) => ({ value: d, label: `d${d}`, selected: luckDie === d })),
        dice: sys.luckDice ?? [],
        formula: `${PROJECTANIME.villain.luckDiceCount}d${luckDie}`
      };
      const gatesOn = this.#gatesOn();
      ctx.gates = {
        enabled: gatesOn,
        count: gatesOn ? sys.gates.hb.length : gateCount(this.#partySize()),
        dist: gatesOn ? sys.gates.hb.join(" / ") : "",
        techniquesPerGate: PROJECTANIME.villain.techniquesPerGate
      };
    }

    // Styles (rules: The Stat Block) — the Weapon Style cards ADD attacks (one click = one
    // attack carrying that Style's printed line; the same Style may be taken more than once),
    // one Armor Style (Guard bonus/Movement), an optional Shield. Cards match the Character
    // Creator's; a weapon card wears a count badge instead of a single check.
    if (ctx.onStyles) {
      const styleCards = (keys, table, kindKey, selected) => keys.map((k) => {
        const st = table[k];
        return {
          key: k, label: L(st.label), icon: st.icon,
          tooltip: styleTooltipHTML(st, kindKey),
          selected: k === selected
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
      const weapons = this.actor.items.filter((i) => i.type === "weapon");
      ctx.weaponStyles = cfg.weaponStyleKeys.map((k) => {
        const st = cfg.weaponStyles[k];
        return {
          key: k, label: L(st.label), icon: st.icon,
          tooltip: styleTooltipHTML(st, "PROJECTANIME.Style.weapon"),
          count: weapons.filter((i) => i.system.style === k).length
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
      ctx.armorStyles = styleCards(cfg.armorStyleKeys, cfg.armorStyles, "PROJECTANIME.Style.armor", sys.armorStyle);
      ctx.shieldStyles = styleCards(cfg.shieldStyleKeys, cfg.shieldStyles, "PROJECTANIME.Style.shield", sys.shieldStyle);
      ctx.noShield = !sys.shieldStyle;
    }

    // Derived statblock — the numbers this build stores (shared partial; Tier + Review steps).
    this.#statblockContext(ctx, cfg, sys, L);

    // Attribute spending — one die select per Attribute; every step over d4 costs 1 EXP.
    ctx.attributes = cfg.attributeKeys.map((k) => ({
      key: k,
      label: L(cfg.attributes[k]),
      icon: cfg.attributeIcons?.[k] ?? "",
      base: sys.attributes[k]?.base ?? 4,
      options: [4, 6, 8, 10, 12].map((d) => ({ value: d, label: `d${d}`, selected: (sys.attributes[k]?.base ?? 4) === d }))
    }));

    // Hit / Energy boxes (1 EXP each). A gated Villain's hit boxes have no cap; everyone else
    // stops at 10. Energy is always one shared pool.
    ctx.boxes = {
      hb: this.#hbTotal(),
      hbAtCap: !this.#gatesOn() && this.#hbTotal() >= (PROJECTANIME.expOptions.hitBox.cap ?? 10),
      eb: Number(this.actor._source.system.energy.max) || 0,
      ebAtCap: (Number(this.actor._source.system.energy.max) || 0) >= (PROJECTANIME.expOptions.energy.cap ?? 10)
    };

    // Embedded Talents (`system.talents`) — inline-editable rows (name · die · primary Attribute).
    // A Talent enters at d6 (2 EXP); each die step above costs 1 more.
    const talents = actorTalents(this.actor);
    ctx.talents = talents.map((t) => ({
      id: t.id,
      name: t.name,
      die: t.die,
      dieOptions: TALENT_DICE.map((d) => ({ value: d, label: `d${d}`, selected: t.die === d })),
      attrOptions: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: t.attribute === k }))
    }));
    ctx.talentCount = talents.length;

    // Attacks — weapon items, each carrying its own Weapon Style's printed line. Each row
    // exposes the two accuracy Attributes (the same Attribute may be chosen twice) and the
    // Talent link that replaces one die and adds the Trained Edge.
    ctx.attacks = this.actor.items
      .filter((i) => i.type === "weapon")
      .sort(bySort)
      .map((i) => {
        const acc = i.system.accuracy ?? {};
        const st = cfg.weaponStyles[i.system.style];
        return {
          id: i.id,
          name: i.name,
          img: i.img,
          styleLabel: st ? L(st.label) : "",
          range: physicalRangeLabel(i.system.range ?? {}),
          damage: Number(i.system.damage?.value) || 0,
          threshold: Number(i.system.threshold) || 0,
          attrA: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: acc.attrA === k })),
          attrB: cfg.attributeKeys.map((k) => ({ value: k, label: L(cfg.attributes[k]), selected: acc.attrB === k })),
          talentOptions: talents.map((t) => ({ value: t.id, label: t.name, selected: i.system.talentId === t.id }))
        };
      });
    ctx.attackCount = ctx.attacks.length;

    // Techniques — built with the Skill Builder or picked from the Skill Browser (2 EXP each).
    // A gated Villain budgets two per Gate; rows carry a Gate select the roll path enforces.
    const gatesOn = this.#gatesOn();
    const gateOptions = gatesOn ? Array.fromRange(this.actor.system.gates.hb.length).map((i) => i + 1) : [];
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => {
        const gate = Number(i.getFlag("project-anime", "gate")) || 0;
        return {
          id: i.id,
          name: i.name,
          img: i.img,
          cost: i.system.actionType === "passive" ? L("PROJECTANIME.Skill.passive") : `${i.system.energyCost ?? 0} EP`,
          actionLabel: L(cfg.actionTypes[i.system.actionType] ?? ""),
          gateOptions: gatesOn ? [
            { value: "", label: "—", selected: !gate },
            ...gateOptions.map((g) => ({ value: g, label: game.i18n.format("PROJECTANIME.Gate.nth", { n: g }), selected: gate === g }))
          ] : null
        };
      });
    ctx.skillCount = ctx.skills.length;
    ctx.techBudget = gatesOn
      ? String(PROJECTANIME.villain.techniquesPerGate * this.actor.system.gates.hb.length)
      : "";
    ctx.gatesOn = gatesOn;

    // Review (last step) — a compact summary badge (Tier + Threat + EXP).
    const tierCfg = this.#tier();
    ctx.reviewBadge = ctx.framed ? {
      label: L(tierCfg.label),
      icon: tierCfg.icon ?? "",
      color: tierCfg.color ?? "var(--pa-line)",
      threat: ctx.isCompanion ? ""
        : ctx.isVillain ? L("PROJECTANIME.Threat.fullBudget")
        : formatThreat(tierCfg.threat ?? 1)
    } : null;

    return ctx;
  }

  /** The shared statblock readout (monster-statblock.hbs): the new printed format — HB / EB /
   *  Guard / Movement, every Attack's line (Damage · Threshold · Range), the Attribute dice,
   *  Talents with die sizes, Techniques, and the Villain extras (Gates layout + Luck Dice). */
  #statblockContext(ctx, cfg, sys, L) {
    if (!ctx.framed) { ctx.stat = null; return; }
    const gatesOn = this.#gatesOn();
    ctx.stat = {
      hb: gatesOn ? this.#hbTotal() : sys.hp.max,
      gateDist: gatesOn ? sys.gates.hb.join(" / ") : null,
      eb: sys.energy.base ?? sys.energy.max,
      guard: sys.guard.value,
      movement: sys.movement.value
    };
    ctx.attackLines = this.actor.items
      .filter((i) => i.type === "weapon")
      .sort(bySort)
      .map((i) => ({
        label: i.name,
        damage: Number(i.system.damage?.value) || 0,
        threshold: Number(i.system.threshold) || 0,
        range: physicalRangeLabel(i.system.range ?? {})
      }));
    const as = cfg.armorStyles[sys.armorStyle];
    const ss = cfg.shieldStyles[sys.shieldStyle];
    ctx.armorLine = as ? L(as.label) : "";
    ctx.shieldLine = ss ? L(ss.label) : "";
    ctx.attrDice = cfg.attributeKeys.map((k) => ({
      key: k,
      label: L(cfg.attributeAbbr[k]),
      die: `d${sys.attributes[k]?.base ?? 4}`
    }));
    ctx.statTalents = actorTalents(this.actor).map((t) => ({ name: t.name, die: `d${t.die}` }));
    ctx.statTechniques = this.actor.items.filter((i) => i.type === "skill").sort(bySort).map((i) => i.name);
    ctx.statLuck = this.#isVillain() ? {
      die: `d${Number(sys.luckDie) || 6}`,
      dice: sys.luckDice ?? []
    } : null;
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
    // Attack rows: inline rename + accuracy Attribute / Talent-link selects.
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
    // Party XP (the enemy's EXP boost) + party size (the Villain's Gate count).
    for (const input of this.element.querySelectorAll(".mc-party-xp")) {
      input.addEventListener("change", (ev) => this.#commitPartyXp(ev.currentTarget));
    }
    for (const input of this.element.querySelectorAll(".mc-party-size")) {
      input.addEventListener("change", (ev) => this.#commitPartySize(ev.currentTarget));
    }
    // Villain Luck Die size select.
    for (const sel of this.element.querySelectorAll(".mc-luck-die")) {
      sel.addEventListener("change", (ev) => this.#commitLuckDie(ev.currentTarget));
    }
    // Technique Gate assignment selects (gated Villains).
    for (const sel of this.element.querySelectorAll(".mc-skill-gate")) {
      sel.addEventListener("change", (ev) => this.#commitSkillGate(ev.currentTarget));
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

  /** Block leaving the Tier step until a Tier is chosen. */
  #validateStep() {
    if (STEPS[this.#step] === "tier" && !this.#framed()) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.pickTierFirst"));
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
  /*  Tier (EXP budget · Villain frame)           */
  /* -------------------------------------------- */

  /** Pick a Tier: stamp its key. The FIRST framing (no Tier yet) also seeds the shared base
   *  statblock — 1 hit box, 1 energy box, all Attributes d4, no Guard/Movement offsets (rules:
   *  The Stat Block). Re-picking a Tier later only moves the EXP budget: the build stands, the
   *  Companion tile included — a Companion is built like an enemy on the very same base line
   *  (rules: Building a Companion), so switching between them just rewires the ally side. */
  static async #onPickTier(event, target) {
    const key = target.closest("[data-tier]")?.dataset.tier;
    const isTier = !!PROJECTANIME.enemyTiers[key];
    if (!isTier && key !== "companion") return;
    const prev = this.actor.system.npcType || "";
    const update = { "system.npcType": key };

    // Leaving the Villain tier — whatever the destination tile — folds any Gates back into one
    // pool (capped at 10 without them): remaining = the current Gate's value + every unbroken
    // later Gate (broken Gates lost their excess on the break, so they contribute nothing).
    if (prev === "villain" && key !== "villain" && this.actor.system.gates?.enabled) {
      const g = this.actor.system.gates;
      const total = Math.clamp(this.#hbTotal(), 1, PROJECTANIME.maxBoxes);
      const later = (g.hb ?? []).slice((Number(g.broken) || 0) + 1).reduce((n, v) => n + (Number(v) || 0), 0);
      update["system.gates.enabled"] = false;
      update["system.gates.hb"] = [];
      update["system.gates.broken"] = 0;
      update["system.hp.max"] = total;
      update["system.hp.value"] = Math.min((Number(this.actor.system.hp.value) || 0) + later, total);
    }

    if (key === "companion") {
      // The ally side of the Companion tile: friendly disposition, linked token, and — when
      // the actor isn't filed anywhere yet — a home with the companions. The free creation
      // Talent arrives at d6 (rules: Companion Talents) if the build holds none yet.
      update["system.disposition"] = "friendly";
      update["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      update["prototypeToken.actorLink"] = true;
      if (!prev) {
        update["system.hp.max"] = PROJECTANIME.enemyBase.hitBoxes;
        update["system.hp.value"] = PROJECTANIME.enemyBase.hitBoxes;
        update["system.energy.max"] = PROJECTANIME.enemyBase.energyBoxes;
        update["system.energy.value"] = PROJECTANIME.enemyBase.energyBoxes;
        update["system.guard.bonus"] = 0;
        update["system.movement.bonus"] = 0;
        PROJECTANIME.attributeKeys.forEach((k) => { update[`system.attributes.${k}.base`] = PROJECTANIME.enemyBase.attrDie; });
      }
      if (!actorTalents(this.actor).length) {
        update[`system.talents.${foundry.utils.randomID()}`] = {
          name: game.i18n.localize("PROJECTANIME.MonsterCreator.talentName"),
          die: PROJECTANIME.companion.talentDie,
          attribute: "might"
        };
      }
      if (!this.actor.folder) {
        const folder = await ensureServantFolder();
        if (folder) update.folder = folder.id;
      }
      await this.actor.update(update);
      return this.render();
    }

    // Enemy Tier. Seed the base line only on the FIRST framing — a Companion build shares the
    // same base, so it carries over. Coming off the Companion tile reverts the ally wiring
    // (disposition, token link, companions folder).
    if (!prev) {
      update["system.hp.max"] = PROJECTANIME.enemyBase.hitBoxes;
      update["system.hp.value"] = PROJECTANIME.enemyBase.hitBoxes;
      update["system.energy.max"] = PROJECTANIME.enemyBase.energyBoxes;
      update["system.energy.value"] = PROJECTANIME.enemyBase.energyBoxes;
      update["system.guard.bonus"] = 0;
      update["system.movement.bonus"] = 0;
      PROJECTANIME.attributeKeys.forEach((k) => { update[`system.attributes.${k}.base`] = PROJECTANIME.enemyBase.attrDie; });
    }
    if (prev === "companion") {
      update["system.disposition"] = "hostile";
      update["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.HOSTILE;
      update["prototypeToken.actorLink"] = false;
      // Only clear the auto-assigned companions home — never a GM-chosen folder.
      if (/companion/i.test(this.actor.folder?.name ?? "")) update.folder = null;
    }
    await this.actor.update(update);
    this.render();
  }

  /** Pull the party's earned XP off the live roster into `system.exp.party`. */
  static async #onPullPartyXp() {
    await this.actor.update({ "system.exp.party": rosterPartyXp() });
    this.render();
  }

  /** Commit a typed Party XP (the EXP the build adds to its Tier's base). */
  async #commitPartyXp(input) {
    const n = Math.max(0, Math.round(Number(input.value) || 0));
    await this.actor.update({ "system.exp.party": n });
    this.render();
  }

  /** Commit the party-size override — a gated Villain re-lays its Gates over the new count
   *  (Technique Gate flags re-clamp so nothing strands past the last Gate). */
  async #commitPartySize(input) {
    const n = Math.max(1, Number(input.value) || 0);
    this.#partySizeOverride = n === livePartySize() ? null : n;
    if (this.#gatesOn()) {
      const hb = distributeGates(this.#hbTotal(), gateCount(n));
      await this.actor.update({
        "system.gates.hb": hb,
        "system.gates.broken": 0,
        "system.hp.value": hb[0]
      });
      await this.#assignSkillGates(hb.length);
    }
    this.render();
  }

  /** Commit the Villain's Luck Die size (base d6; each step up costs 2 EXP, cap d12). */
  async #commitLuckDie(select) {
    const die = Number(select.value) || 6;
    if (![6, 8, 10, 12].includes(die)) return;
    await this.actor.update({ "system.luckDie": die });
    this.render();
  }

  /** Roll the Villain's three Luck Dice and record the results (rules: Villains — the same
   *  rules as a Player Character). */
  static async #onRollLuck() {
    if (!this.#isVillain()) return;
    const die = Number(this.actor.system.luckDie) || 6;
    const roll = await new Roll(`${PROJECTANIME.villain.luckDiceCount}d${die}`).evaluate();
    await this.actor.update({ "system.luckDice": roll.dice[0].results.map((r) => r.result) });
    this.render();
  }

  /** Toggle the Villain's Gates: ON divides the purchased hit boxes across ⌈party ÷ 2⌉ Gates
   *  (and chunk-assigns unflagged Techniques, two per Gate); OFF folds them back into one pool
   *  (re-capped at 10 — the no-cap allowance is a Gates privilege). */
  static async #onToggleGates() {
    if (!this.#isVillain()) return;
    const sys = this.actor.system;
    if (!sys.gates?.enabled) {
      const total = this.#hbTotal();
      const hb = distributeGates(total, gateCount(this.#partySize()));
      await this.actor.update({
        "system.gates.enabled": true,
        "system.gates.hb": hb,
        "system.gates.broken": 0,
        "system.hp.value": hb[0]
      });
      await this.#assignSkillGates(hb.length);
    } else {
      // Fold back into one pool (re-capped at 10 — the no-cap allowance is a Gates privilege):
      // remaining = the current Gate's value + every unbroken later Gate.
      const g = sys.gates;
      const total = Math.clamp(this.#hbTotal(), 1, PROJECTANIME.maxBoxes);
      const later = (g.hb ?? []).slice((Number(g.broken) || 0) + 1).reduce((n, v) => n + (Number(v) || 0), 0);
      await this.actor.update({
        "system.gates.enabled": false,
        "system.gates.hb": [],
        "system.gates.broken": 0,
        "system.hp.max": total,
        "system.hp.value": Math.min((Number(sys.hp.value) || 0) + later, total)
      });
    }
    this.render();
  }

  /** Reconcile Technique Gate flags with a (re)laid Gate count: chunk-assign unflagged
   *  Techniques in list order (two per Gate) and clamp any stale flag past the last Gate —
   *  a stranded flag would lock the Technique for the whole fight (rollSkill's gate check). */
  async #assignSkillGates(count) {
    const per = PROJECTANIME.villain.techniquesPerGate;
    const updates = [];
    this.actor.items.filter((i) => i.type === "skill").sort(bySort).forEach((item, i) => {
      const cur = Number(item.getFlag("project-anime", "gate")) || 0;
      if (!cur) updates.push({ _id: item.id, "flags.project-anime.gate": Math.min(count, Math.floor(i / per) + 1) });
      else if (cur > count) updates.push({ _id: item.id, "flags.project-anime.gate": count });
    });
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /* -------------------------------------------- */
  /*  Styles (Weapon · Armor · Shield)            */
  /* -------------------------------------------- */

  /** A Weapon Style card ADDS an attack: an equipped weapon carrying the Style's printed line
   *  (Damage, Threshold, Range, properties), named and iconed for the Style. Click as many as
   *  the monster needs — the same Style more than once included; rename inline, fine-tune on
   *  the item sheet, remove from the attack list. Strikes roll through rollAttack and never
   *  spend Energy. */
  static async #onAddStyleAttack(event, target) {
    const key = target.closest("[data-style]")?.dataset.style;
    const st = PROJECTANIME.weaponStyles[key];
    if (!st) return;
    const [min, max] = st.range;
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize(st.label),
      type: "weapon",
      img: st.icon,
      system: {
        style: key,
        accuracy: { attrA: "might", attrB: "agility", mod: 0 },
        damage: { value: st.damage },
        threshold: st.threshold,
        range: { type: max > 1 ? "ranged" : "melee", tiles: max, minTiles: min > 1 ? min : 0 },
        dual: !!st.dual,
        grip: st.twoHanded ? "two" : "one",
        twoHandedOnly: !!st.twoHanded,
        size: 0,
        equipped: true,
        hand: "main"
      }
    }]);
    this.render();
  }

  /** Pick the Armor Style: store the key and wear it as an equipped armor item — Unarmored
   *  included (Guard +0 · Movement 6 · Energy Regen 2, the same numbers the no-armor
   *  derivation gives), so the sheet always shows what the body wears. */
  static async #onPickArmorStyle(event, target) {
    const key = target.closest("[data-style]")?.dataset.style;
    const st = PROJECTANIME.armorStyles[key];
    if (!st) return;
    await this.actor.update({ "system.armorStyle": key });
    const existing = this.actor.items.find((i) => i.type === "armor" && i.getFlag("project-anime", "creationArmor"));
    const name = key === "unarmored"
      ? game.i18n.localize(st.label)
      : `${game.i18n.localize(st.label)} ${game.i18n.localize("TYPES.Item.armor")}`;
    const system = {
      style: key,
      guardBonus: st.guard,
      movement: st.movement,
      energyRegen: st.energyRegen ?? 0,
      size: 0,
      equipped: true
    };
    if (existing) await existing.update({ name, img: st.icon, system });
    else {
      await this.actor.createEmbeddedDocuments("Item", [{
        name, type: "armor", img: st.icon ?? ARMOR_IMG, system,
        flags: { "project-anime": { creationArmor: true } }
      }]);
    }
    this.render();
  }

  /** Pick the Shield Style (or none): store the key and wear it as an equipped shield item —
   *  its Guard bonus joins the derivation; it can bash as a weapon like any shield. */
  static async #onPickShieldStyle(event, target) {
    const key = target.closest("[data-style]")?.dataset.style ?? "";
    const existing = this.actor.items.find((i) => i.type === "shield" && i.getFlag("project-anime", "creationShield"));
    if (!key) {
      await this.actor.update({ "system.shieldStyle": "" });
      if (existing) await existing.delete();
      return this.render();
    }
    const st = PROJECTANIME.shieldStyles[key];
    if (!st) return;
    await this.actor.update({ "system.shieldStyle": key });
    const [min, max] = st.range;
    const name = game.i18n.localize(st.label);
    const system = {
      style: key,
      guardBonus: st.guard,
      accuracy: { attrA: "might", attrB: "agility", mod: 0 },
      damage: { value: st.damage },
      threshold: st.threshold,
      range: { type: "melee", tiles: max, minTiles: min > 1 ? min : 0 },
      dual: !!st.dual,
      size: 0,
      equipped: true,
      hand: "off"
    };
    if (existing) await existing.update({ name, img: st.icon, system });
    else {
      await this.actor.createEmbeddedDocuments("Item", [{
        name, type: "shield", img: st.icon, system,
        flags: { "project-anime": { creationShield: true } }
      }]);
    }
    this.render();
  }

  /* -------------------------------------------- */
  /*  Attributes & Boxes (EXP spends)             */
  /* -------------------------------------------- */

  /** Commit one Attribute's assigned die (Attributes step select; 1 EXP per step over d4). */
  async #commitAttribute(select) {
    const key = select.closest("[data-attribute]")?.dataset.attribute;
    if (!PROJECTANIME.attributeKeys.includes(key)) return;
    const die = Number(select.value) || 4;
    await this.actor.update({ [`system.attributes.${key}.base`]: die });
    this.render();
  }

  /** Buy one hit/energy box (1 EXP). Hit boxes cap at 10 — unless the Villain is gated, where
   *  the purchased total has no ceiling and re-lays across the Gates. */
  static async #onBoxPlus(event, target) {
    return this.#stepBox(target.closest("[data-pool]")?.dataset.pool, +1);
  }

  /** Refund one hit/energy box (floor 1 hit box / 0 energy — the shared base line). */
  static async #onBoxMinus(event, target) {
    return this.#stepBox(target.closest("[data-pool]")?.dataset.pool, -1);
  }

  async #stepBox(pool, delta) {
    if (pool === "hp") {
      if (this.#gatesOn()) {
        const g = this.actor.system.gates;
        const total = Math.max(1, this.#hbTotal() + delta);
        // Re-lay over the party-derived count (not hb.length) so the Gate count recovers once
        // enough boxes are bought; the current Gate's value grows with the boxes added to it.
        const hb = distributeGates(total, gateCount(this.#partySize()));
        const oldIdx = Math.clamp(Number(g.broken) || 0, 0, g.hb.length - 1);
        const idx = Math.clamp(Number(g.broken) || 0, 0, hb.length - 1);
        const grown = Math.max(0, (hb[idx] ?? 1) - (Number(g.hb[oldIdx]) || 1));
        await this.actor.update({
          "system.gates.hb": hb,
          "system.hp.value": Math.clamp((Number(this.actor.system.hp.value) || 0) + grown, 0, hb[idx] ?? 1)
        });
        await this.#assignSkillGates(hb.length);
        return this.render();
      }
      const authored = Number(this.actor._source.system.hp.max) || 1;
      const next = Math.clamp(authored + delta, 1, PROJECTANIME.expOptions.hitBox.cap ?? PROJECTANIME.maxBoxes);
      if (next === authored) return;
      return this.actor.update({
        "system.hp.max": next,
        "system.hp.value": Math.clamp((Number(this.actor.system.hp.value) || 0) + Math.max(0, next - authored), 0, next)
      }).then(() => this.render());
    }
    if (pool === "energy") {
      const authored = Number(this.actor._source.system.energy.max) || 0;
      const next = Math.clamp(authored + delta, 0, PROJECTANIME.expOptions.energy.cap ?? PROJECTANIME.maxBoxes);
      if (next === authored) return;
      return this.actor.update({
        "system.energy.max": next,
        "system.energy.value": Math.clamp((Number(this.actor.system.energy.value) || 0) + Math.max(0, next - authored), 0, next)
      }).then(() => this.render());
    }
  }

  /* -------------------------------------------- */
  /*  Attacks                                     */
  /* -------------------------------------------- */

  /** Open an attack's item sheet for full tuning (range, grip, size…). */
  static #onEditAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  /** Delete an attack. */
  static async #onRemoveAttack(event, target) {
    const id = target.closest("[data-attack-id]")?.dataset.attackId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "weapon") return;
    await item.delete();
    this.render();
  }

  /** Commit an inline attack rename to its weapon item (empty falls back to the default). */
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
  /*  Talents (2 EXP at d6 · +1 per step)         */
  /* -------------------------------------------- */

  /** Add a Talent at d6 (rules: Spending EXP — "Talent at d6", 2 EXP; step it up inline). */
  static async #onAddTalent() {
    await this.actor.update({
      [`system.talents.${foundry.utils.randomID()}`]: {
        name: game.i18n.localize("PROJECTANIME.MonsterCreator.talentName"),
        die: 6,
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

  /** Commit a Technique's Gate assignment (gated Villains; "—" = always available). */
  async #commitSkillGate(select) {
    const id = select.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    const gate = Number(select.value) || 0;
    if (gate > 0) await item.setFlag("project-anime", "gate", gate);
    else await item.unsetFlag("project-anime", "gate");
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
