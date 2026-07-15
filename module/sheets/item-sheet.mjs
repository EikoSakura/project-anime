import { enhanceSelects } from "../helpers/select.mjs";
import {
  PROJECTANIME, rangeHasTiles, skillEffectKeys, actorTalents, styleTooltipHTML,
  getTalent, effectCost, effectAttrCount, modifierCost, modifierTakes, modifierValue,
  modifierBarredByType, isSelfCenteredArea
} from "../helpers/config.mjs";
import {
  ATTR_EFFECTS, techniqueDraftFromSystem, barredTechniqueEffects, reseedEffectDefaults,
  dedupeAttrPair, toggleTechniqueModifier, normalizeTechniqueDraft, assembleTechniqueSystem,
  techniqueCommitWarnings
} from "../helpers/technique-build.mjs";
import { renderDescriptionHTML, htmlToMarkup, applyProseTool } from "../helpers/prose.mjs";
import { summarizeRules } from "../helpers/effects.mjs";
import { weaponRow, shieldRow, armorRow } from "../helpers/pack-audit.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * ApplicationV2 item sheet, PF2e-style tabs: Description (default — the locked Codex prose
 * with chat + pencil chips) | Details (the type's editable fields, compact label—field rows)
 * | Effects. Technique (`skill`) sheets swap Details for a dedicated Technique tab — the
 * build data edited in place under the wizard's own legality rules (shared brain in
 * helpers/technique-build.mjs).
 */
