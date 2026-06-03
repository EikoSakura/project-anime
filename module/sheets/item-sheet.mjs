import { enhanceSelects } from "../helpers/select.mjs";
import { elementChoices, elementLabel } from "../helpers/elements.mjs";
import { rangeLabel, rangeHasTiles, skillEffectKeys } from "../helpers/config.mjs";
import { skillRulesHTML } from "../helpers/skill-description.mjs";
import { summarizeRules, grantRefs } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";

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
      toggleEffectEnabled: ProjectAnimeItemSheet.#onToggleEffectEnabled
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
      context.showDamageDie = cfg.dieEffects.includes(sys.effect);
      context.damageDieChoices = {
        attrA: game.i18n.localize(cfg.attributes[sys.attributes?.attrA] ?? sys.attributes?.attrA ?? "attrA"),
        attrB: game.i18n.localize(cfg.attributes[sys.attributes?.attrB] ?? sys.attributes?.attrB ?? "attrB")
      };
      context.damageDieLabel = sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
      context.rangeHasTiles = rangeHasTiles(sys.range?.scope);
      context.rangeRec = cfg.rangeTiles[sys.range?.scope] ?? 0;
      context.damagePoolChoices = cfg.damagePools;
      // The HP/Energy pool field shows for Strike (which pool its damage hits) and Sustain
      // (which pool it regenerates); the label adapts (Damage Pool vs Regen Pool).
      context.showDamagePool = cfg.poolEffects.includes(sys.effect);
      context.poolLabel = sys.effect === "sustain" ? "PROJECTANIME.Skill.field.regenPool" : "PROJECTANIME.Skill.field.damagePool";
      context.rankInfo = cfg.skillRanks[sys.rank] ?? {};
      context.rankChoices = Object.fromEntries(
        Object.entries(cfg.skillRanks).map(([k, v]) => [k, `${v.stars} ${game.i18n.localize(v.label)}`])
      );
      context.effectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${sys.effect}`);
      context.modifierList = Object.entries(cfg.skillModifiers).map(([key, label]) => ({
        key,
        label: game.i18n.localize(label),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        heavy: cfg.heavyModifiers.includes(key),
        selected: (sys.modifiers ?? []).includes(key)
      }));
      // Passive Skills cost no Energy, so the header summary is just the rank stars.
      context.summary = sys.energyCost > 0
        ? `${context.rankInfo.stars ?? ""} · ${sys.energyCost} EN`
        : `${context.rankInfo.stars ?? ""}`;
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
    const phRange = () => `${L(cfg.rangeTypes[sys.range?.type])} · ${sys.range?.tiles ?? 0}`;

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
        push("PROJECTANIME.Field.defenseBonus", signed(sys.defenseBonus));
        push("PROJECTANIME.Field.evasionPenalty", `−${sys.evasionPenalty ?? 0}`);
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
        const r = cfg.skillRanks[sys.rank] ?? {};
        push("PROJECTANIME.Skill.field.rank", `${r.stars ?? ""} ${L(r.label)}`.trim());
        push("PROJECTANIME.Skill.field.actionType", L(cfg.actionTypes[sys.actionType]));
        push("PROJECTANIME.Skill.field.effect", skillEffectKeys(sys).map((k) => L(cfg.skillEffects[k])).join(" + "));
        push("PROJECTANIME.Skill.field.range", rangeLabel(sys.range));
        push("PROJECTANIME.Skill.field.attrA", `${L(cfg.attributes[sys.attributes?.attrA])} + ${L(cfg.attributes[sys.attributes?.attrB])}`);
        if (cfg.dieEffects.includes(sys.effect)) push(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie", L(cfg.attributes[sys.attributes?.[sys.damageAttr]]));
        if (sys.energyCost > 0) push("PROJECTANIME.Skill.field.energyCost", sys.energyCost);
        push("PROJECTANIME.Skill.field.spCost", sys.spCost);
        if (sys.accuracyMod) push("PROJECTANIME.Skill.field.accuracyMod", `+${sys.accuracyMod}`);
        if (sys.damageMod && cfg.dieEffects.includes(sys.effect)) push(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healMod" : "PROJECTANIME.Skill.field.damageMod", `+${sys.damageMod}`);
        if (sys.damageType && cfg.damageEffects.includes(sys.effect)) push("PROJECTANIME.Skill.field.damageType", elementLabel(sys.damageType));
        if (sys.actionType === "react" && sys.trigger) push("PROJECTANIME.Skill.field.trigger", L(cfg.triggers[sys.trigger]));
        if (sys.modifiers?.length) push("PROJECTANIME.Skill.field.modifiers", sys.modifiers.map((m) => L(cfg.skillModifiers[m]) || m).join(", "));
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

  static async #onToggleModifier(event, target) {
    if (!this.isEditable) return;
    const key = target.dataset.modifier;
    if (!key) return;
    const set = new Set(this.item.system.modifiers ?? []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    await this.item.update({ "system.modifiers": [...set] });
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
