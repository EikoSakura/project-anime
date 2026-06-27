import { rollCheck, rollInitiative, useConsumable } from "../helpers/dice.mjs";
import { enhanceSelects } from "../helpers/select.mjs";
import { rangeLabel, physicalRangeLabel, skillEffectKeys } from "../helpers/config.mjs";
import { getElements, isImageIcon } from "../helpers/elements.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { summarizeRules, narrateRule, normalizeRule, applyEffectCopy } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { AdvancementApp } from "../apps/advancement.mjs";
import { RestApp } from "../apps/rest.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";
import { CharacterCreatorApp } from "../apps/character-creator.mjs";
import { MonsterCreatorApp } from "../apps/monster-creator.mjs";
import { SkillLogApp } from "../apps/skill-log.mjs";
import { skillPointLedger } from "../helpers/skill-points.mjs";
import { blankBond, getBonds, saveBonds, BOND_MAX_RANK, npcBond, npcBondRanks, forgeBondFromNpc } from "../helpers/bonds.mjs";
import { getFactions, clampStanding } from "../helpers/factions.mjs";
import { confirmAndDismiss } from "../helpers/servants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Loose gear item types shown as inventory grids (Skills + Containers are handled
 *  separately — containers are the WoW-style "bags" in the container bar). */
const GEAR_GROUPS = ["weapon", "armor", "shield", "accessory", "consumable", "gear"];

/** Item types that can be equipped (and so get an equip toggle). */
const EQUIPPABLE = new Set(["weapon", "armor", "shield", "accessory"]);

/** Item types that can be copied onto an actor via drag-drop (every embeddable Item type). */
const TRANSFERABLE_ITEM_TYPES = new Set([...GEAR_GROUPS, "skill", "container", "package"]);

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
  mainHand: ["weapon", "shield"],
  offHand: ["weapon", "shield"],
  armor: ["armor"],
  container: ["container"],
  accessory: ["accessory"]
};

/** Stable inventory ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

/** First letter of a bond's name (the diamond-portrait fallback when there's no image). */
const initialOf = (name) => String(name || "?").trim().charAt(0).toUpperCase() || "?";

/** Default icon for a Signature Trait / Trait card before one is chosen. */
const DEFAULT_TRAIT_IMG = "icons/svg/aura.svg";

/* ---- Signature Trait / Trait card auto-description (a skill-style rules line) ---- */
const escTraitHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** Wrap dice / signed ints / percents in the gold "number" span (matches skill descriptions). */
const colorizeTraitNums = (s) => String(s ?? "").replace(/(\bd\d+\b|[+\-−]?\d+%?)/g, (m) => `<span class="nd-num">${m}</span>`);
/** Join clauses naturally: "a", "a and b", "a, b, and c". */
const joinTraitClauses = (arr) => {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a.join("");
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
};
/** The auto-written rules line (+ optional flavor) for a Signature/Trait card, as safe HTML. The
 *  mechanics describe themselves (numbers in gold); flavor is escaped user prose for bespoke abilities. */
function traitCardDescHTML(rules, flavor) {
  const clauses = (rules ?? []).map((r) => narrateRule(normalizeRule(r))).filter(Boolean);
  let s = joinTraitClauses(clauses);
  if (s) s = colorizeTraitNums(escTraitHtml(s.charAt(0).toUpperCase() + s.slice(1) + "."));
  const fl = (flavor ?? "").trim();
  const parts = [];
  if (fl) parts.push(`<span class="nd-flavor">${escTraitHtml(fl)}</span>`);
  if (s) parts.push(`<span class="nd-rules">${s}</span>`);
  return parts.join(" ");
}

/** Fallback hero gradient when a bond has no banner — built from its accent colour. */
const bondHeroGrad = (acc) =>
  `radial-gradient(120% 120% at 78% 8%, color-mix(in srgb, ${acc} 42%, transparent), transparent 55%), ` +
  `linear-gradient(150deg, #2c2340, #1c1730 60%, #120e1c)`;

/** Sections that open as slide-in drawers (Stats is the always-visible main view). The Bonds
 *  drawer (a character's own relationship cards) is Character-only — see _configureRenderOptions. */
