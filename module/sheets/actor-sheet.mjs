import { rollCheck, rollInitiative } from "../helpers/dice.mjs";
import { enhanceSelects } from "../helpers/select.mjs";
import { rangeLabel } from "../helpers/config.mjs";
import { getElements, isImageIcon } from "../helpers/elements.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { summarizeRules, collectToggles, applyEffectCopy } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { AdvancementApp } from "../apps/advancement.mjs";
import { RestApp } from "../apps/rest.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";
import { CharacterCreatorApp } from "../apps/character-creator.mjs";
import { MonsterCreatorApp } from "../apps/monster-creator.mjs";
import { SkillLogApp } from "../apps/skill-log.mjs";
import { skillPointLedger } from "../helpers/skill-points.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Loose gear item types shown as inventory grids (Skills + Containers are handled
 *  separately — containers are the WoW-style "bags" in the container bar). */
const GEAR_GROUPS = ["weapon", "armor", "shield", "accessory", "consumable", "gear"];

/** Item types that can be equipped (and so get an equip toggle). */
const EQUIPPABLE = new Set(["weapon", "armor", "shield", "accessory"]);

/** Paperdoll equip slots, positioned over the portrait in the Gear drawer (the
 *  template places each by `key` via CSS). The two accessory slots use the
 *  "accessory:N" form (N = position among equipped). */
const PAPERDOLL_SLOTS = [
  { key: "mainHand",    icon: "fa-hand-fist",     base: "mainHand"  },
  { key: "offHand",     icon: "fa-shield-halved", base: "offHand"   },
  { key: "armor",       icon: "fa-shirt",         base: "armor"     },
  { key: "accessory:0", icon: "fa-ring",          base: "accessory" },
  { key: "accessory:1", icon: "fa-ring",          base: "accessory" }
];

/** Item types each paperdoll slot accepts (keyed by the slot's `base`). */
const SLOT_ACCEPTS = {
  mainHand: ["weapon"],
  offHand: ["weapon", "shield"],
  armor: ["armor"],
  container: ["container"],
  accessory: ["accessory"]
};

