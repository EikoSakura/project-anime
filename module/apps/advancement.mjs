/**
 * Project: Anime — Advancement dialog (V2 milestones).
 *
 * A standalone ApplicationV2 opened from the actor sheet (and, for Companions, the party
 * sheet's Companions strip). Characters hold unspent XP
 * (system.advancement.value) granted by the GM's milestone tool; this dialog spends it
 * on the Advancement List (PROJECTANIME.advancementOptions) — every purchase pays the
 * option's XP price against its slot cap (rules: Advancement).
 * Everything STAGES first — +/− marks pending
 * purchases against the unspent pool and the option slot caps — and CONFIRM commits
 * the lot: one atomic actor update carrying one refundable ledger entry per purchase
 * (actor.recordAdvancementSpends), plus the item writes the purchases need.
 *
 * Create a Technique / Rebuild a Technique hand off to the Technique Builder after
 * the spend; the created item's id is attached to the pending ledger entry when the
 * Builder commits (see attachBuildRef), so the Advancement Log's Refund and the
 * delete-item refund hook can find it.
 */
import { advancementLedger } from "../helpers/skill-points.mjs";
import { actorTalents, isCompanion } from "../helpers/config.mjs";
import { SkillBuilderApp } from "./skill-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The attribute / talent die ladder, one node per step on the track. */
const DIE_LADDER = [4, 6, 8, 10, 12];

/**
 * A technique/rebuild spend is recorded before the Builder runs, carrying a unique
 * placeholder ref. The next Technique this user creates on the actor claims it: every
 * ledger entry holding the placeholder is re-pointed at the created item (and the
 * pending "Create a Technique" entry takes the item's name). If the build is abandoned
 * the entry keeps its placeholder — still safely refundable from the Advancement Log,
 * since the placeholder matches nothing else.
 */
function attachBuildRef(actor, placeholder) {
  const hookId = Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.parent?.id !== actor.id || item.type !== "skill") return;
    Hooks.off("createItem", hookId);
    const log = actor.system.advancement?.log ?? [];
    if (!log.some((e) => e.ref === placeholder)) return;
    actor.update({
      "system.advancement.log": log.map((e) => {
        if (e.ref !== placeholder) return e;
        const label = e.kind === "technique"
          ? game.i18n.format("PROJECTANIME.AdvLog.entry.technique", { name: item.name })
          : e.label;
        return { ...e, ref: item.id, label };
      })
    });
  });
}

