import { enhanceSelects } from "../helpers/select.mjs";
import { elementChoices, elementLabel } from "../helpers/elements.mjs";
import { rangeLabel, physicalRangeLabel, rangeHasTiles, skillEffectKeys, isHeavyModifier, skillTarget, skillDuration, skillEvasionAttr, skillEvasionLabel } from "../helpers/config.mjs";
import { skillRulesHTML } from "../helpers/skill-description.mjs";
import { summarizeRules, grantRefs } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * ApplicationV2 item sheet. A shared header + description wrap a type-specific
 * body part chosen by `_configureRenderOptions`. The Skill body is a full
 * rules-aware builder.
 */
export class ProjectAnimeItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "item"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimeItemSheet.#onEditImage,
      toggleModifier: ProjectAnimeItemSheet.#onToggleModifier,
      selectTab: ProjectAnimeItemSheet.#onSelectTab,
      addEffect: ProjectAnimeItemSheet.#onAddEffect,
      editEffect: ProjectAnimeItemSheet.#onEditEffect,
      deleteEffect: ProjectAnimeItemSheet.#onDeleteEffect,
      toggleEffectEnabled: ProjectAnimeItemSheet.#onToggleEffectEnabled,
      openSkillBuilder: ProjectAnimeItemSheet.#onOpenSkillBuilder
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/item/header.hbs" },
    tabs: { template: "systems/project-anime/templates/item/tabs.hbs" },
    details: { template: "systems/project-anime/templates/item/details.hbs", scrollable: [""] },
    skill: { template: "systems/project-anime/templates/item/skill.hbs", scrollable: [""] },
    weapon: { template: "systems/project-anime/templates/item/weapon.hbs", scrollable: [""] },
    armor: { template: "systems/project-anime/templates/item/armor.hbs", scrollable: [""] },
    shield: { template: "systems/project-anime/templates/item/shield.hbs", scrollable: [""] },
    accessory: { template: "systems/project-anime/templates/item/accessory.hbs", scrollable: [""] },
    consumable: { template: "systems/project-anime/templates/item/consumable.hbs", scrollable: [""] },
    container: { template: "systems/project-anime/templates/item/container.hbs", scrollable: [""] },
    gear: { template: "systems/project-anime/templates/item/gear.hbs", scrollable: [""] },
    package: { template: "systems/project-anime/templates/item/package.hbs", scrollable: [""] },
    description: { template: "systems/project-anime/templates/item/description.hbs" },
    effects: { template: "systems/project-anime/templates/item/effects.hbs", scrollable: [""] }
  };

  /** Per-type Font Awesome icon shown beside the type badge in the header (swappable). */
  static TYPE_ICONS = {
    weapon: "fa-solid fa-khanda",
    armor: "fa-solid fa-shirt",
    shield: "fa-solid fa-shield-halved",
    accessory: "fa-solid fa-ring",
    consumable: "fa-solid fa-flask",
    container: "fa-solid fa-box-open",
    gear: "fa-solid fa-box-archive",
    skill: "fa-solid fa-bolt",
    package: "fa-solid fa-gift"
  };

  /** Active sheet tab: "view" (read display) or "edit" (input form). Survives re-render. */
  #activeTab = "view";

  /** Saved scroll position of .window-content, restored after re-renders (submitOnChange). */
  #scroll = 0;

  /** @override — an editable standalone (world/compendium) Skill has no plain edit sheet:
   *  every render request (sidebar double-click, content link, the create dialog's auto-open)
   *  shows the Skill Builder wizard instead. Read-only contexts (locked pack, no permission)
   *  keep this sheet as the view surface; actor-owned Skills keep it too — their edit path
   *  already routes through the actor's Builder. */
  async render(options = {}, _options = {}) {
    if (this.item.type === "skill" && !this.item.parent && this.isEditable) {
      SkillBuilderApp.openForItem(this.item);
      return this;
    }
    return super.render(options, _options);
  }

  /** @override — render the shared header, the type-specific body, and the description. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const body = this.item.type in ProjectAnimeItemSheet.PARTS ? this.item.type : "gear";
    // Render ALL parts every render; the active tab is shown via CSS (.tab-pane.active).
    // Rendering only the active tab left the previous tab's parts stale in the DOM
    // (AppV2 doesn't remove dropped parts) — which made the tabs visually "merge".
    options.parts = ["header", "tabs", "details", body, "description", "effects"];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
    context.flags = this.item.flags;
    context.config = CONFIG.PROJECTANIME;
    context.damageTypeChoices = elementChoices();
    context.itemUuid = this.item.uuid;
    context.editable = this.isEditable;
    context.typeLabel = game.i18n.localize(`TYPES.Item.${this.item.type}`);
    context.typeIcon = ProjectAnimeItemSheet.TYPE_ICONS[this.item.type] ?? "fa-solid fa-cube";
    context.tabView = this.#activeTab === "view";
    context.tabEdit = this.#activeTab === "edit";
    context.tabEffects = this.#activeTab === "effects";
    context.effects = this.item.effects.map((e) => ({
      id: e.id,
      name: e.name,
      img: e.img,
      disabled: e.disabled,
      summary: summarizeRules(e)
    }));
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    context.enrichedDescription = await TE.enrichHTML(this.item.system.description ?? "", {
      relativeTo: this.item,
      secrets: this.item.isOwner
    });
    // Skills carry an auto-written, colored rules summary (the View tab + chat card). A non-blank
    // `rulesOverride` replaces it with the player's own text (enriched); blank = the live auto rules.
    if (this.item.type === "skill") {
      const override = (this.item.system.rulesOverride ?? "").trim();
      context.skillRules = override
        ? await TE.enrichHTML(this.item.system.rulesOverride, { relativeTo: this.item, secrets: this.item.isOwner })
        : skillRulesHTML(this.item);
    }
    this.#prepareTypeContext(context);
    context.displayStats = this.#buildDisplayStats(context);
    return context;
  }

  /** @override — Skill sheets get a header control into the Skill Builder wizard (built
   *  fresh each render; mutating the parent's options-backed array would duplicate it). */
  _getHeaderControls() {
    const controls = [...super._getHeaderControls()];
    if (this.item.type === "skill" && this.isEditable) {
      controls.unshift({ icon: "fa-solid fa-wand-sparkles", label: "PROJECTANIME.SkillBuilder.title", action: "openSkillBuilder" });
    }
    return controls;
  }

  /** UUID of the compendium document this item was imported from (V13 stat, legacy flag), or null. */
  #sourceUuid() {
    return this.item._stats?.compendiumSource ?? this.item.flags?.core?.sourceId ?? null;
  }

  /** @override — inject a PF2e-style "Refresh from Compendium" button directly in the window
   *  header, beside ✕. Only shown for an editable item that carries a compendium source; clicking
   *  it re-pulls the item's definition from that pack. Frame is built once, so this injects once. */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const header = frame.querySelector(".window-header");
    if (header && this.isEditable && this.#sourceUuid() && !header.querySelector(".pa-refresh-source")) {
      const label = game.i18n.localize("PROJECTANIME.Item.refreshFromCompendium");
      const btn = document.createElement("button");
      btn.type = "button";
      // `icon` restores the Font Awesome font-family (core's global button rule forces --font-sans,
      // which renders the glyph as tofu); match the ✕ button's classes exactly.
      btn.className = "header-control icon fa-solid fa-arrows-rotate pa-refresh-source";
      btn.dataset.tooltip = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); this.#refreshFromCompendium(); });
      const closeBtn = header.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.before(btn);
      else header.appendChild(btn);
    }
    return frame;
  }

  /** Reset this item's name/img/system (and embedded effects) to its compendium source, keeping
   *  the copy's own instance state — quantity, equipped, which bag it lives in — and its flags
   *  (pins, grants, source id). Confirms first: it overwrites local edits and can't be undone. */
  async #refreshFromCompendium() {
    if (!this.isEditable) return;
    const uuid = this.#sourceUuid();
    const source = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (!source) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Item.refreshNoSource"));

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Item.refreshFromCompendium") },
      content: `<p>${game.i18n.format("PROJECTANIME.Item.refreshPrompt", { name: source.name })}</p>`
    });
    if (!ok) return;

    const src = source.toObject();
    // A refresh updates the *definition* — carry over this copy's instance state (schema-backed only).
    for (const f of ["quantity", "equipped", "container"])
      if (this.item.system[f] !== undefined) src.system[f] = this.item.system[f];
    // Schema-backed system: overwriting every field to the source resets it (arrays replace, no stale keys).
    await this.item.update({ name: src.name, img: src.img, system: src.system });

    // Re-sync the item's embedded Active Effects to the source's definitions.
    const effIds = this.item.effects.map((e) => e.id);
    if (effIds.length) await this.item.deleteEmbeddedDocuments("ActiveEffect", effIds);
    if (src.effects?.length)
      await this.item.createEmbeddedDocuments("ActiveEffect", src.effects.map(({ _id, ...rest }) => rest));

    ui.notifications.info(game.i18n.format("PROJECTANIME.Item.refreshDone", { name: this.item.name }));
    this.render();
  }

  /** @override — replace native dropdowns with the themed custom widget. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    enhanceSelects(this.element);
    // Effect rows are draggable so an item's effect can be dragged onto an actor/token.
    for (const row of this.element.querySelectorAll(".effect-row[data-effect-id]")) {
      const effect = this.item.effects.get(row.dataset.effectId);
      if (!effect) continue;
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "ActiveEffect", uuid: effect.uuid }));
      });
    }
    // Armor protection split: changing one side auto-adjusts the other.
    for (const inp of this.element.querySelectorAll('[data-action="armorSplit"]')) {
      inp.addEventListener("change", (ev) => {
        const prot = this.item.system.protection ?? 0;
        const field = ev.currentTarget.name;
        const val = Math.clamp(Number(ev.currentTarget.value) || 0, 0, prot);
        const other = field === "system.defSplit" ? "system.resSplit" : "system.defSplit";
        this.item.update({ [field]: val, [other]: prot - val });
      });
    }
    // The whole sheet scrolls on .window-content; keep its position across re-renders.
    const wc = this.element.querySelector(".window-content");
    if (wc) {
      if (this.#scroll) wc.scrollTop = this.#scroll;
      if (!wc.dataset.paScroll) {
        wc.dataset.paScroll = "1";
        wc.addEventListener("scroll", () => { this.#scroll = wc.scrollTop; }, { passive: true });
      }
    }
  }

  /* -------------------------------------------- */
  /*  Context helpers                             */
  /* -------------------------------------------- */

  #attrName(key) {
    return game.i18n.localize(CONFIG.PROJECTANIME.attributes[key] ?? key);
  }

  #prepareTypeContext(context) {
    const sys = this.item.system;
    const cfg = CONFIG.PROJECTANIME;

    if (this.item.type === "skill") {
      context.isReact = sys.actionType === "react";
      context.isStrike = sys.effect === "strike";
      context.showDamageType = cfg.damageEffects.includes(sys.effect);
      // Elemental Control's free-text element (either Effect slot may hold EC).
      context.showControlElement = skillEffectKeys(sys).includes("elementalControl");
      context.showDamageDie = cfg.dieEffects.includes(sys.effect);
      context.damageDieChoices = {
        attrA: game.i18n.localize(cfg.attributes[sys.attributes?.attrA] ?? sys.attributes?.attrA ?? "attrA"),
        attrB: game.i18n.localize(cfg.attributes[sys.attributes?.attrB] ?? sys.attributes?.attrB ?? "attrB")
      };
      context.damageDieLabel = sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
      context.rangeHasTiles = rangeHasTiles(sys.range?.scope);
      context.rangeRec = cfg.rangeTiles[sys.range?.scope] ?? 0;
      context.damagePoolChoices = cfg.damagePools;
      // The HP/Energy pool field shows for Strike (which pool its damage hits) and Heal (v0.03:
      // which pool it restores).
      context.showDamagePool = cfg.poolEffects.includes(sys.effect);
      context.poolLabel = sys.effect === "mend" ? "PROJECTANIME.Skill.field.healPool" : "PROJECTANIME.Skill.field.damagePool";
      context.effectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${sys.effect}`);
      context.modifierList = Object.entries(cfg.skillModifiers).map(([key, label]) => ({
        key,
        label: game.i18n.localize(label),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        heavy: isHeavyModifier(key, sys),
        selected: (sys.modifiers ?? []).includes(key)
      }));
      // Active Skills show their Energy cost; a Passive shows its max-Energy tax instead.
      const costTag = `${sys.spCost ?? 0} SP`;
      context.summary = sys.energyCost > 0
        ? `${costTag} · ${sys.energyCost} EN`
        : (sys.actionType === "passive" && sys.passiveEnergyTax > 0 ? `${costTag} · −${sys.passiveEnergyTax} Max EN` : costTag);
    } else if (this.item.type === "weapon" || this.item.type === "shield") {
      context.accuracyFormula = `⟪${this.#attrName(sys.accuracy.attrA)}⟫ + ⟪${this.#attrName(sys.accuracy.attrB)}⟫`;
    } else if (this.item.type === "consumable") {
      context.restoreChoices = cfg.consumableRestore;
    }
  }

  /** Read-only {label, value} rows for the View tab — the item's key info, by type. */
  #buildDisplayStats(context) {
    const sys = this.item.system;
    const cfg = CONFIG.PROJECTANIME;
    const L = (k) => (k ? game.i18n.localize(k) : "");
    const signed = (n) => { const v = Number(n) || 0; return v > 0 ? `+${v}` : `${v}`; };
    const onoff = (b) => (b ? "✓" : "—");
    const rows = [];
    const push = (label, value) => { if (value !== undefined && value !== null && value !== "") rows.push({ label, value }); };
    const accuracy = () => `${context.accuracyFormula ?? ""}${sys.accuracy?.mod ? ` ${signed(sys.accuracy.mod)}` : ""}`.trim();
    const damage = () => `${signed(sys.damage?.mod)} · ${elementLabel(sys.damage?.type)}`;
    const phRange = () => physicalRangeLabel(sys.range);

    switch (this.item.type) {
      case "weapon":
        push("PROJECTANIME.Field.accuracy", accuracy());
        push("PROJECTANIME.Field.damage", damage());
        push("PROJECTANIME.Field.range", phRange());
        push("PROJECTANIME.Field.hand", L(cfg.hands[sys.hand]));
        push("PROJECTANIME.Field.grip", L(cfg.grips[sys.grip]));
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        push("PROJECTANIME.Field.equipped", onoff(sys.equipped));
        break;
      case "shield":
        if (sys.evasionBonus) push("PROJECTANIME.Field.evasionBonus", signed(sys.evasionBonus));
        if (sys.defenseBonus) push("PROJECTANIME.Field.defenseBonus", signed(sys.defenseBonus));
        push("PROJECTANIME.Field.accuracy", accuracy());
        push("PROJECTANIME.Field.damage", damage());
        push("PROJECTANIME.Field.range", phRange());
        push("PROJECTANIME.Field.hand", L(cfg.hands[sys.hand]));
        push("PROJECTANIME.Field.shieldUse", L(cfg.shieldUses[sys.use]));
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        push("PROJECTANIME.Field.equipped", onoff(sys.equipped));
        break;
      case "armor":
        push("PROJECTANIME.Field.protection", sys.protection);
        push("PROJECTANIME.Field.defSplit", sys.defSplit);
        push("PROJECTANIME.Field.resSplit", sys.resSplit);
        if (sys.evasionMod) push("PROJECTANIME.Field.evasionMod", signed(sys.evasionMod));
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        push("PROJECTANIME.Field.equipped", onoff(sys.equipped));
        break;
      case "consumable":
        push("PROJECTANIME.Field.quantity", sys.quantity);
        if (sys.restoreType && sys.restoreType !== "none")
          push("PROJECTANIME.Consumable.restoreType", `${L(cfg.consumableRestore[sys.restoreType])} ${sys.restoreAmount}`);
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        break;
      case "container":
        push("PROJECTANIME.Field.capacityBonus", `+${sys.capacityBonus ?? 0}`);
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        push("PROJECTANIME.Field.equipped", onoff(sys.equipped));
        break;
      case "accessory":
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
        push("PROJECTANIME.Field.equipped", onoff(sys.equipped));
        break;
      case "skill": {
        push("PROJECTANIME.Skill.field.spCost", `${sys.spCost ?? 0} SP`);
        push("PROJECTANIME.Skill.field.actionType", L(cfg.actionTypes[sys.actionType]));
        push("PROJECTANIME.Skill.field.effect", skillEffectKeys(sys).map((k) => L(cfg.skillEffects[k])).join(" + "));
        push("PROJECTANIME.Skill.field.target", L(cfg.skillTargets[skillTarget(sys)]));
        // Duration (rules v0.01): Standard shows its turn count; passives are always-on (no row).
        if (sys.actionType !== "passive") {
          const dur = skillDuration(sys);
          push("PROJECTANIME.Skill.field.duration", dur === "standard"
            ? `${L(cfg.skillDurations.standard)} · ${sys.effectDuration ?? cfg.standardDurationTurns} ${L("PROJECTANIME.Skill.turns")}`
            : L(cfg.skillDurations[dur]));
        }
        if (skillEvasionAttr(sys)) push("PROJECTANIME.Skill.field.skillEvasion", skillEvasionLabel(skillEvasionAttr(sys)));
        push("PROJECTANIME.Skill.field.range", rangeLabel(sys.range));
        push("PROJECTANIME.Skill.field.attrA", `${L(cfg.attributes[sys.attributes?.attrA])} + ${L(cfg.attributes[sys.attributes?.attrB])}`);
        if (cfg.dieEffects.includes(sys.effect)) push(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie", L(cfg.attributes[sys.attributes?.[sys.damageAttr]]));
        if (sys.energyCost > 0) push("PROJECTANIME.Skill.field.energyCost", sys.energyCost);
        else if (sys.actionType === "passive" && sys.passiveEnergyTax > 0) push("PROJECTANIME.Skill.field.energyTax", `−${sys.passiveEnergyTax}`);
        if (sys.accuracyMod) push("PROJECTANIME.Skill.field.accuracyMod", `+${sys.accuracyMod}`);
        if (sys.damageMod && cfg.dieEffects.includes(sys.effect)) push(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healMod" : "PROJECTANIME.Skill.field.damageMod", `+${sys.damageMod}`);
        if (sys.damageType && cfg.damageEffects.includes(sys.effect)) push("PROJECTANIME.Skill.field.damageType", elementLabel(sys.damageType));
        if ((sys.controlElement ?? "").trim() && skillEffectKeys(sys).includes("elementalControl")) push("PROJECTANIME.Skill.field.controlElement", sys.controlElement.trim());
        if (sys.actionType === "react" && sys.trigger) push("PROJECTANIME.Skill.field.trigger", L(cfg.triggers[sys.trigger]));
        if (sys.modifiers?.length) push("PROJECTANIME.Skill.field.modifiers", sys.modifiers.map((m) => L(cfg.skillModifiers[m]) || m).join(", "));
        // Inflict's chosen Status (+ its chosen pool for a pool-choice one — Barrier/Regen protect
        // or restore that pool, Curse blocks that pool's recovery).
        if ((sys.modifiers ?? []).includes("inflict") && sys.inflictStatus) {
          const cond = (cfg.statusConditions ?? []).find((c) => c.id === sys.inflictStatus);
          const hasPool = (cfg.poolChoiceStatuses ?? []).includes(sys.inflictStatus);
          push("PROJECTANIME.Skill.field.inflictStatus",
            `${cond ? L(cond.name) : sys.inflictStatus}${hasPool ? ` · ${L(cfg.damagePools[sys.inflictPool === "energy" ? "energy" : "hp"])}` : ""}`);
        }
        break;
      }
      case "package": {
        if (sys.category) push("PROJECTANIME.Package.category", sys.category);
        const n = grantRefs(this.item).length;
        if (n) push("PROJECTANIME.Package.grants", n);
        break;
      }
      default: // gear
        push("PROJECTANIME.Field.quantity", sys.quantity);
        push("PROJECTANIME.Field.size", sys.size);
        push("PROJECTANIME.Field.cost", sys.cost);
    }
    return rows;
  }

  /* -------------------------------------------- */
  /*  Action handlers (invoked with `this` = sheet) */
  /* -------------------------------------------- */

  static async #onEditImage(event, target) {
    const attr = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.document, attr);
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current,
      callback: (path) => this.document.update({ [attr]: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  /** Hand the Skill to the Builder wizard — the actor-bound flow for owned Skills (SP
   *  reconcile), the standalone flow for world/compendium ones. */
  static #onOpenSkillBuilder() {
    if (this.item.type !== "skill" || !this.isEditable) return;
    if (this.item.actor) return SkillBuilderApp.open(this.item.actor, { skillId: this.item.id });
    return SkillBuilderApp.openForItem(this.item);
  }

  static async #onToggleModifier(event, target) {
    if (!this.isEditable) return;
    const key = target.dataset.modifier;
    if (!key) return;
    const set = new Set(this.item.system.modifiers ?? []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const update = { "system.modifiers": [...set] };
    // A passive-only Modifier (Aura) forces the Skill to Passive so the field actually projects.
    if (set.has(key) && (CONFIG.PROJECTANIME.passiveOnlyModifiers ?? []).includes(key)) update["system.actionType"] = "passive";
    await this.item.update(update);
  }

  /** Switch tabs via CSS (toggle .active on the live DOM) — instant, no re-render.
   *  The <prose-mirror> editor auto-activates once on render and stays live whether its
   *  pane is CSS-hidden or shown, so a CSS toggle is safe (no re-mount needed). */
  static #onSelectTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab || tab === this.#activeTab) return;
    this.#activeTab = tab;
    for (const pane of this.element.querySelectorAll(".tab-pane"))
      pane.classList.toggle("active", pane.dataset.tabPane === tab);
    for (const btn of this.element.querySelectorAll(".item-tab"))
      btn.classList.toggle("active", btn.dataset.tab === tab);
    const wc = this.element.querySelector(".window-content");
    if (wc) { this.#scroll = 0; wc.scrollTop = 0; }
  }

  /* -------------------------------------------- */
  /*  Active Effects (no-code builder)            */
  /* -------------------------------------------- */

  /** Look up the effect for a clicked row (the row carries data-effect-id). */
  #effectFromTarget(target) {
    const id = target.closest("[data-effect-id]")?.dataset.effectId;
    return id ? this.item.effects.get(id) : null;
  }

  /** Create a transferring ActiveEffect on the item and open the builder for it. */
  static async #onAddEffect() {
    if (!this.isEditable) return;
    const [effect] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("PROJECTANIME.Effect.newEffect"),
      img: "icons/svg/aura.svg",
      transfer: true,
      disabled: false
    }]);
    if (effect) new EffectBuilder(effect).render(true);
  }

  static #onEditEffect(event, target) {
    const effect = this.#effectFromTarget(target);
    if (!effect) return;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${effect.id}`);
    if (existing) return existing.bringToFront();
    new EffectBuilder(effect).render(true);
  }

  static async #onToggleEffectEnabled(event, target) {
    if (!this.isEditable) return;
    const effect = this.#effectFromTarget(target);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static async #onDeleteEffect(event, target) {
    if (!this.isEditable) return;
    const effect = this.#effectFromTarget(target);
    if (!effect) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Effect.deleteTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Effect.deletePrompt", { name: effect.name })}</p>`
    });
    if (ok) await effect.delete();
  }
}