/** Stable inventory ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

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
      addReadied: ProjectAnimeActorSheet.#onAddReadied,
      unreadySkill: ProjectAnimeActorSheet.#onUnreadySkill,
      togglePin: ProjectAnimeActorSheet.#onTogglePin,
      toggleEquip: ProjectAnimeActorSheet.#onToggleEquip,
      pickSlot: ProjectAnimeActorSheet.#onPickSlot,
      unequipSlot: ProjectAnimeActorSheet.#onUnequipSlot,
      selectBag: ProjectAnimeActorSheet.#onSelectBag,
      toggleCondition: ProjectAnimeActorSheet.#onToggleCondition,
      toggleEffectEnabled: ProjectAnimeActorSheet.#onToggleEffectEnabled,
      flipToggle: ProjectAnimeActorSheet.#onFlipToggle,
      addActorEffect: ProjectAnimeActorSheet.#onAddActorEffect,
      editActorEffect: ProjectAnimeActorSheet.#onEditActorEffect,
      deleteActorEffect: ProjectAnimeActorSheet.#onDeleteActorEffect,
      cycleAffinity: ProjectAnimeActorSheet.#onCycleAffinity,
      openDrawer: ProjectAnimeActorSheet.#onOpenDrawer,
      closeDrawer: ProjectAnimeActorSheet.#onCloseDrawer,
      rollInitiative: ProjectAnimeActorSheet.#onRollInitiative,
      openAdvancement: ProjectAnimeActorSheet.#onOpenAdvancement,
      openRest: ProjectAnimeActorSheet.#onOpenRest,
      buildSkill: ProjectAnimeActorSheet.#onBuildSkill,
      openCreator: ProjectAnimeActorSheet.#onOpenCreator,
      openSkillLog: ProjectAnimeActorSheet.#onOpenSkillLog
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

  /** Skills drawer filter — action-type chip ("all"/"action"/"react"/"passive") and
   *  the name-search query. Client-side only (no re-render); survives re-renders. */
  #skillFilter = "all";
  #skillQuery = "";

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
    // Monster Tier badge (NPCs the Monster Creator has stamped) — null = untiered NPC.
    const tierKey = this.actor.system.tier;
    const tierCfg = tierKey ? CONFIG.PROJECTANIME.monsterTiers?.[tierKey] : null;
    context.tierBadge = tierCfg
      ? { label: game.i18n.localize(tierCfg.label), icon: tierCfg.icon, color: tierCfg.color }
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

    // Resource bar percentages.
    const hp = this.actor.system.hp ?? {};
    const energy = this.actor.system.energy ?? {};
    context.hpPct = hp.max > 0 ? Math.clamp(Math.round((hp.value / hp.max) * 100), 0, 100) : 0;
    context.energyPct = energy.max > 0 ? Math.clamp(Math.round((energy.value / energy.max) * 100), 0, 100) : 0;

    // Toggleable status conditions and their active state.
    const cfg = CONFIG.PROJECTANIME;
    context.conditions = cfg.statusConditions.map((c) => ({
      id: c.id,
      label: game.i18n.localize(c.name),
      img: c.img,
      active: this.actor.statuses.has(c.id)
    }));
    // Player-flippable toggle effects → switches on the Stats view.
    context.toggles = collectToggles(this.actor);
    // Active Effects affecting this actor (own + item-transferred), for the Effects drawer.
    // allApplicableEffects() includes disabled ones, so they can be re-enabled from here.
    context.activeEffects = Array.from(this.actor.allApplicableEffects()).map((e) => ({
      uuid: e.uuid,
      name: e.name,
      img: e.img,
      disabled: e.disabled,
      source: e.parent?.documentName === "Item" ? e.parent.name : "—",
      durationLabel: e.isTemporary ? (e.duration?.label ?? "") : "",
      removable: e.parent?.documentName === "Actor",
      summary: summarizeRules(e)
    }));
    // Affinity ("Elemental Defense") rows — icon, level, a pip meter, and the
    // mechanical effect glyph, for the FF8-style defense matrix on the Stats tab.
    const affPips = { none: 0, weak: 1, resist: 2, immune: 3, absorb: 4 };
    const affEffect = {
      none: "—",
      weak: `+${cfg.affinityDamage.weak}`,
      resist: `−${Math.abs(cfg.affinityDamage.resist)}`,
      immune: "0",
      absorb: "↺"
    };
    context.affinityRows = getElements().map((el) => {
      const value = this.actor.system.affinities?.[el.key] ?? "none";
      const n = affPips[value] ?? 0;
      return {
        key: el.key,
        label: el.label,
        value,
        icon: el.icon,
        iconImg: isImageIcon(el.icon),
        pips: [1, 2, 3, 4].map((i) => i <= n),
        effect: affEffect[value] ?? "—",
        tip: `${el.label} — ${game.i18n.localize(cfg.affinityLevels[value])}`
      };
    });

    // Attribute cards (with the Skill-Point cost to raise each one).
    context.attributeList = cfg.attributeKeys.map((k) => {
      const a = this.actor.system.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        die: a.die ?? `d${a.value}`,
        base: a.base,
        icon: cfg.attributeIcons?.[k] ?? ""
      };
    });

    // Initiative formula label for the side-panel button (Agility die + Mind die).
    const agi = this.actor.system.attributes.agility?.value ?? 4;
    const mnd = this.actor.system.attributes.mind?.value ?? 4;
    context.initiativeLabel = `d${agi} + d${mnd}`;

    this.#prepareItems(context);
    return context;
  }

  /** @override — themed dropdowns + paperdoll drag-and-drop. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    enhanceSelects(this.element);
    this.#bindTooltips();
    this.#bindSkillFilter();
    if (this.isEditable) {
      this.#bindPaperdoll();
      this.#bindSkillContext();
      this.#bindEffectDnD();
    }
  }

  /** Make Effects-drawer rows draggable (as ActiveEffect drag data) and let the sheet
   *  accept dropped effects — drag an effect from another sheet/item/token onto this
   *  character to apply a copy. Native listeners, mirroring the paperdoll DnD approach. */
  #bindEffectDnD() {
    const root = this.element;
    if (!root) return;
    // Drawer rows are rebuilt each render → (re)mark them draggable.
    for (const row of root.querySelectorAll(".effect-row[data-effect-uuid]")) {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "ActiveEffect", uuid: row.dataset.effectUuid }));
      });
    }
    // Drop target lives on the persistent window root → bind once.
    if (root.dataset.paEffectDrop) return;
    root.dataset.paEffectDrop = "1";
    root.addEventListener("dragover", (ev) => { ev.preventDefault(); });
    root.addEventListener("drop", (ev) => this.#onEffectDrop(ev));
  }

  /** Apply a dropped ActiveEffect as a copy on this actor. Ignores non-effect drops, so
   *  the paperdoll's item DnD (which stops propagation on its own zones) is unaffected. */
  async #onEffectDrop(ev) {
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain") || "{}"); } catch (_) { return; }
    if (data?.type !== "ActiveEffect" || !data.uuid) return;
    ev.preventDefault();
    const effect = await fromUuid(data.uuid);
    if (effect) await applyEffectCopy(this.actor, effect);
  }

  /* -------------------------------------------- */
  /*  Context helpers                             */
  /* -------------------------------------------- */

  #prepareItems(context) {
    const skills = [];
    const containers = [];
    const packages = [];
    const groups = Object.fromEntries(GEAR_GROUPS.map((k) => [k, []]));
    for (const item of this.actor.items) {
      if (item.type === "skill") skills.push(item);
      else if (item.type === "container") containers.push(item);
      else if (item.type === "package") packages.push(item);
      else if (groups[item.type]) groups[item.type].push(item);
    }

    const lite = (i) => ({ id: i.id, name: i.name, img: i.img, system: i.system });

    // Skills drawer: grouped by action type (Active / React / Passive). Each tile
    // carries its Effect glyph + role colour, rank, energy cost, pinned state, and
    // rules-validation flags (over Modifier budget / unaffordable at current Energy).
    skills.sort(bySort);
    const cfgS = CONFIG.PROJECTANIME;
    const curEnergy = this.actor.system.energy?.value ?? 0;
    const mapDrawerSkill = (i) => {
      const rank = cfgS.skillRanks[i.system.rank] ?? {};
      const cost = i.system.energyCost ?? 0;
      // Granted (free) abilities come from a Package/Skill's Grant effect — badged, and
      // not directly deletable (they're managed by their source; the trash is hidden).
      const granted = !!i.getFlag("project-anime", "granted");
      const byId = granted ? i.getFlag("project-anime", "grantedBy") : null;
      const source = byId ? this.actor.items.get(byId)?.name : "";
      return {
        id: i.id,
        name: i.name,
        img: i.img,
        stars: rank.stars ?? "",
        energyCost: cost,
        pinned: !!i.getFlag("project-anime", "readied"),
        over: !!i.system.modifiersOver,
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

    // Skill-Point summary for the drawer strip; the full refundable ledger lives in the
    // Skill Point Log dialog (opened via the button). `spLogCount` badges the button.
    const { spInfo, spLog } = skillPointLedger(this.actor);
    context.spInfo = spInfo;
    context.spLogCount = spLog?.length ?? 0;

    // Packages (ability bundles, e.g. a chosen Race) carried by the actor — shown as chips
    // at the top of the Skills drawer; each grants its abilities via the Grant engine.
    context.packages = packages
      .sort(bySort)
      .map((p) => ({ id: p.id, name: p.name, img: p.img, category: p.system?.category ?? "" }));

    // Quick-action panel on the Stats main view: equipped weapons (attack from
    // here) + skills the player has pinned (via a `readied` flag). Two blocks.
    context.quickWeapons = groups.weapon
      .filter((i) => i.system?.equipped)
      .sort(bySort)
      .map((i) => ({ id: i.id, name: i.name, img: i.img }));
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

    // Containers (WoW-style bags): a bar of [Backpack] + one tab per container item.
    // The inventory grids below are scoped to whichever bag is selected.
    const containerIds = new Set(containers.map((c) => c.id));
    if (this.#selectedBag && !containerIds.has(this.#selectedBag)) this.#selectedBag = ""; // deleted bag → backpack
    const sel = this.#selectedBag;
    // An item's effective bag: its container if that still exists, else the backpack.
    const bagOf = (i) => {
      const c = i.system?.container || "";
      return c && containerIds.has(c) ? c : "";
    };
    const containable = GEAR_GROUPS.flatMap((k) => groups[k]);
    const countIn = (id) => containable.reduce((n, i) => n + (bagOf(i) === id ? 1 : 0), 0);

    context.selectedBag = sel;
    context.bags = [
      { id: "", name: game.i18n.localize("PROJECTANIME.Container.backpack"), icon: "fa-box-open", count: countIn(""), selected: sel === "", backpack: true },
      ...containers.sort(bySort).map((c) => ({ id: c.id, name: c.name, img: c.img, count: countIn(c.id), selected: sel === c.id }))
    ];

    // Inventory — one flat icon grid (FFXIV-style, no type headers) of the items in
    // the selected bag, lightly ordered by type so like items cluster together.
    context.bagItems = containable
      .filter((i) => bagOf(i) === sel)
      .sort((a, b) => GEAR_GROUPS.indexOf(a.type) - GEAR_GROUPS.indexOf(b.type) || bySort(a, b))
      .map((i) => {
        const l = lite(i);
        const q = Number(i.system?.quantity);
        l.qty = q > 1 ? q : null;          // quantity badge (stacks)
        l.equippable = EQUIPPABLE.has(i.type);
        l.equipped = !!i.system?.equipped;
        return l;
      });

    // Paperdoll: resolve each slot's current occupant for the Gear drawer. A flat
    // list — the template positions each slot over the portrait by its `key`.
    const equipped = this.actor.items.filter((i) => i.system?.equipped);
    context.paperdoll = PAPERDOLL_SLOTS.map((def) => {
      const it = this.#slotOccupant(def.key, equipped);
      let label = game.i18n.localize(`PROJECTANIME.Equipment.${def.base}`);
      if (def.base === "accessory") label += ` ${Number(def.key.split(":")[1]) + 1}`;
      return {
        key: def.key,
        icon: def.icon,
        label,
        item: it ? { id: it.id, name: it.name, img: it.img } : null
      };
    });
  }

  /** Which equipped item currently fills a paperdoll slot (null if empty). */
  #slotOccupant(slotKey, equipped) {
    if (slotKey === "mainHand") return equipped.find((i) => i.type === "weapon" && i.system.hand === "main") ?? null;
    if (slotKey === "offHand") return equipped.find((i) => (i.type === "weapon" && i.system.hand === "off") || i.type === "shield") ?? null;
    if (slotKey === "armor") return equipped.find((i) => i.type === "armor") ?? null;
    if (slotKey === "container") return equipped.find((i) => i.type === "container") ?? null;
    if (slotKey.startsWith("accessory:")) {
      const idx = Number(slotKey.split(":")[1]) || 0;
      return equipped.filter((i) => i.type === "accessory").sort(bySort)[idx] ?? null;
    }
    return null;
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

  static #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }

  static async #onEditItem(event, target) {
    ProjectAnimeActorSheet.#getItem.call(this, target)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    await ProjectAnimeActorSheet.#getItem.call(this, target)?.deleteDialog();
  }

  static async #onRollCheck(event, target) {
    const attr = target.dataset.attribute || "might";
    return rollCheck(this.actor, { attrA: attr, attrB: attr });
  }

  static async #onRollInitiative() {
    return rollInitiative(this.actor);
  }

  static async #onRollItem(event, target) {
    ProjectAnimeActorSheet.#getItem.call(this, target)?.roll({ event });
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
    await this.#clearSlot(target.dataset.slot);
  }

  /* -------------------------------------------- */
  /*  Paperdoll equip logic                       */
  /* -------------------------------------------- */

  /** Equip `item` into a paperdoll slot, clearing whatever it displaces. */
  async #equipToSlot(item, slotKey) {
    if (!item || !slotKey) return;
    const base = slotKey.startsWith("accessory") ? "accessory" : slotKey;
    if (!SLOT_ACCEPTS[base]?.includes(item.type)) return;

    const equipped = this.actor.items.filter((i) => i.system?.equipped && i.id !== item.id);
    const updates = [];
    const clear = (it) => updates.push({ _id: it.id, "system.equipped": false });
    const target = { _id: item.id, "system.equipped": true };

    switch (base) {
      case "mainHand": {
        const twoHanded = item.system.grip === "two";
        target["system.hand"] = "main";
        for (const it of equipped) if (it.type === "weapon" && it.system.hand === "main") clear(it);
        // A two-handed grip occupies both hands → also free the off hand.
        if (twoHanded) for (const it of equipped) if ((it.type === "weapon" && it.system.hand === "off") || it.type === "shield") clear(it);
        break;
      }
      case "offHand": {
        if (item.type === "weapon") target["system.hand"] = "off";
        for (const it of equipped) if ((it.type === "weapon" && it.system.hand === "off") || it.type === "shield") clear(it);
        // A two-handed weapon in the main hand must give up a hand for this.
        for (const it of equipped) if (it.type === "weapon" && it.system.hand === "main" && it.system.grip === "two") clear(it);
        break;
      }
      case "armor":
        for (const it of equipped) if (it.type === "armor") clear(it);
        break;
      case "container":
        for (const it of equipped) if (it.type === "container") clear(it);
        break;
      case "accessory": {
        const idx = Number(slotKey.split(":")[1]) || 0;
        const accs = equipped.filter((i) => i.type === "accessory").sort(bySort);
        if (accs[idx]) clear(accs[idx]);               // swap out this slot's occupant
        const rest = accs.filter((_, i) => i !== idx);
        while (rest.length >= 2) clear(rest.pop());     // never exceed two accessory slots
        break;
      }
    }

    updates.push(target);
    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /** Unequip whatever fills `slotKey`. */
  async #clearSlot(slotKey) {
    const occupant = this.#slotOccupant(slotKey, this.actor.items.filter((i) => i.system?.equipped));
    if (occupant) await occupant.update({ "system.equipped": false });
  }

  /** Open the click-to-equip popover for a slot: eligible items + an Unequip row. */
  #openSlotPicker(slotKey, anchor) {
    if (!this.isEditable || !slotKey) return;
    this.element.querySelector(".pd-picker")?.remove();

    const base = slotKey.startsWith("accessory") ? "accessory" : slotKey;
    const accepts = SLOT_ACCEPTS[base] ?? [];
    const equipped = this.actor.items.filter((i) => i.system?.equipped);
    const occupant = this.#slotOccupant(slotKey, equipped);
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

    if (occupant) addRow("pd-empty", (r) => (r.textContent = game.i18n.localize("PROJECTANIME.Equipment.empty")), () => this.#clearSlot(slotKey));
    for (const it of candidates) {
      addRow(`pd-option${occupant && it.id === occupant.id ? " is-selected" : ""}`, (r) => {
        const img = document.createElement("img");
        img.src = it.img;
        const span = document.createElement("span");
        span.textContent = it.name;
        r.append(img, span);
      }, () => this.#equipToSlot(it, slotKey));
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
        const stars = cfg.skillRanks[s.system?.rank]?.stars ?? "";
        content += `<label class="psd-row"><input type="checkbox" name="${s.id}"${on} /><img src="${esc(s.img)}" /><span class="psd-name">${esc(s.name)}</span><span class="psd-meta">${stars}</span></label>`;
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
  #bindTooltips() {
    const root = this.element;
    if (!root) return;
    const cache = new Map();
    for (const el of root.querySelectorAll("[data-item-id]")) {
      const item = this.actor.items.get(el.dataset.itemId);
      if (!item) continue;
      if (!cache.has(item.id)) cache.set(item.id, this.#itemTooltip(item));
      el.dataset.tooltip = cache.get(item.id);
      el.dataset.tooltipClass = "pa-tooltip";
      el.dataset.tooltipDirection = "RIGHT";
      el.removeAttribute("title");
      el.querySelectorAll("[title]").forEach((c) => c.removeAttribute("title"));
    }
  }

  /** Build the rich-tooltip HTML for one item (header + stat rows + description). */
  #itemTooltip(item) {
    const sys = item.system ?? {};
    const cfg = CONFIG.PROJECTANIME;
    const i18n = (k) => game.i18n.localize(k);
    const esc = foundry.utils.escapeHTML;
    const aName = (k) => i18n(cfg.attributes[k] ?? k);
    const elName = (k) => (k ? (getElements().find((e) => e.key === k)?.label ?? k) : "");
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
      row(i18n("PROJECTANIME.Field.accuracy"), `⟪${aName(acc.attrA)}⟫ + ⟪${aName(acc.attrB)}⟫${signed(acc.mod)}`);
      if (sys.damage) row(i18n("PROJECTANIME.Roll.damage"), `${elName(sys.damage.type)}${signed(sys.damage.mod)}`.trim());
      if (item.type === "shield") row(i18n("PROJECTANIME.Field.evasionBonus"), sys.evasionBonus);
      if (cfg.hands?.[sys.hand]) row(i18n("PROJECTANIME.Field.hand"), i18n(cfg.hands[sys.hand]));
      if (sys.equipped) typeLabel += ` · ${i18n("PROJECTANIME.Field.equipped")}`;
    } else if (item.type === "skill") {
      const rank = cfg.skillRanks[sys.rank] ?? {};
      typeLabel = `${i18n("TYPES.Item.skill")} · ${i18n(cfg.actionTypes[sys.actionType] ?? "")}`;
      rowHTML(i18n("PROJECTANIME.Skill.field.rank"), `<span class='pa-tt-stars'>${rank.stars ?? ""}</span> ${esc(i18n(rank.label ?? ""))}`);
      if (sys.energyCost > 0) row(i18n("PROJECTANIME.Skill.field.energyCost"), `${sys.energyCost} EN`);
      row(i18n("PROJECTANIME.Skill.field.range"), rangeLabel(sys.range));
      row(i18n("PROJECTANIME.Skill.field.effect"), i18n(cfg.skillEffects[sys.effect] ?? ""));
      if (cfg.dieEffects.includes(sys.effect)) row(i18n(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie"), aName(sys.attributes?.[sys.damageAttr]));
      if (sys.accuracyMod) row(i18n("PROJECTANIME.Skill.field.accuracyMod"), `+${sys.accuracyMod}`);
      if (sys.actionType === "react" && sys.trigger) row(i18n("PROJECTANIME.Skill.field.trigger"), i18n(cfg.triggers[sys.trigger] ?? sys.trigger));
      if (sys.damageType && cfg.damageEffects.includes(sys.effect)) row(i18n("PROJECTANIME.Skill.field.damageType"), elName(sys.damageType));
    } else if (item.type === "armor") {
      row(i18n("PROJECTANIME.Field.defenseBonus"), sys.defenseBonus);
      if (sys.evasionPenalty) row(i18n("PROJECTANIME.Field.evasionPenalty"), sys.evasionPenalty);
    } else if (item.type === "container") {
      row(i18n("PROJECTANIME.Field.capacityBonus"), sys.capacityBonus);
    }
    if (sys.quantity > 1) row(i18n("PROJECTANIME.Field.quantity"), sys.quantity);

    const head = `<div class='pa-tt-head'><img class='pa-tt-img' src='${esc(item.img)}' /><div class='pa-tt-heads'><div class='pa-tt-title'>${esc(item.name)}</div><div class='pa-tt-type'>${esc(typeLabel)}</div></div></div>`;
    const rowsHtml = rows.length ? `<div class='pa-tt-rows'>${rows.join("")}</div>` : "";
    const desc = sys.description ? `<div class='pa-tt-desc'>${sys.description}</div>` : "";
    return `${head}<div class='pa-tt-body'>${rowsHtml}${desc}</div>`;
  }

  /** Skills drawer: action-type chips + name search. Pure client-side show/hide — no
   *  re-render — so it's instant and never fights the drawer-open state. Filter state
   *  lives in #skillFilter / #skillQuery and is re-applied here after every render. */
  #bindSkillFilter() {
    const drawer = this.element?.querySelector('.section-drawer[data-section="skills"]');
    if (!drawer) return;
    const chips = drawer.querySelectorAll(".skill-chip");
    const search = drawer.querySelector(".skill-search");
    const apply = () => {
      const f = this.#skillFilter;
      const q = this.#skillQuery.trim().toLowerCase();
      for (const chip of chips) chip.classList.toggle("active", chip.dataset.filter === f);
      for (const group of drawer.querySelectorAll(".skill-group")) {
        const typeOk = f === "all" || group.dataset.group === f;
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
        this.#skillFilter = chip.dataset.filter;
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

  /** Right-click a skill tile (drawer or quick panel) → context menu. Editable views only. */
  #bindSkillContext() {
    const root = this.element;
    if (!root) return;
    for (const tile of root.querySelectorAll(".skill-tile, .quick-tile[data-readied-type='skill']")) {
      tile.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        const item = this.actor.items.get(tile.dataset.itemId);
        if (item) this.#openItemContext(item, ev);
      });
    }
  }

  /** Build the skill context menu as a popover anchored at the cursor. */
  #openItemContext(item, ev) {
    this.element.querySelector(".pd-picker")?.remove();
    const readied = !!item.getFlag("project-anime", "readied");

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

    add("fa-dice-d20", "PROJECTANIME.Action.use", () => item.roll({ event: ev }));
    if (readied) add("fa-xmark", "PROJECTANIME.Quick.remove", () => item.unsetFlag("project-anime", "readied"));
    else add("fa-thumbtack", "PROJECTANIME.Quick.pin", () => item.setFlag("project-anime", "readied", true));
    add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => item.sheet.render(true));
    add("fa-trash", "PROJECTANIME.Action.delete", () => item.deleteDialog(), "danger");

    this.element.appendChild(menu);
    menu.addEventListener("toggle", (e) => {
      if (e.newState !== "open") { menu.remove(); return; }
      Object.assign(menu.style, { position: "fixed", inset: "auto", margin: "0", left: `${ev.clientX}px`, top: `${ev.clientY}px`, minWidth: "160px" });
      const h = menu.offsetHeight, w = menu.offsetWidth;
      if (ev.clientY + h > window.innerHeight - 4) menu.style.top = `${Math.max(4, ev.clientY - h)}px`;
      if (ev.clientX + w > window.innerWidth - 4) menu.style.left = `${Math.max(4, ev.clientX - w)}px`;
    });
    menu.showPopover();
  }

  /** Native drag-and-drop: drag bag/slot items onto a slot to equip; onto the bag to unequip. */
  #bindPaperdoll() {
    const root = this.element;
    if (!root) return;

    for (const el of root.querySelectorAll("[data-item-id][draggable='true']")) {
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ paItem: el.dataset.itemId }));
        ev.dataTransfer.effectAllowed = "move";
      });
    }

    for (const slot of root.querySelectorAll(".pd-slot")) {
      slot.addEventListener("dragover", (ev) => { ev.preventDefault(); slot.classList.add("drag-over"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
      slot.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        slot.classList.remove("drag-over");
        const item = this.#draggedItem(ev);
        if (item) this.#equipToSlot(item, slot.dataset.slot);
      });
    }

    const bag = root.querySelector(".pd-bag");
    if (bag) {
      bag.addEventListener("dragover", (ev) => ev.preventDefault());
      bag.addEventListener("drop", (ev) => {
        const item = this.#draggedItem(ev);
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
      tab.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        tab.classList.remove("drag-over");
        const item = this.#draggedItem(ev);
        const bagId = tab.dataset.bagId || "";
        if (item && item.type !== "container" && (item.system.container || "") !== bagId) {
          item.update({ "system.container": bagId });
        }
      });
    }
  }

  /** Resolve the embedded item being dragged within this sheet (null if not ours). */
  #draggedItem(ev) {
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain") || "{}");
      if (data.paItem) return this.actor.items.get(data.paItem) ?? null;
    } catch (_) { /* not our drag payload */ }
    return null;
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

  /** Cycle an affinity none→weak→resist→immune→absorb (Shift-click reverses). */
  static async #onCycleAffinity(event, target) {
    const key = target.dataset.affinity;
    if (!key) return;
    const order = Object.keys(CONFIG.PROJECTANIME.affinityLevels);
    const cur = this.actor.system.affinities?.[key] ?? "none";
    const step = event.shiftKey ? -1 : 1;
    const next = order[(order.indexOf(cur) + step + order.length) % order.length];
    await this.actor.update({ [`system.affinities.${key}`]: next });
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

  /* -------------------------------------------- */
  /*  Advancement                                 */
  /* -------------------------------------------- */

  static #onOpenAdvancement() {
    const id = `pa-advancement-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new AdvancementApp(this.actor).render(true);
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

  /** @override — the first time an owner opens an un-finished character, launch the
   *  Character Creator. Gated by `flags.project-anime.creationComplete` (set on Finish),
   *  so it guides new PCs once and never nags afterwards. */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    if (this.actor.type !== "character" || !this.isEditable) return;
    if (this.actor.getFlag("project-anime", "creationComplete")) return;
    ProjectAnimeActorSheet.#openCreator(this.actor);
  }
}