export class ProjectAnimeItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "item", "pa-glass", "pa-glass-frame"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimeItemSheet.#onEditImage,
      toggleModifier: ProjectAnimeItemSheet.#onToggleModifier,
      toggleCustomHeavy: ProjectAnimeItemSheet.#onToggleCustomHeavy,
      addModifierTake: ProjectAnimeItemSheet.#onAddModifierTake,
      removeModifierTake: ProjectAnimeItemSheet.#onRemoveModifierTake,
      setTwoHanded: ProjectAnimeItemSheet.#onSetTwoHanded,
      setStyle: ProjectAnimeItemSheet.#onSetStyle,
      setChoice: ProjectAnimeItemSheet.#onSetChoice,
      selectTab: ProjectAnimeItemSheet.#onSelectTab,
      addEffect: ProjectAnimeItemSheet.#onAddEffect,
      editEffect: ProjectAnimeItemSheet.#onEditEffect,
      deleteEffect: ProjectAnimeItemSheet.#onDeleteEffect,
      toggleEffectEnabled: ProjectAnimeItemSheet.#onToggleEffectEnabled,
      openSkillBuilder: ProjectAnimeItemSheet.#onOpenSkillBuilder,
      chatDescription: ProjectAnimeItemSheet.#onChatDescription,
      editDescription: ProjectAnimeItemSheet.#onEditDescription,
      saveDescription: ProjectAnimeItemSheet.#onSaveDescription,
      proseTool: ProjectAnimeItemSheet.#onProseTool
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/item/header.hbs" },
    tabs: { template: "systems/project-anime/templates/item/tabs.hbs" },
    skill: { template: "systems/project-anime/templates/item/technique.hbs", scrollable: [""] },
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

  /** Active sheet tab: "description" (default) / "technique" (skill only) / "details" /
   *  "effects". Survives re-render. */
  #activeTab = "description";

  /** PF2e-style description lock: false = rendered prose with the pencil chip; true = the markup
   *  editor is open in its place. Survives submitOnChange re-renders; reset when the sheet closes. */
  #editingDesc = false;

  /** One-shot: focus the description editor on the render right after the pencil unlock. */
  #focusDescOnRender = false;

  /** Saved scroll position of .window-content, restored after re-renders (submitOnChange). */
  #scroll = 0;

  /** The markup presented in the description editor this render (= htmlToMarkup(stored)). Lets the
   *  submit guard tell an untouched description from an edited one, so a legacy HTML value is never
   *  silently rewritten to its lossy markup form when some unrelated field is saved. */
  #presentedDescMarkup = "";

  /** Technique writes (form submits + row actions) run through one chain, so each read of the
   *  current system happens AFTER the previous write landed — a Modifier-row click can otherwise
   *  race the blur-triggered submitOnChange of the same interaction. */
  #writeChain = Promise.resolve();

  #chainWrite(fn) {
    this.#writeChain = this.#writeChain
      .then(() => fn())
      .catch((err) => console.error("Project: Anime | Technique write failed", err));
    return this.#writeChain;
  }

  /** @override — render the shared header + tabs, the description pane, the type body
   *  (Details — or the Technique editor for `skill`), and the Effects pane. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const body = this.item.type in ProjectAnimeItemSheet.PARTS ? this.item.type : "gear";
    // Render ALL parts every render; the active tab is shown via CSS (.tab-pane.active).
    // Rendering only the active tab left the previous tab's parts stale in the DOM
    // (AppV2 doesn't remove dropped parts) — which made the tabs visually "merge".
    options.parts = ["header", "tabs", "description", body, "effects"];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
    context.flags = this.item.flags;
    context.config = CONFIG.PROJECTANIME;
    context.itemUuid = this.item.uuid;
    context.editable = this.isEditable;
    context.typeLabel = game.i18n.localize(`TYPES.Item.${this.item.type}`);
    context.typeIcon = ProjectAnimeItemSheet.TYPE_ICONS[this.item.type] ?? "fa-solid fa-cube";
    // Technique sheets swap the Details tab for the Technique editor; a stale tab pick
    // (a reused sheet instance) falls back to the description.
    context.isSkill = this.item.type === "skill";
    const tabs = context.isSkill ? ["description", "technique", "effects"] : ["description", "details", "effects"];
    if (!tabs.includes(this.#activeTab)) this.#activeTab = "description";
    context.tabDescription = this.#activeTab === "description";
    context.tabTechnique = this.#activeTab === "technique";
    context.tabDetails = this.#activeTab === "details";
    context.tabEffects = this.#activeTab === "effects";
    context.effects = this.item.effects.map((e) => ({
      id: e.id,
      name: e.name,
      img: e.img,
      disabled: e.disabled,
      summary: summarizeRules(e)
    }));
    // The description is authored as light "Codex prose" markup and rendered rich (helpers/prose);
    // legacy ProseMirror HTML still renders as-is. It sits LOCKED on the View tab; the pencil chip
    // swaps in the markup editor (PF2e-style). The card hides only when there is nothing to show
    // AND no way to author it.
    context.enrichedDescription = await renderDescriptionHTML(this.item, { secrets: this.item.isOwner });
    this.#presentedDescMarkup = htmlToMarkup(this.item.system.description ?? "");
    context.descriptionMarkup = this.#presentedDescMarkup;
    context.editingDesc = this.#editingDesc && this.isEditable;
    // The description toolbar's Talent picker (inserts @talent[Name] at the caret).
    context.insertTalents = actorTalents(this.item.actor).map((t) => t.name);
    this.#prepareTypeContext(context);
    // The header's gold worth coin (cost > 0 only; Techniques/Packages have no cost field).
    context.worth = Number(this.item.system.cost) > 0 ? Number(this.item.system.cost) : null;
    return context;
  }

  /** @override — never clobber an untouched description. The editor textarea is pre-filled with
   *  the markup form of `system.description`; when its value still equals what we presented, drop
   *  it from the submit so a legacy HTML value isn't rewritten to lossy markup by an unrelated
   *  edit. Technique submits then round-trip through the shared build brain so every save obeys
   *  the wizard's legality rules — illegal combinations can't reach the database. */
  _prepareSubmitData(event, form, formData, updateData) {
    // Capture the Technique tab's non-schema effectAttr0..N picker slots BEFORE super — V14's
    // submit validation prunes unknown top-level keys in place; re-injecting after keeps both
    // cores working (on V13 this merely re-assigns the surviving keys).
    const attrSlots = {};
    if (this.item.type === "skill") {
      for (const [k, v] of Object.entries(formData.object ?? {})) if (/^effectAttr\d+$/.test(k)) attrSlots[k] = v;
    }
    const data = super._prepareSubmitData(event, form, formData, updateData);
    const presented = String(this.#presentedDescMarkup ?? "").trim();
    // Handle both submit-data shapes (nested {system:{description}} or a flattened key).
    const nested = foundry.utils.getProperty(data, "system.description");
    if (nested !== undefined && String(nested).trim() === presented) foundry.utils.deleteProperty(data, "system.description");
    else if (data["system.description"] !== undefined && String(data["system.description"]).trim() === presented) delete data["system.description"];
    if (this.item.type === "skill") return this.#prepareTechniqueSubmit(Object.assign(data, attrSlots));
    return data;
  }

  /** Normalize a Technique form submit: merge the patch over the stored system, rebuild a
   *  draft, apply the wizard's change reactions (attr-pair dedupe, Effect re-seed, range-scope
   *  tile reset, Talent validation), normalize, and re-assemble the WHOLE system so barred
   *  Modifier combinations are shed exactly like a wizard commit. An untouched description
   *  (dropped by the guard above) round-trips as the stored value — an identical string, so
   *  legacy HTML is never rewritten. */
  #prepareTechniqueSubmit(data) {
    const expanded = foundry.utils.expandObject(data ?? {});
    const patch = expanded.system;
    const attrSlots = Object.keys(expanded).filter((k) => /^effectAttr\d+$/.test(k)).sort();
    if (!patch && !attrSlots.length) return data;
    const current = this.item.system.toObject();
    const merged = foundry.utils.mergeObject(current, patch ?? {}, { inplace: false });
    // Empower/Weaken/Transform Attribute slots (effectAttr0..N, non-schema fields) → effectAttrs.
    if (attrSlots.length) {
      merged.effectAttrs = attrSlots.map((k) => expanded[k]).filter(Boolean);
      for (const k of attrSlots) delete expanded[k];
    }
    const draft = techniqueDraftFromSystem(merged);
    // Switching Range scope resets tiles to the new scope's default (the tiles input in the
    // same submit is stale).
    if (patch?.range?.scope !== undefined && patch.range.scope !== current.range?.scope) {
      draft.range.tiles = CONFIG.PROJECTANIME.rangeTiles[patch.range.scope] ?? 1;
    }
    // The fallback pair must be two DIFFERENT Attributes — the untouched one shifts.
    if (patch?.attributes) {
      dedupeAttrPair(draft, patch.attributes.attrA !== undefined && patch.attributes.attrA !== current.attributes?.attrA);
    }
    // The Talent pick — validated against the actor's embedded Talents ("" = the Attribute pair).
    if (patch?.talentId !== undefined && this.item.actor) {
      if (!this.item.actor.system?.talents?.[draft.talentId ?? ""]) draft.talentId = "";
    }
    // A new Effect re-seeds Target + Duration (+ an inherent range like Sense's 5 tiles); the
    // submitted turn count is then STALE (it belonged to the old Effect) and must not re-apply.
    const effectChanged = patch?.effect !== undefined && patch.effect !== current.effect;
    if (effectChanged) reseedEffectDefaults(draft);
    // Blank/invalid duration turns → the printed default (2).
    if (!effectChanged && patch?.effectDuration !== undefined) {
      const n = Math.round(Number(patch.effectDuration));
      draft.effectDuration = Number.isFinite(n) && n >= 1 ? n : null;
    }
    normalizeTechniqueDraft(draft);
    // The wizard refuses these at Finish; here the fields sit on the same pane, so surface the
    // rule as a toast while the player finishes the pick (only when a related field changed).
    if (patch && ["actionType", "trigger", "effect", "manifestSkillId"].some((k) => k in patch)) {
      const warns = techniqueCommitWarnings(draft, this.item.actor);
      if (warns.length) ui.notifications.warn(game.i18n.localize(warns[0]));
    }
    expanded.system = assembleTechniqueSystem(draft);
    return expanded;
  }

  /** @override — Technique submits join the same write chain as the row actions, so two writes
   *  from one interaction (field blur + row click) always land in order. */
  async _processSubmitData(event, form, submitData, options) {
    if (this.item.type !== "skill") return super._processSubmitData(event, form, submitData, options);
    return this.#chainWrite(() => super._processSubmitData(event, form, submitData, options));
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
    // Description just unlocked — put the caret in the editor (end of text), once per unlock.
    if (this.#focusDescOnRender) {
      this.#focusDescOnRender = false;
      const ta = this.element.querySelector('.desc-pane-edit textarea[name="system.description"]');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
    // Talent insert picker (description toolbar) — drop @talent[Name] at the caret and save,
    // like the other prose tools. stopPropagation keeps the unnamed select clear of the form's
    // submitOnChange handling.
    const talSel = this.element.querySelector("select.desc-tool-talent");
    if (talSel) talSel.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const name = talSel.value;
      if (!name || !this.isEditable) return;
      const ta = this.element.querySelector('textarea[name="system.description"]');
      if (!ta) return;
      const next = applyProseTool(ta.value, ta.selectionStart, ta.selectionEnd, "talent", this.item, name);
      if (next !== ta.value) await this.item.update({ "system.description": next });
    });
  }

  /** @override — the sheet instance is reused across opens: re-lock the description so a window
   *  closed mid-edit reopens on the rendered prose, like PF2e's re-render restore. */
  _onClose(options) {
    this.#editingDesc = false;
    super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context helpers                             */
  /* -------------------------------------------- */

  #prepareTypeContext(context) {
    const sys = this.item.system;
    const cfg = CONFIG.PROJECTANIME;

    if (this.item.type === "skill") {
      context.tech = this.#prepareTechniqueContext();
      // Active Techniques show their Energy cost; a Passive shows the boxes it locks instead.
      context.summary = sys.energyCost > 0
        ? `${sys.energyCost} ${game.i18n.localize("PROJECTANIME.Stat.energyAbbr")}`
        : (sys.passiveEnergyTax > 0 ? game.i18n.format("PROJECTANIME.Skill.locks", { n: sys.passiveEnergyTax }) : "");
    } else if (this.item.type === "shield") {
      // Wield As segmented toggle: only two choices, so a single boolean drives both buttons.
      context.shieldUseDual = sys.use === "dual";
    } else if (this.item.type === "consumable") {
      context.restoreChoices = cfg.consumableRestore;
    }

    // Weapons and shields may link an embedded Talent (rolled alongside the Paired Attribute).
    if ((this.item.type === "weapon" || this.item.type === "shield") && this.item.actor) {
      context.talentChoices = actorTalents(this.item.actor)
        .map((t) => ({ id: t.id, name: t.name, die: t.die, selected: sys.talentId === t.id }));
    }

    // Style picker — one image tile per printed Style, alphabetized; hover shows the printed
    // line as a rich tooltip, click stamps it onto the item (clicking the active tile just
    // unsets the Style tag).
    const styleTable = ProjectAnimeItemSheet.STYLE_TABLES[this.item.type];
    if (styleTable) {
      const { styles, keys, kind } = styleTable();
      context.styleTiles = keys.map((key) => ({
        key,
        icon: styles[key].icon,
        label: game.i18n.localize(styles[key].label),
        selected: sys.style === key,
        tooltip: styleTooltipHTML(styles[key], kind)
      })).sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  /** The Style tables per item type (weapon 7 · shield 2 · armor 4). */
  static STYLE_TABLES = {
    weapon: () => ({ styles: PROJECTANIME.weaponStyles, keys: PROJECTANIME.weaponStyleKeys, kind: "PROJECTANIME.Style.weapon" }),
    shield: () => ({ styles: PROJECTANIME.shieldStyles, keys: PROJECTANIME.shieldStyleKeys, kind: "PROJECTANIME.Style.shield" }),
    armor: () => ({ styles: PROJECTANIME.armorStyles, keys: PROJECTANIME.armorStyleKeys, kind: "PROJECTANIME.Style.armor" })
  };

  /** Click a Style tile: stamp the printed line (Damage/Threshold/Range/Guard/Movement/
   *  properties) onto the item. Clicking the active tile unsets the Style tag only — the
   *  stamped numbers stay for homebrew tuning. */
  static async #onSetStyle(event, target) {
    const key = target.dataset.style;
    if (this.item.system.style === key) return this.item.update({ "system.style": "" });
    const row = this.item.type === "weapon" && PROJECTANIME.weaponStyles[key] ? weaponRow(key)
      : this.item.type === "shield" && PROJECTANIME.shieldStyles[key] ? shieldRow(key)
      : this.item.type === "armor" && PROJECTANIME.armorStyles[key] ? armorRow(key)
      : null;
    if (row) await this.item.update(row);
  }

  /** Context for the Technique tab — the wizard's fields shaped for editing IN PLACE off the
   *  item's current system. This only READS: every value the tab writes round-trips through
   *  #prepareTechniqueSubmit (form fields) or #updateTechnique (row actions), so the shared
   *  build brain enforces the same legality as the wizard. */
  #prepareTechniqueContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.item.system;
    const actor = this.item.actor;
    const mods = sys.modifiers ?? [];
    const t = {};

    const isCompanion = sys.effect === "companion";
    const passive = sys.actionType === "passive" || isCompanion;
    t.isCompanion = isCompanion;
    t.actionTypeLocked = isCompanion;
    t.actionTypeChoices = cfg.actionTypes;
    t.isReact = !isCompanion && sys.actionType === "react";
    t.showPassiveMode = passive && !isCompanion;
    t.passiveModeChoices = cfg.passiveModes;
    t.triggerChoices = cfg.triggers;

    // Roll — the bound Talent (with die), or the two-Attribute fallback pair.
    const talents = actorTalents(actor);
    t.hasTalents = talents.length > 0;
    t.talentChoices = Object.fromEntries(talents.map((x) => [
      x.id, `${x.name} · d${x.die} ${game.i18n.localize(cfg.attributes[x.attribute] ?? "")}`
    ]));
    t.hasTalentSelected = !!getTalent(actor, sys.talentId);
    t.attributeChoices = cfg.attributes;

    // Effects list: the V2 printing minus retired entries (unless one IS the current pick);
    // a raised Servant / bonded Companion can never take the Companion Effect.
    const servantBarred = barredTechniqueEffects(actor);
    const retired = cfg.retiredEffects ?? [];
    const effectOption = (k, label, cur) => ({
      key: k,
      label: effectCost(k) ? `${game.i18n.localize(label)} · ${effectCost(k)}` : game.i18n.localize(label),
      selected: k === cur
    });
    t.effectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !servantBarred.includes(k) && (!retired.includes(k) || k === sys.effect))
      .map(([k, label]) => effectOption(k, label, sys.effect));
    // Control's free-text element (either Effect slot may hold it).
    t.showControlElement = skillEffectKeys(sys).includes("elementalControl");
    t.showDamagePool = (cfg.poolEffects ?? []).includes(sys.effect);
    t.poolLabel = "PROJECTANIME.Skill.field.healPool";
    t.damagePoolChoices = cfg.damagePools;
    t.isAttrEffect = ATTR_EFFECTS.includes(sys.effect);
    t.isHinder = sys.effect === "hinder";
    const attrSeed = sys.effectAttrs ?? [];
    if (t.isAttrEffect) {
      t.effectAttrPickers = Array.from({ length: effectAttrCount(sys.effect) }, (_, i) => ({ index: i, value: attrSeed[i] ?? "" }));
    }

    // Range & Duration.
    t.rangeChoices = cfg.ranges;
    t.rangeHasTiles = rangeHasTiles(sys.range?.scope);
    t.durationChoices = { instant: cfg.skillDurations.instant, standard: cfg.skillDurations.standard };
    t.durationLocked = mods.includes("channeled") ? game.i18n.localize(cfg.skillDurations.channeled)
      : mods.includes("scene") ? game.i18n.localize(cfg.skillDurations.scene)
      : (cfg.sceneEffects ?? []).includes(sys.effect) ? game.i18n.localize(cfg.skillDurations.scene) : "";
    t.showDurationTurns = !t.durationLocked && sys.duration !== "instant";

    // Target — an Aura (or a self-centered Burst) needs a real audience; a non-area
    // Self-Range Technique locks onto the caster.
    const auraOn = mods.includes("aura");
    const selfArea = isSelfCenteredArea(sys);
    t.targetChoices = (auraOn || selfArea)
      ? Object.fromEntries(Object.entries(cfg.skillTargets).filter(([k]) => k !== "self"))
      : cfg.skillTargets;
    t.targetLocked = !auraOn && !selfArea && sys.range?.scope === "self";

    // Live cost readout: an Active pays its total per use; a Passive locks that many boxes.
    t.isPassiveCost = passive;
    t.liveEnergy = Number(sys.totalCost) || 0;
    // Resistance (rules: Resistance) — every Technique carries one, derived from its build.
    t.resistance = sys.resistance;

    // Modifier grid — the wizard's rows: cost tier groups, legality blocks, scaled values,
    // per-Modifier creation-time picks. Descriptions ride as tooltips.
    const gateBuilt = skillEffectKeys(sys).includes("gate");
    const conditionLabel = (id) => {
      const c = (cfg.statusConditions ?? []).find((x) => x.id === id);
      return c ? game.i18n.localize(c.name) : id;
    };
    t.inflictChoices = Object.fromEntries((cfg.inflictStatuses ?? []).map((id) => [id, conditionLabel(id)]));
    t.inflictSevereChoices = Object.fromEntries((cfg.inflictSevereStatuses ?? []).map((id) => [id, conditionLabel(id)]));
    t.inflictSevereHasPool = mods.includes("inflictSevere") && (cfg.poolChoiceStatuses ?? []).includes(sys.inflictSevereStatus);
    t.analyzeChoices = Object.fromEntries(Object.entries(cfg.analyzeCategories).map(([k, v]) => [k, game.i18n.localize(v)]));
    t.manifestChoices = Object.fromEntries((actor?.items ?? [])
      .filter((i) => i.type === "skill" && i.id !== this.item.id
        && i.system.actionType === "passive" && i.system.effect !== "companion")
      .map((i) => [i.id, i.name]));
    t.manifestHasChoices = Object.keys(t.manifestChoices).length > 0;

    const noMods = (cfg.noModifierEffects ?? []).includes(sys.effect);
    const modRow = (key) => {
      const selected = mods.includes(key);
      const isCustom = key === "custom";
      const multiTake = (cfg.multiTakeModifiers ?? []).includes(key);
      const takes = multiTake ? modifierTakes(key, sys) : 1;
      const blocked = !selected && (noMods || modifierBarredByType(key, { actionType: sys.actionType, effect: sys.effect }));
      const scaled = key in (cfg.scaledModifiers ?? {})
        ? `${modifierValue(this.item, key)} ${game.i18n.localize("PROJECTANIME.Skill.tiles")}` : "";
      return {
        key,
        label: game.i18n.localize(cfg.skillModifiers[key] ?? key),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        cost: modifierCost(key, sys) * takes,
        scaled,
        selected,
        blocked,
        isCustom,
        customHeavy: isCustom && !!sys.customModifierHeavy,
        multiTake: selected && multiTake,
        takes,
        canTakeAgain: selected && multiTake && takes < 2,
        canDropTake: selected && multiTake && takes > 1,
        showInflict: selected && key === "inflict",
        showInflictSevere: selected && key === "inflictSevere",
        showDrain: selected && key === "drain",
        showPotent: selected && key === "potent",
        showAnalyze: selected && key === "analyze",
        showManifest: selected && key === "manifest" && t.manifestHasChoices,
        hasConfig: selected && (["inflict", "inflictSevere", "drain", "potent", "analyze"].includes(key)
          || (key === "manifest" && t.manifestHasChoices))
      };
    };
    // Grouped by cost tier (rules: Modifiers): Standard +1 · Heavy 🔶 +2 · Extreme +3.
    // Waypoint (Gate only) lists only while a Gate is built (or it's already selected).
    const allKeys = Object.keys(cfg.skillModifiers)
      .filter((k) => !(cfg.freeModifiers ?? []).includes(k))
      .filter((k) => k !== "waypoint" || gateBuilt || mods.includes("waypoint"));
    const tierOf = (k) => (cfg.extremeModifiers.includes(k) ? "extreme" : cfg.heavyModifiers.includes(k) ? "heavy" : "standard");
    const byLabel = (a, b) => a.label.localeCompare(b.label);
    t.modGroups = ["standard", "heavy", "extreme"].map((tier) => ({
      label: game.i18n.localize(`PROJECTANIME.SkillBuilder.modGroup.${tier}`),
      mods: allKeys.filter((k) => tierOf(k) === tier).map(modRow).sort(byLabel)
    })).filter((g) => g.mods.length);

    // "Secondary Effect" Modifier — the second Effect picker + its creation-time picks
    // (Companion / Animate can't ride along: they take no Modifiers, so they can't BE one).
    const secActive = mods.includes("secondaryEffect");
    const secEffect = sys.secondaryEffect || "strike";
    const noSecondary = ["passive", "animate", "companion"];
    t.secondaryActive = secActive;
    t.secondaryEffectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !noSecondary.includes(k) && !servantBarred.includes(k) && (!retired.includes(k) || k === secEffect))
      .map(([k, label]) => effectOption(k, label, secEffect));
    t.showSecondaryPool = secActive && (cfg.poolEffects ?? []).includes(secEffect);
    t.secondaryIsAttrEffect = secActive && ATTR_EFFECTS.includes(secEffect) && !t.isAttrEffect;
    if (t.secondaryIsAttrEffect) {
      t.secondaryAttrPickers = Array.from({ length: effectAttrCount(secEffect) }, (_, i) => ({ index: i, value: attrSeed[i] ?? "" }));
    }
    t.secondaryIsHinder = secEffect === "hinder";

    return t;
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

  /** Post the item's identity + description card to chat (the send-to-chat chip). */
  static #onChatDescription() {
    return this.item.toChat();
  }

  /** Unlock the description (the pencil chip, PF2e-style): swap the rendered prose for the
   *  markup editor in place. */
  static #onEditDescription() {
    if (!this.isEditable || this.#editingDesc) return;
    this.#editingDesc = true;
    this.#focusDescOnRender = true;
    this.render();
  }

  /** Save the description and re-lock: read the live textarea (unsaved typing included), persist
   *  when it actually changed, and re-render back to the locked prose view. */
  static async #onSaveDescription() {
    if (!this.isEditable) return;
    const ta = this.element.querySelector('textarea[name="system.description"]');
    this.#editingDesc = false;
    const val = ta ? String(ta.value) : null;
    if (val !== null && val.trim() !== String(this.#presentedDescMarkup ?? "").trim()) {
      await this.item.update({ "system.description": val });
    } else {
      this.render();
    }
  }

  /** Codex-prose toolbar — insert markup into the `data-target` textarea from a `data-tool`:
   *  wrap the selection (highlight / gold / bold), prefix the current line (heading / list /
   *  Label / outcome block — Hit / Resistance / Threshold insert their CALCULATED values), or drop
   *  a divider. Reads the live textarea, then saves. */
  static async #onProseTool(event, target) {
    if (!this.isEditable) return;
    const name = target.dataset.target;
    const ta = name && this.element.querySelector(`textarea[name="${name}"]`);
    if (!ta) return;
    const next = applyProseTool(ta.value, ta.selectionStart, ta.selectionEnd, target.dataset.tool, this.item);
    if (next !== ta.value) await this.item.update({ [name]: next });
  }

  /** Segmented handedness toggle (weapon Edit) — set whether the weapon is inherently Two-Handed.
   *  Driven as an action (not a bound field) so the Boolean isn't clobbered by "true"/"false"
   *  string coercion; `grip` follows in the model's derived data. */
  static async #onSetTwoHanded(event, target) {
    if (!this.isEditable) return;
    const two = target.dataset.two === "true";
    if (!!this.item.system.twoHandedOnly === two) return;
    await this.item.update({ "system.twoHandedOnly": two });
  }

  /** Generic segmented-choice toggle for a string field (e.g. shield Wield As) — set the field
   *  named in `data-field` to `data-value`. Action-driven so it reads like the Handedness toggle. */
  static async #onSetChoice(event, target) {
    if (!this.isEditable) return;
    const field = target.dataset.field;
    const value = target.dataset.value;
    if (!field || foundry.utils.getProperty(this.item, field) === value) return;
    await this.item.update({ [field]: value });
  }

  /** Round-trip a Technique mutation through the shared build brain: current system → draft →
   *  mutate → normalize → assemble → save. A refused mutation ({ok:false, warn}) surfaces the
   *  wizard's own warning instead of saving; a NEWLY-introduced commit warning (React without a
   *  Trigger, Manifest without a bound Passive) toasts but still saves — the config picker the
   *  player needs appears on the freshly-saved state. Chained so the read never races an
   *  in-flight submit. */
  async #updateTechnique(mutate) {
    if (!this.isEditable || this.item.type !== "skill") return;
    return this.#chainWrite(async () => {
      const draft = techniqueDraftFromSystem(this.item.system.toObject());
      const before = techniqueCommitWarnings(draft, this.item.actor);
      const res = mutate(draft);
      if (res && res.ok === false) return void ui.notifications.warn(game.i18n.localize(res.warn));
      normalizeTechniqueDraft(draft);
      const fresh = techniqueCommitWarnings(draft, this.item.actor).filter((w) => !before.includes(w));
      if (fresh.length) ui.notifications.warn(game.i18n.localize(fresh[0]));
      await this.item.update({ system: assembleTechniqueSystem(draft) });
    });
  }

  /** Toggle a Modifier on the Technique tab — same legality as the wizard (shared brain). */
  static async #onToggleModifier(event, target) {
    if (!this.isEditable) return;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key) return;
    // A row's inline option chips (Custom's Heavy, a multi-take's takes) and in-row config
    // pickers live inside the row — ignore clicks on them so making a choice never de-selects it.
    if (event.target.closest(".tech-mod-opts, .tech-mod-config")) return;
    await this.#updateTechnique((d) => toggleTechniqueModifier(d, key));
  }

  /** Take a multi-take Modifier (Potent / Keen) a second time (rules: "Can be taken twice")
   *  — its cost counts per take. */
  static async #onAddModifierTake(event, target) {
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!(PROJECTANIME.multiTakeModifiers ?? []).includes(key)) return;
    await this.#updateTechnique((d) => {
      if (d.modifiers.includes(key)) d[`${key}Count`] = Math.min(2, (Number(d[`${key}Count`]) || 1) + 1);
    });
  }

  /** Drop one take (never the last — un-tick the row for that). */
  static async #onRemoveModifierTake(event, target) {
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!(PROJECTANIME.multiTakeModifiers ?? []).includes(key)) return;
    await this.#updateTechnique((d) => {
      if (d.modifiers.includes(key)) d[`${key}Count`] = Math.max(1, (Number(d[`${key}Count`]) || 1) - 1);
    });
  }

  /** Flip the free-form "Custom" Modifier's Heavy flag (its end-of-row chip): +1 ⇄ +2 Energy. */
  static async #onToggleCustomHeavy() {
    await this.#updateTechnique((d) => {
      if (d.modifiers.includes("custom")) d.customModifierHeavy = !d.customModifierHeavy;
    });
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
