/**
 * Project: Anime — no-code Active Effect builder.
 *
 * A friendly form (ApplicationV2) for editing one ActiveEffect's structured rules,
 * launched from an item's "Effects" tab. Every modification is a dropdown-built
 * "sentence" row — the GM/player never types a data path or JSON. Saves the rules to
 * effect.flags["project-anime"].rules (+ the effect's name/icon/enabled). Mirrors the
 * element-config form pattern (working copy survives interactive re-renders).
 */
import {
  blankRule, normalizeRule, effectRules, ruleChoices
} from "../helpers/effects.mjs";
import { isImageIcon } from "../helpers/elements.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Migrate a stored rule into its current editable shape as it's seeded into the builder, so a
 *  re-save can't silently corrupt it. A legacy "Skill Adjustment" (skillMod) scoped to a weapon or
 *  unarmed attack is now a "Weapon Adjustment" (weaponMod) — render it in the weaponMod row (those
 *  scope options were removed from skillMod, so it would otherwise default to "Any Skill" on Save).
 *  Everything else is shallow-copied unchanged. */
function seedRule(r) {
  if (r?.type === "skillMod" && (r.scope === "weapon" || r.scope === "unarmed")) {
    const migrated = { type: "weaponMod", scope: r.scope === "weapon" ? "any" : "unarmed", typeName: "", attack: 0, damage: Math.round(Number(r.damage) || 0) };
    if (r.pred) migrated.pred = r.pred;
    return migrated;
  }
  return { ...r };
}

/** Derive {unit, value} from a core ActiveEffect duration object (for the builder). */
function readDuration(dur) {
  if (dur?.rounds) return { unit: "rounds", value: dur.rounds };
  if (dur?.turns) return { unit: "turns", value: dur.turns };
  if (dur?.seconds) return { unit: "minutes", value: Math.round(dur.seconds / 60) };
  return { unit: "none", value: 0 };
}

/** Build a core duration object (rounds/turns/seconds) from {unit, value}. */
function toDuration(unit, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const dur = { rounds: null, turns: null, seconds: null };
  if (unit === "rounds") dur.rounds = v;
  else if (unit === "turns") dur.turns = v;
  else if (unit === "minutes") dur.seconds = v * 60;
  return dur;
}