const DRAWER_SECTIONS = ["skills", "gear", "biography", "defenses", "effects", "bonds", "npcbond"];

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
      cycleShieldUse: ProjectAnimeActorSheet.#onCycleShieldUse,
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
      rollTalent: ProjectAnimeActorSheet.#onRollTalent,
      editSignature: ProjectAnimeActorSheet.#onEditSignature,
      clearSignature: ProjectAnimeActorSheet.#onClearSignature,
      addTrait: ProjectAnimeActorSheet.#onAddTrait,
      editTrait: ProjectAnimeActorSheet.#onEditTrait,
      removeTrait: ProjectAnimeActorSheet.#onRemoveTrait,
      rollInitiative: ProjectAnimeActorSheet.#onRollInitiative,
      openAdvancement: ProjectAnimeActorSheet.#onOpenAdvancement,
      openRest: ProjectAnimeActorSheet.#onOpenRest,
      buildSkill: ProjectAnimeActorSheet.#onBuildSkill,
      openCreator: ProjectAnimeActorSheet.#onOpenCreator,
      openSkillLog: ProjectAnimeActorSheet.#onOpenSkillLog,
      openBond: ProjectAnimeActorSheet.#onOpenBond,
      closeBond: ProjectAnimeActorSheet.#onCloseBond,
      newBond: ProjectAnimeActorSheet.#onNewBond,
      deleteBond: ProjectAnimeActorSheet.#onDeleteBond,
      deepenBond: ProjectAnimeActorSheet.#onDeepenBond,
      lessenBond: ProjectAnimeActorSheet.#onLessenBond,
      addBondVital: ProjectAnimeActorSheet.#onAddBondVital,
      removeBondVital: ProjectAnimeActorSheet.#onRemoveBondVital,
      pickBondPortrait: ProjectAnimeActorSheet.#onPickBondPortrait,
      pickBondBanner: ProjectAnimeActorSheet.#onPickBondBanner,
      openBondActor: ProjectAnimeActorSheet.#onOpenBondActor,
      clearBondActor: ProjectAnimeActorSheet.#onClearBondActor,
      toggleRole: ProjectAnimeActorSheet.#onToggleRole,
      toggleStatblock: ProjectAnimeActorSheet.#onToggleStatblock,
      removeRewardItem: ProjectAnimeActorSheet.#onRemoveRewardItem,
      editBondRankEffect: ProjectAnimeActorSheet.#onEditBondRankEffect,
      pickNpcBondBanner: ProjectAnimeActorSheet.#onPickNpcBondBanner,
      openNpcBondRank: ProjectAnimeActorSheet.#onOpenNpcBondRank,
      closeNpcBondRank: ProjectAnimeActorSheet.#onCloseNpcBondRank,
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
    effects: { template: "systems/project-anime/templates/actor/effects-drawer.hbs" },
    bonds: { template: "systems/project-anime/templates/actor/bonds.hbs", scrollable: [".bonds-grid"] },
    npcbond: { template: "systems/project-anime/templates/actor/npc-bond.hbs", scrollable: [".npcbond-scroll"] }
  };

  /** Which section drawer is open ("skills"/"gear"/"biography"/"defenses"), or null.
   *  Transient UI state; re-applied on render so it survives re-renders. */
  #openSection = null;

  /** The bond whose detail book is currently open (id), or null. Transient UI state, re-applied on
   *  render so the open book survives the re-render an edit triggers. */
  #openBond = null;

  /** The NPC bond-offer RANK whose detail book is currently open (rank number), or null. Transient UI
   *  state, re-applied on render so the open rank book survives the re-render an edit triggers. */
  #openNpcRank = null;

  /** Queued "bond deepened" flourish: { rank, id }, set by Deepen and consumed once in _onRender
   *  after the data-driven re-render (so the gala + star-pop fire exactly once). */
  #bondGala = null;

  /** One-shot flag → plays the role crest's flip animation once after a Monster⇄NPC toggle. */
  #roleFlip = false;

  /** Whether a social NPC's collapsible "Combat stats" block is expanded (npc-role only). Default
   *  collapsed — an NPC leads with its dossier, with the statblock tucked away. Re-applied on render. */
  #statblockOpen = false;

  /** Which bag (container) the Gear inventory is scoped to: "" = backpack, else a
   *  container item id. Drives the WoW-style bag view; survives re-renders. */
  #selectedBag = "";

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
    // Bonds are a Player Character's own relationship cards — not shown for NPCs.
    if (this.document.type === "character") options.parts.push("bonds");
    // A social NPC (role "npc") authors a Bond OFFER in its own drawer; Monsters don't.
    if (this.document.type === "npc" && this.document.system?.role === "npc") options.parts.push("npcbond");
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
    // NPC role: "monster" (the combat statblock) vs "npc" (a social NPC that offers a Bond). Drives
    // the header toggle + which extra UI shows. Characters are neither.
    context.npcRole = context.isNPC ? (this.actor.system.role ?? "monster") : null;
    context.isNpcRole = context.isNPC && context.npcRole === "npc";
    context.isMonster = context.isNPC && context.npcRole !== "npc";
    // A social NPC's combat statblock is collapsible (default folded) — see stats.hbs.
    context.statblockOpen = this.#statblockOpen;
    // Monster ★-Tier badge — only on a Monster-role NPC (a social NPC isn't Tiered). The star count
    // is the per-NPC power rating; rendered as N filled stars before the tier label ("★★★ Elite").
    const tierKey = context.isMonster ? this.actor.system.tier : null;
    const tierCfg = tierKey ? CONFIG.PROJECTANIME.monsterTiers?.[tierKey] : null;
    const tierStars = context.isMonster ? (Number(this.actor.system.stars) || 0) : 0;
    context.tierBadge = tierCfg
      ? { label: game.i18n.localize(tierCfg.label), icon: tierCfg.icon, color: tierCfg.color,
          stars: tierStars >= 1 ? Array.from({ length: tierStars }, (_, i) => i) : null,
          apex: tierStars >= CONFIG.PROJECTANIME.maxStars,
          // Encounter-budget worth (Party-Equivalents) surfaced at a glance — see helpers/encounter.mjs.
          worth: game.i18n.localize(`PROJECTANIME.Worth.${tierKey}`) }
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
    // Faction affiliation for a social NPC — relocated to the Biography "Profile" (was the Bond drawer).
    // Stored at system.bond.faction; the bio select uses name= so the actor form saves it directly.
    if (context.isNpcRole) {
      const facId = this.actor.system.bond?.faction ?? "";
      const facs = getFactions();
      context.npcFaction = {
        value: facId,
        label: facs.find((f) => f.id === facId)?.name ?? "",
        options: facs.map((f) => ({ id: f.id, name: f.name, sel: f.id === facId }))
      };
    }
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

    // NPC HQ work profile — Talents (work dice) + the Signature Trait + Traits (npc actor type only).
    if (context.isNPC) {
      context.talentList = cfg.talentKeys.map((k) => {
        const tt = this.actor.system.talents?.[k] ?? {};
        const base = tt.base ?? 4;
        const value = tt.value ?? base; // current die (base + any `talent` effect), shown on the card
        return { key: k, label: game.i18n.localize(cfg.talents[k]), icon: cfg.talentIcons?.[k] ?? "", base, value, die: `d${value}` };
      });
      // Signature Trait + Traits — skill-style ability cards. The flat Trait-Bonus rows are retired;
      // bonuses are authored as Traits via the Effect Builder, each shown with its auto rules line.
      const tr = this.actor.system.trait ?? {};
      context.signature = {
        name: tr.name ?? "",
        img: tr.img || DEFAULT_TRAIT_IMG,
        descHTML: traitCardDescHTML(tr.rules, tr.desc),
        empty: !((tr.name || "").trim() || tr.rules?.length || (tr.desc || "").trim())
      };
      context.traitsList = (this.actor.system.traits ?? []).map((t, idx) => ({
        idx, id: t.id, name: t.name ?? "", img: t.img || DEFAULT_TRAIT_IMG,
        descHTML: traitCardDescHTML(t.rules, "")
      }));
    }

    // Initiative formula label for the side-panel button (Agility die + Mind die).
    const agi = this.actor.system.attributes.agility?.value ?? 4;
    const mnd = this.actor.system.attributes.mind?.value ?? 4;
    context.initiativeLabel = `d${agi} + d${mnd}`;

    // BONDS drawer (Characters only) — the player's own relationship cards (flip-cards).
    if (context.isCharacter) context.bonds = await this.#bondContext();
    // BOND OFFER drawer (social NPCs) — the bond this NPC offers + its per-rank rewards.
    if (context.isNpcRole) context.npcBond = this.#npcBondContext();

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
      this.#bindItemContext();
      this.#bindSheetDnD();
      this.#bindHudDrag();
      this.#bindBondsDrawer();
      this.#bindNpcBond();
      this.#bindEnergyMax();
    }
    // A queued Deepen flourish fires once, after the data re-render that raised the rank.
    if (this.#bondGala != null) {
      const { rank, id } = this.#bondGala;
      this.#bondGala = null;
      ProjectAnimeActorSheet.#playBondGala(rank);
      const book = this.element?.querySelector?.(`.bond-overlay[data-bond-book="${id}"]`);
      book?.querySelectorAll?.(`.st[data-star="${rank - 1}"]`).forEach((s) => s.classList.add("pop"));
      book?.querySelector?.(`.ability[data-ar="${rank}"]`)?.classList.add("just");
    }
    // The Monster⇄NPC crest flips once, right after a role toggle's re-render.
    if (this.#roleFlip) {
      this.#roleFlip = false;
      this.element?.querySelector?.(".role-crest")?.classList.add("flip");
    }
  }

  /** Drag-and-drop INTO the sheet: accept Items (skills + gear) and ActiveEffects dropped from
   *  another sheet, a compendium, the sidebar, or the party stash — each lands as a copy on this
   *  actor. Also (re)marks the Effects-drawer rows draggable so effects can be dragged back out.
   *  Native listeners, mirroring the paperdoll DnD approach. */
  #bindSheetDnD() {
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
    const data = this.#readDrag(ev);
    if (data?.type === "ActiveEffect" && data.uuid) {
      ev.preventDefault();
      const effect = await fromUuid(data.uuid);
      if (effect) await applyEffectCopy(this.actor, effect);
      return;
    }
    if (data?.type === "Actor" && data.uuid && this.actor.type === "character") {
      // Drag a social NPC onto a Player → forge/sync the bond it offers + deliver its rank rewards.
      // A monster / plain NPC (no offer) is ignored. Re-drag safe (matches by the NPC's UUID).
      ev.preventDefault();
      const npc = await fromUuid(data.uuid).catch(() => null);
      if (!npc) return;
      this.#openSection = "bonds";              // reveal the card on the re-render the forge triggers
      const res = await forgeBondFromNpc(this.actor, npc);
      if (!res) this.#openSection = null;       // no offer → nothing forged, leave drawers closed
      return;
    }
    if (data?.type === "Item" && data.uuid) {
      // A same-sheet drag (paperdoll/HUD tile) is handled by its own zones — ignore it here so
      // dropping a tile back on its own sheet never duplicates the item.
      if (data.paItem && this.actor.items.has(data.paItem)) return;
      ev.preventDefault();
      await this.#importDroppedItem(data);
    }
  }

  /** Foundry's ActorSheetV2 binds its own `element.ondrop` every render (see its `_onRender`),
   *  which auto-creates a raw copy of any dropped Item/ActiveEffect. We run our own drop pipeline
   *  (#onSheetDrop → #importDroppedItem / applyEffectCopy) that strips grant/natural/pin flags and
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

  /** Actor drops are handled by #onSheetDrop (drag a social NPC onto a PC → forge the bond it
   *  offers); suppress any base Actor-drop behavior so only our pipeline runs. */
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
    // The refundable Skill Point Log dialog opens for Characters and Monster-role NPCs (which now
    // carry the same ledger); social NPCs stay excluded — they don't build a statblock.
    context.showSpLog = context.isCharacter || context.isMonster;

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
    context.quickWeapons = [...groups.weapon.filter((i) => i.system?.equipped || isNatural(i)), ...groups.shield.filter(isWeaponShield)]
      .sort((a, b) => (!!b.system?.equipped - !!a.system?.equipped) || (isNatural(a) - isNatural(b)) || bySort(a, b))
      .map((i) => ({ id: i.id, name: i.name, img: i.img, natural: isNatural(i), shield: i.type === "shield" }));
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
    // The innate Natural Attack is surfaced in the quick panel, not the carried-gear grid — keep
    // it out of the bags (and their counts) so it never reads as droppable/loose equipment.
    const containable = GEAR_GROUPS.flatMap((k) => groups[k]).filter((i) => !i.getFlag("project-anime", "natural"));
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
        // Shields carry their Wield-As mode so the slot can show an inline toggle (Dual Wield ↔
        // Shield Only) — see the `pdSlot` partial + #onCycleShieldUse.
        item: it ? {
          id: it.id, name: it.name, img: it.img,
          shield: it.type === "shield",
          dualWield: it.type === "shield" && it.system.use === "dual"
        } : null
      };
    });
  }

  /** Which equipped item currently fills a paperdoll slot (null if empty). */
  #slotOccupant(slotKey, equipped) {
    if (slotKey === "mainHand") return equipped.find((i) => (i.type === "weapon" || i.type === "shield") && i.system.hand === "main") ?? null;
    if (slotKey === "offHand") return equipped.find((i) => (i.type === "weapon" || i.type === "shield") && i.system.hand === "off") ?? null;
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
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item) return;
    // Editing a Skill opens the full Skill Builder, pre-loaded with its choices; other
    // item types open their own sheet.
    if (item.type === "skill") return SkillBuilderApp.open(this.actor, { skillId: item.id });
    item.sheet.render(true);
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

  /** Paperdoll: flip a shield between Dual Wield and Shield Only in place (mirrors the gear
   *  context-menu toggle). Dual Wield counts toward dual-wielding; Shield Only steps its bash die. */
  static async #onCycleShieldUse(event, target) {
    const item = ProjectAnimeActorSheet.#getItem.call(this, target);
    if (!item || item.type !== "shield") return;
    await item.update({ "system.use": item.system.use === "dual" ? "shield" : "dual" });
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
        for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "main") clear(it);
        // A two-handed grip occupies both hands → also free the off hand.
        if (twoHanded) for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "off") clear(it);
        break;
      }
      case "offHand": {
        target["system.hand"] = "off";
        for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "off") clear(it);
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
  async #bindTooltips() {
    const root = this.element;
    if (!root) return;
    const cache = new Map();
    for (const el of root.querySelectorAll("[data-item-id]")) {
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
      if (sys.range) row(i18n("PROJECTANIME.Field.range"), physicalRangeLabel(sys.range));
      if (item.type === "shield" && sys.evasionBonus) row(i18n("PROJECTANIME.Field.evasionBonus"), sys.evasionBonus);
      if (item.type === "shield" && sys.defenseBonus) row(i18n("PROJECTANIME.Field.defenseBonus"), sys.defenseBonus);
      if (cfg.hands?.[sys.hand]) row(i18n("PROJECTANIME.Field.hand"), i18n(cfg.hands[sys.hand]));
      if (item.type === "shield" && cfg.shieldUses?.[sys.use]) row(i18n("PROJECTANIME.Field.shieldUse"), i18n(cfg.shieldUses[sys.use]));
      if (sys.equipped) typeLabel += ` · ${i18n("PROJECTANIME.Field.equipped")}`;
    } else if (item.type === "skill") {
      const rank = cfg.skillRanks[sys.rank] ?? {};
      typeLabel = `${i18n("TYPES.Item.skill")} · ${i18n(cfg.actionTypes[sys.actionType] ?? "")}`;
      rowHTML(i18n("PROJECTANIME.Skill.field.rank"), `<span class='pa-tt-stars'>${rank.stars ?? ""}</span> ${esc(i18n(rank.label ?? ""))}`);
      if (sys.energyCost > 0) row(i18n("PROJECTANIME.Skill.field.energyCost"), `${sys.energyCost} EN`);
      row(i18n("PROJECTANIME.Skill.field.range"), rangeLabel(sys.range));
      row(i18n("PROJECTANIME.Skill.field.effect"), skillEffectKeys(sys).map((k) => i18n(cfg.skillEffects[k] ?? "")).join(" + "));
      if (cfg.dieEffects.includes(sys.effect)) row(i18n(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie"), aName(sys.attributes?.[sys.damageAttr]));
      if (sys.accuracyMod) row(i18n("PROJECTANIME.Skill.field.accuracyMod"), `+${sys.accuracyMod}`);
      if (sys.damageMod && cfg.dieEffects.includes(sys.effect)) row(i18n(sys.effect === "mend" ? "PROJECTANIME.Skill.field.healMod" : "PROJECTANIME.Skill.field.damageMod"), `+${sys.damageMod}`);
      if (sys.actionType === "react" && sys.trigger) row(i18n("PROJECTANIME.Skill.field.trigger"), i18n(cfg.triggers[sys.trigger] ?? sys.trigger));
      if (sys.damageType && cfg.damageEffects.includes(sys.effect)) row(i18n("PROJECTANIME.Skill.field.damageType"), elName(sys.damageType));
      if ((sys.controlElement ?? "").trim() && skillEffectKeys(sys).includes("elementalControl")) row(i18n("PROJECTANIME.Skill.field.controlElement"), sys.controlElement.trim());
    } else if (item.type === "armor") {
      row(i18n("PROJECTANIME.Field.defenseBonus"), sys.defenseBonus);
      if (sys.evasionPenalty) row(i18n("PROJECTANIME.Field.evasionPenalty"), sys.evasionPenalty);
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
    add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => SkillBuilderApp.open(this.actor, { skillId: item.id }));
    add("fa-trash", "PROJECTANIME.Action.delete", () => item.deleteDialog(), "danger");
    show();
  }

  /** Gear context menu: use (consumables), post to chat, equip, pin to main screen, edit, delete. */
  #openGearContext(item, ev) {
    const equipped = !!item.system?.equipped;
    const pinned = !!item.getFlag("project-anime", "readied");
    const { add, show } = this.#contextMenu(ev);
    // Consumables get a one-click Use (consume now) above "Post to Chat" — the posted card carries
    // its own ▶ Use button, so both routes run the same restore-then-leave-inventory action.
    if (item.type === "consumable") add("fa-play", "PROJECTANIME.Action.use", () => useConsumable(this.actor, item));
    add("fa-comment", "PROJECTANIME.Action.toChat", () => item.roll({ event: ev }));
    // The innate Natural Attack isn't carried gear — offer only chat + tuning (no equip / delete).
    if (item.getFlag("project-anime", "natural")) {
      add("fa-pen-to-square", "PROJECTANIME.Action.edit", () => item.sheet.render(true));
      show();
      return;
    }
    if (item.type === "weapon" || item.type === "shield") {
      add("fa-hand-fist", "PROJECTANIME.Action.equipMainHand", () => this.#equipToSlot(item, "mainHand"));
      add("fa-shield-halved", "PROJECTANIME.Action.equipOffHand", () => this.#equipToSlot(item, "offHand"));
      if (equipped) add("fa-xmark", "PROJECTANIME.Action.unequip", () => item.update({ "system.equipped": false }));
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
        () => item.update({ "system.grip": twoH ? "one" : "two" }));
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
        const item = this.#draggedItem(ev) ?? await this.#importDroppedItem(this.#readDrag(ev));
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
      tab.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        tab.classList.remove("drag-over");
        const bagId = tab.dataset.bagId || "";
        const item = this.#draggedItem(ev);
        if (item) {
          // Own item → just refile it into this bag.
          if (item.type !== "container" && (item.system.container || "") !== bagId) {
            await item.update({ "system.container": bagId });
          }
          return;
        }
        // Foreign item → copy it straight into this bag.
        await this.#importDroppedItem(this.#readDrag(ev), { container: bagId });
      });
    }
  }

  /** Parse the drag payload (the JSON stashed on `text/plain` by our sheets + core Foundry). */
  #readDrag(ev) {
    try { return JSON.parse(ev.dataTransfer.getData("text/plain") || "{}"); } catch (_) { return {}; }
  }

  /** Resolve the embedded item being dragged within THIS sheet (null if foreign / not ours). */
  #draggedItem(ev) {
    const data = this.#readDrag(ev);
    return data.paItem ? (this.actor.items.get(data.paItem) ?? null) : null;
  }

  /** Strip a source item down to a clean object for copying onto this actor: drop the source id,
   *  the grant/natural/pin flags (meaningless or duplicative on a new owner), and reset the
   *  equipped/bag state so the copy lands loose in the chosen bag (default backpack). */
  #cleanItemForTransfer(item, { container = "" } = {}) {
    const obj = item.toObject();
    delete obj._id;
    delete obj.sort;
    const paFlags = obj.flags?.["project-anime"];
    if (paFlags) {
      delete paFlags.granted;     // a copy is a normally-owned ability, not a grant…
      delete paFlags.grantedBy;   // …and its source carrier doesn't exist on the new owner
      delete paFlags.natural;     // the new owner already has its own Natural Attack
      delete paFlags.readied;     // don't auto-pin to the new owner's quick panel
    }
    if (obj.system) {
      if ("equipped" in obj.system) obj.system.equipped = false;
      if ("container" in obj.system) obj.system.container = item.type === "container" ? "" : container;
    }
    return obj;
  }

  /** Copy a dropped foreign Item (from another sheet / compendium / sidebar / stash) onto this
   *  actor. Returns the created Item, or null if the drop wasn't a transferable foreign item. */
  async #importDroppedItem(data, options = {}) {
    if (data?.type !== "Item" || !data.uuid) return null;
    const item = await fromUuid(data.uuid);
    if (!item || item.documentName !== "Item" || !TRANSFERABLE_ITEM_TYPES.has(item.type)) return null;
    if (item.parent?.id === this.actor.id) return null; // already ours — never self-copy
    const [created] = await this.actor.createEmbeddedDocuments("Item", [this.#cleanItemForTransfer(item, options)]);
    return created ?? null;
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

  /** Close whichever section drawer is open (also dismisses any open bond book). */
  static #onCloseDrawer() {
    this.#openSection = null;
    this.#openBond = null;
    this.#openNpcRank = null;
    this.#applyDrawers();
    this.#applyBondBooks();
    this.#applyNpcRankBooks();
  }

  /** Reflect #openSection on the live DOM so the slide transition plays without a
   *  full re-render (the templates also apply it via `open.*`, for re-render persistence). */
  #applyDrawers() {
    for (const el of this.element?.querySelectorAll?.(".section-drawer") ?? []) {
      el.classList.toggle("open", el.dataset.section === this.#openSection);
    }
  }

  /* -------------------------------------------- */
  /*  Bonds drawer (per-character relationships)  */
  /* -------------------------------------------- */

  /** Build the view-model for every bond on this character: the tarot card (HQ-style art) plus the
   *  codex detail book (stars, dossier, vitals, quote, per-rank abilities) shown when the card is
   *  opened. `isOpen` reflects which book is open so it survives the re-render an edit triggers. */
  async #bondContext() {
    const factions = getFactions();
    const accentFor = (b) => b.accent || factions.find((f) => f.id === b.faction)?.accent || "#8a6fc0";
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    const L = (k) => game.i18n.localize(k);
    const F = (k, d) => game.i18n.format(k, d);
    const out = [];
    for (const b of getBonds(this.actor)) {
      const f = factions.find((x) => x.id === b.faction) ?? null;
      const maxed = b.rank >= BOND_MAX_RANK;
      const accent = accentFor(b);
      const stars = Array.from({ length: BOND_MAX_RANK }, (_v, i) => ({ full: i < b.rank, idx: i }));
      const abilities = (b.abilities ?? []).map((a) => {
        const on = a.rank <= b.rank;
        return {
          rank: a.rank,
          nameRaw: a.name ?? "",
          descRaw: a.desc ?? "",
          name: a.name || F("PROJECTANIME.Covenant.abilityUnnamed", { rank: a.rank }),
          desc: on ? (a.desc || "") : F("PROJECTANIME.Covenant.abilityLocked", { rank: a.rank }),
          // Auto-summary of the rank's mechanical Effect (Grants / buffs / Skill adjustments), shown read-only
          // once the rank is unlocked — players see what the bond actually does (the GM authors it).
          rulesHTML: on ? traitCardDescHTML(a.rules, "") : "",
          on,
          reqLabel: on ? L("PROJECTANIME.Covenant.unlocked") : F("PROJECTANIME.Covenant.rankN", { rank: a.rank })
        };
      });
      out.push({
        id: b.id,
        name: b.name,
        title: b.title,
        accent,
        img: b.img,
        initial: initialOf(b.name),
        bannerStyle: b.banner ? `background-image:url('${b.banner}')` : `background:${bondHeroGrad(accent)}`,
        faction: f ? { id: f.id, name: f.name, sigil: f.sigil, accent: f.accent } : null,
        factionName: f?.name ?? L("PROJECTANIME.Covenant.unaffiliated"),
        factionSig: f?.sigil ?? "◆",
        actorUuid: b.actorUuid,
        locked: !!b.locked,
        maxed,
        rankNum: b.rank,
        rankDisplay: maxed ? "★" : b.rank,
        rankWord: maxed ? L("PROJECTANIME.Covenant.bondMax") : L("PROJECTANIME.Covenant.bondRank"),
        stars,
        progPct: maxed ? 100 : clampStanding(b.prog),
        progLabel: maxed ? "★ ★ ★ ★ ★" : `${clampStanding(b.prog)}%`,
        towardLabel: maxed ? L("PROJECTANIME.Covenant.bondComplete") : F("PROJECTANIME.Covenant.towardRank", { rank: b.rank + 1 }),
        vitals: (b.vitals ?? []).map((v) => ({ id: v.id, k: v.k, v: v.v })),
        dossier: await TE.enrichHTML(b.dossier ?? "", { relativeTo: this.actor, secrets: this.actor.isOwner }),
        dossierRaw: b.dossier ?? "",
        quote: b.quote,
        abilities,
        factionOptions: factions.map((x) => ({ id: x.id, name: x.name, sel: x.id === b.faction })),
        isOpen: this.#openBond === b.id
      });
    }
    // Display the cards (and their books) alphabetically by name — case-insensitive, natural number
    // order. Display-only: the stored bonds array keeps its order so forge/reward matching is unaffected.
    out.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));
    return out;
  }

  /** Mutate one bond on this actor and persist the whole list (mirrors the Covenant pattern). Pass
   *  `{ render: false }` for an inline field edit so the Bonds drawer keeps its scroll position. */
  async #mutateBond(id, fn, { render = true } = {}) {
    if (!this.isEditable) return;
    const bonds = getBonds(this.actor);
    const b = bonds.find((x) => x.id === id);
    if (!b) return;
    fn(b);
    await saveBonds(this.actor, bonds, { render });
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
    });
  }

  /** Commit an inline bond edit (a field, a vital, or an ability). The inputs carry data-* (never
   *  `name`), so the actor form's submitOnChange never collects them — we persist here instead. */
  async #onBondFieldChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.bond;
    // No re-render on an inline edit (keeps the Bonds drawer's scroll position).
    const quiet = { render: false };
    if (!id) return;
    const val = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.bvital !== undefined) {
      return this.#mutateBond(id, (b) => {
        const v = (b.vitals ?? []).find((x) => x.id === el.dataset.bvital);
        if (v) v[el.dataset.bvitalField] = val;
      }, quiet);
    }
    if (el.dataset.babil !== undefined) {
      return this.#mutateBond(id, (b) => {
        const a = (b.abilities ?? []).find((x) => x.rank === Number(el.dataset.babil));
        if (a) a[el.dataset.babilField] = val;
      }, quiet);
    }
    const field = el.dataset.bondField;
    if (field) return this.#mutateBond(id, (b) => { b[field] = val; }, quiet);
  }

  /** Bind the Bonds drawer's inline-edit listeners + actor-link drop zones (owner only). */
  #bindBondsDrawer() {
    const drawer = this.element?.querySelector?.('.section-drawer[data-section="bonds"]');
    if (!drawer) return;
    for (const el of drawer.querySelectorAll("[data-bond-field], [data-bvital], [data-babil]")) {
      el.addEventListener("change", this.#onBondFieldChange.bind(this));
    }
    for (const zone of drawer.querySelectorAll("[data-bdrop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.remove("drag-over");
        this.#onBondActorDrop(ev, zone.dataset.bdrop);
      });
    }
    // Right-click a bond card → context menu (open / open NPC sheet / delete).
    for (const card of drawer.querySelectorAll(".bond-tcard[data-bond-id]")) {
      card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openBondContext(card, ev); });
    }
  }

  /** Bond-card right-click menu: open the detail book, open a linked NPC's sheet, and delete the bond.
   *  Row actions reuse the existing handlers (delete confirms via #onDeleteBond). */
  #openBondContext(card, ev) {
    const id = card?.dataset.bondId;
    const bond = getBonds(this.actor).find((b) => b.id === id);
    if (!bond) return;
    const { add, show } = this.#contextMenu(ev);
    add("fa-book-open", "PROJECTANIME.Covenant.openBond", () => { this.#openBond = id; this.#applyBondBooks(); });
    if (bond.actorUuid) add("fa-up-right-from-square", "PROJECTANIME.Covenant.openSheet", () => ProjectAnimeActorSheet.#onOpenBondActor.call(this, ev, card));
    if (this.isEditable) add("fa-trash", "PROJECTANIME.Covenant.delete", () => ProjectAnimeActorSheet.#onDeleteBond.call(this, ev, card), "danger");
    show();
  }

  /** Drop an Actor onto a bond zone: "new-bond" forges a fresh bond from it; "bond-actor:<id>"
   *  links it to an existing bond (filling portrait + name). */
  async #onBondActorDrop(event, spec) {
    if (!this.isEditable || !spec) return;
    const data = this.#readDrag(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid).catch(() => null);
    if (!actor) return;
    // A social NPC that OFFERS a Bond → forge/sync from its definition + deliver rewards (re-drag
    // safe). On a card's "link actor" zone it targets that card; on the forge zone it forges fresh.
    if (npcBond(actor)) {
      const bondId = spec.startsWith("bond-actor:") ? spec.slice("bond-actor:".length) : null;
      await forgeBondFromNpc(this.actor, actor, { bondId });
      return;
    }
    if (spec === "new-bond") {
      const bonds = getBonds(this.actor);
      const bond = blankBond({ name: actor.name, img: actor.img || "", actorUuid: actor.uuid });
      bonds.unshift(bond);
      this.#openBond = bond.id;
      await saveBonds(this.actor, bonds);
      return;
    }
    if (spec.startsWith("bond-actor:")) {
      const id = spec.slice("bond-actor:".length);
      await this.#mutateBond(id, (b) => {
        b.actorUuid = actor.uuid;
        b.img = actor.img || b.img;
        if (!b.name || b.name === game.i18n.localize("PROJECTANIME.Covenant.newBondName")) b.name = actor.name;
      });
    }
  }

  /** Open a bond's codex detail book — instant, no re-render (the template also reflects #openBond
   *  via `isOpen`, so the open book survives the re-render an edit triggers). */
  static #onOpenBond(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    if (!id) return;
    this.#openBond = id;
    this.#applyBondBooks();
  }

  /** Close the open bond book (backdrop / close button). */
  static #onCloseBond() {
    this.#openBond = null;
    this.#applyBondBooks();
  }

  /** Reflect #openBond on the live DOM so a book opens/closes without a full re-render. */
  #applyBondBooks() {
    for (const el of this.element?.querySelectorAll?.(".bond-overlay") ?? []) {
      el.classList.toggle("open", el.dataset.bondBook === this.#openBond);
    }
  }

  static async #onNewBond() {
    if (!this.isEditable) return;
    const bonds = getBonds(this.actor);
    const bond = blankBond();
    bonds.unshift(bond);
    this.#openBond = bond.id; // open the new bond's book to its editable form
    await saveBonds(this.actor, bonds);
  }

  static async #onDeleteBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bonds.find((x) => x.id === id);
    if (!b) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Covenant.deleteBondTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Covenant.deleteConfirm", { name: b.name })}</p>`
    }).catch(() => false);
    if (!ok) return;
    if (this.#openBond === id) this.#openBond = null;
    await saveBonds(this.actor, bonds.filter((x) => x.id !== id));
  }

  static async #onDeepenBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bonds.find((x) => x.id === id);
    if (!b || b.rank >= BOND_MAX_RANK) return;
    b.rank += 1;
    b.prog = b.rank >= BOND_MAX_RANK ? 100 : 20;
    b.locked = false;
    this.#bondGala = { rank: b.rank, id }; // consumed once in _onRender after the re-render
    await saveBonds(this.actor, bonds);
  }

  static async #onLessenBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    await this.#mutateBond(id, (b) => {
      if (b.rank <= 0) return;
      b.rank -= 1;
      b.prog = b.rank >= BOND_MAX_RANK ? 100 : 20;
    });
  }

  static async #onAddBondVital(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    await this.#mutateBond(id, (b) => { (b.vitals ??= []).push({ id: foundry.utils.randomID(), k: "", v: "" }); });
  }

  static async #onRemoveBondVital(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const vid = target.dataset.bvital;
    await this.#mutateBond(id, (b) => { b.vitals = (b.vitals ?? []).filter((x) => x.id !== vid); });
  }

  /* ---- NPC Talents & Trait (HQ work profile) ---- */

  /** Roll a Talent die (an NPC's work die) to chat. */
  static async #onRollTalent(event, target) {
    const k = target.dataset.talent;
    const tt = this.actor.system.talents?.[k] ?? {};
    const faces = tt.value ?? tt.base ?? 4; // roll the current die (includes any `talent` effect)
    const roll = await new Roll(`1d${faces}`).evaluate();
    const label = game.i18n.localize(CONFIG.PROJECTANIME.talents?.[k] ?? k);
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: `${label} — ${game.i18n.localize("PROJECTANIME.Talent.title")}` });
  }

  /** Author the Signature Trait in the shared Effect Builder (data mode, with a flavor line) — saving
   *  back to `system.trait`, which reconcileTraits then projects as an always-on AE. */
  static async #onEditSignature() {
    if (!this.isEditable) return;
    const actor = this.actor;
    const tr = actor.system.trait ?? {};
    const id = `trait-sig-${actor.id}`;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${id}`);
    if (existing) return existing.bringToFront();
    EffectBuilder.forData({
      id,
      title: game.i18n.localize("PROJECTANIME.Talent.signature"),
      name: tr.name || "",
      img: tr.img || DEFAULT_TRAIT_IMG,
      rules: tr.rules ?? [],
      desc: tr.desc || "",
      withDesc: true,
      onSave: ({ name, img, rules, desc }) => actor.update({ "system.trait": { name, img, rules, desc: desc ?? "" } })
    }).render(true);
  }

  /** Clear the Signature Trait (reconcileTraits then purges its projected AE). */
  static async #onClearSignature() {
    if (!this.isEditable) return;
    await this.actor.update({ "system.trait": { name: "", desc: "", img: "", rules: [] } });
  }

  /** Add a new Trait, then open the Effect Builder to author it. */
  static async #onAddTrait() {
    if (!this.isEditable) return;
    const actor = this.actor;
    const id = foundry.utils.randomID();
    const traits = foundry.utils.deepClone(actor.system.traits ?? []);
    traits.push({ id, name: "", img: DEFAULT_TRAIT_IMG, rules: [] });
    await actor.update({ "system.traits": traits });
    ProjectAnimeActorSheet.#openTraitBuilder(actor, id);
  }

  /** Edit a Trait by id in the Effect Builder. */
  static async #onEditTrait(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-trait-id]")?.dataset.traitId;
    if (id) ProjectAnimeActorSheet.#openTraitBuilder(this.actor, id);
  }

  /** Remove a Trait by id. */
  static async #onRemoveTrait(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-trait-id]")?.dataset.traitId;
    const traits = foundry.utils.deepClone(this.actor.system.traits ?? []).filter((t) => t.id !== id);
    await this.actor.update({ "system.traits": traits });
  }

  /** Open the Effect Builder (data mode) bound to one Trait, saving back to its array entry by id. */
  static #openTraitBuilder(actor, id) {
    const t = (actor.system.traits ?? []).find((x) => x.id === id);
    if (!t) return;
    const winId = `trait-${actor.id}-${id}`;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${winId}`);
    if (existing) return existing.bringToFront();
    EffectBuilder.forData({
      id: winId,
      title: game.i18n.localize("PROJECTANIME.Talent.traitTitle"),
      name: t.name || "",
      img: t.img || DEFAULT_TRAIT_IMG,
      rules: t.rules ?? [],
      onSave: ({ name, img, rules }) => {
        const traits = foundry.utils.deepClone(actor.system.traits ?? []);
        const i = traits.findIndex((x) => x.id === id);
        if (i < 0) return;
        traits[i] = { ...traits[i], name, img, rules };
        return actor.update({ "system.traits": traits });
      }
    }).render(true);
  }

  static async #onPickBondPortrait(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getBonds(this.actor).find((x) => x.id === id)?.img ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateBond(id, (b) => { b.img = path; }) }).browse();
  }

  static async #onPickBondBanner(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getBonds(this.actor).find((x) => x.id === id)?.banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateBond(id, (b) => { b.banner = path; }) }).browse();
  }

  static async #onOpenBondActor(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const b = getBonds(this.actor).find((x) => x.id === id);
    if (!b?.actorUuid) return;
    const actor = await fromUuid(b.actorUuid).catch(() => null);
    actor?.sheet?.render(true);
  }

  static async #onClearBondActor(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    await this.#mutateBond(id, (b) => { b.actorUuid = ""; });
  }

  /** A full-screen "Bond Deepened — RANK N" flourish on a detached overlay (survives re-renders).
   *  Ported from the old Covenant gala. */
  static #playBondGala(rank) {
    document.querySelector(".pa-bond-gala")?.remove();
    const el = document.createElement("div");
    el.className = "project-anime theme-dark pa-bond-gala";
    let rays = "";
    for (let i = 0; i < 12; i++) rays += `<span class="burst" style="--r:${i * 30}deg"></span>`;
    el.innerHTML = `${rays}<span class="ringp"></span>
      <div class="gmsg">
        <div class="k">${game.i18n.localize("PROJECTANIME.Covenant.bondDeepened")}</div>
        <div class="t">${game.i18n.format("PROJECTANIME.Covenant.rankWord", { rank })}</div>
      </div>`;
    document.body.appendChild(el);
    void el.offsetWidth; // force reflow so the animation always restarts
    el.classList.add("show");
    setTimeout(() => el.remove(), 1800);
  }

  /* -------------------------------------------- */
  /*  Bond OFFER drawer (social NPC → players)    */
  /* -------------------------------------------- */

  /** View-model for the NPC's Bond-offer editor: identity + five rank rows (ability boon + rewards).
   *  Reward items render as chips read straight from the stored snapshots (no async resolve). */
  #npcBondContext() {
    const def = this.actor.system.bond ?? {};
    const accent = def.accent || "#8a6fc0";
    return {
      title: def.title ?? "",
      accent,
      banner: def.banner ?? "",
      bannerStyle: def.banner ? `background-image:url('${def.banner}')` : `background:${bondHeroGrad(accent)}`,
      npcName: this.actor.name,
      npcImg: this.actor.img,
      ranks: npcBondRanks(this.actor).map((r) => ({
        rank: r.rank,
        rankLabel: game.i18n.format("PROJECTANIME.Covenant.rankN", { rank: r.rank }),
        abilityName: r.abilityName,
        abilityDesc: r.abilityDesc,
        rewardGold: r.rewardGold,
        rewardSP: r.rewardSP,
        rewardItems: r.rewardItems.map((o, idx) => ({ idx, name: o?.name ?? "—", img: o?.img ?? "icons/svg/item-bag.svg" })),
        rewardCount: (r.rewardItems ?? []).length,
        // The rank's mechanical Effect, auto-summarized (Grants / buffs / Skill adjustments) — same colored
        // rules line as the Signature Trait cards; "" when the rank has no Effect authored yet.
        rulesHTML: traitCardDescHTML(r.rules, ""),
        hasRules: (r.rules ?? []).length > 0,
        // Which rank's detail book is open survives the re-render an edit triggers (mirrors bonds' isOpen).
        isOpen: this.#openNpcRank === r.rank
      }))
    };
  }

  /** Read this NPC's bond offer as a fully-normalized mutable object (scalars + vitals + the five
   *  rank rows), apply `fn`, and persist the whole `system.bond`. Pass `{ render: false }` for an
   *  inline field edit so the drawer doesn't re-render and lose its scroll position. */
  async #mutateNpcBond(fn, { render = true } = {}) {
    if (!this.isEditable) return;
    const sys = this.actor.system.bond ?? {};
    const bond = {
      title: sys.title ?? "", accent: sys.accent ?? "", banner: sys.banner ?? "",
      faction: sys.faction ?? "", dossier: sys.dossier ?? "", quote: sys.quote ?? "",
      vitals: (sys.vitals ?? []).map((v) => ({ id: v.id, k: v.k, v: v.v })),
      ranks: npcBondRanks(this.actor)
    };
    fn(bond);
    await this.actor.update({ "system.bond": bond }, { render });
  }

  /** Commit an inline edit to the NPC's bond offer (a scalar field or a rank's ability text /
   *  reward number). data-* attributes only → never collected by the actor form. */
  async #onNpcBondFieldChange(event) {
    const el = event.currentTarget;
    const val = el.value;
    // No re-render: the edited input already shows its value, and nothing derived needs rebuilding —
    // so the Bond drawer keeps its scroll position instead of snapping to the top on every field.
    const quiet = { render: false };
    if (el.dataset.npcbondRankField !== undefined) {
      const rank = Number(el.dataset.npcbondRank);
      const field = el.dataset.npcbondRankField;
      const num = field === "rewardGold" || field === "rewardSP";
      return this.#mutateNpcBond((b) => {
        const r = b.ranks.find((x) => x.rank === rank);
        if (r) r[field] = num ? Math.max(0, Math.round(Number(val) || 0)) : val;
      }, quiet);
    }
    const field = el.dataset.npcbondField;
    if (field) return this.#mutateNpcBond((b) => { b[field] = val; }, quiet);
  }

  /** Bind the Bond-offer editor's inline listeners + reward-item drop zones (owner only). */
  #bindNpcBond() {
    const drawer = this.element?.querySelector?.('.section-drawer[data-section="npcbond"]');
    if (!drawer) return;
    for (const el of drawer.querySelectorAll("[data-npcbond-field], [data-npcbond-rank-field]"))
      el.addEventListener("change", this.#onNpcBondFieldChange.bind(this));
    for (const zone of drawer.querySelectorAll("[data-reward-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.remove("drag-over");
        this.#onRewardItemDrop(ev, zone.dataset.rewardDrop);
      });
    }
  }

  /** Drop an Item onto a rank's reward slot → store a self-contained snapshot as that rank's reward. */
  async #onRewardItemDrop(event, rank) {
    if (!this.isEditable) return;
    const data = this.#readDrag(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    await this.#mutateNpcBond((b) => {
      const r = b.ranks.find((x) => x.rank === Number(rank));
      if (r) (r.rewardItems ??= []).push(snap);
    });
  }

  /** Flip an NPC between the Monster statblock and the social-NPC (Bond offer) layout. */
  static async #onToggleRole() {
    if (!this.isEditable || this.actor.type !== "npc") return;
    const next = this.actor.system.role === "npc" ? "monster" : "npc";
    const updates = { "system.role": next };
    // A social NPC defaults to a non-hostile disposition — nudge it Neutral when it was still the
    // Monster's Hostile default (so its token isn't auto-treated as an enemy). Leave any deliberate
    // disposition the GM already set untouched.
    if (next === "npc" && this.actor.system.disposition === "hostile") updates["system.disposition"] = "neutral";
    this.#roleFlip = true;   // play the crest flip on the re-render this triggers
    await this.actor.update(updates);
  }

  /** Expand / collapse a social NPC's "Combat stats" block (instant DOM toggle, persisted for re-render). */
  static #onToggleStatblock() {
    this.#statblockOpen = !this.#statblockOpen;
    this.element?.querySelector?.(".statblock.foldable")?.classList.toggle("open", this.#statblockOpen);
  }

  static async #onRemoveRewardItem(event, target) {
    const rank = Number(target.dataset.npcbondRank);
    const idx = Number(target.dataset.rewardItem);
    await this.#mutateNpcBond((b) => {
      const r = b.ranks.find((x) => x.rank === rank);
      if (r && Array.isArray(r.rewardItems)) r.rewardItems.splice(idx, 1);
    });
  }

  /** Author a bond RANK's mechanical Effect in the shared Effect Builder (data mode) — Grant
   *  Items/Skills + buffs + Skill adjustments. Saves the rules (and the rank's ability name) back to
   *  `system.bond`; the player's bond copies them on forge and reconcileBonds projects/delivers
   *  them as the bond deepens (helpers/bond-effect.mjs). */
  static async #onEditBondRankEffect(event, target) {
    if (!this.isEditable) return;
    const rank = Number(target.dataset.rank ?? target.closest("[data-rank]")?.dataset.rank);
    if (!(rank >= 1)) return;
    const actor = this.actor;
    const row = npcBondRanks(actor).find((r) => r.rank === rank) ?? {};
    const id = `bondrank-${actor.id}-${rank}`;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${id}`);
    if (existing) return existing.bringToFront();
    EffectBuilder.forData({
      id,
      title: game.i18n.format("PROJECTANIME.NpcBond.effectTitle", { rank }),
      name: row.abilityName || "",
      img: actor.img || DEFAULT_TRAIT_IMG,
      rules: row.rules ?? [],
      toggle: !!row.toggle,
      allowToggle: true,   // a bond boon can be player-toggleable (e.g. "+1 Charm vs nobles")
      onSave: ({ name, rules, toggle }) => this.#mutateNpcBond((b) => {
        const r = b.ranks.find((x) => x.rank === rank);
        if (r) { r.abilityName = name; r.rules = rules; r.toggle = !!toggle; }
      })
    }).render(true);
  }

  static async #onPickNpcBondBanner() {
    if (!this.isEditable) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = this.actor.system.bond?.banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateNpcBond((b) => { b.banner = path; }) }).browse();
  }

  /** Open a bond RANK's detail book — instant, no re-render (the template also reflects #openNpcRank
   *  via `isOpen`, so the open book survives the re-render an edit triggers). */
  static #onOpenNpcBondRank(event, target) {
    const rank = Number(target.closest("[data-rank]")?.dataset.rank);
    if (!(rank >= 1)) return;
    this.#openNpcRank = rank;
    this.#applyNpcRankBooks();
  }

  /** Close the open bond-rank book (backdrop / close button). */
  static #onCloseNpcBondRank() {
    this.#openNpcRank = null;
    this.#applyNpcRankBooks();
  }

  /** Reflect #openNpcRank on the live DOM so a rank book opens/closes without a full re-render. */
  #applyNpcRankBooks() {
    for (const el of this.element?.querySelectorAll?.(".nbr-overlay") ?? []) {
      el.classList.toggle("open", Number(el.dataset.rankBook) === this.#openNpcRank);
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
