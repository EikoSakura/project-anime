import { rollCheck, useConsumable, contextRemoveEffect } from "../helpers/dice.mjs";
import { enhanceSelects } from "../helpers/select.mjs";
import { PROJECTANIME, rangeLabel, physicalRangeLabel, skillEffectKeys, enemyStrongAttrs, rankRow, tierFromRank } from "../helpers/config.mjs";
import { getElements, isImageIcon } from "../helpers/elements.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { summarizeRules, narrateRule, normalizeRule, applyEffectCopy } from "../helpers/effects.mjs";
import { EffectBuilder } from "../apps/effect-builder.mjs";
import { AdvancementApp } from "../apps/advancement.mjs";
import { RestApp } from "../apps/rest.mjs";
import { materialTypeLabel } from "../helpers/crafting.mjs";
import { tierNumeral, partyTier } from "../helpers/chronicle.mjs";
import { skillRulesHTML } from "../helpers/skill-description.mjs";
import { SkillBuilderApp } from "../apps/skill-builder.mjs";
import { CharacterCreatorApp } from "../apps/character-creator.mjs";
import { MonsterCreatorApp } from "../apps/monster-creator.mjs";
import { SkillLogApp } from "../apps/skill-log.mjs";
import { skillPointLedger } from "../helpers/skill-points.mjs";
import {
  blankBond, getBonds, saveBonds, BOND_MAX_RANK, bondById, rankLetter, bondEligible, canRankUp,
  bondProgress, capacityInfo, forgeBond, earnBondScene, earnStandingTogether, adjustBondPoints,
  rankUpBond, breakBond
} from "../helpers/bonds.mjs";
import { getFactions } from "../helpers/factions.mjs";
import { confirmAndDismiss } from "../helpers/servants.mjs";
import {
  GEAR_GROUPS, EQUIPPABLE, SLOT_ACCEPTS, bySort,
  buildGearContext, slotOccupant, equipToSlot, equipToAvailableHand, clearSlot, importDroppedItem, readDrag, draggedItem
} from "../helpers/gear.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