export class AdvancementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-advancement-${actor.id}` });
    this.actor = actor;
  }

  /** Pending (unconfirmed) purchases. `talents` rows are {name, attr}; `attrs` /
   *  `talentSteps` map a key / talent id to staged step counts. */
  #staged = { technique: false, energy: 0, hitBox: 0, luckDie: 0, talents: [], rebuildId: "", attrs: {}, talentSteps: {} };

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "advancement-app"],
    position: { width: 440, height: "auto" },
    window: { title: "PROJECTANIME.Advancement.title", icon: "fa-solid fa-arrow-up-right-dots" },
    actions: {
      stage: AdvancementApp.#onStage,
      addTalent: AdvancementApp.#onAddTalent,
      removeTalent: AdvancementApp.#onRemoveTalent,
      confirmAdvance: AdvancementApp.#onConfirm
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
    this.#staged = { technique: false, energy: 0, hitBox: 0, luckDie: 0, talents: [], rebuildId: "", attrs: {}, talentSteps: {} };
  }

  /** An option's XP price (rules: Advancement — one list for Characters and Companions). */
  #cost(kind) {
    return CONFIG.PROJECTANIME.advancementOptions[kind]?.cost ?? 1;
  }

  /** Staged purchase COUNT on one option (slot usage, not price). */
  #stagedOf(kind) {
    return {
      technique: this.#staged.technique ? 1 : 0,
      energy: this.#staged.energy,
      hitBox: this.#staged.hitBox,
      luckDie: this.#staged.luckDie,
      talent: this.#staged.talents.length,
      rebuild: this.#staged.rebuildId ? 1 : 0,
      attribute: Object.values(this.#staged.attrs).reduce((n, v) => n + v, 0),
      talentStep: Object.values(this.#staged.talentSteps).reduce((n, v) => n + v, 0)
    }[kind] ?? 0;
  }

  /** XP the current staging would spend (each purchase at its option's price). */
  #stagedCount() {
    return CONFIG.PROJECTANIME.advancementOptionKeys.reduce(
      (n, kind) => n + this.#stagedOf(kind) * this.#cost(kind), 0);
  }

  /** Free slots left on an option once its staged purchases are counted (Infinity = uncapped). */
  #slotsLeft(slots, kind) {
    const slot = slots[kind] ?? { used: 0, max: 0 };
    return slot.max - slot.used - this.#stagedOf(kind);
  }

  /** The actor's owned Techniques / Talents, stably ordered. */
  #owned(type) {
    return this.actor.items.filter((i) => i.type === type)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const { advInfo } = advancementLedger(this.actor);
    const src = this.actor._source.system ?? {};

    // The pool or the roster moved under our staging (a milestone grant revoked, an item
    // deleted elsewhere) — drop the staging rather than guess which pieces still fit.
    if (this.#staged.rebuildId && !this.actor.items.get(this.#staged.rebuildId)) this.#staged.rebuildId = "";
    for (const id of Object.keys(this.#staged.talentSteps)) {
      if (!this.actor.system.talents?.[id]) delete this.#staged.talentSteps[id];
    }
    if (this.#stagedCount() > advInfo.available) this.#resetStaged();

    const staged = this.#stagedCount();
    const left = advInfo.available - staged;
    const slots = advInfo.slots;
    const label = (kind) => game.i18n.localize(cfg.advancementOptions[kind]?.label ?? kind);
    // Live slot usage per option: committed entries + this window's staged purchases. An
    // uncapped Companion option (max Infinity) shows a dash instead of a ceiling.
    const slotLine = (kind) => {
      const slot = slots[kind] ?? { used: 0, max: 0 };
      const used = slot.used + this.#stagedOf(kind);
      return game.i18n.format("PROJECTANIME.Advancement.slots", {
        used, max: Number.isFinite(slot.max) ? slot.max : "—"
      });
    };

    const techniques = this.#owned("skill");
    const talents = actorTalents(this.actor);
    const s = this.#staged;

    // Attribute rows — the d4→d12 node track plus a 1-advancement stepper.
    const attrSlotsLeft = this.#slotsLeft(slots, "attribute");
    const attributes = cfg.attributeKeys.map((k) => {
      const base = Number(src.attributes?.[k]?.base) || 4;
      const lockIdx = Math.max(0, Math.min(4, (base - 4) / 2));
      const stagedSteps = s.attrs[k] ?? 0;
      const at = base + 2 * stagedSteps;
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        die: `d${at}`,
        staged: stagedSteps > 0,
        canPlus: at < 12 && left >= this.#cost("attribute") && attrSlotsLeft > 0,
        canMinus: stagedSteps > 0,
        nodes: DIE_LADDER.map((d, i) => ({
          cls: i <= lockIdx ? "lk" : i <= lockIdx + stagedSteps ? "on" : "",
          linkCls: i < lockIdx + stagedSteps ? "lk" : "",
          last: i === DIE_LADDER.length - 1
        }))
      };
    });

    // Talent step rows — same track, keyed on the actor's embedded Talent rows.
    const talentStepSlotsLeft = this.#slotsLeft(slots, "talentStep");
    const talentRows = talents.map((t) => {
      const die = t.die;
      const lockIdx = Math.max(0, Math.min(4, (die - 4) / 2));
      const stagedSteps = s.talentSteps[t.id] ?? 0;
      const at = die + 2 * stagedSteps;
      return {
        id: t.id,
        name: t.name,
        attrLabel: game.i18n.localize(cfg.attributes[t.attribute] ?? ""),
        die: `d${at}`,
        staged: stagedSteps > 0,
        canPlus: at < 12 && left >= this.#cost("talentStep") && talentStepSlotsLeft > 0,
        canMinus: stagedSteps > 0,
        nodes: DIE_LADDER.map((d, i) => ({
          cls: i <= lockIdx ? "lk" : i <= lockIdx + stagedSteps ? "on" : "",
          linkCls: i < lockIdx + stagedSteps ? "lk" : "",
          last: i === DIE_LADDER.length - 1
        }))
      };
    });

    const energyBase = Number(src.energy?.max) || 0;
    const hpBase = Number(src.hp?.max) || 0;
    const attrChoices = Object.fromEntries(cfg.attributeKeys.map((k) => [k, game.i18n.localize(cfg.attributes[k])]));

    // Luck Die — a single count-based step track (d6→d8→d10→d12), held by Characters and
    // Companions alike. `luckUsed` = committed steps, `luckAt` = the projected die with staging.
    const luckUsed = slots.luckDie?.used ?? 0;
    const luckAt = cfg.luckDie + 2 * (luckUsed + s.luckDie);
    const luckDie = (this.actor.type === "character" || isCompanion(this.actor)) ? {
      label: label("luckDie"),
      slots: slotLine("luckDie"),
      cost: this.#cost("luckDie"),
      value: `d${Math.min(cfg.luckDieMax, luckAt)}`,
      stagedAmount: s.luckDie ? `+${s.luckDie}` : "",
      canPlus: left >= this.#cost("luckDie") && this.#slotsLeft(slots, "luckDie") > 0 && luckAt < cfg.luckDieMax,
      canMinus: s.luckDie > 0
    } : null;

    return {
      available: advInfo.available,
      left,
      stagedTotal: staged,
      hasStaged: staged > 0,
      technique: {
        label: label("technique"),
        slots: slotLine("technique"),
        cost: this.#cost("technique"),
        staged: s.technique,
        canPlus: !s.technique && !s.rebuildId && left >= this.#cost("technique") && this.#slotsLeft(slots, "technique") > 0,
        canMinus: s.technique
      },
      energy: {
        label: label("energy"),
        slots: slotLine("energy"),
        cost: this.#cost("energy"),
        value: Math.min(cfg.maxBoxes, energyBase + s.energy),
        stagedAmount: s.energy ? `+${s.energy}` : "",
        canPlus: left >= this.#cost("energy") && this.#slotsLeft(slots, "energy") > 0 && energyBase + s.energy < cfg.maxBoxes,
        canMinus: s.energy > 0
      },
      hitBox: {
        label: label("hitBox"),
        slots: slotLine("hitBox"),
        cost: this.#cost("hitBox"),
        value: Math.min(cfg.maxBoxes, hpBase + s.hitBox),
        stagedAmount: s.hitBox ? `+${s.hitBox}` : "",
        canPlus: left >= this.#cost("hitBox") && this.#slotsLeft(slots, "hitBox") > 0 && hpBase + s.hitBox < cfg.maxBoxes,
        canMinus: s.hitBox > 0
      },
      luckDie,
      talent: {
        label: label("talent"),
        slots: slotLine("talent"),
        cost: this.#cost("talent"),
        canPlus: left >= this.#cost("talent") && this.#slotsLeft(slots, "talent") > 0,
        rows: s.talents.map((t, i) => ({ index: i, name: t.name, attr: t.attr }))
      },
      rebuild: {
        label: label("rebuild"),
        slots: slotLine("rebuild"),
        cost: this.#cost("rebuild"),
        disabled: s.technique || (!s.rebuildId && (left < this.#cost("rebuild") || this.#slotsLeft(slots, "rebuild") <= 0 || !techniques.length)),
        options: techniques.map((t) => ({ id: t.id, name: t.name, selected: t.id === s.rebuildId }))
      },
      attributes,
      attrCost: this.#cost("attribute"),
      talentRows,
      talentStepCost: this.#cost("talentStep"),
      hasTalents: talentRows.length > 0,
      attrChoices
    };
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

  /** Live-refresh as the actor changes by joining the document's app registry; bind the
   *  inputs that stage without re-rendering (new-Talent name/attribute, rebuild pick). */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.actor.apps[this.id] = this;

    this.element.querySelector("select.adv-rebuild")?.addEventListener("change", (ev) => {
      this.#staged.rebuildId = ev.currentTarget.value;
      this.render();
    });
    for (const input of this.element.querySelectorAll("input.adv-talent-name")) {
      input.addEventListener("change", (ev) => {
        const i = Number(ev.currentTarget.dataset.index);
        if (this.#staged.talents[i]) this.#staged.talents[i].name = ev.currentTarget.value;
      });
    }
    for (const sel of this.element.querySelectorAll("select.adv-talent-attr")) {
      sel.addEventListener("change", (ev) => {
        const i = Number(ev.currentTarget.dataset.index);
        if (this.#staged.talents[i]) this.#staged.talents[i].attr = ev.currentTarget.value;
      });
    }
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /** Pull the live new-Talent inputs into staging (change events fire on blur, so read
   *  directly before committing). */
  #collectTalentInputs() {
    for (const input of this.element?.querySelectorAll("input.adv-talent-name") ?? []) {
      const i = Number(input.dataset.index);
      if (this.#staged.talents[i]) this.#staged.talents[i].name = input.value;
    }
    for (const sel of this.element?.querySelectorAll("select.adv-talent-attr") ?? []) {
      const i = Number(sel.dataset.index);
      if (this.#staged.talents[i]) this.#staged.talents[i].attr = sel.value;
    }
  }

  /* -------------------------------------------- */
  /*  Staging actions                             */
  /* -------------------------------------------- */

  /** One handler for every +/− stepper: data-kind picks the option, data-delta the direction.
   *  Guards mirror what _prepareContext disables — a stale click stages nothing. */
  static #onStage(event, target) {
    this.#collectTalentInputs();
    const cfg = CONFIG.PROJECTANIME;
    const { kind, key } = target.dataset;
    const delta = Number(target.dataset.delta) || 0;
    const { advInfo } = advancementLedger(this.actor);
    const left = advInfo.available - this.#stagedCount();
    const canBuy = (k) => left >= this.#cost(k) && this.#slotsLeft(advInfo.slots, k) > 0;
    const s = this.#staged;
    const src = this.actor._source.system ?? {};

    if (kind === "technique") {
      if (delta > 0 && !s.technique && !s.rebuildId && canBuy("technique")) s.technique = true;
      else if (delta < 0) s.technique = false;
    } else if (kind === "energy") {
      const base = Number(src.energy?.max) || 0;
      if (delta > 0 && canBuy("energy") && base + s.energy < cfg.maxBoxes) s.energy += 1;
      else if (delta < 0 && s.energy > 0) s.energy -= 1;
    } else if (kind === "hitBox") {
      const base = Number(src.hp?.max) || 0;
      if (delta > 0 && canBuy("hitBox") && base + s.hitBox < cfg.maxBoxes) s.hitBox += 1;
      else if (delta < 0 && s.hitBox > 0) s.hitBox -= 1;
    } else if (kind === "luckDie") {
      const used = advInfo.slots.luckDie?.used ?? 0;
      const at = cfg.luckDie + 2 * (used + s.luckDie);
      if (delta > 0 && canBuy("luckDie") && at < cfg.luckDieMax) s.luckDie += 1;
      else if (delta < 0 && s.luckDie > 0) s.luckDie -= 1;
    } else if (kind === "attr") {
      const base = Number(src.attributes?.[key]?.base) || 4;
      const staged = s.attrs[key] ?? 0;
      if (delta > 0 && canBuy("attribute") && base + 2 * staged < 12) s.attrs[key] = staged + 1;
      else if (delta < 0 && staged > 0) s.attrs[key] = staged - 1;
    } else if (kind === "talentStep") {
      const talent = this.actor.system.talents?.[key];
      if (!talent) return;
      const die = Number(talent.die) || 4;
      const staged = s.talentSteps[key] ?? 0;
      if (delta > 0 && canBuy("talentStep") && die + 2 * staged < 12) s.talentSteps[key] = staged + 1;
      else if (delta < 0 && staged > 0) s.talentSteps[key] = staged - 1;
    }
    this.render();
  }

  static #onAddTalent() {
    this.#collectTalentInputs();
    const { advInfo } = advancementLedger(this.actor);
    if (advInfo.available - this.#stagedCount() < this.#cost("talent")) return;
    if (this.#slotsLeft(advInfo.slots, "talent") <= 0) return;
    this.#staged.talents.push({ name: "", attr: "might" });
    this.render();
  }

  static #onRemoveTalent(event, target) {
    this.#collectTalentInputs();
    const i = Number(target.dataset.index);
    if (i >= 0 && i < this.#staged.talents.length) this.#staged.talents.splice(i, 1);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Confirm                                     */
  /* -------------------------------------------- */

  static async #onConfirm() {
    const cfg = CONFIG.PROJECTANIME;
    this.#collectTalentInputs();
    const s = this.#staged;
    const total = this.#stagedCount();
    if (!total) return;
    if (total > (this.actor.system.advancement?.value ?? 0)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.notEnough"));
    }
    if (s.talents.some((t) => !t.name.trim())) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Advancement.talentUnnamed"));
    }

    const src = this.actor._source.system ?? {};
    const entries = [];
    const changes = {};

    // New Talents at d4 — embedded rows keyed by a fresh id, riding the same atomic update;
    // the ledger entry carries the key so Refund / removeTalent can find it.
    for (const t of s.talents) {
      const key = foundry.utils.randomID();
      changes[`system.talents.${key}`] = {
        name: t.name.trim(),
        die: 4,
        attribute: t.attr in cfg.attributes ? t.attr : "might"
      };
      entries.push({
        kind: "talent", ref: key, amount: this.#cost("talent"),
        label: game.i18n.format("PROJECTANIME.AdvLog.entry.talent", { name: t.name.trim() })
      });
    }

    // Rebuild — the discarded Technique's ledger entries move to a placeholder BEFORE the
    // delete so its Create-a-Technique slot survives the swap (the delete hook then finds
    // nothing to refund); the Builder's replacement claims the placeholder.
    let placeholder = "";
    const rebuildItem = s.rebuildId ? this.actor.items.get(s.rebuildId) : null;
    if (rebuildItem) {
      placeholder = `pending-${foundry.utils.randomID(8)}`;
      const log = this.actor.system.advancement?.log ?? [];
      if (log.some((e) => e.ref === rebuildItem.id)) {
        await this.actor.update({
          "system.advancement.log": log.map((e) => (e.ref === rebuildItem.id ? { ...e, ref: placeholder } : e))
        });
      }
      entries.push({
        kind: "rebuild", ref: "", amount: this.#cost("rebuild"),
        label: game.i18n.format("PROJECTANIME.AdvLog.entry.rebuild", { name: rebuildItem.name })
      });
      await rebuildItem.delete();
    }

    // Create a Technique — spend now; the Builder attaches the built item's id.
    if (s.technique) {
      placeholder = placeholder || `pending-${foundry.utils.randomID(8)}`;
      entries.push({
        kind: "technique", ref: placeholder, amount: this.#cost("technique"),
        label: game.i18n.localize("PROJECTANIME.AdvLog.entry.techniquePending")
      });
    }

    // Boxes — `_source` maxima so Wound locks / Passive taxes never skew the math.
    if (s.energy) {
      const base = Number(src.energy?.max) || 0;
      const max = Math.min(cfg.maxBoxes, base + s.energy);
      changes["system.energy.max"] = max;
      changes["system.energy.value"] = Math.min((Number(src.energy?.value) || 0) + s.energy, max);
      for (let i = 0; i < s.energy; i++) entries.push({ kind: "energy", ref: "", amount: this.#cost("energy"), label: game.i18n.localize("PROJECTANIME.AdvLog.entry.energy") });
    }
    if (s.hitBox) {
      const base = Number(src.hp?.max) || 0;
      const max = Math.min(cfg.maxBoxes, base + s.hitBox);
      changes["system.hp.max"] = max;
      changes["system.hp.value"] = Math.min((Number(src.hp?.value) || 0) + s.hitBox, max);
      for (let i = 0; i < s.hitBox; i++) entries.push({ kind: "hitBox", ref: "", amount: this.#cost("hitBox"), label: game.i18n.localize("PROJECTANIME.AdvLog.entry.hitBox") });
    }

    // Luck Die — fungible count-based steps (d6→d8→d10→d12). The derived Luck Die size reads the
    // count of these entries, so no actor `changes` are needed — one refundable entry per step.
    for (let i = 0; i < s.luckDie; i++) {
      entries.push({ kind: "luckDie", ref: "", amount: this.#cost("luckDie"), label: game.i18n.localize("PROJECTANIME.AdvLog.entry.luckDie") });
    }

    // Attributes — one refundable entry per die step (the Log's cascade-refund reads from/to).
    for (const [k, steps] of Object.entries(s.attrs)) {
      if (!steps) continue;
      const base = Number(src.attributes?.[k]?.base) || 4;
      for (let i = 0; i < steps; i++) {
        const from = base + 2 * i;
        entries.push({
          kind: "attribute", ref: k, data: { from, to: from + 2 }, amount: this.#cost("attribute"),
          label: game.i18n.format("PROJECTANIME.SkillLog.entry.attribute", {
            attr: game.i18n.localize(cfg.attributes[k] ?? k),
            from: `d${from}`, to: `d${from + 2}`
          })
        });
      }
      changes[`system.attributes.${k}.base`] = Math.min(12, base + 2 * steps);
    }

    // Talent steps — the die writes ride the same atomic update alongside the entries.
    for (const [id, steps] of Object.entries(s.talentSteps)) {
      if (!steps) continue;
      const talent = this.actor.system.talents?.[id];
      if (!talent) continue;
      const die = Number(talent.die) || 4;
      for (let i = 0; i < steps; i++) {
        const from = die + 2 * i;
        entries.push({
          kind: "talentStep", ref: id, data: { from, to: from + 2 }, amount: this.#cost("talentStep"),
          label: game.i18n.format("PROJECTANIME.AdvLog.entry.talentStep", {
            name: talent.name, from: `d${from}`, to: `d${from + 2}`
          })
        });
      }
      changes[`system.talents.${id}.die`] = Math.min(12, die + 2 * steps);
    }

    await this.actor.recordAdvancementSpends(entries, changes);

    // Technique / Rebuild hand-off — the Builder's commit claims the placeholder entries.
    if (placeholder) {
      attachBuildRef(this.actor, placeholder);
      this.#openBuilder();
    }
    this.#resetStaged();
    this.render();
  }

  /** Open (or focus) the Technique Builder straight into Build mode. */
  #openBuilder() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }
}