export class EffectBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "effect-builder"],
    tag: "form",
    position: { width: 600, height: "auto" },
    window: { title: "PROJECTANIME.Effect.builderTitle", icon: "fa-solid fa-wand-magic-sparkles" },
    form: { handler: EffectBuilder.#onSubmit, closeOnSubmit: true },
    actions: {
      addRule: EffectBuilder.#onAddRule,
      deleteRule: EffectBuilder.#onDeleteRule,
      removeGrant: EffectBuilder.#onRemoveGrant,
      pickIcon: EffectBuilder.#onPickIcon
    }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/effect-builder.hbs", scrollable: [""] }
  };

  /** The ActiveEffect being edited (null in data mode — see #data). */
  #effect;

  /** Data-mode descriptor: `{ id, title, name, img, rules, onSave }`. When set, the builder edits a
   *  plain data object instead of a live ActiveEffect — seeded from it and, on save, handed back to
   *  `onSave({name, img, rules})` instead of writing a document. Used to author an effect that's
   *  STORED in schema and projected as an AE elsewhere (e.g. an actor's signature Trait effect). */
  #data = null;

  /** Working copy of editable state (survives interactive add/delete re-renders). */
  #name = null;
  #img = null;
  #enabled = true;
  #toggle = false;
  #durUnit = "none";
  #durValue = 0;
  #rules = null;
  #desc = ""; // optional flavor line (data mode + withDesc — e.g. a Signature Trait's prose)

  /** Grant-item snapshots (uuid → self-contained item data), seeded from existing rules + each drop.
   *  Held on the instance because the form round-trip only carries uuid/name/img; reattached at submit
   *  so a grant survives its source Item being deleted (see #onDropGrant / #onSubmit). */
  #grantSnapshots = new Map();

  constructor(effect, options = {}) {
    const data = options.dataMode ?? null;
    super({ ...options, id: `pa-effect-builder-${data ? data.id : effect.id}` });
    this.#effect = effect;
    this.#data = data;
  }

  /**
   * Open the builder on a plain DATA object instead of a live ActiveEffect. Seeds from
   * `{name, img, rules}` and, on submit, calls `onSave({name, img, rules})` rather than writing a
   * document. `id` makes the window unique / re-focusable per source. In this mode the always-on meta
   * controls (enabled / toggleable / duration) are hidden — a stored effect is reconciled always-on
   * by whatever projects it (e.g. helpers/trait-effect.mjs).
   */
  static forData({ id, title, name = "", img = "icons/svg/aura.svg", rules = [], desc = "", withDesc = false, toggle = false, allowToggle = false, onSave }) {
    return new EffectBuilder(null, { dataMode: { id, title, name, img, rules, desc, withDesc, toggle, allowToggle, onSave } });
  }

  get title() {
    if (this.#data) return this.#data.title || game.i18n.localize("PROJECTANIME.Effect.builderTitle");
    return `${game.i18n.localize("PROJECTANIME.Effect.builderTitle")} — ${this.#effect.name}`;
  }

  /** Seed the working copy from the effect (or the data descriptor) on first render. */
  #initState() {
    if (this.#rules !== null) return;
    // Seed the snapshot map from any grant rules that already carry a self-contained `data` snapshot,
    // so re-saving an existing grant preserves it (the form round-trip would otherwise drop it).
    const srcRules = this.#data ? (this.#data.rules ?? []) : effectRules(this.#effect);
    for (const r of srcRules) {
      if (r?.type !== "grant") continue;
      for (const it of r.items ?? []) if (it?.uuid && it?.data) this.#grantSnapshots.set(it.uuid, it.data);
    }
    if (this.#data) {
      this.#name = this.#data.name ?? "";
      this.#img = this.#data.img ?? "icons/svg/aura.svg";
      this.#enabled = true;     // a stored Trait effect is reconciled always-on
      this.#toggle = !!this.#data.toggle;   // but it MAY be a player-toggle (allowToggle consumers, e.g. bonds)
      this.#durUnit = "none";
      this.#durValue = 0;
      this.#rules = (this.#data.rules ?? []).map(seedRule);
      this.#desc = this.#data.desc ?? "";
      return;
    }
    this.#name = this.#effect.name;
    this.#img = this.#effect.img;
    this.#enabled = !this.#effect.disabled;
    this.#toggle = !!this.#effect.flags?.["project-anime"]?.toggle;
    const d = readDuration(this.#effect.duration);
    this.#durUnit = d.unit;
    this.#durValue = d.value;
    this.#rules = effectRules(this.#effect).map(seedRule);
  }

  /** @override */
  async _prepareContext() {
    this.#initState();
    const choices = ruleChoices();
    return {
      // Data mode (a stored effect, e.g. a signature Trait): hide the always-on meta controls
      // (enabled / toggleable / duration) — the projector keeps it always-on. `withDesc` adds an
      // optional flavor textarea (the Signature Trait's prose for not-yet-codeable abilities).
      rulesOnly: !!this.#data,
      // The toggleable checkbox shows in full mode always, and in data mode only when the consumer
      // opts in (allowToggle) — e.g. bond rank effects, so a boon can be flipped on situationally.
      showToggle: !this.#data || !!this.#data?.allowToggle,
      withDesc: !!this.#data?.withDesc,
      desc: this.#desc,
      name: this.#name,
      img: this.#img,
      iconImg: isImageIcon(this.#img),
      enabled: this.#enabled,
      toggle: this.#toggle,
      durUnit: this.#durUnit,
      durValue: this.#durValue,
      choices,
      weaponTypes: CONFIG.PROJECTANIME?.weaponTypeSuggestions ?? [],
      rules: this.#rules.map((r) => {
        const pred = r.pred ?? {};
        const pt = pred.type ?? "always";
        return {
          ...r,
          isNone: r.type === "none",
          isAttribute: r.type === "attribute",
          isTalent: r.type === "talent",
          isHq: r.type === "hq",
          isGather: r.type === "gather",
          isStat: r.type === "stat",
          isResource: r.type === "resource",
          isSustain: r.type === "sustain",
          isAffinity: r.type === "affinity",
          isRoll: r.type === "roll",
          isNcCheck: r.type === "ncCheck",
          isCondition: r.type === "condition",
          isImmunity: r.type === "immunity",
          isLuck: r.type === "luck",
          isTrade: r.type === "trade",
          isReveal: r.type === "reveal",
          isGrant: r.type === "grant",
          isSkillMod: r.type === "skillMod",
          isWeaponMod: r.type === "weaponMod",
          wScopeType: r.type === "weaponMod" && r.scope === "type",
          items: r.items ?? [],
          predType: pt,
          predStatus: pred.status ?? "",
          predPct: pred.pct ?? "",
          predElement: pred.element ?? "",
          predLevel: pred.level ?? "",
          predSelf: pt === "selfCondition",
          predHp: pt === "hpBelow",
          predEnergy: pt === "energyBelow",
          predTargetCond: pt === "targetCondition",
          predTargetAff: pt === "targetAffinity"
        };
      })
    };
  }

  /** @override — re-render when a rule's TYPE changes so its type-specific fields show;
   *  and make Grant rules accept dropped Items (drag a Skill/Package onto the drop zone). */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const sel of this.element.querySelectorAll(".rule-type, .rule-pred, .rule-wscope")) {
      sel.addEventListener("change", () => { this.#sync(); this.render(); });
    }
    for (const zone of this.element.querySelectorAll(".eb-grant-drop")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", (ev) => this.#onDropGrant(ev, zone));
    }
  }

  /** Drop an Item onto a Grant rule's zone → add it to that rule's granted list. */
  async #onDropGrant(event, zone) {
    event.preventDefault();
    zone.classList.remove("dragover");
    const i = Number(zone.dataset.index);
    if (!(i >= 0)) return;
    let data = null;
    try {
      const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
      data = TE?.getDragEventData ? TE.getDragEventData(event) : JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (_) { return; }
    if (data?.type !== "Item" || !data.uuid) return;
    const doc = await fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Item") return;
    this.#sync();
    const rule = this.#rules[i];
    if (!rule || rule.type !== "grant") return;
    if (!Array.isArray(rule.items)) rule.items = [];
    if (rule.items.some((it) => it.uuid === doc.uuid)) return; // already granted
    // Snapshot the source NOW (it definitely exists at drop time) so the grant survives the
    // source being deleted/renamed later — the delivery path prefers this over re-resolving uuid.
    const snap = doc.toObject();
    delete snap._id; delete snap.folder; delete snap.sort;
    this.#grantSnapshots.set(doc.uuid, snap);   // reattached at submit (form round-trip drops `data`)
    rule.items.push({ uuid: doc.uuid, name: doc.name, img: doc.img, data: snap });
    this.render();
  }

  /** Remove one granted Item from a Grant rule (the × on a chip). */
  static #onRemoveGrant(event, target) {
    const i = Number(target.dataset.index);
    const j = Number(target.dataset.grantIndex);
    this.#sync();
    const rule = this.#rules[i];
    if (rule && Array.isArray(rule.items) && j >= 0 && j < rule.items.length) rule.items.splice(j, 1);
    this.render();
  }

  /** Pull current (possibly unsaved) field values into the working copy. */
  #sync() {
    if (!this.element) return;
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    this.#name = data.name ?? this.#name;
    this.#img = data.img ?? this.#img;
    this.#enabled = !!data.enabled;
    this.#toggle = !!data.toggle;
    this.#durUnit = data.durUnit ?? this.#durUnit;
    this.#durValue = data.durValue ?? this.#durValue;
    this.#desc = data.desc ?? this.#desc;
    this.#rules = data.rules
      ? Object.values(data.rules).map((r) => {
          const rule = { ...r };
          // Grant items come from hidden inputs as an index-keyed object — keep them an
          // array so the drop/remove handlers can push/splice them.
          if ("items" in rule) rule.items = Object.values(rule.items ?? {});
          return rule;
        })
      : [];
  }

  static #onAddRule() {
    this.#sync();
    this.#rules.push(blankRule());
    this.render();
  }

  static #onDeleteRule(event, target) {
    const i = Number(target.dataset.index);
    this.#sync();
    if (i >= 0 && i < this.#rules.length) this.#rules.splice(i, 1);
    this.render();
  }

  /** Open the file browser to pick an image for this effect's icon. */
  static async #onPickIcon() {
    this.#sync();
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.#img || "",
      callback: (path) => { this.#img = path; this.render(); }
    });
    return fp.browse();
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const list = (data.rules ? Object.values(data.rules) : []).map(normalizeRule).filter(Boolean);
    // Reattach grant snapshots dropped from the form round-trip (the form carries only uuid/name/img),
    // so a saved grant stays self-contained and survives its source Item being deleted.
    for (const rule of list) {
      if (rule.type !== "grant") continue;
      for (const it of rule.items ?? []) if (!it.data && this.#grantSnapshots.has(it.uuid)) it.data = this.#grantSnapshots.get(it.uuid);
    }
    // Data mode: hand the cleaned rules + name/icon (+ optional flavor) back to the owner; no document
    // is written.
    if (this.#data) {
      const payload = {
        name: (data.name || "").trim(),
        img: (data.img || "").trim() || this.#data.img,
        rules: list
      };
      if (this.#data.allowToggle) payload.toggle = !!data.toggle;
      if (this.#data.withDesc) payload.desc = (data.desc || "").trim();
      return this.#data.onSave(payload);
    }
    const duration = toDuration(data.durUnit, data.durValue);
    // Stamp start markers so duration.remaining counts down from now (combat + world time).
    if (data.durUnit && data.durUnit !== "none") {
      duration.startTime = game.time?.worldTime ?? 0;
      if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
    }
    await this.#effect.update({
      name: (data.name || "").trim() || this.#effect.name,
      img: (data.img || "").trim() || this.#effect.img,
      // A toggleable effect is switched by its PLAYER toggle (flags.project-anime.toggles), so it must
      // stay enabled to be live — otherwise it's excluded from appliedEffects and never shows up to be
      // toggled (in the roll dialog or Effects tab). The toggle is its on/off, not the enabled flag.
      disabled: data.toggle ? false : !data.enabled,
      duration,
      "flags.project-anime.toggle": !!data.toggle,
      "flags.project-anime.rules": { version: 1, list }
    });
  }
}
