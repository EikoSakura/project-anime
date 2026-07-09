import { rollCheck, useConsumable, contextRemoveEffect, postCard, cardHTML } from "../helpers/dice.mjs";
import { enhanceSelects } from "../helpers/select.mjs";
import { PROJECTANIME, rangeLabel, physicalRangeLabel, skillEffectKeys, getTalent, isCompanion } from "../helpers/config.mjs";
import { isImageIcon } from "../helpers/config.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { summarizeRules, applyEffectCopy } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { AdvancementApp } from "../apps/advancement.mjs";
import { RestApp } from "../apps/rest.mjs";
import { renderDescriptionBlock, renderDescriptionHTML } from "../helpers/prose.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";
import { CharacterCreatorApp } from "../apps/character-creator.mjs";
import { MonsterCreatorApp } from "../apps/monster-creator.mjs";
import { SkillLogApp } from "../apps/skill-log.mjs";
import { advancementLedger } from "../helpers/skill-points.mjs";
import { confirmAndDismiss } from "../helpers/servants.mjs";
import {
  GEAR_GROUPS, EQUIPPABLE, SLOT_ACCEPTS, bySort,
  buildGearContext, slotOccupant, equipToSlot, equipToAvailableHand, clearSlot, importDroppedItem, readDrag, draggedItem
} from "../helpers/gear.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

// Gear constants + the paperdoll/bag/equip/transfer logic live in helpers/gear.mjs, shared with the
// Monster Creator's Gear step. This sheet keeps its own action handlers, popovers, and DnD bindings.

/** Sections that open as slide-in drawers (Stats is the always-visible main view). */
const DRAWER_SECTIONS = ["skills", "gear", "biography", "defenses", "effects"];

/**
 * ApplicationV2 actor sheet shared by Character and NPC. Stats is the always-on
 * main view; Skills, Gear, Biography and Defenses open as slide-in drawers.
 */