// Gear constants + the paperdoll/bag/equip/transfer logic live in helpers/gear.mjs, shared with the
// Monster Creator's Gear step. This sheet keeps its own action handlers, popovers, and DnD bindings.

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
const DRAWER_SECTIONS = ["skills", "gear", "biography", "defenses", "effects", "bonds"];

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
      cycleAffinity: ProjectAnimeActorSheet.#onCycleAffinity,
      openDrawer: ProjectAnimeActorSheet.#onOpenDrawer,
      closeDrawer: ProjectAnimeActorSheet.#onCloseDrawer,
      rollTalent: ProjectAnimeActorSheet.#onRollTalent,
      editSignature: ProjectAnimeActorSheet.#onEditSignature,
      clearSignature: ProjectAnimeActorSheet.#onClearSignature,
      addTrait: ProjectAnimeActorSheet.#onAddTrait,
      editTrait: ProjectAnimeActorSheet.#onEditTrait,
      removeTrait: ProjectAnimeActorSheet.#onRemoveTrait,
      openAdvancement: ProjectAnimeActorSheet.#onOpenAdvancement,
      openRest: ProjectAnimeActorSheet.#onOpenRest,
      buildSkill: ProjectAnimeActorSheet.#onBuildSkill,
      openCreator: ProjectAnimeActorSheet.#onOpenCreator,
      openSkillLog: ProjectAnimeActorSheet.#onOpenSkillLog,
      openBond: ProjectAnimeActorSheet.#onOpenBond,
      closeBond: ProjectAnimeActorSheet.#onCloseBond,
      newBond: ProjectAnimeActorSheet.#onNewBond,
      breakBond: ProjectAnimeActorSheet.#onBreakBond,
      rankUpBond: ProjectAnimeActorSheet.#onRankUpBond,
      earnBondScene: ProjectAnimeActorSheet.#onEarnBondScene,
      earnStanding: ProjectAnimeActorSheet.#onEarnStanding,
      adjustBond: ProjectAnimeActorSheet.#onAdjustBond,
      bondFilter: ProjectAnimeActorSheet.#onBondFilter,
      pickBondPortrait: ProjectAnimeActorSheet.#onPickBondPortrait,
      openBondActor: ProjectAnimeActorSheet.#onOpenBondActor,
      buildUnion: ProjectAnimeActorSheet.#onBuildUnion,
      openUnion: ProjectAnimeActorSheet.#onOpenUnion,
      unlinkUnion: ProjectAnimeActorSheet.#onUnlinkUnion,
      clearFacility: ProjectAnimeActorSheet.#onClearFacility,
      toggleRole: ProjectAnimeActorSheet.#onToggleRole,
      toggleStatblock: ProjectAnimeActorSheet.#onToggleStatblock,
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
    bonds: { template: "systems/project-anime/templates/actor/bonds.hbs", scrollable: [".bonds-grid"] }
  };

  /** Which section drawer is open ("skills"/"gear"/"biography"/"defenses"), or null.
   *  Transient UI state; re-applied on render so it survives re-renders. */
  #openSection = null;

  /** The bond whose detail book is currently open (id), or null. Transient UI state, re-applied on
   *  render so the open book survives the re-render an edit triggers. */
  #openBond = null;

  /** Bonds-grid segment filter: "all" | "party" | "follower". Client-side show/hide (no re-render),
   *  re-applied on render. */
  #bondFilter = "all";

  /** Queued "bond deepened" flourish: { rank, id }, set by a rank-up and consumed once in _onRender
   *  after the data-driven re-render (so the gala fires exactly once). */
  #bondGala = null;

  /** One-shot flag → plays the role crest's flip animation once after a Monster⇄NPC toggle. */
  #roleFlip = false;

  /** Whether a social NPC's collapsible "Combat stats" block is expanded (npc-role only). Default
   *  collapsed — an NPC leads with its dossier, with the statblock tucked away. Re-applied on render. */
  #statblockOpen = false;

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
    // Bonds are a Player Character's own relationship cards — not shown for NPCs.
    if (this.document.type === "character") options.parts.push("bonds");
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
    // Enemy Role · Tier badge (v0.03) — only on a Monster-role NPC (a social NPC isn't a combat enemy).
    // Reads "⟨Role⟩ · Tier ⟨I–IV⟩", with a Rival / Boss chip when flagged. Threat is the encounter cost.
    const eRole = context.isMonster ? this.actor.system.enemyRole : "";
    const eTier = context.isMonster ? (Number(this.actor.system.enemyTier) || 0) : 0;
    const roleCfg = eRole ? CONFIG.PROJECTANIME.enemyRoles?.[eRole] : null;
    context.tierBadge = roleCfg
      ? { label: game.i18n.localize(roleCfg.label), icon: roleCfg.icon, color: roleCfg.color,
          tierNumeral: CONFIG.PROJECTANIME.enemyTierNumerals?.[eTier] ?? "",
          rival: !!this.actor.system.rival,
          boss: !!this.actor.system.boss?.enabled,
          threat: this.actor.system.rival ? 3 : (roleCfg.threat ?? 1) }
      : null;
    // Boss Bars readout (v0.03): the pip strip under the header + the current-Bar note.
    context.bossBars = (context.isMonster && this.actor.system.boss?.enabled)
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
    // Faction affiliation for a social NPC — authored on the Biography "Profile". Stored at
    // system.faction; the bio select uses name= so the actor form saves it directly.
    if (context.isNpcRole) {
      const facId = this.actor.system.faction ?? "";
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
    // For a Monster, tag each Attribute Strong / Weak (its die derives from the Role × Tier) so the
    // statblock shows the two-die model at a glance.
    const monsterStrong = context.isMonster && this.actor.system.enemyRole
      ? enemyStrongAttrs(this.actor.system.enemyRole, this.actor.system.strongAttrs)
      : null;
    context.attributeList = cfg.attributeKeys.map((k) => {
      const a = this.actor.system.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        short: cfg.attributeAbbr?.[k] ? game.i18n.localize(cfg.attributeAbbr[k]) : game.i18n.localize(cfg.attributes[k]),
        die: a.die ?? `d${a.value}`,
        base: a.base,
        icon: cfg.attributeIcons?.[k] ?? "",
        strong: monsterStrong ? monsterStrong.includes(k) : false
      };
    });

    // Party Tier → the Roman-numeral gem crest on the status-window portrait (characters). Gold is
    // shown/edited on the Gear tab, not here.
    if (context.isCharacter) {
      const t = partyTier();
      context.tierRoman = t ? tierNumeral(t) : "";
    }

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

    // BONDS drawer (Characters only) — the player's own paired relationships (v0.03).
    if (context.isCharacter) context.bonds = await this.#bondContext();

    await this.#prepareItems(context);
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
      this.#bindSkillReorder();
      this.#bindBondsDrawer();
      this.#bindEnergyMax();
    }
    this.#applyBondFilter();
    // A queued rank-up flourish fires once, after the data re-render that raised the rank.
    if (this.#bondGala != null) {
      const { rank } = this.#bondGala;
      this.#bondGala = null;
      ProjectAnimeActorSheet.#playBondGala(rank);
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
    if (data?.type === "Actor" && data.uuid && this.actor.type === "character") {
      // Drag a Character or NPC onto a Player Character → open a Bond with it (Party for a PC,
      // Follower for an NPC). Idempotent (an existing bond just re-opens); a Party Bond mirrors.
      ev.preventDefault();
      const other = await fromUuid(data.uuid).catch(() => null);
      if (!other || other.uuid === this.actor.uuid) return;
      this.#openSection = "bonds";              // reveal the drawer on the re-render the forge triggers
      const res = await forgeBond(this.actor, other);
      if (res?.bond) { this.#openBond = res.bond.id; this.render(); }
      else this.#openSection = null;
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
      // Rules summary for the command-row hover drawer: a manual override wins, else the auto
      // colour-coded line (helpers/skill-description). Rendered with {{{descHTML}}}. Guarded so a
      // single malformed skill can never abort the whole sheet render.
      const ov = i.system?.rulesOverride;
      let descHTML = "";
      try { descHTML = (ov && String(ov).trim()) ? ov : skillRulesHTML(i); } catch (_e) { descHTML = ""; }
      const actionType = i.system?.actionType || "action";
      return {
        id: i.id,
        name: i.name,
        img: i.img,
        stars: `${i.system.spCost ?? 0} SP`,
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

    // Skill-Point summary for the drawer strip; the full refundable ledger lives in the
    // Skill Point Log dialog (opened via the button). `spLogCount` badges the button.
    const { spInfo, spLog } = skillPointLedger(this.actor);
    context.spInfo = spInfo;
    context.spLogCount = spLog?.length ?? 0;
    // Rank F–S (Characters, v0.03 "Rank and Tier") for the SP strip: the letter + the character's
    // own Tier, with lifetime-earned SP (editable — the migration only estimates it) and the next
    // threshold. The stored rank itself rises at a rest.
    if (this.actor.type === "character") {
      const rank = Number(this.actor.system.rank) || 0;
      const next = PROJECTANIME.ranks[rank + 1];
      context.rankInfo = {
        letter: rankRow(rank).key,
        tier: tierNumeral(tierFromRank(rank)),
        earned: this.actor.system.skillPoints?.earned ?? 0,
        next: next ? next.sp : null
      };
    }
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
    // The hover drawer unfolds a rich stat card (accuracy / damage / range rows + enriched
    // description) — the same fields #itemTooltip formats for the floating tooltip.
    const cfgW = CONFIG.PROJECTANIME;
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    const escW = foundry.utils.escapeHTML;
    const aNameW = (k) => game.i18n.localize(cfgW.attributes[k] ?? k);
    const elNameW = (k) => (k ? (getElements().find((e) => e.key === k)?.label ?? k) : "");
    const signedW = (n) => (n ? ` ${n > 0 ? "+" : ""}${n}` : "");
    context.quickWeapons = await Promise.all([...groups.weapon.filter((i) => i.system?.equipped || isNatural(i)), ...groups.shield.filter(isWeaponShield)]
      .sort((a, b) => (!!b.system?.equipped - !!a.system?.equipped) || (isNatural(a) - isNatural(b)) || bySort(a, b))
      .map(async (i) => {
        const sys = i.system ?? {};
        const isSh = i.type === "shield";
        const nat = isNatural(i);
        const dmgMod = Number(sys.damage?.mod) || 0;
        const rangeTiles = Number(sys.range?.tiles) || 0;
        // Accuracy: the two rolled Attributes (accent-coloured) + the weapon's flat mod.
        const acc = sys.accuracy ?? {};
        const accParts = [acc.attrA, acc.attrB].filter(Boolean).map((k) => `<span class="att">${escW(aNameW(k))}</span>`);
        const accHTML = accParts.length ? `${accParts.join(' <span class="op">+</span> ')}${escW(signedW(acc.mod))}` : "";
        const dmgType = elNameW(sys.damage?.type);
        const dmgLabel = (dmgType || dmgMod) ? `${dmgType}${signedW(dmgMod)}`.trim() : "";
        const rangeText = rangeTiles > 0 ? physicalRangeLabel(sys.range) : "";
        let descHTML = "";
        if (sys.description && String(sys.description).trim()) {
          try { descHTML = await TE.enrichHTML(String(sys.description), { relativeTo: i, secrets: false }); } catch (_e) { descHTML = ""; }
        }
        return {
          id: i.id, name: i.name, img: i.img, natural: nat, shield: isSh,
          equipped: !!sys.equipped,
          typeLabel: nat ? game.i18n.localize("PROJECTANIME.NaturalAttack.tag")
            : game.i18n.localize(`TYPES.Item.${i.type}`),
          dmgMod, rangeTiles, accHTML, dmgLabel, rangeText, descHTML,
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

    // Carried Materials (v0.03 Crafting) — a dedicated Gear-tab section (they're not in the bag grid,
    // and bundle 3-per-Bulk rather than 1-per-item). Renameable like gear via the item sheet.
    context.materials = this.actor.items
      .filter((i) => i.type === "material")
      .map((i) => ({
        id: i.id, name: i.name, img: i.img,
        prime: i.system.grade === "prime",
        typeLabel: materialTypeLabel(i.system.category),
        tierRoman: tierNumeral(Number(i.system.tier) || 1),
        qty: Number(i.system.quantity) || 0,
        icon: CONFIG.PROJECTANIME.materialTypeIcons?.[i.system.category] ?? "fa-solid fa-cube"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    context.hasMaterials = context.materials.length > 0;
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
        const costTag = `${s.system?.spCost ?? 0} SP`;
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
      typeLabel = `${i18n("TYPES.Item.skill")} · ${i18n(cfg.actionTypes[sys.actionType] ?? "")}`;
      row(i18n("PROJECTANIME.Skill.field.spCost"), `${sys.spCost ?? 0} SP`);
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
      row(i18n("PROJECTANIME.Field.protection"), sys.protection);
      row(i18n("PROJECTANIME.Field.defSplit"), sys.defSplit);
      row(i18n("PROJECTANIME.Field.resSplit"), sys.resSplit);
      if (sys.evasionMod) row(i18n("PROJECTANIME.Field.evasionMod"), sys.evasionMod);
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
    this.#applyDrawers();
    this.#applyBondBooks();
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

  /** Build the Bonds drawer view-model (v0.03): the Charm-capacity meter, the segment filter, and one
   *  entry per bond — its tarot card plus the codex detail book (rank ladder, BP meter, benefit ladder,
   *  Union Skill). `isOpen` reflects which book is open so it survives the re-render an edit triggers. */
  async #bondContext() {
    const L = (k) => game.i18n.localize(k);
    const F = (k, d) => game.i18n.format(k, d);
    const rt = String(this.actor.flags?.["project-anime"]?.lastRestAt ?? "none");
    const cid = game.combat?.id || "";

    const cards = [];
    for (const b of getBonds(this.actor)) {
      const isParty = b.kind === "party";
      const accent = b.accent || (isParty ? "#9a78e0" : "#d8b257");
      const rank = Number(b.rank) || 0;
      const maxed = rank >= BOND_MAX_RANK;
      const prog = bondProgress(b);
      const eligible = bondEligible(b);
      const defs = isParty ? PROJECTANIME.partyBondBenefits : PROJECTANIME.followerBondBenefits;

      // The four-rung Standing ladder (C/B/A/S): the benefit that unlocks at each rank, or "".
      const ladder = PROJECTANIME.bondRanks.map((letter, i) => {
        const def = defs.find((d) => d.rank === i);
        return {
          letter, done: i <= rank, cur: i === rank,
          benefit: def ? L(`PROJECTANIME.Bond.benefit.${def.key}.short`) : "—"
        };
      });

      // The detailed benefit list for the info page.
      const benefits = defs.map((def) => {
        const on = rank >= def.rank;
        const note = (b.notes ?? {})[def.key] ?? "";
        const row = {
          key: def.key, letter: PROJECTANIME.bondRanks[def.rank], rank: def.rank, on,
          name: L(`PROJECTANIME.Bond.benefit.${def.key}.name`),
          desc: L(`PROJECTANIME.Bond.benefit.${def.key}.desc`),
          note, tracked: !!def.tracked, auto: !!def.rules
        };
        if (def.choice) {
          row.isAid = true;
          row.aidOptions = Object.entries(PROJECTANIME.bondAidChoices).map(([id, lk]) => ({ id, label: L(lk), sel: b.aidChoice === id }));
        }
        return row;
      });

      // Union Skill (party, rank S): resolve the linked skill item for display.
      let union = null;
      if (isParty) {
        let skill = null;
        if (b.unionSkillId) skill = await fromUuid(b.unionSkillId).catch(() => null);
        union = {
          unlocked: rank >= 3,
          linked: !!skill,
          name: skill?.name ?? "",
          img: skill?.img ?? "",
          meta: skill ? skillRulesHTML(skill) : ""
        };
      }

      cards.push({
        id: b.id, kind: b.kind, isParty,
        name: b.name || (isParty ? L("PROJECTANIME.Bond.kind.party") : L("PROJECTANIME.Bond.kind.follower")),
        title: b.title, quote: b.quote, accent, img: b.img, initial: initialOf(b.name),
        bannerStyle: `background:${bondHeroGrad(accent)}`,
        partnerUuid: b.partnerUuid, hasPartner: !!b.partnerUuid,
        kindLabel: L(`PROJECTANIME.Bond.kind.${b.kind}`),
        rank, rankLetter: rankLetter(rank), maxed,
        bp: Number(b.bp) || 0, need: prog.need, progPct: prog.pct, atMax: prog.need == null,
        eligible, eligibleLetter: rankLetter(eligible), ready: canRankUp(b), nextLetter: maxed ? "" : rankLetter(rank + 1),
        ladder, benefits,
        aidChoice: b.aidChoice,
        favoredFacility: b.favoredFacility ?? "", favoredFacilityIcon: b.favoredFacilityIcon || "fa-chess-rook", resides: !!b.resides,
        union,
        sceneAvailable: (b.sceneRestId || "") !== rt,
        standingAvailable: !!cid && (b.standingCombatId || "") !== cid,
        isOpen: this.#openBond === b.id
      });
    }
    // Display alphabetically by name (case-insensitive, natural). Storage order is untouched.
    cards.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));

    return { cards, capacity: capacityInfo(this.actor), filter: this.#bondFilter };
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

  /** Commit an inline bond edit (a scalar field or a per-benefit GM note). The inputs carry data-*
   *  (never `name`), so the actor form's submitOnChange never COLLECTS them — but a themed <select>
   *  still dispatches a bubbling `change` (helpers/select.mjs) that reaches the form and forces a full
   *  re-render (which resets the drawer scroll + jumps to the top). We stop that bubble and persist
   *  here quietly (render:false) instead. */
  async #onBondFieldChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.bond;
    if (!id) return;
    event.stopPropagation();
    const quiet = { render: false };
    const val = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.bondNote !== undefined) {
      return this.#mutateBond(id, (b) => { (b.notes ??= {})[el.dataset.bondNote] = val; }, quiet);
    }
    const field = el.dataset.bondField;   // title / quote / accent / aidChoice / favoredFacility / resides
    if (field) return this.#mutateBond(id, (b) => { b[field] = val; }, quiet);
  }

  /** Bind the Bonds drawer's inline-edit listeners + drop zones (forge a bond, link a Union Skill). */
  #bindBondsDrawer() {
    const drawer = this.element?.querySelector?.('.section-drawer[data-section="bonds"]');
    if (!drawer) return;
    for (const el of drawer.querySelectorAll("[data-bond-field], [data-bond-note]"))
      el.addEventListener("change", this.#onBondFieldChange.bind(this));
    // Forge zone (drag a Character or NPC to open a bond).
    for (const zone of drawer.querySelectorAll("[data-bdrop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onBondForgeDrop(ev); });
    }
    // Union Skill zone (drag one of your own Skills onto a rank-S Party Bond).
    for (const zone of drawer.querySelectorAll("[data-union-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onUnionDrop(ev, zone.dataset.unionDrop); });
    }
    // Favored Facility zone (drag an HQ facility card from the Codex onto a Follower Bond).
    for (const zone of drawer.querySelectorAll("[data-facility-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onFacilityDrop(ev, zone.dataset.facilityDrop); });
    }
    for (const card of drawer.querySelectorAll(".bond-tcard[data-bond-id]"))
      card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openBondContext(card, ev); });
  }

  /** Bond-card right-click menu: open the book, open the partner's sheet, break the bond. */
  #openBondContext(card, ev) {
    const id = card?.dataset.bondId;
    const bond = bondById(id, getBonds(this.actor));
    if (!bond) return;
    const { add, show } = this.#contextMenu(ev);
    add("fa-book-open", "PROJECTANIME.Bond.openBond", () => { this.#openBond = id; this.#applyBondBooks(); });
    if (bond.partnerUuid) add("fa-up-right-from-square", "PROJECTANIME.Bond.openPartner", () => ProjectAnimeActorSheet.#onOpenBondActor.call(this, ev, card));
    if (this.isEditable) add("fa-heart-crack", "PROJECTANIME.Bond.break", () => ProjectAnimeActorSheet.#onBreakBond.call(this, ev, card), "danger");
    show();
  }

  /** Drop a Character or NPC onto the forge zone → open a bond with it (Party for a PC, Follower for
   *  an NPC). Idempotent (an existing bond just re-opens); a Party Bond mirrors onto the partner. */
  async #onBondForgeDrop(event) {
    if (!this.isEditable) return;
    const data = readDrag(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid).catch(() => null);
    if (!actor) return;
    if (actor.uuid === this.actor.uuid) return ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Bond.noSelfBond"));
    const res = await forgeBond(this.actor, actor);
    if (res?.bond) { this.#openBond = res.bond.id; this.render(); }
  }

  /** Drop one of this actor's own Skills onto a rank-S Party Bond's Union panel → designate it the
   *  bond's Union Skill (flag the item, store its uuid on the bond; syncPartyBonds mirrors it). */
  async #onUnionDrop(event, bondId) {
    if (!this.isEditable) return;
    const data = readDrag(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (item?.type !== "skill") return ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Bond.unionNeedsSkill"));
    if (item.parent?.id !== this.actor.id) return ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Bond.unionOwnSkill"));
    const bonds = getBonds(this.actor);
    const b = bondById(bondId, bonds);
    if (!b || b.kind !== "party") return;
    await item.setFlag("project-anime", "union", { bondId: b.id, partnerUuid: b.partnerUuid, partnerName: b.name });
    b.unionSkillId = item.uuid;
    await saveBonds(this.actor, bonds);
  }

  /** Drop an HQ facility card (dragged from the Codex Home) onto a Follower Bond's Favored Facility
   *  slot → store a snapshot of its name + icon. Saves quietly and repaints the slot in place so the
   *  book keeps its scroll position. */
  async #onFacilityDrop(event, bondId) {
    if (!this.isEditable) return;
    const fac = readDrag(event)?.paFacility;
    if (!fac) return;
    const name = (fac.name || "").trim() || game.i18n.localize("PROJECTANIME.HQ.newFacility");
    const icon = fac.icon || "fa-chess-rook";
    await this.#mutateBond(bondId, (b) => { b.favoredFacility = name; b.favoredFacilityIcon = icon; }, { render: false });
    const zone = event.currentTarget;
    zone.classList.add("set");
    zone.replaceChildren();
    const i = document.createElement("i"); i.className = `fas ${icon}`;
    const s = document.createElement("span"); s.className = "fh-name"; s.textContent = name;
    const x = document.createElement("button");
    x.type = "button"; x.className = "fh-x"; x.dataset.action = "clearFacility"; x.dataset.bondId = bondId;
    x.title = game.i18n.localize("PROJECTANIME.Bond.clear"); x.textContent = "✕";
    zone.append(i, s, x);
  }

  /** Clear a Follower Bond's Favored Facility (✕) — quiet save + repaint the empty slot in place. */
  static async #onClearFacility(event, target) {
    if (!this.isEditable) return;
    const zone = target.closest(".fh-drop");
    const id = zone?.dataset.facilityDrop;
    if (!id) return;
    await this.#mutateBond(id, (b) => { b.favoredFacility = ""; b.favoredFacilityIcon = ""; }, { render: false });
    zone.classList.remove("set");
    zone.replaceChildren();
    const s = document.createElement("span"); s.className = "fh-ph"; s.textContent = game.i18n.localize("PROJECTANIME.Bond.favoredDrop");
    zone.append(s);
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

  /** New blank Follower bond (for an NPC you haven't linked yet) — opened to its editable book. */
  static async #onNewBond() {
    if (!this.isEditable) return;
    const bonds = getBonds(this.actor);
    const bond = blankBond({ kind: "follower" });
    bonds.unshift(bond);
    this.#openBond = bond.id;
    await saveBonds(this.actor, bonds);
  }

  /** Break a bond (removes both sides of a Party Bond) after a confirm. */
  static async #onBreakBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bond = bondById(id, getBonds(this.actor));
    if (!bond) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Bond.breakTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Bond.breakConfirm", { name: bond.name })}</p>`
    }).catch(() => false);
    if (!ok) return;
    if (this.#openBond === id) this.#openBond = null;
    await breakBond(this.actor, id);
  }

  /** Play the rank-up Bond Scene: raise the bond one rank if eligible (enforces Charm capacity). */
  static async #onRankUpBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bondById(id, bonds);
    if (!b) return;
    const res = rankUpBond(this.actor, b);
    if (!res.ok) return ui.notifications?.warn(game.i18n.localize(`PROJECTANIME.Bond.rankUpFail.${res.reason}`));
    this.#bondGala = { rank: b.rank, id };   // consumed once in _onRender after the re-render
    await saveBonds(this.actor, bonds);
  }

  /** Earn +1 BP from a Bond Scene (1/rest per pair). */
  static async #onEarnBondScene(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bondById(id, bonds);
    if (!b) return;
    const res = await earnBondScene(this.actor, b);
    if (!res.ok) return ui.notifications?.info(game.i18n.localize("PROJECTANIME.Bond.sceneUsed"));
    await saveBonds(this.actor, bonds);
  }

  /** Earn +1 BP from Standing Together (1/Conflict per pair). */
  static async #onEarnStanding(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bondById(id, bonds);
    if (!b) return;
    const res = await earnStandingTogether(this.actor, b);
    if (!res.ok) return ui.notifications?.info(game.i18n.localize(`PROJECTANIME.Bond.standingFail.${res.reason}`));
    await saveBonds(this.actor, bonds);
  }

  /** Manual BP adjust (GM tool — data-delta ±N, no guard). */
  static async #onAdjustBond(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bondById(id, bonds);
    if (!b) return;
    adjustBondPoints(b, Number(target.dataset.delta) || 0);
    await saveBonds(this.actor, bonds);
  }

  /** Segment filter (All / Party / Followers) — client-side show/hide, no re-render. */
  static #onBondFilter(event, target) {
    this.#bondFilter = target.dataset.filter || "all";
    this.#applyBondFilter();
  }

  /** Reflect #bondFilter on the live grid (segment button state + card visibility). */
  #applyBondFilter() {
    const drawer = this.element?.querySelector?.('.section-drawer[data-section="bonds"]');
    if (!drawer) return;
    for (const btn of drawer.querySelectorAll(".bond-seg [data-filter]"))
      btn.classList.toggle("on", (btn.dataset.filter || "all") === this.#bondFilter);
    for (const card of drawer.querySelectorAll(".bond-tcard[data-kind]"))
      card.classList.toggle("filtered-out", !(this.#bondFilter === "all" || card.dataset.kind === this.#bondFilter));
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
    const cur = bondById(id, getBonds(this.actor))?.img ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateBond(id, (b) => { b.img = path; }) }).browse();
  }

  /** Open the partner's sheet (the other character in the pair). */
  static async #onOpenBondActor(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const b = bondById(id, getBonds(this.actor));
    if (!b?.partnerUuid) return;
    const actor = await fromUuid(b.partnerUuid).catch(() => null);
    actor?.sheet?.render(true);
  }

  /** Open the Skill Builder to build a Union Skill — then drag the result onto the bond's Union panel. */
  static #onBuildUnion() {
    return ProjectAnimeActorSheet.#onBuildSkill.call(this);
  }

  /** Open the linked Union Skill's sheet. */
  static async #onOpenUnion(event, target) {
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const b = bondById(id, getBonds(this.actor));
    if (!b?.unionSkillId) return;
    const skill = await fromUuid(b.unionSkillId).catch(() => null);
    skill?.sheet?.render(true);
  }

  /** Unlink the Union Skill (clears the item's union flag if it's ours; leaves the skill itself). */
  static async #onUnlinkUnion(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-bond-id]")?.dataset.bondId;
    const bonds = getBonds(this.actor);
    const b = bondById(id, bonds);
    if (!b) return;
    if (b.unionSkillId) {
      const skill = await fromUuid(b.unionSkillId).catch(() => null);
      if (skill?.parent?.id === this.actor.id) await skill.unsetFlag("project-anime", "union").catch(() => {});
    }
    b.unionSkillId = "";
    await saveBonds(this.actor, bonds);
  }

  /** A full-screen "Bond Deepened — RANK X" flourish on a detached overlay (survives re-renders). */
  static #playBondGala(rank) {
    document.querySelector(".pa-bond-gala")?.remove();
    const el = document.createElement("div");
    el.className = "project-anime theme-dark pa-bond-gala";
    let rays = "";
    for (let i = 0; i < 12; i++) rays += `<span class="burst" style="--r:${i * 30}deg"></span>`;
    el.innerHTML = `${rays}<span class="ringp"></span>
      <div class="gmsg">
        <div class="k">${game.i18n.localize("PROJECTANIME.Bond.deepened")}</div>
        <div class="t">${game.i18n.format("PROJECTANIME.Bond.rankWord", { rank: rankLetter(rank) })}</div>
      </div>`;
    document.body.appendChild(el);
    void el.offsetWidth; // force reflow so the animation always restarts
    el.classList.add("show");
    setTimeout(() => el.remove(), 1800);
  }

  /* -------------------------------------------- */
  /*  NPC role toggle (Monster ⇄ social NPC)      */
  /* -------------------------------------------- */

  /** Flip an NPC between the Monster statblock and the social-NPC layout (a social NPC is one a PC can
   *  forge a Follower Bond with — see helpers/bonds.mjs). */
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