export class ProjectAnimeActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "actor"],
    position: { width: 820, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimeActorSheet.#onEditImage,
      rollCheck: ProjectAnimeActorSheet.#onRollCheck,
      createItem: ProjectAnimeActorSheet.#onCreateItem,
      createMenu: ProjectAnimeActorSheet.#onCreateMenu,
      editItem: ProjectAnimeActorSheet.#onEditItem,
      deleteItem: ProjectAnimeActorSheet.#onDeleteItem,
      rollItem: ProjectAnimeActorSheet.#onRollItem,
      postItem: ProjectAnimeActorSheet.#onPostItem,
      addReadied: ProjectAnimeActorSheet.#onAddReadied,
      unreadySkill: ProjectAnimeActorSheet.#onUnreadySkill,
      togglePin: ProjectAnimeActorSheet.#onTogglePin,
      toggleEquip: ProjectAnimeActorSheet.#onToggleEquip,
      pickSlot: ProjectAnimeActorSheet.#onPickSlot,
      unequipSlot: ProjectAnimeActorSheet.#onUnequipSlot,
      cycleShieldUse: ProjectAnimeActorSheet.#onCycleShieldUse,
      cycleGrip: ProjectAnimeActorSheet.#onCycleGrip,
      selectBag: ProjectAnimeActorSheet.#onSelectBag,
      toggleBagView: ProjectAnimeActorSheet.#onToggleBagView,
      toggleCondition: ProjectAnimeActorSheet.#onToggleCondition,
      toggleEffectEnabled: ProjectAnimeActorSheet.#onToggleEffectEnabled,
      flipToggle: ProjectAnimeActorSheet.#onFlipToggle,
      addActorEffect: ProjectAnimeActorSheet.#onAddActorEffect,
      editActorEffect: ProjectAnimeActorSheet.#onEditActorEffect,
      deleteActorEffect: ProjectAnimeActorSheet.#onDeleteActorEffect,
      openDrawer: ProjectAnimeActorSheet.#onOpenDrawer,
      closeDrawer: ProjectAnimeActorSheet.#onCloseDrawer,
      addTalent: ProjectAnimeActorSheet.#onAddTalent,
      editTalent: ProjectAnimeActorSheet.#onEditTalent,
      postTalent: ProjectAnimeActorSheet.#onPostTalent,
      addWound: ProjectAnimeActorSheet.#onAddWound,
      removeWound: ProjectAnimeActorSheet.#onRemoveWound,
      setResourceBox: ProjectAnimeActorSheet.#onSetResourceBox,
      openAdvancement: ProjectAnimeActorSheet.#onOpenAdvancement,
      openRest: ProjectAnimeActorSheet.#onOpenRest,
      buildSkill: ProjectAnimeActorSheet.#onBuildSkill,
      openCreator: ProjectAnimeActorSheet.#onOpenCreator,
      openSkillLog: ProjectAnimeActorSheet.#onOpenSkillLog,
      dismissServant: ProjectAnimeActorSheet.#onDismissServant
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/actor/header.hbs" },
    stats: { template: "systems/project-anime/templates/actor/stats.hbs", scrollable: [""] },
    skills: { template: "systems/project-anime/templates/actor/skills.hbs", scrollable: [""] },
    gear: { template: "systems/project-anime/templates/actor/gear.hbs", scrollable: [""] },
    biography: { template: "systems/project-anime/templates/actor/biography.hbs", scrollable: [""] },
    defenses: { template: "systems/project-anime/templates/actor/defenses-drawer.hbs" },
    effects: { template: "systems/project-anime/templates/actor/effects-drawer.hbs" }
  };

  /** Which section drawer is open ("skills"/"gear"/"biography"/"defenses"), or null.
   *  Transient UI state; re-applied on render so it survives re-renders. */
  #openSection = null;

  /** Which bag (container) the Gear inventory is scoped to: "" = backpack, else a
   *  container item id. Drives the WoW-style bag view; survives re-renders. */
  #selectedBag = "";

  /** Gear inventory view: "single" (one open bag) or "combined" (all bags as sections, WoW
   *  Combine-Bags style). Persisted per user so it sticks across reloads. */
  #bagView = game.user?.getFlag("project-anime", "bagView") || "single";

  /** Skills drawer filter — a set of selected action-type chips ("action"/"react"/"passive";
   *  empty = "all", i.e. show everything) plus the name-search query. Multi-select: chips
   *  union, so Active + React shows both. Client-side only (no re-render); survives re-renders. */
  #skillFilters = new Set();
  #skillQuery = "";

  /** @override — a raised servant's sheet gets a "Dismiss" header control (its owner only): a
   *  persistent release path beside the Animate raise card's button. Built fresh each render so
   *  the options-backed parent array isn't mutated (which would duplicate it). */
  _getHeaderControls() {
    const controls = [...super._getHeaderControls()];
    if (this.actor.getFlag("project-anime", "servantOf") && this.actor.isOwner) {
      controls.unshift({ icon: "fas fa-person-walking-arrow-loop-left", label: "PROJECTANIME.Servant.dismiss", action: "dismissServant" });
    }
    return controls;
  }

  /** @override — choose which parts render (handles the limited-permission view). */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = ["header"];
    if (this.document.limited) {
      options.parts.push("biography");
      return;
    }
    options.parts.push("stats", "skills", "gear", "biography", "defenses", "effects");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.editable = this.isEditable;
    context.owner = this.document.isOwner;
    context.limited = this.document.limited;
    context.actor = this.actor;
    context.system = this.actor.system;
    context.flags = this.actor.flags;
    context.config = CONFIG.PROJECTANIME;
    context.isCharacter = this.actor.type === "character";
    context.isNPC = this.actor.type === "npc";
    // Enemy Type badge (V2) — shows the Type + a Rival / Boss chip when flagged. Threat is
    // the encounter cost. A Companion (bonded, hand-typed, or folder-filed) wears its own
    // paw chip instead — no Threat, it never enters the encounter budget.
    const eType = context.isNPC ? this.actor.system.npcType : "";
    const typeCfg = eType ? CONFIG.PROJECTANIME.enemyTypes?.[eType] : null;
    context.tierBadge = typeCfg
      ? { label: game.i18n.localize(typeCfg.label), icon: typeCfg.icon, color: typeCfg.color,
          tierNumeral: "",
          rival: !!this.actor.system.rival,
          boss: !!this.actor.system.boss?.enabled,
          threat: this.actor.system.rival ? PROJECTANIME.rivalThreat : (typeCfg.threat ?? 1) }
      : (context.isNPC && isCompanion(this.actor))
        ? { label: game.i18n.localize(PROJECTANIME.companion.label), icon: PROJECTANIME.companion.icon,
            color: PROJECTANIME.companion.color, tierNumeral: "", rival: false, boss: false, threat: null }
        : null;
    // Boss Bars readout: the pip strip under the header + the current-Bar note.
    context.bossBars = (context.isNPC && this.actor.system.boss?.enabled)
      ? { remaining: Number(this.actor.system.boss.remaining) || 0,
          total: Number(this.actor.system.boss.bars) || 0,
          broken: Number(this.actor.system.boss.broken) || 0,
          pips: Array.from({ length: Number(this.actor.system.boss.bars) || 0 }, (_, i) => ({ full: i < (Number(this.actor.system.boss.remaining) || 0) })) }
      : null;
    // The toggled <prose-mirror> shows enriched HTML while collapsed and loads the raw
    // value (+ this UUID, for content links) when editing — the PF2e click-to-edit
    // pattern. The enriched content is injected as the element's inner HTML.
    context.actorUuid = this.actor.uuid;
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    context.enrichedBiography = await TE.enrichHTML(this.actor.system.biography ?? "", {
      relativeTo: this.actor,
      secrets: this.actor.isOwner
    });
    // GM-configurable Bio "dossier" fields (label/icon/type from the world setting)
    // paired with this actor's stored value. The list is shared; values live in
    // details.<key>. `long` fields render as a full-width textarea, else an input.
    const details = this.actor.system.details ?? {};
    context.bioFields = getBioFields().map((f) => ({
      key: f.key,
      label: f.label,
      value: details[f.key] ?? "",
      icon: f.icon,
      iconImg: isImageIcon(f.icon),
      long: f.type === "long"
    }));
    // Which section drawer is open — drives `{{#if open.<section>}}` in the templates.
    context.open = Object.fromEntries(DRAWER_SECTIONS.map((s) => [s, this.#openSection === s]));

    // Resource mark boxes — one box per point, MARKED as damage lands / energy is spent (the
    // printed convention: start at 0 marks, work up to full). Storage keeps `value` = remaining,
    // so marks = max − value; the paired inputs also read in marks (see #bindMarkedInputs).
    // LOCKED boxes (Wound-locked hit boxes, Passive/Servant-locked energy boxes) still render,
    // padlocked at the top of the strip: locked = authored max − effective max. A Boss's Bar
    // override REPLACES the max rather than locking boxes, so it shows none.
    const hp = this.actor.system.hp ?? {};
    const energy = this.actor.system.energy ?? {};
    const marks = (res) => Math.clamp((res.max ?? 0) - (res.value ?? 0), 0, Math.max(res.max ?? 0, 0));
    const boxes = (res, locked) => [
      ...Array.fromRange(Math.max(res.max ?? 0, 0)).map((i) => ({ n: i + 1, marked: i < marks(res) })),
      ...Array.fromRange(Math.max(locked, 0)).map(() => ({ locked: true }))
    ];
    const hpAuthored = Math.clamp(this.actor._source.system?.hp?.max ?? (hp.max ?? 0), 1, CONFIG.PROJECTANIME.maxBoxes ?? 10);
    const hpLocked = this.actor.system.boss?.enabled ? 0 : Math.max(0, hpAuthored - (hp.max ?? 0));
    const energyLocked = Math.max(0, (energy.base ?? energy.max ?? 0) - (energy.max ?? 0));
    context.hpBoxes = boxes(hp, hpLocked);
    context.energyBoxes = boxes(energy, energyLocked);
    context.hpMarked = marks(hp);
    context.energyMarked = marks(energy);

    // Toggleable status conditions and their active state.
    const cfg = CONFIG.PROJECTANIME;
    context.conditions = cfg.statusConditions.map((c) => ({
      id: c.id,
      label: game.i18n.localize(c.name),
      img: c.img,
      active: this.actor.statuses.has(c.id)
    }));
    // Active Effects affecting this actor (own + item-transferred), for the Effects drawer.
    // allApplicableEffects() includes disabled ones, so they can be re-enabled from here. A
    // "toggleable" effect (flagged in the Effect Builder) shows a player on/off switch instead of
    // the enable/disable — its state lives on the actor (flags.project-anime.toggles), the same
    // state the roll dialog flips, and every roll-time/passive collector gates on it.
    const toggleStates = this.actor.flags?.["project-anime"]?.toggles ?? {};
    context.activeEffects = Array.from(this.actor.allApplicableEffects()).map((e) => ({
      uuid: e.uuid,
      id: e.id,
      name: e.name,
      img: e.img,
      disabled: e.disabled,
      toggleable: !!e.flags?.["project-anime"]?.toggle,
      toggleOn: !!toggleStates[e.id],
      source: e.parent?.documentName === "Item" ? e.parent.name : "—",
      durationLabel: e.isTemporary ? (e.duration?.label ?? "") : "",
      removable: e.parent?.documentName === "Actor",
      summary: summarizeRules(e)
    }));
    // Attribute cards.
    context.attributeList = cfg.attributeKeys.map((k) => {
      const a = this.actor.system.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        short: cfg.attributeAbbr?.[k] ? game.i18n.localize(cfg.attributeAbbr[k]) : game.i18n.localize(cfg.attributes[k]),
        die: a.die ?? `d${a.value}`,
        base: a.base,
        icon: cfg.attributeIcons?.[k] ?? ""
      };
    });

    // Wounds (characters): each locks a hit box until a Town clears it.
    if (context.isCharacter) {
      context.wounds = (this.actor.system.wounds ?? []).map((w, idx) => ({ idx, id: w.id, note: w.note ?? "" }));
      context.woundCount = context.wounds.length;
    }

    await this.#prepareItems(context);
    return context;
  }

  /** @override — themed dropdowns + paperdoll drag-and-drop. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    enhanceSelects(this.element);
    this.#bindTooltips();
    this.#bindSkillFilter();
    this.#bindWoundNotes();
    if (this.isEditable) {
      this.#bindPaperdoll();
      this.#bindItemContext();
      this.#bindSheetDnD();
      this.#bindHudDrag();
      this.#bindSkillReorder();
      this.#bindEnergyMax();
      this.#bindHpMax();
      this.#bindMarkedInputs();
      this.#bindGold();
    }
  }

  /** The Gear drawer's Gold pill is a nameless input (the rail's `system.gold` input owns the
   *  form name — a duplicate would submit an array), persisted on change here. */
  #bindGold() {
    for (const input of this.element.querySelectorAll("input[data-gold]")) {
      input.addEventListener("change", (ev) => {
        this.actor.update({ "system.gold": Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0)) });
      });
    }
  }

  /** Drag-and-drop INTO the sheet: accept Items (skills + gear) and ActiveEffects dropped from
   *  another sheet, a compendium, the sidebar, or the party stash — each lands as a copy on this
   *  actor. Also (re)marks the Effects-drawer rows draggable so effects can be dragged back out.
   *  Native listeners, mirroring the paperdoll DnD approach. */
  #bindSheetDnD() {
    const root = this.element;
    if (!root) return;
    // Drawer rows are rebuilt each render → (re)mark them draggable + (re)bind right-click removal.
    // Right-click mirrors the floating Effects Panel: overcomeable conditions offer Overcome-or-Remove,
    // everything else is cleared outright (item-borne effects notify to remove their source item).
    for (const row of root.querySelectorAll(".effect-row[data-effect-uuid]")) {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "ActiveEffect", uuid: row.dataset.effectUuid }));
      });
      row.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        contextRemoveEffect(row.dataset.effectUuid);
      });
    }
    // Drop target lives on the persistent window root → bind once.
    if (root.dataset.paSheetDrop) return;
    root.dataset.paSheetDrop = "1";
    root.addEventListener("dragover", (ev) => { ev.preventDefault(); });
    root.addEventListener("drop", (ev) => this.#onSheetDrop(ev));
  }

  /** Handle a drop on the sheet body: copy a dropped Item (skill/gear) onto this actor, or apply a
   *  dropped ActiveEffect. Drops on the paperdoll slots / bag tabs are handled by their own zones
   *  (which stop propagation), so this only fires for the rest of the open sheet area. */
  async #onSheetDrop(ev) {
    // Leave text-editor drops alone (content-link creation in the biography editor).
    if (ev.target?.closest?.("prose-mirror, .ProseMirror, .editor-content")) return;
    const data = readDrag(ev);
    if (data?.type === "ActiveEffect" && data.uuid) {
      ev.preventDefault();
      const effect = await fromUuid(data.uuid);
      if (effect) await applyEffectCopy(this.actor, effect);
      return;
    }
    if (data?.type === "Item" && data.uuid) {
      // A same-sheet drag (paperdoll/HUD tile) is handled by its own zones — ignore it here so
      // dropping a tile back on its own sheet never duplicates the item.
      if (data.paItem && this.actor.items.has(data.paItem)) return;
      ev.preventDefault();
      await importDroppedItem(this.actor, data);
    }
  }

  /** Foundry's ActorSheetV2 binds its own `element.ondrop` every render (see its `_onRender`),
   *  which auto-creates a raw copy of any dropped Item/ActiveEffect. We run our own drop pipeline
   *  (#onSheetDrop → importDroppedItem / applyEffectCopy) that strips grant/natural/pin flags and
   *  routes effects, so the two channels would both fire and the drop would land TWICE. Suppress
   *  the base auto-create for foreign drops; keep delegating own-item drops to core so intra-sheet
   *  re-sorting (dropping a tile onto a sibling) still works. */
  async _onDropItem(event, item) {
    if (this.actor.uuid !== item?.parent?.uuid) return null; // foreign → our pipeline copies it
    return super._onDropItem(event, item);                   // own item → let core re-sort
  }

  /** Suppress the base auto-create on ActiveEffect drops — handled by #onSheetDrop → applyEffectCopy. */
  async _onDropActiveEffect(event, effect) {
    return null;
  }

  /** Suppress any base Actor-drop behavior — dropping an actor on a sheet does nothing here. */
  async _onDropActor(event, actor) {
    return null;
  }

  /** Make Skill-drawer + quick-panel tiles (and Package chips) draggable as standard Item drag
   *  data, so they can be dropped onto another actor's sheet (transfer) or the Cinematic HUD's
   *  action slots. (Paperdoll/gear tiles already emit their own {paItem} payload, which the HUD
   *  resolves against the actor — so they're left untouched here.) */
  #bindHudDrag() {
    const root = this.element;
    if (!root) return;
    for (const el of root.querySelectorAll(".skill-tile[data-item-id], .quick-tile[data-item-id], .pkg-chip[data-item-id]")) {
      const item = this.actor.items.get(el.dataset.itemId);
      if (!item) continue;
      el.setAttribute("draggable", "true");
      // The inner <img> is natively draggable and would hijack the drag (carrying the image, not the
      // item) so this dragstart never fires — disable it so the tile itself is the drag source.
      for (const img of el.querySelectorAll("img")) img.setAttribute("draggable", "false");
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid, paItem: item.id }));
        ev.dataTransfer.effectAllowed = "copyMove";
      });
    }
  }

  /** Drag-to-reorder for the Skills command list on the Stats view. Each action group (Active /
   *  Reaction / Passive) is its own `.cmd-list[data-reorder]`; dragging is confined to the group a
   *  skill belongs to (its group IS its action type). On drop, the new on-screen order is written to
   *  each skill item's `sort` so it survives reloads. Scoped to the section + stopPropagation so the
   *  sheet's own item-drop handler never sees these internal drags. */
  #bindSkillReorder() {
    const section = this.element?.querySelector?.(".cmd-skills");
    if (!section) return;
    let dragged = null;
    for (const list of section.querySelectorAll(".cmd-list[data-reorder]")) {
      for (const row of list.querySelectorAll(".cmd-row")) row.setAttribute("draggable", "true");
      list.addEventListener("dragstart", (ev) => {
        const row = ev.target.closest(".cmd-row");
        if (!row || !list.contains(row)) return;
        dragged = row;
        ev.stopPropagation();
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", "");
        section.classList.add("reordering");
        requestAnimationFrame(() => row.classList.add("dragging"));
      });
      list.addEventListener("dragover", (ev) => {
        if (!dragged || !list.contains(dragged)) return;   // only reorder within the source group
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = "move";
        const over = ev.target.closest(".cmd-row");
        if (!over || over === dragged || !list.contains(over)) return;
        const r = over.getBoundingClientRect();
        if (ev.clientY - r.top > r.height / 2) over.after(dragged);
        else over.before(dragged);
      });
      list.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    }
    section.addEventListener("dragend", () => {
      if (!dragged) return;
      dragged.classList.remove("dragging");
      dragged = null;
      section.classList.remove("reordering");
      this.#persistSkillOrder(section);
    });
  }

  /** Write the current on-screen order of the Skills lists to each skill's `sort`, but only if it
   *  actually changed (skip a redundant update + re-render on a no-op drag). */
  async #persistSkillOrder(section) {
    const ids = [...section.querySelectorAll(".cmd-row[data-item-id]")].map((r) => r.dataset.itemId);
    const current = this.actor.items.filter((i) => i.type === "skill").sort(bySort).map((i) => i.id);
    if (ids.join("|") === current.join("|")) return;
    const updates = ids.map((id, idx) => ({ _id: id, sort: (idx + 1) * 100000 }));
    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /* -------------------------------------------- */
  /*  Context helpers                             */
  /* -------------------------------------------- */

  async #prepareItems(context) {
    const skills = [];
    const packages = [];
    const groups = Object.fromEntries(GEAR_GROUPS.map((k) => [k, []]));
    for (const item of this.actor.items) {
      if (item.type === "skill") skills.push(item);
      else if (item.type === "package") packages.push(item);
      else if (groups[item.type]) groups[item.type].push(item);
    }

    // Talents — trained disciplines (die + Primary Attribute) embedded on the actor
    // (`system.talents`), shown above the Techniques and edited in place (no item sheet).
    const cfgT = CONFIG.PROJECTANIME;
    context.talents = Object.entries(this.actor.system.talents ?? {}).map(([id, t]) => ({
      id,
      name: t.name,
      die: `d${t.die ?? 4}`,
      attribute: game.i18n.localize(cfgT.attributes[t.attribute] ?? t.attribute ?? "")
    }));
    context.showTalents = context.talents.length > 0 || this.isEditable;

    // Skills drawer: grouped by action type (Active / React / Passive). Each tile
    // carries its Effect glyph + role colour, rank, energy cost, pinned state, and
    // rules-validation flags (over Modifier budget / unaffordable at current Energy).
    skills.sort(bySort);
    const cfgS = CONFIG.PROJECTANIME;
    const curEnergy = this.actor.system.energy?.value ?? 0;
    const mapDrawerSkill = (i) => {
      const cost = i.system.energyCost ?? 0;
      // Granted (free) abilities come from a Package/Skill's Grant effect — badged, and
      // not directly deletable (they're managed by their source; the trash is hidden).
      const granted = !!i.getFlag("project-anime", "granted");
      const byId = granted ? i.getFlag("project-anime", "grantedBy") : null;
      const source = byId ? this.actor.items.get(byId)?.name : "";
      // Command-row dropdown: the hand-authored Codex-prose description (helpers/prose) —
      // mirroring the item View tab. Guarded so a single malformed skill can never abort the
      // whole sheet render.
      let descHTML = "";
      try { descHTML = renderDescriptionBlock(i); } catch (_e) { descHTML = ""; }
      const actionType = i.system?.actionType || "action";
      const passive = actionType === "passive" || i.system?.effect === "companion";
      return {
        id: i.id,
        name: i.name,
        img: i.img,
        stars: passive
          ? (i.system.manifested
            ? game.i18n.localize("PROJECTANIME.Skill.manifested")
            : game.i18n.format("PROJECTANIME.Skill.locks", { n: i.system.passiveEnergyTax ?? 0 }))
          : `${cost} ${game.i18n.localize("PROJECTANIME.Stat.energyAbbr")}`,
        energyCost: cost,
        actionType,
        passive: actionType === "passive",
        descHTML,
        pinned: !!i.getFlag("project-anime", "readied"),
        affordable: cost <= curEnergy,
        granted,
        grantedTip: granted
          ? (source ? game.i18n.format("PROJECTANIME.Skill.grantedBy", { source }) : game.i18n.localize("PROJECTANIME.Skill.granted"))
          : ""
      };
    };
    context.skillGroups = [
      { key: "action", label: game.i18n.localize("PROJECTANIME.Quick.active") },
      { key: "react", label: game.i18n.localize("PROJECTANIME.Quick.react") },
      { key: "passive", label: game.i18n.localize("PROJECTANIME.Quick.passive") }
    ]
      .map((g) => ({ ...g, skills: skills.filter((i) => (i.system?.actionType || "action") === g.key).map(mapDrawerSkill) }))
      .filter((g) => g.skills.length);

    // Advancement summary for the drawer strip; the full refundable ledger lives in the
    // Advancement Log dialog (opened via the button). `spLogCount` badges the button.
    if (this.actor.type === "character") {
      const { advInfo, advLog } = advancementLedger(this.actor);
      context.advInfo = advInfo;
      context.spInfo = { available: advInfo.available, spent: advInfo.spent, granted: 0, total: advInfo.total };
      context.spLogCount = advLog?.length ?? 0;
    }
    // The refundable Advancement Log opens for Characters only (monsters don't advance in V2;
    // a Companion spends its pool from the party sheet's Companions strip).
    context.showSpLog = context.isCharacter;

    // Packages (ability bundles, e.g. a chosen Race) carried by the actor — shown as chips
    // at the top of the Skills drawer; each grants its abilities via the Grant engine.
    context.packages = packages
      .sort(bySort)
      .map((p) => ({ id: p.id, name: p.name, img: p.img, category: p.system?.category ?? "" }));

    // Quick-action panel on the Stats main view: equipped weapons + the innate Natural Attack
    // (always available, in addition to equipment) + Dual-Wield shields + skills the player has
    // pinned (`readied`). Equipped items lead; the Natural Attack trails as the unarmed fallback.
    const isNatural = (i) => !!i.getFlag("project-anime", "natural");
    const isReadied = (i) => !!i.getFlag("project-anime", "readied");
    // A Dual-Wield shield bashes as an off-hand weapon (see the shield "Wield As" mode), so it joins
    // the Weapons block when EITHER equipped or pinned — surfaced like a real weapon. Shield-Only
    // shields are defensive and never land here (a pinned one stays in the Items block below).
    const isWeaponShield = (i) => i.type === "shield" && i.system?.use === "dual" && (i.system?.equipped || isReadied(i));
    // The hover drawer unfolds a rich stat card (accuracy / damage / range rows + enriched
    // description) — the same fields #itemTooltip formats for the floating tooltip.
    const cfgW = CONFIG.PROJECTANIME;
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    const escW = foundry.utils.escapeHTML;
    const aNameW = (k) => game.i18n.localize(cfgW.attributes[k] ?? k);
    const signedW = (n) => (n ? ` ${n > 0 ? "+" : ""}${n}` : "");
    context.quickWeapons = await Promise.all([...groups.weapon.filter((i) => i.system?.equipped || isNatural(i)), ...groups.shield.filter(isWeaponShield)]
      .sort((a, b) => (!!b.system?.equipped - !!a.system?.equipped) || (isNatural(a) - isNatural(b)) || bySort(a, b))
      .map(async (i) => {
        const sys = i.system ?? {};
        const isSh = i.type === "shield";
        const nat = isNatural(i);
        const dmg = Number(sys.damage?.value) || 0;
        const threshold = Number(sys.threshold) || 0;
        const rangeTiles = Number(sys.range?.tiles) || 0;
        // The rolled pair: Paired Attribute + Talent (+1 Trained Edge) or the two Attributes.
        const acc = sys.accuracy ?? {};
        const talent = getTalent(this.actor, sys.talentId);
        const accParts = talent
          ? [`<span class="att">${escW(aNameW(acc.attrA))}</span>`, `<span class="att">${escW(talent.name)}</span>`]
          : [acc.attrA, acc.attrB].filter(Boolean).map((k) => `<span class="att">${escW(aNameW(k))}</span>`);
        const edge = talent ? ` +${PROJECTANIME.trainedEdge}` : "";
        const accHTML = accParts.length ? `${accParts.join(' <span class="op">+</span> ')}${escW(signedW(acc.mod))}${edge}` : "";
        const dmgLabel = dmg ? String(dmg) : "";
        const rangeText = rangeTiles > 0 ? physicalRangeLabel(sys.range) : "";
        let descHTML = "";
        try { descHTML = await renderDescriptionHTML(i); } catch (_e) { descHTML = ""; }
        return {
          id: i.id, name: i.name, img: i.img, natural: nat, shield: isSh,
          equipped: !!sys.equipped,
          typeLabel: nat ? game.i18n.localize("PROJECTANIME.NaturalAttack.tag")
            : game.i18n.localize(`TYPES.Item.${i.type}`),
          dmgMod: dmg, rangeTiles, accHTML, dmgLabel, threshold, rangeText, descHTML,
          hand: sys.hand || "",
          // gates the hover dropdown + caret
          hasMeta: !!(accHTML || dmgLabel || rangeText || descHTML || nat)
        };
      }));
    const readied = skills.filter((i) => i.getFlag("project-anime", "readied"));
    const mapSkill = (i) => ({ id: i.id, name: i.name, img: i.img, energyCost: i.system?.energyCost ?? 0 });
    // Pinned skills, split into the three action-type groups (empty groups drop out).
    context.quickSkillGroups = [
      { key: "action", label: game.i18n.localize("PROJECTANIME.Quick.active") },
      { key: "react", label: game.i18n.localize("PROJECTANIME.Quick.react") },
      { key: "passive", label: game.i18n.localize("PROJECTANIME.Quick.passive") }
    ]
      .map((g) => ({ ...g, skills: readied.filter((i) => (i.system?.actionType || "action") === g.key).map(mapSkill) }))
      .filter((g) => g.skills.length);

    // Pinned NON-skill gear (consumables + other items) → the "Items" quick block on the Stats
    // view. Same `readied` flag as skills, set from the gear context menu; clicking a tile runs the
    // item's roll() (a consumable posts its Use card, a weapon attacks, other gear posts a
    // description). The innate Natural Attack and pinned Dual-Wield shields live in the Weapons
    // block (the shield bashes as a weapon), so both are excluded here.
    context.quickItems = GEAR_GROUPS
      .flatMap((k) => groups[k])
      .filter((i) => isReadied(i) && !isNatural(i) && !isWeaponShield(i))
      .sort(bySort)
      .map((i) => {
        const q = Number(i.system?.quantity);
        return { id: i.id, name: i.name, img: i.img, qty: q > 1 ? q : null };
      });

    // Carried gear (bag bar + inventory grid + paperdoll) — shared with the Monster Creator's Gear
    // step. buildGearContext also corrects a stale selected bag (deleted → backpack), so write the
    // corrected id back to our state.
    const gear = buildGearContext(this.actor, { selectedBag: this.#selectedBag, bagView: this.#bagView });
    this.#selectedBag = gear.selectedBag;
    Object.assign(context, gear);
    context.bagViewCombined = this.#bagView === "combined";
    // Actor-sheet gear is the live inventory: left-clicking a bag tile posts it to chat (the
    // Monster Creator's builder grid keeps click-to-edit). Gates the tile action in gear-body.hbs.
    context.gearChatClick = true;
  }

  /* -------------------------------------------- */
  /*  Action handlers (invoked with `this` = sheet) */
  /* -------------------------------------------- */

  /** Add a Wound (locks one hit box until a Town clears it). */
  static async #onAddWound() {
    const wounds = [...(this.actor.system.toObject().wounds ?? []), { id: foundry.utils.randomID(), note: "" }];
    await this.actor.update({ "system.wounds": wounds });
  }

  /** Clear one Wound (the Town rest also offers this — rules: a Town clears one, chosen by the player). */
  static async #onRemoveWound(event, target) {
    const id = target.dataset.woundId;
    const wounds = (this.actor.system.toObject().wounds ?? []).filter((w) => w.id !== id);
    await this.actor.update({ "system.wounds": wounds });
  }

  /** Click box n → n boxes marked; clicking the topmost marked box unmarks it (n − 1), so the
   *  strip can be walked back down to 0 marks. Marks count UP from 0 while storage keeps
   *  `value` = remaining, so the write is the remainder: value = max − marks. */
  static async #onSetResourceBox(event, target) {
    if (!this.isEditable) return;
    const res = target.dataset.resource;
    if (!["hp", "energy"].includes(res)) return;
    const { value = 0, max = 0 } = this.actor.system[res] ?? {};
    const n = Number(target.dataset.n) || 0;
    const marked = Math.clamp(max - value, 0, max);
    const next = n === marked ? n - 1 : n;
    await this.actor.update({ [`system.${res}.value`]: Math.clamp(max - next, 0, max) });
  }

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

  static async #onCreateItem(event, target) {
    event.preventDefault();
    await this.#createItem(target.dataset.type || "gear");
  }

  /** Open the "add item" type picker (the + tile in the flat inventory grid). */
  static #onCreateMenu(event, target) {
    this.#openCreateMenu(target);
  }

  /** Create one item of `type`, filed into the bag currently being viewed. */
  async #createItem(type) {
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) });
    const data = { name, type };
    // New loose gear lands in the bag you're currently viewing (containers excluded).
    if (this.#selectedBag && GEAR_GROUPS.includes(type)) data["system.container"] = this.#selectedBag;
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Select a bag (container) — re-renders so the inventory grid shows its contents. */
  static #onSelectBag(event, target) {
    this.#selectedBag = target.dataset.bagId || "";
    this.render();
  }

  /** Toggle the Gear inventory between the single-bag panel and the combined (all-bags) sections
   *  view — the WoW "Combine Bags" switch. Persisted per user. */
  static #onToggleBagView(event, target) {
    this.#bagView = this.#bagView === "combined" ? "single" : "combined";
    game.user?.setFlag("project-anime", "bagView", this.#bagView);
    this.render();
  }

  static #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  static async #onEditItem(event, target) {
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item) return;
    // Every item type opens its own sheet — a Technique's sheet carries the Technique editor
    // tab (v0.5.19); the guided Skill Builder stays a header control there.
    item.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    await ProjectAnimeActorSheet.#getItem.call(this, target)?.deleteDialog();
  }

  static async #onRollCheck(event, target) {
    const attr = target.dataset.attribute || "might";
    return rollCheck(this.actor, { attrA: attr, attrB: attr });
  }

  static async #onRollItem(event, target) {
    ProjectAnimeActorSheet.#getItem.call(this, target)?.roll({ event });
  }

  /** Post an item's info card to chat (bag/grid click) — distinct from #onRollItem, which rolls
   *  the attack/skill from the main-screen quick panel. */
  static async #onPostItem(event, target) {
    ProjectAnimeActorSheet.#getItem.call(this, target)?.toChat();
  }

  static #onAddReadied() {
    this.#openSkillDialog();
  }

  static async #onUnreadySkill(event, target) {
    await ProjectAnimeActorSheet.#getItem.call(this, target)?.unsetFlag("project-anime", "readied");
  }

  /** Toggle a skill's pinned (readied) flag from the Skills drawer. */
  static async #onTogglePin(event, target) {
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item) return;
    if (item.getFlag("project-anime", "readied")) await item.unsetFlag("project-anime", "readied");
    else await item.setFlag("project-anime", "readied", true);
  }

  static async #onToggleEquip(event, target) {
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item || !("equipped" in item.system)) return;
    await item.update({ "system.equipped": !item.system.equipped });
  }

  /** Click a paperdoll slot → open the equip picker. */
  static #onPickSlot(event, target) {
    this.#openSlotPicker(target.dataset.slot, target);
  }

  /** Click a slot's ✕ → unequip whatever fills it. */
  static async #onUnequipSlot(event, target) {
    await clearSlot(this.actor, target.dataset.slot);
  }

  /** Paperdoll: flip a shield between Dual Wield and Shield Only in place (mirrors the gear
   *  context-menu toggle). Dual Wield counts toward dual-wielding; Shield Only steps its bash die. */
  static async #onCycleShieldUse(event, target) {
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item || item.type !== "shield") return;
    await item.update({ "system.use": item.system.use === "dual" ? "shield" : "dual" });
  }

  /** Paperdoll: flip a weapon's grip in place (shares #toggleGrip with the gear context menu). */
  static async #onCycleGrip(event, target) {
    await this.#toggleGrip(ProjectAnimeActorSheet.#getItem.call(this, target));
  }

  /** Flip a weapon's grip one-/two-handed — the SINGLE path used by both the paperdoll badge and the
   *  gear context menu, so the off-hand lock registers identically from either. Two-handed spans both
   *  hands → enforceEquipExclusivity frees the off hand, which then reads as locked. A Two-Handed-Only
   *  weapon has no grip to flip. */
  async #toggleGrip(item) {
    if (!item || item.type !== "weapon" || item.system?.twoHandedOnly) return;
    const toTwo = item.system.grip !== "two";
    await item.update({ "system.grip": toTwo ? "two" : "one" });
    // A two-handed grip occupies both hands: equip it into the main hand so the off hand frees and
    // locks — so the grip change itself runs the whole lock mechanism (from the context menu too, not
    // only the equipped paperdoll). equipToSlot reads the now-current grip to clear the off hand.
    // Switching back to one-handed leaves the weapon equipped and simply frees the off hand for use.
    if (toTwo) await equipToSlot(this.actor, item, "mainHand");
  }

  /* -------------------------------------------- */
  /*  Paperdoll equip logic                       */
  /* -------------------------------------------- */

  /** Open the click-to-equip popover for a slot: eligible items + an Unequip row. */
  #openSlotPicker(slotKey, anchor) {
    if (!this.isEditable || !slotKey) return;
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
    if (!this.isEditable) return;
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
      row.addEventListener("click", () => { menu.hidePopover(); this.#createItem(type); });
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

  /** Manage pinned skills via a dialog checklist, grouped by action type. */
  async #openSkillDialog() {
    if (!this.isEditable) return;
    const skills = this.actor.items.filter((i) => i.type === "skill").sort(bySort);
    if (!skills.length) {
      ui.notifications.info(game.i18n.localize("PROJECTANIME.Empty"));
      return;
    }
    const cfg = CONFIG.PROJECTANIME;
    const esc = foundry.utils.escapeHTML;
    // No <form> wrapper — DialogV2 supplies the form (its `button.form`).
    let content = `<div class="project-anime pa-skill-dialog">`;
    for (const [key, langKey] of [["action", "active"], ["react", "react"], ["passive", "passive"]]) {
      const inGroup = skills.filter((s) => (s.system?.actionType || "action") === key);
      if (!inGroup.length) continue;
      content += `<div class="psd-group"><div class="psd-head">${game.i18n.localize("PROJECTANIME.Quick." + langKey)}</div>`;
      for (const s of inGroup) {
        const on = s.getFlag("project-anime", "readied") ? " checked" : "";
        const costTag = `${s.system?.energyCost ?? 0} ${game.i18n.localize("PROJECTANIME.Stat.energyAbbr")}`;
        content += `<label class="psd-row"><input type="checkbox" name="${s.id}"${on} /><img src="${esc(s.img)}" /><span class="psd-name">${esc(s.name)}</span><span class="psd-meta">${costTag}</span></label>`;
      }
      content += `</div>`;
    }
    content += `</div>`;

    const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("PROJECTANIME.Quick.manageTitle"), icon: "fas fa-bolt" },
      content,
      buttons: [
        { action: "save", label: game.i18n.localize("PROJECTANIME.Quick.save"), icon: "fas fa-check", default: true, callback: (event, button) => new FDE(button.form).object },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fas fa-times" }
      ],
      rejectClose: false
    });
    if (!result || result === "cancel") return;

    const updates = [];
    for (const s of skills) {
      const want = !!result[s.id];
      if (want !== !!s.getFlag("project-anime", "readied")) {
        updates.push(want ? s.setFlag("project-anime", "readied", true) : s.unsetFlag("project-anime", "readied"));
      }
    }
    await Promise.all(updates);
  }

  /** Attach Foundry rich tooltips to every item element on the sheet. */
  async #bindTooltips() {
    const root = this.element;
    if (!root) return;
    const cache = new Map();
    for (const el of root.querySelectorAll("[data-item-id]")) {
      // Gear drawer shows no hover tooltips — it's for managing inventory, not previewing stats
      // (left-click posts to chat; edit via the tile action). Strip the native title too.
      if (el.closest('[data-section="gear"]')) {
        el.removeAttribute("title");
        el.querySelectorAll("[title]").forEach((c) => c.removeAttribute("title"));
        continue;
      }
      // Command rows with their own inline hover dropdown (skills, and weapons with stat chips) reveal
      // their info in place — a floating rich tooltip on top would be redundant, so skip those. Rows
      // with no dropdown (pinned items, meta-less weapons) still get the tooltip.
      if (el.classList.contains("cmd-row") && el.querySelector(".cmd-desc")) continue;
      const item = this.actor.items.get(el.dataset.itemId);
      if (!item) continue;
      if (!cache.has(item.id)) cache.set(item.id, await this.#itemTooltip(item));
      // The sheet can re-render while we await enrichment — bail if our element is stale.
      if (!root.isConnected) return;
      el.dataset.tooltip = cache.get(item.id);
      el.dataset.tooltipClass = "pa-tooltip";
      el.dataset.tooltipDirection = "RIGHT";
      el.removeAttribute("title");
      el.querySelectorAll("[title]").forEach((c) => c.removeAttribute("title"));
    }
  }

  /** Build the rich-tooltip HTML for one item (header + stat rows + description). */
  async #itemTooltip(item) {
    const sys = item.system ?? {};
    const cfg = CONFIG.PROJECTANIME;
    const i18n = (k) => game.i18n.localize(k);
    const esc = foundry.utils.escapeHTML;
    const aName = (k) => i18n(cfg.attributes[k] ?? k);
    const signed = (n) => (n ? ` ${n > 0 ? "+" : ""}${n}` : "");
    const rows = [];
    const row = (label, value) => {
      if (value !== undefined && value !== null && `${value}`.trim() !== "") {
        rows.push(`<div class='pa-tt-row'><span class='k'>${esc(label)}</span><span class='v'>${esc(String(value))}</span></div>`);
      }
    };
    const rowHTML = (label, html) => rows.push(`<div class='pa-tt-row'><span class='k'>${esc(label)}</span><span class='v'>${html}</span></div>`);

    let typeLabel = i18n(`TYPES.Item.${item.type}`);

    if (item.type === "weapon" || item.type === "shield") {
      const acc = sys.accuracy ?? {};
      const talent = getTalent(item.actor, sys.talentId);
      row(i18n("PROJECTANIME.Field.accuracy"), talent
        ? `⟪${aName(acc.attrA)}⟫ + ⟪${talent.name}⟫ +1`
        : `⟪${aName(acc.attrA)}⟫ + ⟪${aName(acc.attrB)}⟫${signed(acc.mod)}`);
      if (sys.damage?.value) row(i18n("PROJECTANIME.Roll.damage"), sys.damage.value);
      if (sys.threshold) row(i18n("PROJECTANIME.Field.threshold"), sys.threshold);
      if (sys.range) row(i18n("PROJECTANIME.Field.range"), physicalRangeLabel(sys.range));
      if (sys.guardBonus) row(i18n("PROJECTANIME.Stat.guard"), `+${sys.guardBonus}`);
      if (cfg.hands?.[sys.hand]) row(i18n("PROJECTANIME.Field.hand"), i18n(cfg.hands[sys.hand]));
      if (item.type === "shield" && cfg.shieldUses?.[sys.use]) row(i18n("PROJECTANIME.Field.shieldUse"), i18n(cfg.shieldUses[sys.use]));
      if (sys.equipped) typeLabel += ` · ${i18n("PROJECTANIME.Field.equipped")}`;
    } else if (item.type === "skill") {
      typeLabel = `${i18n("TYPES.Item.skill")} · ${i18n(cfg.actionTypes[sys.actionType] ?? "")}`;
      if (sys.actionType === "passive" || sys.effect === "companion") row(i18n("PROJECTANIME.Skill.field.energyLock"), `${sys.passiveEnergyTax ?? 0}`);
      else if (sys.energyCost > 0) row(i18n("PROJECTANIME.Skill.field.energyCost"), `${sys.energyCost} ${i18n("PROJECTANIME.Stat.energyAbbr")}`);
      row(i18n("PROJECTANIME.Skill.field.range"), rangeLabel(sys.range));
      row(i18n("PROJECTANIME.Skill.field.effect"), skillEffectKeys(sys).map((k) => i18n(cfg.skillEffects[k] ?? "")).join(" + "));
      if (sys.actionType === "react" && sys.trigger) row(i18n("PROJECTANIME.Skill.field.trigger"), i18n(cfg.triggers[sys.trigger] ?? sys.trigger));
      if ((sys.controlElement ?? "").trim() && skillEffectKeys(sys).includes("elementalControl")) row(i18n("PROJECTANIME.Skill.field.controlElement"), sys.controlElement.trim());
    } else if (item.type === "armor") {
      row(i18n("PROJECTANIME.Stat.guard"), `+${sys.guardBonus ?? 0}`);
      row(i18n("PROJECTANIME.Stat.movement"), sys.movement);
      if (sys.energyRegen > 1) row(i18n("PROJECTANIME.Field.energyRegen"), sys.energyRegen);
    } else if (item.type === "container") {
      row(i18n("PROJECTANIME.Field.capacityBonus"), sys.capacityBonus);
    }
    if (sys.quantity > 1) row(i18n("PROJECTANIME.Field.quantity"), sys.quantity);

    const head = `<div class='pa-tt-head'><img class='pa-tt-img' src='${esc(item.img)}' /><div class='pa-tt-heads'><div class='pa-tt-title'>${esc(item.name)}</div><div class='pa-tt-type'>${esc(typeLabel)}</div></div></div>`;
    const rowsHtml = rows.length ? `<div class='pa-tt-rows'>${rows.join("")}</div>` : "";
    // Enrich so embedded @UUID references (e.g. a weapon granting a Skill) render as
    // content links with their icon instead of raw `@UUID[...]` text.
    let descHtml = "";
    if (sys.description && String(sys.description).trim()) {
      const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
      descHtml = await TE.enrichHTML(String(sys.description), { relativeTo: item, secrets: false });
    }
    const desc = descHtml ? `<div class='pa-tt-desc'>${descHtml}</div>` : "";
    return `${head}<div class='pa-tt-body'>${rowsHtml}${desc}</div>`;
  }

  /** Persist a Wound's description when its note input changes (array field — no `name` binding). */
  #bindWoundNotes() {
    for (const el of this.element?.querySelectorAll(".wound-note") ?? []) {
      el.addEventListener("change", (ev) => {
        const id = ev.currentTarget.dataset.woundId;
        const wounds = (this.actor.system.toObject().wounds ?? []).map((w) =>
          w.id === id ? { ...w, note: ev.currentTarget.value } : w);
        this.actor.update({ "system.wounds": wounds });
      });
    }
  }

  /** Skills drawer: action-type chips + name search. Pure client-side show/hide — no
   *  re-render — so it's instant and never fights the drawer-open state. Filter state
   *  lives in #skillFilters / #skillQuery and is re-applied here after every render. */
  #bindSkillFilter() {
    const drawer = this.element?.querySelector('.section-drawer[data-section="skills"]');
    if (!drawer) return;
    const chips = drawer.querySelectorAll(".skill-chip");
    const search = drawer.querySelector(".skill-search");
    const sel = this.#skillFilters;
    const apply = () => {
      const q = this.#skillQuery.trim().toLowerCase();
      // "all" lights up when nothing is selected; each type chip when it's in the set.
      for (const chip of chips) {
        const f = chip.dataset.filter;
        chip.classList.toggle("active", f === "all" ? sel.size === 0 : sel.has(f));
      }
      for (const group of drawer.querySelectorAll(".skill-group")) {
        const typeOk = sel.size === 0 || sel.has(group.dataset.group);
        let shown = 0;
        for (const tile of group.querySelectorAll(".skill-tile")) {
          const match = typeOk && (!q || (tile.dataset.name || "").toLowerCase().includes(q));
          tile.classList.toggle("filtered-out", !match);
          if (match) shown++;
        }
        group.classList.toggle("filtered-out", shown === 0);
      }
    };
    for (const chip of chips) {
      chip.addEventListener("click", () => {
        const f = chip.dataset.filter;
        // "all" clears the selection; type chips toggle (union). Removing the last selected
        // type falls back to "all".
        if (f === "all") sel.clear();
        else if (sel.has(f)) sel.delete(f);
        else sel.add(f);
        apply();
      });
    }
    if (search) {
      search.value = this.#skillQuery;
      search.addEventListener("input", () => {
        this.#skillQuery = search.value;
        apply();
      });
    }
    apply();
  }

  /** Right-click an item tile — skill (drawer/quick panel), equipped-weapon quick panel, or
   *  gear bag — opens a context menu. Dispatches by item type. Editable views only. */
  #bindItemContext() {
    const root = this.element;
    if (!root) return;
    for (const tile of root.querySelectorAll(".item-tile")) {
      const id = tile.dataset.itemId;
      if (!id) continue;   // skip non-item tiles (e.g. the "add item" tile)
      tile.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        const item = this.actor.items.get(id);
        if (!item) return;
        if (item.type === "skill") this.#openSkillContext(item, ev);
        else this.#openGearContext(item, ev);
      });
    }
    // Talent rows (side panel) — right-click offers Delete (left-click edits).
    for (const row of root.querySelectorAll(".talent-row")) {
      const id = row.dataset.talentId;
      if (!id) continue;
      row.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.#openTalentContext(id, ev);
      });
    }
  }

  /** Talent context menu: delete (unlinks weapons/Techniques built under it + refunds its
   *  Advancement Log entries — see Actor#removeTalent). */
  #openTalentContext(id, ev) {
    if (!this.actor.system.talents?.[id]) return;
    const { add, show } = this.#contextMenu(ev);
    add("fa-trash", "PROJECTANIME.Action.delete", () => this.actor.removeTalent(id), "danger");
    show();
  }

  /** An empty context-menu popover anchored at the cursor. Returns an `add(icon, label,
   *  onClick, cls?)` row helper and a `show()` to display it — shared by the menus below. */
  #contextMenu(ev) {
    this.element.querySelector(".pd-picker")?.remove();
    const menu = document.createElement("div");
    menu.className = "pd-picker context-menu";
    menu.setAttribute("popover", "auto");

    const add = (icon, label, onClick, cls = "") => {
      const row = document.createElement("div");
      row.className = cls ? `pd-option ${cls}` : "pd-option";
      const i = document.createElement("i");
      i.className = `fas ${icon}`;
      const span = document.createElement("span");
      span.textContent = game.i18n.localize(label);
      row.append(i, span);
      row.addEventListener("click", () => { menu.hidePopover(); onClick(); });
      menu.appendChild(row);
    };

    const show = () => {
      this.element.appendChild(menu);
      menu.addEventListener("toggle", (e) => {
        if (e.newState !== "open") { menu.remove(); return; }
        Object.assign(menu.style, { position: "fixed", inset: "auto", margin: "0", left: `${ev.clientX}px`, top: `${ev.clientY}px`, minWidth: "160px" });
        const h = menu.offsetHeight, w = menu.offsetWidth;
        if (ev.clientY + h > window.innerHeight - 4) menu.style.top = `${Math.max(4, ev.clientY - h)}px`;
        if (ev.clientX + w > window.innerWidth - 4) menu.style.left = `${Math.max(4, ev.clientX - w)}px`;
      });
      menu.showPopover();
    };

    return { add, show };
  }

  /** Skill context menu: use, pin/unpin, edit, delete. */
  #openSkillContext(item, ev) {
    const readied = !!item.getFlag("project-anime", "readied");
    const { add, show } = this.#contextMenu(ev);
    add("fa-dice-d20", "PROJECTANIME.Action.use", () => item.roll({ event: ev }));
    if (readied) add("fa-xmark", "PROJECTANIME.Quick.remove", () => item.unsetFlag("project-anime", "readied"));
    else add("fa-thumbtack", "PROJECTANIME.Quick.pin", () => item.setFlag("project-anime", "readied", true));
    add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => item.sheet.render(true));
    add("fa-trash", "PROJECTANIME.Action.delete", () => item.deleteDialog(), "danger");
    show();
  }

  /** Gear context menu: use (consumables), post to chat, equip, pin to main screen, edit, delete. */
  #openGearContext(item, ev) {
    const equipped = !!item.system?.equipped;
    const pinned = !!item.getFlag("project-anime", "readied");
    const { add, show } = this.#contextMenu(ev);
    // Consumables get a one-click Use (consume now); the posted card carries its own ▶ Use button.
    if (item.type === "consumable") add("fa-play", "PROJECTANIME.Action.use", () => useConsumable(this.actor, item));
    // The innate Natural Attack isn't carried gear — offer only tuning (no equip / delete).
    if (item.getFlag("project-anime", "natural")) {
      add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => item.sheet.render(true));
      show();
      return;
    }
    if (item.type === "weapon" || item.type === "shield") {
      // One "Equip" drops it into a free hand (weapon→main, shield→off; a two-handed weapon claims both).
      if (equipped) add("fa-xmark", "PROJECTANIME.Action.unequip", () => item.update({ "system.equipped": false }));
      else add("fa-hand-fist", "PROJECTANIME.Action.equipHand", () => equipToAvailableHand(this.actor, item));
    } else if (EQUIPPABLE.has(item.type)) {
      const key = equipped ? "PROJECTANIME.Action.unequip" : "PROJECTANIME.Action.equip";
      add("fa-shield-halved", key, () => item.update({ "system.equipped": !equipped }));
    }
    // Weapons flip grip in place (a two-handed grip Steps Up the damage die and, when
    // equipped, frees the off hand via enforceEquipExclusivity on the resulting update).
    // A Two-Handed-Only weapon (a bow) has no grip to flip — both hands, always.
    if (item.type === "weapon" && !item.system?.twoHandedOnly) {
      const twoH = item.system?.grip === "two";
      add(twoH ? "fa-hand" : "fa-hands", twoH ? "PROJECTANIME.Action.gripOne" : "PROJECTANIME.Action.gripTwo",
        () => this.#toggleGrip(item));
    }
    // Shields flip Use in place: dual-wield (counts as a weapon, both dice Step Down) vs just-a-
    // shield (defensive; a bash Steps the shield's own die Down). Mirrors the weapon grip toggle.
    if (item.type === "shield") {
      const dual = item.system?.use === "dual";
      add(dual ? "fa-shield-halved" : "fa-hand-fist", dual ? "PROJECTANIME.Action.useShieldOnly" : "PROJECTANIME.Action.useDualWield",
        () => item.update({ "system.use": dual ? "shield" : "dual" }));
    }
    // Pin / unpin to a main-screen quick block (Skills pin via their own menu). A Dual-Wield shield
    // pins into the Weapons block (it bashes as an off-hand weapon); all other gear pins to "Items".
    const asWeapon = item.type === "shield" && item.system?.use === "dual";
    if (pinned) add("fa-xmark", asWeapon ? "PROJECTANIME.Quick.unpinWeapon" : "PROJECTANIME.Quick.unpinItem", () => item.unsetFlag("project-anime", "readied"));
    else add("fa-thumbtack", asWeapon ? "PROJECTANIME.Quick.pinWeapon" : "PROJECTANIME.Quick.pinItem", () => item.setFlag("project-anime", "readied", true));
    add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => item.sheet.render(true));
    add("fa-trash", "PROJECTANIME.Action.delete", () => item.deleteDialog(), "danger");
    show();
  }

  /** Native drag-and-drop: drag bag/slot items onto a slot to equip; onto the bag to unequip. */
  #bindPaperdoll() {
    const root = this.element;
    if (!root) return;

    for (const el of root.querySelectorAll("[data-item-id][draggable='true']")) {
      // Disable native <img> dragging inside the tile so the tile/icon is the drag source (an inner
      // <img> would otherwise carry the image instead of the item — breaking both equip and HUD drops).
      for (const img of el.querySelectorAll("img")) img.setAttribute("draggable", "false");
      el.addEventListener("dragstart", (ev) => {
        // paItem keeps the paperdoll equip working; type+uuid lets the Cinematic HUD slots resolve it.
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
        // Own item → equip it; foreign item → copy it onto this actor first, then equip the copy.
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

    // Container bar tabs accept item drops → file the item into that bag (or backpack).
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

  static async #onToggleCondition(event, target) {
    const id = target.dataset.condition;
    if (id) await this.actor.toggleStatusEffect(id);
  }

  /** Enable/disable an effect from the Effects drawer (resolved by uuid — it may live
   *  on an owned item, transferred to this actor). */
  static async #onToggleEffectEnabled(event, target) {
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    if (!uuid) return;
    const effect = await fromUuid(uuid);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  /** Flip a player-toggle effect on/off. State lives on the actor; the re-render makes
   *  passive rules (and the next roll's modifiers) recompute against the new state.
   *  NB: use a dotted update PATH, not setFlag("project-anime", `toggles.${id}`, …) —
   *  setFlag would store a literal key "toggles.<id>" instead of nesting under `toggles`. */
  static async #onFlipToggle(event, target) {
    const id = target.closest("[data-effect-id]")?.dataset.effectId;
    if (!id) return;
    const cur = !!this.actor.flags?.["project-anime"]?.toggles?.[id];
    await this.actor.update({ [`flags.project-anime.toggles.${id}`]: !cur });
  }

  /** Create a temporary/standalone effect directly ON the actor, then open the builder. */
  static async #onAddActorEffect() {
    if (!this.isEditable) return;
    const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("PROJECTANIME.Effect.newEffect"),
      img: "icons/svg/aura.svg",
      disabled: false
    }]);
    if (effect) new EffectBuilder(effect).render(true);
  }

  /** Open the builder for an effect listed in the drawer (resolved by uuid). */
  static async #onEditActorEffect(event, target) {
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    const effect = uuid ? await fromUuid(uuid) : null;
    if (!effect) return;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${effect.id}`);
    if (existing) return existing.bringToFront();
    new EffectBuilder(effect).render(true);
  }

  /** Delete an actor-owned effect from the drawer (with confirmation). */
  static async #onDeleteActorEffect(event, target) {
    if (!this.isEditable) return;
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    const effect = uuid ? await fromUuid(uuid) : null;
    if (!effect) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Effect.deleteTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Effect.deletePrompt", { name: effect.name })}</p>`
    });
    if (ok) await effect.delete();
  }

  /** Open a section drawer (skills/gear/biography/defenses). */
  static #onOpenDrawer(event, target) {
    this.#openSection = target.dataset.section || null;
    this.#applyDrawers();
  }

  /** Close whichever section drawer is open. */
  static #onCloseDrawer() {
    this.#openSection = null;
    this.#applyDrawers();
  }

  /** Reflect #openSection on the live DOM so the slide transition plays without a
   *  full re-render (the templates also apply it via `open.*`, for re-render persistence). */
  #applyDrawers() {
    for (const el of this.element?.querySelectorAll?.(".section-drawer") ?? []) {
      el.classList.toggle("open", el.dataset.section === this.#openSection);
    }
  }

  /** The header Max-Energy input shows the EFFECTIVE maximum (authored − passive/servant tax) and is
   *  edited directly. It carries `data-energy-max` and NO `name`, so the form's submitOnChange never
   *  collects it — otherwise the derived/taxed value would be written back and re-taxed every prepare
   *  (the original "Current edit lowers Max" bug). We persist the AUTHORED max — the entered effective
   *  value PLUS the current tax — so the tax is re-derived next prepare instead of baked into storage. */
  #bindEnergyMax() {
    const input = this.element?.querySelector?.("input[data-energy-max]");
    if (!input) return;
    input.addEventListener("change", async (event) => {
      const sys = this.actor.system;
      const tax = (sys.energy?.passiveTax ?? 0) + (sys.energy?.servantTax ?? 0);
      const entered = Math.max(0, Math.round(Number(event.currentTarget.value) || 0));
      await this.actor.update({ "system.energy.max": entered + tax });
      // A no-op write (same authored max) skips the re-render — resync the display by hand.
      event.currentTarget.value = this.actor.system.energy?.max ?? entered;
    });
  }

  /** Like #bindEnergyMax for HP: the Max field shows the EFFECTIVE maximum (authored − Wound
   *  locks; a Boss shows its Bar HP), so a name-bound field would write that derived number back
   *  into the authored max on every form submit, compounding one box away per Wound per edit.
   *  Edits store the AUTHORED max (entered + current Wound locks) so the shave is re-derived. */
  #bindHpMax() {
    const input = this.element?.querySelector?.("input[data-hp-max]");
    if (!input) return;
    input.addEventListener("change", async (event) => {
      const locks = this.actor.system.woundCount ?? 0;
      const entered = Math.max(0, Math.round(Number(event.currentTarget.value) || 0));
      await this.actor.update({ "system.hp.max": entered + locks });
      event.currentTarget.value = this.actor.system.hp?.max ?? entered;
    });
  }

  /** The HP/Energy value inputs read in MARKS (boxes marked so far — 0 = untouched), the printed
   *  marking convention, while storage keeps `value` = boxes remaining. They carry data-marked and
   *  NO `name` so submitOnChange never collects them raw; this binder writes the remainder back. */
  #bindMarkedInputs() {
    for (const input of this.element?.querySelectorAll?.("input[data-marked]") ?? []) {
      input.addEventListener("change", async (event) => {
        const res = event.currentTarget.dataset.marked;
        if (!["hp", "energy"].includes(res)) return;
        const max = this.actor.system[res]?.max ?? 0;
        const entered = Math.clamp(Math.round(Number(event.currentTarget.value) || 0), 0, max);
        await this.actor.update({ [`system.${res}.value`]: max - entered });
        // An out-of-range entry that clamps to the current marks is an empty diff — Foundry
        // drops it without a re-render, stranding the raw text; resync the field by hand.
        event.currentTarget.value = entered;
      });
    }
  }

  /* -------------------------------------------- */
  /*  Talents (actor data — no item sheet)        */
  /* -------------------------------------------- */

  /** Name · Die · Primary Attribute editor for one Talent row. Returns the row, or null on
   *  cancel/blank name. Delete lives on the row's context menu, not here. */
  async #promptTalent({ name = "", die = 6, attribute = "might" } = {}, title) {
    const cfg = CONFIG.PROJECTANIME;
    const dieOpts = [4, 6, 8, 10, 12]
      .map((d) => `<option value="${d}" ${d === Number(die) ? "selected" : ""}>d${d}</option>`).join("");
    const attrOpts = cfg.attributeKeys
      .map((k) => `<option value="${k}" ${k === attribute ? "selected" : ""}>${game.i18n.localize(cfg.attributes[k])}</option>`).join("");
    const content = `
      <div class="form-group"><label>${game.i18n.localize("PROJECTANIME.Talent.name")}</label>
        <input type="text" name="name" value="${foundry.utils.escapeHTML(name)}" autofocus /></div>
      <div class="form-group"><label>${game.i18n.localize("PROJECTANIME.Talent.die")}</label>
        <select name="die">${dieOpts}</select></div>
      <div class="form-group"><label>${game.i18n.localize("PROJECTANIME.Talent.attribute")}</label>
        <select name="attribute">${attrOpts}</select></div>`;
    const picked = await foundry.applications.api.DialogV2.prompt({
      window: { title, icon: "fa-solid fa-graduation-cap" },
      position: { width: 380 },
      content,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("PROJECTANIME.Talent.save"),
        icon: "fas fa-check",
        callback: (event, button) => ({
          name: (button.form.elements.name?.value ?? "").trim(),
          die: Number(button.form.elements.die?.value) || 6,
          attribute: button.form.elements.attribute?.value ?? "might"
        })
      }
    });
    return picked?.name ? picked : null;
  }

  static async #onAddTalent() {
    if (!this.isEditable) return;
    const row = await this.#promptTalent({}, game.i18n.localize("PROJECTANIME.Talent.add"));
    if (!row) return;
    await this.actor.update({ [`system.talents.${foundry.utils.randomID()}`]: row });
  }

  static async #onEditTalent(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-talent-id]")?.dataset.talentId;
    const t = this.actor.system.talents?.[id];
    if (!t) return;
    const row = await this.#promptTalent(t, t.name || game.i18n.localize("PROJECTANIME.Item.talent"));
    if (!row) return;
    await this.actor.update({ [`system.talents.${id}`]: row });
  }

  /** Announce one Talent as a themed chat card (the row's message icon — Daggerheart-style). */
  static async #onPostTalent(event, target) {
    if (!this.document.isOwner) return;
    const id = target.closest("[data-talent-id]")?.dataset.talentId;
    const t = getTalent(this.actor, id);
    if (!t) return;
    const attr = game.i18n.localize(CONFIG.PROJECTANIME.attributes[t.attribute] ?? t.attribute);
    await postCard(this.actor, cardHTML({
      title: t.name,
      subtitle: game.i18n.localize("PROJECTANIME.Item.talent"),
      glyph: "fa-graduation-cap",
      meta: [`d${t.die}`, attr]
    }), null);
  }

  /* -------------------------------------------- */
  /*  Advancement                                 */
  /* -------------------------------------------- */

  static #onOpenAdvancement() {
    const id = `pa-advancement-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new AdvancementApp(this.actor).render(true);
  }

  /** Header control on a raised servant's sheet → confirm + release it (restores the caster's
   *  locked Energy via the deleteActor hook). Shares the chat card / Token HUD dismissal flow. */
  static #onDismissServant() {
    return confirmAndDismiss(this.actor);
  }

  static #onOpenRest() {
    const id = `pa-rest-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new RestApp(this.actor).render(true);
  }

  static #onOpenSkillLog() {
    const id = `pa-skill-log-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillLogApp(this.actor).render(true);
  }

  /** Open the in-game Skill Builder (build new + improve existing skills). */
  static #onBuildSkill() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor).render(true);
  }

  /** Open the step-by-step creator for this actor (Character or Monster). */
  static #onOpenCreator() {
    return ProjectAnimeActorSheet.#openCreator(this.actor);
  }

  /** Open (or focus) the right creator for an actor — the Monster Creator for NPCs,
   *  the Character Creator for PCs. */
  static #openCreator(actor) {
    const isNPC = actor.type === "npc";
    const id = isNPC ? `pa-monster-creator-${actor.id}` : `pa-character-creator-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return (isNPC ? new MonsterCreatorApp(actor) : new CharacterCreatorApp(actor)).render(true);
  }
}
