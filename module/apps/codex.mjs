/**
 * Project: Anime — THE CODEX: the campaign hub window.
 *
 * One standalone window (opened from the scene-controls book button) that gathers the three
 * campaign-level surfaces into tabbed panes, each its own view:
 *   • Quests   — the Chronicle quest log (browse + GM authoring; was its own window).
 *   • Factions — the world's faction standing codex (was a Party-sheet tab).
 *   • Home     — the HQ: facilities staffed by recruited faction members (was a Party-sheet tab).
 *
 * All three are world-scoped data — the `quests` and `covenantFactions` world settings plus the
 * shared party folder (`resolveParty`) — so the Codex isn't bound to any one actor; it reads the
 * settings and the party the same way the surfaces did when they lived on the Party sheet. The
 * Factions/Home panes are gated by the GM's `partyFactionsTab` setting (the same toggle as before).
 *
 * The window carries the legacy `chronicle-app` CSS class so the entire quest UI styling (scoped
 * under `.chronicle-app`) applies verbatim; faction/HQ styling is scoped under `.pa-factions`/`.pa-hq`
 * and likewise carries over. The on-canvas quest tracker (ChronicleTracker) lives here too.
 */

import {
  getQuests,
  saveQuests,
  blankQuest,
  questProgress,
  QUEST_CATEGORIES,
  grantRewards,
  TRACKED_SETTING,
  TRACKER_VISIBLE_SETTING
} from "../helpers/chronicle.mjs";
import {
  getFactions, saveFactions, blankFaction, tierForStanding, clampStanding, STANDING_TIERS,
  setFactionStanding, setFactionRelation, factionById, recruitAvailable, recruitMember, getHQ, saveHQ, normalizeHQ, advanceHQTurn, blankMission,
  statDieFor, statBonusFor, statLabelFor, hqLevel, hqHasteBonus, effectiveMissionDuration
} from "../helpers/factions.mjs";
import { getBonds, BOND_MAX_RANK } from "../helpers/bonds.mjs";
import { partyMembers, resolveParty } from "../helpers/party-folder.mjs";
import { PARTY_FACTIONS_SETTING } from "./party-config.mjs";
import { ShopWindow } from "./shop.mjs";
import { WorkshopWindow } from "./workshop.mjs";
import { StructuresWindow } from "./structures.mjs";
import { exportFacility, importFacility } from "../helpers/hq-share.mjs";
import { EffectBuilder } from "./effect-builder.mjs";
import { summarizeRule, normalizeRule, scaleRuleByTier, collectGather, collectReveals } from "../helpers/effects.mjs";
import { getMaterialCategories, isImageIcon, materialCategoryLabel } from "../helpers/materials.mjs";
import { cardHTML } from "../helpers/dice.mjs";
import { getArchive, saveArchive, blankEntry, blankCategory, entryActor, entryItem, CATEGORY_ICONS } from "../helpers/archive.mjs";
import { actorStatBlock } from "./token-info.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Fallback banner gradients (used when a quest has no banner image) — by category. */
const BANNER_GRAD = {
  main: "radial-gradient(120% 120% at 78% 12%, #b78a2e55, transparent 55%), linear-gradient(150deg,#4a3563,#2c1d3f 58%,#16101f)",
  side: "radial-gradient(120% 120% at 24% 16%, #6c4f9c66, transparent 55%), linear-gradient(150deg,#36294f,#231838 60%,#150e22)",
  personal: "radial-gradient(120% 120% at 50% 14%, #43b88a55, transparent 55%), linear-gradient(150deg,#1e3a34,#142824 60%,#0e1a17)"
};

/** Banner zoom factor (scroll-wheel on the hero), clamped to 1–4× (1 = cover / no zoom). */
const BANNER_ZOOM_MIN = 1, BANNER_ZOOM_MAX = 4;
const bannerZoomOf = (q) => Math.max(BANNER_ZOOM_MIN, Math.min(BANNER_ZOOM_MAX, Number(q?.bannerZoom) || 1));

/** Escape text before injecting into innerHTML (GM-authored text, but be safe). */
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** First letter of a name (avatar fallback). */
const initialOf = (name) => String(name || "?").trim().charAt(0).toUpperCase() || "?";

/** Fallback hero gradient when a faction has no banner — built from its accent colour. */
const factionHeroGrad = (acc) =>
  `radial-gradient(120% 120% at 78% 8%, color-mix(in srgb, ${acc} 42%, transparent), transparent 55%), ` +
  `linear-gradient(150deg, #2c2340, #1c1730 60%, #120e1c)`;

/** FA icon per relationship stance — shown on the matrix cells and the per-faction relation chips. */
const RELATION_ICONS = { ally: "fa-handshake", rival: "fa-hand-fist" };

/** A short (≤2 char) faction code for the relationship-matrix headers + relation chips. Strips leading
 *  articles, then takes the first letters of the first two significant words (or two letters of one). */
function factionCode(name) {
  const skip = new Set(["the", "a", "an", "of", "de", "la", "le"]);
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const sig = words.filter((w) => !skip.has(w.toLowerCase()));
  const use = sig.length ? sig : words;
  return (use.length === 1 ? use[0].slice(0, 2) : use[0][0] + use[1][0]).toUpperCase();
}

/** Standing-tier → its CSS colour variable (for tinting the boon-ladder rungs by tier). */
const TIER_COLOR = Object.fromEntries(STANDING_TIERS.map((t) => [t.key, t.color]));

/**
 * Lay out the relationship WEB — id → {x, y} in the 0–100 stage space. Wholly DETERMINISTIC (no random,
 * no clock), so the same factions + ties + pins always yield the same web and it never jitters between
 * re-renders. Factions the GM has hand-placed (a saved `webPos`) anchor in place; the rest seed onto a
 * ring and then settle under a tiny annealed force pass: ally ties pull together, rival ties shove apart,
 * every pair repels so nodes don't overlap, and a gentle centre pull keeps the web framed. With no ties
 * at all the ring already is the spread, so the relaxation is skipped.
 */
function computeWebLayout(factions) {
  const n = factions.length;
  const TAU = Math.PI * 2;
  const P = {}, fixed = {};
  factions.forEach((f, i) => {
    if (f.webPos) { P[f.id] = { x: f.webPos.x * 100, y: f.webPos.y * 100 }; fixed[f.id] = true; return; }
    const ang = -Math.PI / 2 + (i * TAU) / Math.max(1, n); // seed: first node at top, then clockwise
    P[f.id] = { x: 50 + 34 * Math.cos(ang), y: 50 + 34 * Math.sin(ang) };
  });
  if (!factions.some((f) => (f.relations ?? []).length)) return P; // no ties → the ring is already spread

  const stanceOf = (a, b) => (a.relations ?? []).find((r) => r.factionId === b.id)?.stance || "";
  const lo = 12, hi = 88;         // keep every node (dot + label) framed inside the short stage
  const L_ALLY = 22;              // ally rest length (allies settle this close)
  const SPRING = 0.06;            // ally spring stiffness
  const REPEL = 800, RIVAL_REPEL = 2400; // baseline pairwise repulsion (rivals shove harder)
  const CENTER = 0.02;            // gentle pull toward centre so the web stays framed
  const ITERS = 200, TEMP0 = 6;   // annealed: per-node step cools from TEMP0 → 0 over the run

  for (let it = 0; it < ITERS; it++) {
    const disp = {};
    for (const f of factions) disp[f.id] = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = factions[i], b = factions[j];
      const dx = P[a.id].x - P[b.id].x, dy = P[a.id].y - P[b.id].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const ux = dx / d, uy = dy / d;
      const stance = stanceOf(a, b);
      const rep = (stance === "rival" ? RIVAL_REPEL : REPEL) / (d * d);
      disp[a.id].x += ux * rep; disp[a.id].y += uy * rep;
      disp[b.id].x -= ux * rep; disp[b.id].y -= uy * rep;
      if (stance === "ally") {
        const s = SPRING * (d - L_ALLY); // attract toward the rest length
        disp[a.id].x -= ux * s; disp[a.id].y -= uy * s;
        disp[b.id].x += ux * s; disp[b.id].y += uy * s;
      }
    }
    const temp = TEMP0 * (1 - it / ITERS);
    for (const f of factions) {
      if (fixed[f.id]) continue; // pinned factions exert forces but never move
      const p = P[f.id];
      const mx = disp[f.id].x + (50 - p.x) * CENTER;
      const my = disp[f.id].y + (50 - p.y) * CENTER;
      const len = Math.hypot(mx, my) || 1e-6;
      const move = Math.min(len, temp); // cap each node's step to the cooling temperature
      p.x = Math.max(lo, Math.min(hi, p.x + (mx / len) * move));
      p.y = Math.max(lo, Math.min(hi, p.y + (my / len) * move));
    }
  }
  return P;
}

/** What a recruited PERSON does — the only two people vocations (a Mercenary joins the party to fight;
 *  a Dispatch agent goes on missions). Facilities are their OWN thing (GM-built), not a person role. */
const PERSON_ROLES = ["party", "dispatch"];

/** Crest icon per role/kind — person roles show on the roster tarot card's bottom diamond. */
const ROLE_ICONS = { party: "fa-khanda", service: "fa-heart-pulse", vendor: "fa-store", passive: "fa-hand-sparkles", dispatch: "fa-compass", upgrade: "fa-hammer", workshop: "fa-screwdriver-wrench" };
const RECRUIT_COND_TYPES = ["auto", "repTier", "hqLevel", "manual"];

/** Person-role <select> options, alphabetical by label, `cur` marked selected (the recruit pool's role
 *  picker; facility KINDS are authored in the Structures window, not here). */
const roleOptionsFor = (cur, roles = PERSON_ROLES) => roles
  .map((k) => ({ key: k, label: game.i18n.localize(`PROJECTANIME.Covenant.role.${k}`), sel: k === cur }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Attributes a passive facility's boon can buff (`.value` is the safe, cascading AE target). */
const BOON_ATTRS = ["might", "agility", "mind", "spirit", "charm"];

/** Talent <select> options for a mission's tested stat — dispatch tests downtime Talents only; `cur` marked. */
function missionStatOptions(cur) {
  const C = CONFIG.PROJECTANIME ?? {};
  return (C.talentKeys ?? []).map((k) => ({ value: `talent.${k}`, label: game.i18n.localize(C.talents?.[k] ?? k), sel: `talent.${k}` === cur }));
}

/** Exact success probability (0–100 int) for the Sum rule: P( Σ over entries of (1d`faces` + `bonus`)
 *  ≥ dc ), via a small DP convolution of the dice distributions. entries: [{faces, bonus}]. An empty
 *  squad clears only a non-positive DC (→ 0% for any real mission). */
function teamSuccessPct(entries, dc) {
  let dist = [1]; // dist[s] = P(running sum of die faces === s)
  let flat = 0;
  for (const e of entries) {
    const faces = Math.max(1, Math.round(Number(e.faces) || 1));
    flat += Math.round(Number(e.bonus) || 0);
    const next = new Array(dist.length + faces).fill(0);
    const p = 1 / faces;
    for (let s = 0; s < dist.length; s++) {
      const ds = dist[s];
      if (!ds) continue;
      for (let f = 1; f <= faces; f++) next[s + f] += ds * p;
    }
    dist = next;
  }
  const need = Math.round(dc) - flat;
  let pass = 0;
  for (let s = 0; s < dist.length; s++) if (s >= need) pass += dist[s];
  return Math.max(0, Math.min(100, Math.round(pass * 100)));
}

/** FA icon for a mission's tested stat — the matching Talent or Attribute icon (the poster emblem). */
function missionStatIcon(stat) {
  const C = CONFIG.PROJECTANIME ?? {};
  const [kind, key] = String(stat || "").split(".");
  if (kind === "talent") return C.talentIcons?.[key] || "fa-solid fa-compass";
  if (kind === "attr") return C.attributeIcons?.[key] || "fa-solid fa-hand-fist";
  return "fa-solid fa-scroll";
}

/** Per-type display data for a quest reward chip. */
function rewardView(r, i) {
  const L = (k) => game.i18n.localize(`PROJECTANIME.Chronicle.reward.${k}`);
  switch (r.type) {
    case "sp":
      return { idx: i, type: "sp", icon: "◆", v: `+${r.value ?? 0}`, l: L("sp"), rg: "#9a78e0" };
    case "gold":
      return { idx: i, type: "gold", icon: "G", v: `${r.value ?? 0}`, l: L("gold"), rg: "#e0c14a" };
    case "rep":
      return { idx: i, type: "rep", icon: '<i class="fa-solid fa-handshake"></i>', v: `+${r.value ?? 0}`, l: (r.factionId ? factionById(r.factionId)?.name : null) || r.faction || L("rep"), rg: "#c75d6a" };
    case "bond":
      return { idx: i, type: "bond", icon: "❦", v: `+${r.value ?? 1}`, l: r.name || game.i18n.localize("PROJECTANIME.Chronicle.giver"), rg: "#d98fb0" };
    case "item":
      return { idx: i, type: "item", img: r.img || "icons/svg/item-bag.svg", v: r.name || L("item"), l: L("item"), rg: "#9ad0ff" };
    case "unlock":
      return { idx: i, type: "unlock", icon: "⚿", v: r.label || L("unlock"), l: L("unlock"), rg: "#6fe0b0" };
    case "recruit":
      return { idx: i, type: "recruit", icon: "⚑", v: r.name || L("recruit"), l: L("recruit"), rg: "#7fd0a0" };
    default:
      return { idx: i, type: r.type, icon: "?", v: "", l: r.type, rg: "#9a78e0" };
  }
}

/* -------------------------------------------------------------------------- */
/*  The Codex app                                                             */
/* -------------------------------------------------------------------------- */

export class Codex extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  /** Open (or focus) the shared Codex window. */
  static open(tab) {
    if (!this._instance || this._instance.rendered === false) this._instance = new Codex();
    if (tab) this._instance.#activeTab = tab;
    this._instance.render(true);
    return this._instance;
  }

  constructor(options = {}) {
    super({ ...options, id: "pa-codex" });
    this._tab = "all";   // quest category filter (all | main | side | personal | completed)
    this._selId = null;  // selected quest id
  }

  static DEFAULT_OPTIONS = {
    id: "pa-codex",
    // `chronicle-app` is kept so the quest-pane CSS (scoped under it) applies verbatim.
    classes: ["project-anime", "theme-dark", "pa-codex", "chronicle-app"],
    position: { width: 1080, height: 720 },
    window: { title: "PROJECTANIME.Codex.title", icon: "fa-solid fa-house", resizable: true },
    actions: {
      // Nav
      selectTab: Codex.#onSelectTab,
      openActor: Codex.#onOpenActor,
      // Quests
      selectQuest: Codex.#onSelectQuest,
      setTab: Codex.#onSetTab,
      newQuest: Codex.#onNewQuest,
      deleteQuest: Codex.#onDeleteQuest,
      exitEdit: Codex.#onExitEdit,
      toggleObjective: Codex.#onToggleObjective,
      addObjective: Codex.#onAddObjective,
      removeObjective: Codex.#onRemoveObjective,
      addReward: Codex.#onAddReward,
      addRecruitReward: Codex.#onAddRecruitReward,
      removeReward: Codex.#onRemoveReward,
      setLevel: Codex.#onSetLevel,
      clearGiver: Codex.#onClearGiver,
      openGiver: Codex.#onOpenGiver,
      pickIcon: Codex.#onPickIcon,
      complete: Codex.#onComplete,
      distribute: Codex.#onDistribute,
      reopen: Codex.#onReopen,
      abandon: Codex.#onAbandon,
      track: Codex.#onTrack,
      // Factions
      newFaction: Codex.#onNewFaction,
      openFactionDrawer: Codex.#onOpenFactionDrawer,
      closeFactionDrawer: Codex.#onCloseFactionDrawer,
      deleteFaction: Codex.#onDeleteFaction,
      factionRepUp: Codex.#onFactionRepUp,
      factionRepDown: Codex.#onFactionRepDown,
      toggleFactionLink: Codex.#onToggleFactionLink,
      pickFactionCrest: Codex.#onPickFactionCrest,
      pickFactionBanner: Codex.#onPickFactionBanner,
      removeFactionRewardItem: Codex.#onRemoveFactionRewardItem,
      // Home / HQ
      pickHqCrest: Codex.#onPickHqCrest,
      selectHqTab: Codex.#onSelectHqTab,
      openHqDrawer: Codex.#onOpenHqDrawer,
      closeHqDrawer: Codex.#onCloseHqDrawer,
      removeRecruit: Codex.#onRemoveRecruitAction,
      openRecruitActor: Codex.#onOpenRecruitActorAction,
      recruitMember: Codex.#onRecruitMember,
      unlockRecruit: Codex.#onUnlockRecruit,
      advanceHQTurn: Codex.#onAdvanceHQTurn,
      exportHQ: Codex.#onExportHQ,
      importHQ: Codex.#onImportHQ,
      hqLevelUp: Codex.#onHqLevelUp,
      hqLevelDown: Codex.#onHqLevelDown,
      visitShop: Codex.#onVisitShop,
      visitWorkshop: Codex.#onVisitWorkshop,
      openStructures: Codex.#onOpenStructures,
      openFacility: Codex.#onOpenFacility,
      newMission: Codex.#onNewMission,
      pickMissionImage: Codex.#onPickMissionImage,
      deleteMission: Codex.#onDeleteMission,
      setMissionTier: Codex.#onSetMissionTier,
      bumpMissionDuration: Codex.#onBumpMissionDuration,
      dispatchAgent: Codex.#onDispatchAgent,
      dispatchFromRoster: Codex.#onDispatchFromRoster,
      recallAgent: Codex.#onRecallAgent,
      removeMissionItem: Codex.#onRemoveMissionItem,
      editBoon: Codex.#onEditBoon,
      // Codex / Archive (the in-world encyclopedia tab)
      selectArchiveTab: Codex.#onSelectArchiveTab,
      openArchiveEntry: Codex.#onOpenArchiveEntry,
      closeArchiveEntry: Codex.#onCloseArchiveEntry,
      newArchiveEntry: Codex.#onNewArchiveEntry,
      deleteArchiveEntry: Codex.#onDeleteArchiveEntry,
      toggleReveal: Codex.#onToggleReveal,
      newArchiveCategory: Codex.#onNewArchiveCategory,
      deleteArchiveCategory: Codex.#onDeleteArchiveCategory,
      moveCategory: Codex.#onMoveCategory,
      pickEntryImage: Codex.#onPickEntryImage,
      pickEntryBanner: Codex.#onPickEntryBanner,
      openEntryActor: Codex.#onOpenEntryActor,
      addEntryVital: Codex.#onAddEntryVital,
      removeEntryVital: Codex.#onRemoveEntryVital
    }
  };

  static PARTS = {
    nav: { template: "systems/project-anime/templates/codex/nav.hbs" },
    quests: { template: "systems/project-anime/templates/codex/quests.hbs", scrollable: [".q-list", ".q-detail"] },
    // Like the HQ pane: `.fx-scroll` is the scrolling body, and the two `.open` selectors preserve the
    // open faction book's scroll across a scoped re-render (a standing/lore edit) so it doesn't jump.
    factions: { template: "systems/project-anime/templates/codex/factions.hbs", scrollable: [".fx-scroll", ".section-drawer.open .book", ".section-drawer.open .bk-info"] },
    // `.hq-scroll` = the main pane; `.section-drawer.open .hq-page` preserves the open detail book's
    // scroll across a scoped re-render, so an edit inside it doesn't jump back to the top. It matches
    // only the open drawer, so there's a single stable element.
    hq: { template: "systems/project-anime/templates/codex/hq.hbs", scrollable: [".hq-scroll", ".section-drawer.open .hq-page"] },
    // The Codex / Archive encyclopedia tab. `.arc-scroll` is the body; the open entry book preserves
    // its scroll across a scoped re-render (mirrors the HQ pane).
    archive: { template: "systems/project-anime/templates/codex/archive.hbs", scrollable: [".arc-scroll", ".section-drawer.open .hq-page"] }
  };

  /** Active pane ("quests" | "factions" | "hq"). Survives re-render. */
  #activeTab = "quests";

  /** The id of the faction whose detail BOOK is open (an overlay drawer), or null. Transient; survives
   *  re-render via the template's `isOpen` flag + #applyFactionDrawers (mirrors #openHqDrawer). */
  #openFactionDrawer = null;

  /** Relationship-web authoring state (GM, transient — survives re-render). `#factionLinkMode` is the
   *  "Link" toggle (click two faction nodes to cycle their tie); `#linkSel` is the first node picked in
   *  that mode; `#suppressNodeClick` holds a node id whose pending click should be ignored because it
   *  was actually the tail of a drag-to-reposition. */
  #factionLinkMode = false;
  #linkSel = null;
  #suppressNodeClick = null;

  /** Relationship-web pan offset (px) — everyone can right-drag the stage to move about the web. Local
   *  and transient (per window), re-applied to the canvas after each factions re-render. */
  #webPan = { x: 0, y: 0 };

  /** The id of the Home-tab entity whose detail/authoring DRAWER is open (a person/facility/mission id),
   *  or null. Transient; re-applied on every render. (The three LIST drawers became inline sub-tabs.) */
  #openHqDrawer = null;

  /** Which Home sub-tab is showing (roster | recruitment | facilities | missions). The four HQ lists are
   *  inline tab panes now (not slide-in drawers); DOM-toggled with no re-render, and templated via
   *  `hqTabIs` so a scoped re-render is born on the right tab (mirrors the openIs/#applyHqDrawers rule). */
  #hqTab = "roster";

  /** Which Codex/Archive category sub-tab is showing (a category id). Reconciled to an existing
   *  category in #archiveContext; DOM-toggled with no re-render (mirrors #hqTab). */
  #archiveTab = "";

  /** The id of the Archive entry whose detail BOOK is open, or null. Transient (mirrors #openHqDrawer). */
  #openArchiveEntry = null;

  /** Dispatch squad assembly: the idle agent ids the GM has tapped for the mission being staffed, plus
   *  which mission that is. Transient (DOM-toggled, no persist); survives re-render and clears on Send. */
  #squadPick = new Set();
  #squadPickMission = "";

  /** When true, the next render() is skipped (then the flag clears). Lets a tier/duration tweak persist
   *  QUIETLY — the handler patches the DOM itself, so the setting's onChange re-render would only flicker
   *  the open drawer. One-shot + local: other clients still re-render to pick up the change. */
  #skipRenderOnce = false;

  /** Signature of what the Home pane last rendered from the HQ object — see #hqViewDigest. Lets
   *  notifyHQChanged skip a re-render when an HQ change touched nothing the Home tab actually shows. */
  #hqSig = null;

  /** Signature of what the Archive pane last rendered for THIS viewer — see #archiveViewDigest. Lets
   *  notifyArchiveChanged skip a re-render when an archive change touched nothing the pane shows. */
  #archiveSig = null;

  /** GM quest-authoring toggle. Off → every quest shows its pretty read-only view (same as players);
   *  on → the selected quest reveals its inline edit fields. Transient; reset when navigating away. */
  #editMode = false;

  /** Live banner-zoom while the GM is scrolling the hero (null between gestures), + its debounce-save
   *  timer — so rapid wheel ticks update the DOM but persist to the setting only once they settle. */
  #bannerZoom = null;
  #bannerZoomTimer = null;

  get isGM() {
    return game.user.isGM;
  }

  /** Factions/Home parts are present only when the GM has enabled them. A caller may also request a
   *  SUBSET of parts (e.g. a scoped `render({ parts: ["hq"] })` after an HQ edit) so a single-pane
   *  change rebuilds only that pane instead of flashing the whole window — we honour the request,
   *  intersected with the parts that actually exist; with no request we render every available part. */
  _configureRenderOptions(options) {
    // Capture the caller's explicit subset BEFORE super runs (super back-fills the full PARTS list).
    const requested = Array.isArray(options.parts) ? [...options.parts] : null;
    super._configureRenderOptions(options);
    const available = ["nav", "quests", "archive"];
    if (game.settings.get("project-anime", PARTY_FACTIONS_SETTING)) available.push("factions", "hq");
    const subset = requested ? requested.filter((p) => available.includes(p)) : null;
    options.parts = (subset && subset.length) ? subset : available;
  }

  /* ----------------------------- context ----------------------------- */

  async _prepareContext(options) {
    const isGM = this.isGM;
    const showFactions = game.settings.get("project-anime", PARTY_FACTIONS_SETTING);
    // Which parts this render touches (set by _configureRenderOptions). A scoped re-render only needs
    // its own pane's view-model — building the others would re-run their enrichHTML/loops for nothing.
    const parts = options?.parts ?? ["nav", "quests", "factions", "hq", "archive"];

    // Reconcile the active pane to one that's available.
    const available = ["quests", ...(showFactions ? ["factions", "hq"] : []), "archive"];
    if (!available.includes(this.#activeTab)) this.#activeTab = "quests";
    const active = this.#activeTab;

    const ctx = {
      isGM,
      editMode: isGM && this.#editMode,
      showFactions,
      onQuests: active === "quests",
      onFactions: active === "factions",
      onHq: active === "hq",
      onArchive: active === "archive",
      // The Codex section nav (named `sections` to avoid clashing with the quest pane's `tabs`).
      sections: [
        { key: "quests", icon: "fa-book-open", label: game.i18n.localize("PROJECTANIME.Codex.tabQuests"), active: active === "quests" },
        ...(showFactions ? [
          { key: "factions", icon: "fa-flag", label: game.i18n.localize("PROJECTANIME.Codex.tabFactions"), active: active === "factions" },
          { key: "hq", icon: "fa-house", label: game.i18n.localize("PROJECTANIME.Codex.tabHome"), active: active === "hq" }
        ] : []),
        { key: "archive", icon: "fa-book-skull", label: game.i18n.localize("PROJECTANIME.Codex.tabCodex"), active: active === "archive" }
      ]
    };

    // Build each pane's view-model only when that part is actually rendering, so a scoped HQ edit
    // doesn't re-enrich the Quests brief or every faction's lore. Parts that aren't re-rendered keep
    // their existing DOM (and don't invoke their template), so their absent context is harmless.
    if (parts.includes("quests")) Object.assign(ctx, await this.#questsContext());
    if (showFactions) {
      if (parts.includes("factions")) {
        const fc = await this.#factionContext();
        ctx.factions = fc.list;
        ctx.web = fc.web;
        ctx.hasWeb = fc.hasWeb;
      }
      if (parts.includes("hq")) ctx.hq = this.#hqContext();
    }
    if (parts.includes("archive")) ctx.archive = await this.#archiveContext();
    return ctx;
  }

  /** Build the Quests-pane view-model (the former Chronicle context). */
  async #questsContext() {
    const quests = getQuests();

    const counts = {
      all: quests.length,
      main: quests.filter((q) => q.category === "main" && q.status !== "done").length,
      side: quests.filter((q) => q.category === "side" && q.status !== "done").length,
      personal: quests.filter((q) => q.category === "personal" && q.status !== "done").length,
      completed: quests.filter((q) => q.status === "done").length
    };

    let list = quests.filter((q) => {
      if (this._tab === "all") return true;
      if (this._tab === "completed") return q.status === "done";
      return q.category === this._tab && q.status !== "done";
    });

    if (!this._selId || !quests.find((q) => q.id === this._selId)) {
      this._selId = list[0]?.id ?? quests[0]?.id ?? null;
    }
    const selected = quests.find((q) => q.id === this._selId) ?? null;

    const card = (q) => {
      const cat = QUEST_CATEGORIES[q.category] ?? QUEST_CATEGORIES.main;
      const prog = questProgress(q);
      const levelNum = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
      const bz = bannerZoomOf(q);
      return {
        id: q.id,
        title: q.title,
        category: q.category,
        status: q.status,
        isDone: q.status === "done",
        isNew: q.status === "active" && prog.done === 0, // auto: new until progress/closed
        giverName: q.giver?.name ?? "",
        icon: q.icon || "",
        color: cat.color,
        levelNum,
        levelStars: [1, 2, 3, 4, 5].map((n) => ({ n, on: n <= levelNum })),
        banner: q.banner || "",
        bannerPos: `${Number.isFinite(q.bannerPos?.x) ? q.bannerPos.x : 50}% ${Number.isFinite(q.bannerPos?.y) ? q.bannerPos.y : 50}%`,
        bannerSize: bz > 1 ? `${(bz * 100).toFixed(2)}%` : "cover",
        pct: prog.pct,
        progLabel: q.status === "done" ? "✓" : `${prog.done}/${prog.total}`,
        selected: q.id === this._selId
      };
    };

    const tabs = [
      { k: "all", label: game.i18n.localize("PROJECTANIME.Chronicle.tab.all"), color: "var(--pa-gold)", n: counts.all },
      { k: "main", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.main"), color: "var(--q-main)", n: counts.main },
      { k: "side", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.side"), color: "var(--q-side)", n: counts.side },
      { k: "personal", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.personal"), color: "var(--q-personal)", n: counts.personal },
      { k: "completed", label: game.i18n.localize("PROJECTANIME.Chronicle.tab.completed"), color: "var(--q-done)", n: counts.completed }
    ].map((t) => ({ ...t, on: t.k === this._tab }));

    return {
      tab: this._tab,
      tabs,
      hasQuests: quests.length > 0,
      quests: list.map(card),
      detail: selected ? await this.#detailContext(selected) : null,
      trackedId: game.settings.get("project-anime", TRACKED_SETTING)
    };
  }

  async #detailContext(q) {
    const cat = QUEST_CATEGORIES[q.category] ?? QUEST_CATEGORIES.main;
    const prog = questProgress(q);
    const bannerX = Number.isFinite(q.bannerPos?.x) ? q.bannerPos.x : 50;
    const bannerY = Number.isFinite(q.bannerPos?.y) ? q.bannerPos.y : 50;
    const bannerZoom = bannerZoomOf(q);
    const levelNum = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
    const levelStars = [1, 2, 3, 4, 5].map((n) => ({ n, on: n <= levelNum }));
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let brief = q.brief ?? "";
    try {
      brief = await TE.enrichHTML(q.brief ?? "", { secrets: this.isGM });
    } catch (_e) {
      brief = q.brief ?? "";
    }

    const objectives = (q.objectives ?? [])
      .filter((o) => this.isGM || !o.hidden)
      .map((o) => ({ ...o }));

    const opt = (arr, cur) =>
      arr.map((k) => ({ k, label: game.i18n.localize(`PROJECTANIME.Chronicle.cat.${k}`) || k, sel: k === cur }));
    const statusOpt = ["active", "done", "failed"].map((k) => ({
      k,
      label: game.i18n.localize(`PROJECTANIME.Chronicle.state.${k}`),
      sel: k === q.status
    }));

    const giver = q.giver
      ? { ...q.giver, initial: String(q.giver.name || "?").trim().charAt(0).toUpperCase() }
      : null;

    return {
      ...q,
      giver,
      briefRaw: q.brief ?? "",
      tracked: game.settings.get("project-anime", TRACKED_SETTING) === q.id,
      color: cat.color,
      hasBanner: !!q.banner,
      bannerStyle: q.banner
        ? `background-image:url('${q.banner}'); background-position:${bannerX}% ${bannerY}%${bannerZoom > 1 ? `; background-size:${(bannerZoom * 100).toFixed(2)}%` : ""}`
        : `background:${BANNER_GRAD[q.category] ?? BANNER_GRAD.main}`,
      levelNum,
      levelStars,
      catLabel: game.i18n.localize(`PROJECTANIME.Chronicle.cat.${q.category}`),
      statusLabel: game.i18n.localize(`PROJECTANIME.Chronicle.state.${q.status}`),
      brief,
      objectives,
      // Map with the real array index first (so the remove/hide controls target the right reward),
      // then drop hidden rewards for players — the GM still sees them, dimmed.
      rewards: (q.rewards ?? [])
        .map((r, i) => ({ ...rewardView(r, i), hidden: !!r.hidden }))
        .filter((rv) => this.isGM || !rv.hidden),
      prog,
      isDone: q.status === "done",
      catOptions: opt(["main", "side", "personal"], q.category),
      statusOptions: statusOpt,
      // Skill-Points / Gold / Faction-rep are authored in a fixed three-column form (each its own
      // amount box); Items + Bonds come from their drag drop-zones. No reward-type picker anymore.
      factionChoices: getFactions().map((f) => ({ id: f.id, name: f.name })),
      // Not-yet-recruited HQ pool entries → the card picker for the "Recruit" reward. `picked` marks the
      // recruits already on this quest (click a card to toggle); completing the quest unlocks them.
      recruitChoices: (() => {
        const picked = new Set((q.rewards ?? []).filter((r) => r.type === "recruit").map((r) => r.recruitId));
        return getHQ().people.filter((e) => !e.recruited).map((e) => ({
          id: e.id,
          name: e.name || "—",
          img: e.img || "icons/svg/mystery-man.svg",
          initial: initialOf(e.name),
          roleLabel: game.i18n.localize(`PROJECTANIME.Covenant.role.${e.role}`),
          picked: picked.has(e.id)
        }));
      })()
    };
  }

  /* ----------------------------- render wiring ----------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    // Re-bind only the panes that actually (re)rendered this pass. A scoped render (e.g. only "hq")
    // leaves the other panes' DOM — and the listeners already on it — in place, so re-binding them
    // would stack a duplicate handler on every node. `parts` mirrors _configureRenderOptions.
    const parts = options?.parts ?? ["nav", "quests", "factions", "hq", "archive"];

    if (parts.includes("quests")) this.#bindQuestEvents(root);

    if (parts.includes("hq")) {
      // Right-click a recruited member (roster/facility) → context menu — bound for EVERYONE so players
      // can open a member's sheet (the GM additionally gets Delete; pool cards stay GM-only below).
      this.#bindHqMemberMenus();
      if (this.isGM) this.#bindHqEdits();      // GM authors HQ recruits/missions inline
      this.#applyHqTabs();                     // re-assert the active sub-tab (template already set it)
      this.#applyHqDrawers();                  // re-assert the open detail book (template already set it; harmless reconcile)
      this.#hqSig = this.#hqViewDigest();      // remember what the Home tab now shows (seamless-refresh gate)
    }

    // Factions pane: re-assert the open book (everyone can read it); wire the interactive relationship
    // web (hover-highlight + click-to-open for all; drag / link / edge-cycle for the GM); the GM also
    // authors the faction books inline.
    if (parts.includes("factions")) {
      this.#applyFactionDrawers();
      this.#bindFactionWeb();
      if (this.isGM) this.#bindFactionEdits();
    }

    if (parts.includes("archive")) {
      this.#applyArchiveTabs();
      this.#applyArchiveDrawers();
      this.#bindArchiveMenus();                       // everyone: card right-click (open / open-sheet); GM: category-tab menu
      if (this.isGM) this.#bindArchiveEdits();
      this.#archiveSig = this.#archiveViewDigest();   // remember what the Archive pane now shows (seamless-refresh gate)
    }
  }

  /** Quests-pane listeners: live search filter + (GM) field edits + giver/reward drop zones. */
  #bindQuestEvents(root) {
    // Live client-side search filter (no re-render, keeps input focus).
    const search = root.querySelector(".cw-search input");
    if (search) {
      search.addEventListener("input", (ev) => {
        const q = ev.target.value.trim().toLowerCase();
        for (const c of root.querySelectorAll(".q-card")) {
          const t = (c.dataset.title || "").toLowerCase();
          c.style.display = !q || t.includes(q) ? "" : "none";
        }
      });
    }

    if (!this.isGM) return;

    // GM edits — quest fields, objective fields, and the reward hide toggle, saved on change/blur.
    for (const el of root.querySelectorAll("[data-field], [data-obj-field], [data-rwd-field]")) {
      el.addEventListener("change", this.#onFieldChange.bind(this));
    }
    // GM drop zones: drag an Item → item reward; drag an Actor → quest giver.
    for (const zone of root.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { zone.classList.remove("drag-over"); this.#onQuestDrop(ev, zone.dataset.drop); });
    }
    // GM right-click a quest card in the rail → context menu (track, complete/reopen, abandon, delete).
    for (const card of root.querySelectorAll(".q-card")) {
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.#openQuestContext(card.dataset.id, ev);
      });
    }
    // GM (any view, not just edit mode): the hero banner is interactive — a plain click opens the
    // image FilePicker; a drag repositions its focal point (only when a banner image exists — `.repos`);
    // the scroll wheel zooms the image in/out (`bannerZoom`, 1–4×).
    const hero = root.querySelector(".q-hero");
    if (hero) {
      hero.addEventListener("pointerdown", (ev) => this.#startBannerDrag(ev, hero));
      hero.addEventListener("wheel", (ev) => this.#onBannerWheel(ev, hero), { passive: false });
    }
  }

  /** GM: the quest hero banner is interactive — a plain click opens the image FilePicker; a drag
   *  repositions the banner's focal point (`bannerPos`, {x,y} %), but only when a banner image
   *  exists (the hero carries `.repos`). Grabs on the title/meta inputs, the stars, or the hero
   *  tools are ignored so those stay usable. Mirrors #startHqBannerDrag. */
  #startBannerDrag(ev, hero) {
    if (ev.button !== 0 || ev.target.closest("input, select, textarea, button, label, a, [data-action]")) return;
    ev.preventDefault();
    const canRepos = hero.classList.contains("repos");
    const rect = hero.getBoundingClientRect();
    const startX = ev.clientX, startY = ev.clientY;
    const q0 = getQuests().find((x) => x.id === this._selId);
    const start = {
      x: Number.isFinite(q0?.bannerPos?.x) ? q0.bannerPos.x : 50,
      y: Number.isFinite(q0?.bannerPos?.y) ? q0.bannerPos.y : 50
    };
    let pos = { ...start }, moved = false;
    const move = (e) => {
      if (!canRepos) return;                                // no image yet → pointerup opens the picker
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) moved = true;
      if (!moved) return;
      pos = {
        x: Math.max(0, Math.min(100, start.x - ((e.clientX - startX) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, start.y - ((e.clientY - startY) / rect.height) * 100))
      };
      hero.classList.add("dragging");
      hero.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    };
    const up = async () => {
      hero.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return this.#openQuestBannerPicker();     // plain click → choose / replace the image
      if (pos.x !== start.x || pos.y !== start.y) await this._mutateSelected((q) => { q.bannerPos = pos; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Open the image FilePicker for the quest hero banner (GM only). */
  #openQuestBannerPicker() {
    if (!this.isGM) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getQuests().find((x) => x.id === this._selId)?.banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this._mutateSelected((q) => { q.banner = path; }) }).browse();
  }

  /** GM: scroll the hero banner to zoom the image (`bannerZoom`, 1–4× of cover). Updates the DOM
   *  live and debounce-saves so a flurry of wheel events doesn't thrash the world setting / re-render. */
  #onBannerWheel(ev, hero) {
    const q = getQuests().find((x) => x.id === this._selId);
    if (!q?.banner) return;                                 // nothing to zoom without an image
    ev.preventDefault();
    const cur = this.#bannerZoom ?? bannerZoomOf(q);
    const next = Math.max(BANNER_ZOOM_MIN, Math.min(BANNER_ZOOM_MAX, +(cur + (ev.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)));
    this.#bannerZoom = next;
    hero.style.backgroundSize = next > 1 ? `${(next * 100).toFixed(2)}%` : "cover";
    clearTimeout(this.#bannerZoomTimer);
    this.#bannerZoomTimer = setTimeout(() => {
      this.#bannerZoom = null;
      this._mutateSelected((x) => { x.bannerZoom = next; });
    }, 350);
  }

  /** GM: the HQ hero banner is interactive — a plain click opens the image FilePicker; a drag
   *  repositions the banner's focal point (`bannerPos`, {x,y} %), but only when a banner image
   *  exists (the hero carries `.repos`). Grabs on the crest, the identity inputs, or the hero tools
   *  are ignored so those stay usable. Mirrors #startBannerDrag (quests). */
  #startHqBannerDrag(ev, hero) {
    if (ev.button !== 0 || ev.target.closest("input, select, textarea, button, label, a, .hq-crest, .hq-hero-tools")) return;
    ev.preventDefault();
    const canRepos = hero.classList.contains("repos");
    const rect = hero.getBoundingClientRect();
    const startX = ev.clientX, startY = ev.clientY;
    const hq0 = getHQ();
    const start = {
      x: Number.isFinite(hq0?.bannerPos?.x) ? hq0.bannerPos.x : 50,
      y: Number.isFinite(hq0?.bannerPos?.y) ? hq0.bannerPos.y : 50
    };
    let pos = { ...start }, moved = false;
    const move = (e) => {
      if (!canRepos) return;                                // no image yet → pointerup opens the picker
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) moved = true;
      if (!moved) return;
      pos = {
        x: Math.max(0, Math.min(100, start.x - ((e.clientX - startX) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, start.y - ((e.clientY - startY) / rect.height) * 100))
      };
      hero.classList.add("dragging");
      hero.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    };
    const up = async () => {
      hero.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return this.#openHqBannerPicker();        // plain click → choose / replace the image
      if (pos.x !== start.x || pos.y !== start.y) await this.#mutateHQ((hq) => { hq.bannerPos = pos; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Open the image FilePicker for the HQ hero banner (GM only). */
  #openHqBannerPicker() {
    if (!game.user.isGM) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getHQ().banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateHQ((hq) => { hq.banner = path; }) }).browse();
  }

  /* ----------------------------- nav ----------------------------- */

  /** Switch panes via CSS (toggle .active on the live DOM) — instant, no re-render. */
  static #onSelectTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab || tab === this.#activeTab) return;
    this.#activeTab = tab;
    for (const pane of this.element.querySelectorAll(".codex-pane"))
      pane.classList.toggle("active", pane.dataset.pane === tab);
    for (const btn of this.element.querySelectorAll(".cdx-tab"))
      btn.classList.toggle("active", btn.dataset.tab === tab);
  }

  /** Open a listed actor's (quest giver / recruit / facility / bonded member) own sheet. */
  static async #onOpenActor(event, target) {
    const el = target.closest("[data-ref], [data-uuid]");
    const ref = el?.dataset.ref ?? el?.dataset.uuid;
    const actor = ref ? await fromUuid(ref) : null;
    actor?.sheet?.render(true);
  }

  /* =============================== QUESTS =============================== */

  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** GM-only: mutate a quest by id, persist, re-render. */
  async _mutateQuest(id, fn) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;
    fn(q);
    await saveQuests(quests);
    this.render(false);
  }

  /** GM-only: mutate the selected quest, persist, re-render. */
  async _mutateSelected(fn) {
    return this._mutateQuest(this._selId, fn);
  }

  async #onQuestDrop(event, zone) {
    event.preventDefault();
    if (!this.isGM) return;
    const data = this.#dropData(event);
    if (!data?.type || !data.uuid) return;

    if (zone === "giver") {
      if (data.type !== "Actor") return;
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return;
      const role = actor.type === "npc" ? actor.system?.role ?? "" : "";
      await this._mutateSelected((q) => {
        q.giver = { uuid: actor.uuid, name: actor.name, img: actor.img, role };
      });
    } else if (zone === "reward") {
      if (data.type !== "Item") return;
      const item = await fromUuid(data.uuid).catch(() => null);
      if (!item) return;
      await this._mutateSelected((q) => {
        q.rewards.push({ type: "item", uuid: item.uuid, name: item.name, img: item.img });
      });
    } else if (zone === "bond") {
      // Drag an NPC → a Bond reward linked to that actor; re-dragging the same NPC deepens it by a
      // rank (the "drag for bond increase" gesture), capped at the bond max.
      if (data.type !== "Actor") return;
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return;
      await this._mutateSelected((q) => {
        const ex = (q.rewards ?? []).find((r) => r.type === "bond" && r.uuid === actor.uuid);
        if (ex) ex.value = Math.min(BOND_MAX_RANK, (Number(ex.value) || 1) + 1);
        else q.rewards.push({ type: "bond", uuid: actor.uuid, name: actor.name, img: actor.img, value: 1 });
      });
    }
  }

  async #onFieldChange(event) {
    const el = event.currentTarget;
    const val = el.type === "checkbox" ? el.checked : el.value;

    // Objective sub-fields: data-obj="<id>" data-obj-field="text|done|hidden|optional"
    const oid = el.dataset.obj;
    if (oid !== undefined) {
      await this._mutateSelected((q) => {
        const o = (q.objectives ?? []).find((x) => x.id === oid);
        if (o) o[el.dataset.objField] = val;
      });
      return;
    }

    // Reward sub-fields: data-rwd="<index>" data-rwd-field="hidden" (the eye-slash hide toggle).
    const rwd = el.dataset.rwd;
    if (rwd !== undefined) {
      const idx = Number(rwd);
      await this._mutateSelected((q) => {
        const r = (q.rewards ?? [])[idx];
        if (r) r[el.dataset.rwdField] = val;
      });
      return;
    }

    const field = el.dataset.field;
    if (field === "giverRole") {
      await this._mutateSelected((q) => {
        if (q.giver) q.giver.role = val;
      });
      return;
    }
    await this._mutateSelected((q) => {
      q[field] = val;
    });
  }

  static #onSelectQuest(event, target) {
    const id = target.dataset.id;
    if (id !== this._selId) this.#editMode = false; // left-click navigates → pretty view
    this._selId = id;
    this.render(false);
  }

  static #onSetTab(event, target) {
    this._tab = target.dataset.tab;
    this.#editMode = false; // switching category filters leaves edit mode
    this.render(false);
  }

  static async #onNewQuest() {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = blankQuest();
    q.category = ["main", "side", "personal"].includes(this._tab) ? this._tab : "main";
    quests.unshift(q);
    await saveQuests(quests);
    this._selId = q.id;
    this.#editMode = true; // a fresh quest opens ready to author
    this.render(false);
  }

  static async #onDeleteQuest() {
    return this.#deleteQuest(this._selId);
  }

  /** Delete a quest by id, confirm first. Shared by the GM-bar button and the rail right-click. */
  async #deleteQuest(id) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Chronicle.deleteTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Chronicle.deleteConfirm", { name: q.title })}</p>`
    }).catch(() => false);
    if (!ok) return;
    await saveQuests(quests.filter((x) => x.id !== id));
    if (this._selId === id) this._selId = null;
    this.render(false);
  }

  /** Leave quest edit mode (the GM-bar "Done" button) → back to the pretty read-only view. */
  static #onExitEdit() {
    this.#editMode = false;
    this.render(false);
  }

  /** Enter edit mode for a quest (selecting it first), or leave it if that quest is already the one
   *  being edited. The GM authoring toggle behind the rail context menu's Edit / Done Editing row. */
  #toggleEdit(id) {
    if (this.#editMode && this._selId === id) {
      this.#editMode = false;
    } else {
      this._selId = id;
      this.#editMode = true;
    }
    this.render(false);
  }

  /** A cursor-anchored popover context menu (top-layer, so it escapes the window's clipping).
   *  Returns an `add(icon, label, onClick, cls?)` row builder and a `show()` — mirrors the actor
   *  sheet's menu so the shared `.pd-picker.context-menu` styling applies. */
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

  /** GM right-click on a rail quest card → context menu acting on THAT quest (not necessarily the
   *  selected one): track/untrack, complete-or-reopen, abandon, delete. */
  #openQuestContext(id, ev) {
    if (!this.isGM) return;
    const q = getQuests().find((x) => x.id === id);
    if (!q) return;
    const tracked = game.settings.get("project-anime", TRACKED_SETTING) === id;
    const editingThis = this.#editMode && this._selId === id;
    const { add, show } = this.#contextMenu(ev);
    add(editingThis ? "fa-eye" : "fa-pen-to-square",
      editingThis ? "PROJECTANIME.Chronicle.doneEditing" : "PROJECTANIME.Action.edit",
      () => this.#toggleEdit(id));
    add(tracked ? "fa-flag-checkered" : "fa-flag",
      tracked ? "PROJECTANIME.Chronicle.untrack" : "PROJECTANIME.Chronicle.track",
      () => this.#trackQuest(id));
    if (q.status === "done") {
      add("fa-rotate-left", "PROJECTANIME.Chronicle.reopen", () => this._mutateQuest(id, (x) => { x.status = "active"; }));
    } else {
      add("fa-check", "PROJECTANIME.Chronicle.complete", () => this.#completeQuest(id));
      add("fa-ban", "PROJECTANIME.Chronicle.abandon", () => this._mutateQuest(id, (x) => { x.status = "failed"; }));
    }
    add("fa-trash", "PROJECTANIME.Chronicle.delete", () => this.#deleteQuest(id), "danger");
    show();
  }

  static async #onToggleObjective(event, target) {
    if (!this.isGM) return;
    const oid = target.dataset.obj;
    await this._mutateSelected((q) => {
      const o = (q.objectives ?? []).find((x) => x.id === oid);
      if (o) o.done = !o.done;
    });
  }

  static async #onAddObjective() {
    await this._mutateSelected((q) => {
      q.objectives.push({ id: foundry.utils.randomID(), text: "", done: false, hidden: false, optional: false });
    });
  }

  static async #onRemoveObjective(event, target) {
    const oid = target.dataset.obj;
    await this._mutateSelected((q) => {
      q.objectives = (q.objectives ?? []).filter((x) => x.id !== oid);
    });
  }

  /** Add rewards from the three-column form: each filled box (Skill Points, Gold, and a Faction +
   *  its amount) becomes its own reward chip in one click. */
  static async #onAddReward(event, target) {
    const box = target.closest(".add-reward");
    if (!box) return;
    const sp = Math.max(0, Number(box.querySelector('[data-ar="sp"]')?.value) || 0);
    const gold = Math.max(0, Number(box.querySelector('[data-ar="gold"]')?.value) || 0);
    const factionId = box.querySelector('[data-ar="faction"]')?.value ?? "";
    const rep = Number(box.querySelector('[data-ar="rep"]')?.value) || 0;
    if (!sp && !gold && !(factionId && rep)) return; // nothing entered
    await this._mutateSelected((q) => {
      if (sp) q.rewards.push({ type: "sp", value: sp });
      if (gold) q.rewards.push({ type: "gold", value: gold });
      if (factionId && rep) {
        const f = factionById(factionId);
        q.rewards.push({ type: "rep", factionId: f?.id ?? "", faction: f?.name ?? game.i18n.localize("PROJECTANIME.Chronicle.reward.rep"), value: rep });
      }
    });
  }

  /** Click a recruit card in the reward form → toggle it on/off this quest as a "recruit" reward (GM).
   *  Completing the quest then unlocks the chosen recruit(s) in the HQ pool (see grantRewards). */
  static async #onAddRecruitReward(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (!id) return;
    const rec = getHQ().people.find((e) => e.id === id);
    await this._mutateSelected((q) => {
      q.rewards ??= [];
      const i = q.rewards.findIndex((r) => r.type === "recruit" && r.recruitId === id);
      if (i >= 0) q.rewards.splice(i, 1);
      else q.rewards.push({ type: "recruit", recruitId: id, name: rec?.name ?? "", img: rec?.img ?? "" });
    });
  }

  static async #onRemoveReward(event, target) {
    const idx = Number(target.dataset.idx);
    await this._mutateSelected((q) => {
      q.rewards.splice(idx, 1);
    });
  }

  /** Click a level star → set the quest's difficulty rank (1–5); re-click the current rank to clear it. */
  static async #onSetLevel(event, target) {
    if (!this.isGM) return;
    const n = Math.max(0, Math.min(5, Number(target.dataset.star) || 0));
    await this._mutateSelected((q) => {
      const cur = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
      q.level = cur === n ? 0 : n; // toggle off when re-clicking the current rank
    });
  }

  static async #onClearGiver() {
    await this._mutateSelected((q) => {
      q.giver = null;
    });
  }

  static async #onOpenGiver() {
    const quests = getQuests();
    const q = quests.find((x) => x.id === this._selId);
    if (!q?.giver?.uuid) return;
    const actor = await fromUuid(q.giver.uuid).catch(() => null);
    actor?.sheet?.render(true);
  }

  static async #onPickIcon() {
    if (!this.isGM) return;
    const current = getQuests().find((x) => x.id === this._selId)?.icon ?? "";
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "image",
      current,
      callback: (path) => this._mutateSelected((q) => {
        q.icon = path;
      })
    }).render(true);
  }

  static async #onComplete() {
    return this.#completeQuest(this._selId);
  }

  /** Grant rewards once (idempotent), then mark a quest done by id. Shared by the action button and
   *  the rail context menu. Aborts if rewards needed a party and none resolved. */
  async #completeQuest(id) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;

    if (!q.granted) {
      const summary = await grantRewards(q);
      if (summary === null) return; // needed a party, none resolved — abort, leave active
      q.granted = true;
      this.#announce(q, summary);
    }
    q.status = "done";
    await saveQuests(quests);
    this.render(false);
  }

  /** GM "Distribute Rewards" → a review screen of the quest's rewards with a Gold/Items destination
   *  toggle (shared party stash vs split to each player), then pays out via grantRewards. Sets
   *  `granted` so Mark Complete won't pay again; confirms first if already distributed once. */
  static async #onDistribute() {
    if (!this.isGM) return;
    const quest = getQuests().find((x) => x.id === this._selId);
    if (!quest) return;
    if (!(quest.rewards?.length)) { ui.notifications.info(game.i18n.localize("PROJECTANIME.Chronicle.distEmpty")); return; }

    if (quest.granted) {
      const again = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("PROJECTANIME.Chronicle.distribute") },
        content: `<p>${game.i18n.localize("PROJECTANIME.Chronicle.alreadyDistributed")}</p>`
      }).catch(() => false);
      if (!again) return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("PROJECTANIME.Chronicle.distTitle", { name: quest.title }), icon: "fa-solid fa-gift" },
      classes: ["project-anime", "theme-dark"],
      content: this.#distributeContent(quest),
      buttons: [
        {
          action: "distribute", label: game.i18n.localize("PROJECTANIME.Chronicle.distribute"), icon: "fa-solid fa-paper-plane", default: true,
          callback: (event, button, dialog) => {
            const root = dialog?.element ?? button?.form;
            return { goldItemsTo: root?.querySelector('input[name="goldItemsTo"]:checked')?.value || "stash" };
          }
        },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!choice || typeof choice !== "object") return; // closed or cancelled

    const summary = await grantRewards(quest, { goldItemsTo: choice.goldItemsTo });
    if (summary === null) return; // needed a party, none resolved — grantRewards already warned
    const quests = getQuests();
    const q = quests.find((x) => x.id === quest.id);
    if (q) { q.granted = true; await saveQuests(quests); }
    this.#announce(quest, summary, "PROJECTANIME.Chronicle.rewardsDistributed");
    this.render(false);
  }

  /** Reward-list HTML for the Distribute screen + the Gold/Items destination toggle (shown only when
   *  the quest actually has gold or items to route). */
  #distributeContent(quest) {
    const rows = (quest.rewards ?? []).map((r, i) => {
      const v = rewardView(r, i);
      const ic = v.img ? `<img src="${v.img}" alt="">` : v.icon;
      const hide = r.hidden ? ` <i class="fa-solid fa-eye-slash dr-hidden" title="${escHtml(game.i18n.localize("PROJECTANIME.Chronicle.hiddenReward"))}"></i>` : "";
      return `<div class="dr-row"><span class="dr-ic" style="--rg:${v.rg}">${ic}</span>`
        + `<span class="dr-v">${escHtml(String(v.v))}</span><span class="dr-l">${escHtml(v.l)}${hide}</span>`
        + `<span class="dr-dest">→ ${escHtml(this.#rewardDest(r))}</span></div>`;
    }).join("");
    const hasShareable = (quest.rewards ?? []).some((r) => r.type === "gold" || r.type === "item");
    const toggle = hasShareable
      ? `<fieldset class="dr-target"><legend>${game.i18n.localize("PROJECTANIME.Chronicle.distTo")}</legend>`
        + `<label><input type="radio" name="goldItemsTo" value="stash" checked> ${game.i18n.localize("PROJECTANIME.Chronicle.distStash")}</label>`
        + `<label><input type="radio" name="goldItemsTo" value="players"> ${game.i18n.localize("PROJECTANIME.Chronicle.distPlayers")}</label></fieldset>`
      : "";
    return `<div class="project-anime theme-dark"><div class="pa-distribute">${rows}${toggle}</div></div>`;
  }

  /** Where a reward will land, for the Distribute screen's "→ …" hint. */
  #rewardDest(r) {
    switch (r.type) {
      case "sp": return game.i18n.localize("PROJECTANIME.Chronicle.destMembers");
      case "gold": case "item": return game.i18n.localize("PROJECTANIME.Chronicle.destShareable");
      case "rep": return (r.factionId ? factionById(r.factionId)?.name : null) || r.faction || game.i18n.localize("PROJECTANIME.Chronicle.reward.rep");
      case "bond": return r.name || game.i18n.localize("PROJECTANIME.Chronicle.destMembers");
      case "unlock": return game.i18n.localize("PROJECTANIME.Chronicle.destNarrative");
      default: return "";
    }
  }

  static async #onReopen() {
    if (!this.isGM) return;
    await this._mutateSelected((q) => {
      q.status = "active";
    });
  }

  static async #onAbandon() {
    if (!this.isGM) return;
    await this._mutateSelected((q) => {
      q.status = "failed";
    });
  }

  static async #onTrack() {
    return this.#trackQuest(this._selId);
  }

  /** Toggle the tracked quest (client setting) by id. Shared by the action button + context menu. */
  async #trackQuest(id) {
    const cur = game.settings.get("project-anime", TRACKED_SETTING);
    const next = cur === id ? "" : id;
    await game.settings.set("project-anime", TRACKED_SETTING, next);
    // Tracking a quest un-hides the on-canvas tracker if the user had hidden it.
    if (next && !game.settings.get("project-anime", TRACKER_VISIBLE_SETTING)) {
      await game.settings.set("project-anime", TRACKER_VISIBLE_SETTING, true);
    }
    this.render(false);
  }

  /** Post a chat card summarizing what the party received (heading varies: completed vs distributed). */
  #announce(quest, summary, headingKey = "PROJECTANIME.Chronicle.completed") {
    if (!summary) return;
    const bits = [];
    if (summary.sp) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.sp", { n: summary.sp, members: summary.members }));
    if (summary.gold) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.gold", { n: summary.gold }));
    if (summary.items) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.items", { n: summary.items }));
    if (summary.rep) bits.push(game.i18n.localize("PROJECTANIME.Chronicle.grant.rep"));
    if (summary.bond) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.bond", { n: summary.bond }));
    const qIcon = isImageIcon(quest.icon) ? quest.icon : (isImageIcon(quest.img) ? quest.img : "");
    ChatMessage.create({
      content: cardHTML({
        icon: qIcon,
        glyph: qIcon ? "" : "fa-scroll",
        title: quest.title || game.i18n.localize("PROJECTANIME.Chronicle.untitled"),
        subtitle: game.i18n.localize(headingKey),
        lines: bits
      })
    });
  }

  /* =============================== FACTIONS =============================== */

  /** Build the Factions-pane view-model: an interactive relationship WEB plus each world faction
   *  (its crest, gilded standing meter, ally/rival ties, boon ladder, lore, and bonded members). Read-
   *  only for players; the GM edits inline + opens the detail BOOK. Returns { list, web, hasWeb }. */
  async #factionContext() {
    const factions = getFactions();
    const TE = foundry.applications.ux.TextEditor?.implementation ?? globalThis.TextEditor;
    // Bonds across the shared party's members, grouped by faction id.
    const party = await resolveParty();
    const byFaction = {};
    for (const m of (party ? partyMembers(party) : [])) {
      for (const b of getBonds(m)) {
        if (!b.faction) continue;
        (byFaction[b.faction] ??= []).push({
          name: String(b.name || "").split(",")[0],
          img: b.img,
          initial: initialOf(b.name),
          ref: b.actorUuid || "",
          accent: b.accent,
          starsStr: "★".repeat(b.rank) + "·".repeat(Math.max(0, BOND_MAX_RANK - b.rank)),
          owner: m.name
        });
      }
    }

    // Lightweight per-faction meta (id, short code, name, accent) for the matrix headers + chip lookup.
    const metaById = Object.fromEntries(factions.map((f) => [f.id, { id: f.id, code: factionCode(f.name), name: f.name, accent: f.accent }]));

    const list = [];
    for (const f of factions) {
      const standing = clampStanding(f.standing);
      const tier = tierForStanding(standing);
      // Resolve this faction's ally / rival neighbours (skip dangling edges to deleted factions).
      const allies = [], rivals = [];
      for (const rel of f.relations ?? []) {
        const meta = metaById[rel.factionId];
        if (!meta) continue;
        (rel.stance === "ally" ? allies : rivals).push({ ...meta, icon: RELATION_ICONS[rel.stance] });
      }
      list.push({
        id: f.id,
        name: f.name,
        crest: f.crest || "",
        initial: initialOf(f.name),
        accent: f.accent,
        motto: f.motto,
        isOpen: this.#openFactionDrawer === f.id,
        bannerStyle: f.banner ? `background-image:url('${f.banner}')` : `background:${factionHeroGrad(f.accent)}`,
        standing,
        tierKey: tier.key,
        tierLabel: game.i18n.localize(`PROJECTANIME.Covenant.tier.${tier.key}`),
        tierColor: `var(${tier.color})`,
        // Filled stars for every tier the faction has reached (poster glance).
        tierStars: STANDING_TIERS.map((t) => ({ on: standing >= t.min })),
        tiers: STANDING_TIERS.map((t) => ({
          key: t.key, label: game.i18n.localize(`PROJECTANIME.Covenant.tier.${t.key}`),
          cur: t.key === tier.key, color: `var(${t.color})`
        })),
        allies, rivals, hasRelations: (allies.length + rivals.length) > 0,
        perks: (f.perks ?? []).map((p) => {
          const rewardGold = Number(p.rewardGold) || 0;
          const rewardSP = Number(p.rewardSP) || 0;
          const rewardItems = (p.rewardItems ?? []).map((o, idx) => ({ idx, name: o?.name ?? "—", img: o?.img ?? "icons/svg/item-bag.svg" }));
          const hasReward = rewardGold > 0 || rewardSP > 0 || rewardItems.length > 0;
          const on = standing >= p.req;
          return {
            tier: p.tier, tierLabel: game.i18n.localize(`PROJECTANIME.Covenant.tier.${p.tier}`),
            tierColor: `var(${TIER_COLOR[p.tier] ?? "--pa-gold-soft"})`,
            req: p.req, text: p.text, on, rewardGold, rewardSP, rewardItems, hasReward,
            // ✓ only when an authored reward at a reached tier has actually been paid out.
            claimed: on && hasReward && (f.rewardedTiers ?? []).includes(p.tier)
          };
        }),
        lore: await TE.enrichHTML(f.lore ?? "", { secrets: game.user.isGM }),
        loreRaw: f.lore ?? "",
        members: byFaction[f.id] ?? [],
        memberCount: (byFaction[f.id] ?? []).length
      });
    }

    // The relationship WEB (Layer 4) — an interactive node-link graph. Node positions come from a
    // GM-pinned `webPos` or, when unpinned, the deterministic force layout (allies cluster, rivals
    // splay) — see computeWebLayout. Edges are the symmetric ally/rival ties, emitted once per unordered
    // pair, in the same 0–100 space the SVG overlay (viewBox 0 0 100 100, preserveAspectRatio="none") maps to.
    const r2 = (v) => Math.round(v * 100) / 100;
    const n = factions.length;
    const pos = computeWebLayout(factions);
    const nodes = factions.map((f) => ({
      id: f.id, name: f.name, code: factionCode(f.name), accent: f.accent,
      crest: f.crest || "", initial: initialOf(f.name),
      x: r2(pos[f.id].x), y: r2(pos[f.id].y), pinned: !!f.webPos
    }));
    const edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = factions[i], b = factions[j];
      const stance = (a.relations ?? []).find((r) => r.factionId === b.id)?.stance || "";
      if (!stance) continue;
      edges.push({
        aId: a.id, bId: b.id, stance,
        x1: r2(pos[a.id].x), y1: r2(pos[a.id].y), x2: r2(pos[b.id].x), y2: r2(pos[b.id].y)
      });
    }

    return { list, web: { nodes, edges }, hasWeb: n >= 2 };
  }

  /** Build the Home view-model: the party's built-faction identity, the recruitment POOL (flip-cards
   *  of not-yet-recruited NPCs), and the FACILITIES (recruited non-`party` members) that staff it.
   *  The HQ "level" is the sum of facility tiers. A `repTier` recruit references a world faction. */
  #hqContext() {
    const hq = getHQ();
    const resTypes = getMaterialCategories(); // the GM-configured Resource Types (resource bar + facility build costs)
    const isGM = game.user.isGM;
    const factionOpts = getFactions().map((f) => ({ id: f.id, name: f.name }));

    // Recruitment pool — only the not-yet-recruited candidate people; recruiting moves a person into
    // the Roster (and raises a facility, for a facility-vocation recruit), so it leaves the pool.
    const recruits = hq.people.filter((e) => !e.recruited).map((e) => {
      const available = recruitAvailable(e);
      const condType = e.condition?.type ?? "auto";
      const condFactionId = e.condition?.factionId ?? "";
      const condTier = e.condition?.tier ?? "";
      const condLevel = e.condition?.level ?? 0;
      let condLabel;
      if (condType === "repTier") {
        const fac = factionById(condFactionId);
        condLabel = game.i18n.format("PROJECTANIME.Covenant.condRepTierFaction", {
          tier: game.i18n.localize(`PROJECTANIME.Covenant.tier.${condTier || "neutral"}`),
          faction: fac?.name ?? game.i18n.localize("PROJECTANIME.HQ.anyFaction")
        });
      } else if (condType === "hqLevel") condLabel = game.i18n.format("PROJECTANIME.Covenant.condHqLevel", { level: condLevel });
      else if (condType === "manual") condLabel = e.condition?.label || game.i18n.localize("PROJECTANIME.Covenant.condManual");
      else condLabel = game.i18n.localize("PROJECTANIME.Covenant.condAuto");
      return {
        id: e.id,
        npcUuid: e.npcUuid,
        name: e.name,
        img: e.img || "icons/svg/mystery-man.svg",
        initial: initialOf(e.name),
        role: e.role,
        roleLabel: game.i18n.localize(`PROJECTANIME.Covenant.role.${e.role}`),
        roleIcon: ROLE_ICONS[e.role] || "fa-user",
        roleOptions: roleOptionsFor(e.role),
        condType,
        condTypeOptions: RECRUIT_COND_TYPES.map((k) => ({ key: k, label: game.i18n.localize(`PROJECTANIME.Covenant.cond.${k}`), sel: k === condType })),
        condFactionId,
        factionOptions: factionOpts.map((o) => ({ id: o.id, name: o.name, sel: o.id === condFactionId })),
        condTier,
        tierOptions: STANDING_TIERS.map((t) => ({ key: t.key, label: game.i18n.localize(`PROJECTANIME.Covenant.tier.${t.key}`), sel: t.key === condTier })),
        condLabelRaw: e.condition?.label ?? "",
        condLabel,
        condLevel,
        isRepTier: condType === "repTier",
        isHqLevel: condType === "hqLevel",
        isManual: condType === "manual",
        available,
        locked: !available,
        isOpen: this.#openHqDrawer === e.id
      };
    });

    // Roster — EVERYONE recruited (fighters, facility staff, and dispatch agents). A `party`-role
    // recruit is also filed into the party folder, but the party sheet shows only Characters, so the
    // Roster is the single place every recruit surfaces. Dispatch agents show their away/wounded status
    // + a GM Recall here (they're people now, not facility cards).
    const TAL = CONFIG.PROJECTANIME;
    // Mission picks for the Roster-card "Send on mission" shortcut — id + title only (the live odds
    // preview stays on the Missions tab; from the Roster you just drop one idle agent onto a job).
    const rosterMissionOpts = (hq.missions ?? []).map((m) => ({ id: m.id, title: m.title || game.i18n.localize("PROJECTANIME.HQ.missionUntitled") }));
    const roster = hq.people.filter((e) => e.recruited).map((e) => {
      // Pull the member's Talents + Unique Trait off their backing NPC actor for the book detail.
      const npc = e.npcUuid ? fromUuidSync(e.npcUuid) : null;
      const tals = npc?.system?.talents ?? null;
      const talents = tals ? TAL.talentKeys.map((k) => ({ key: k, label: game.i18n.localize(TAL.talents[k]), icon: TAL.talentIcons[k], die: `d${tals[k]?.base ?? 4}` })) : [];
      const trait = npc?.system?.trait ?? null;
      // The facility this person is posted to (Phase-2 staffing), if any — surfaced on the roster book.
      const postedFac = e.facilityId ? hq.facilities.find((f) => f.id === e.facilityId) : null;
      // An idle dispatch agent (recruited already filtered) can be sent on a mission from their card —
      // same gate as the Missions-tab squad picker: a dispatch vocation, not away/wounded, not posted.
      const idleDispatch = e.role === "dispatch" && !e.status && !e.facilityId;
      return {
        id: e.id,
        npcUuid: e.npcUuid,
        name: e.name,
        img: e.img || "icons/svg/mystery-man.svg",
        initial: initialOf(e.name),
        roleLabel: game.i18n.localize(`PROJECTANIME.Covenant.role.${e.role}`),
        roleIcon: ROLE_ICONS[e.role] || "fa-user",
        posted: !!postedFac,
        postedTo: postedFac?.name || game.i18n.localize("PROJECTANIME.HQ.facility"),
        effect: e.effect || "",
        talents,
        hasTalents: talents.length > 0,
        traitName: trait?.name || "",
        traitDesc: trait?.desc || "",
        away: e.status === "away",
        wounded: e.status === "wounded",
        statusLabel: e.status === "away"
          ? game.i18n.format("PROJECTANIME.HQ.awayUntil", { turn: e.returnsTurn || 0 })
          : e.status === "wounded"
            ? game.i18n.format("PROJECTANIME.HQ.woundedUntil", { turn: e.woundedUntil || 0 })
            : "",
        strikes: e.deathStrikes || 0,
        strikePips: [1, 2, 3].map((n) => ({ on: n <= (e.deathStrikes || 0) })),
        atRisk: (e.deathStrikes || 0) >= 2,
        canDispatch: idleDispatch && rosterMissionOpts.length > 0,
        missionOptions: idleDispatch ? rosterMissionOpts : [],
        isOpen: this.#openHqDrawer === e.id
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Facilities — each standing building, mapped to a READ-ONLY card view-model. All facility authoring,
    // building, staffing, and per-turn yield/cost config live in the standalone Structures window
    // (apps/structures.mjs); a Codex card just shows the built result and opens Structures on click.
    const allFacilities = hq.facilities.map((e) => {
      const tier = Math.min(3, Math.max(0, Number(e.facilityTier) || 0));
      // Residents staffing this building (Phase-2 multi-staff) — portrait dots on the card. Capacity = tier.
      const staffCap = Math.min(3, tier);
      const staff = (e.staffIds ?? [])
        .map((pid) => hq.people.find((p) => p.id === pid && p.recruited))
        .filter(Boolean)
        .map((p) => ({ npcUuid: p.npcUuid, img: p.img || "icons/svg/mystery-man.svg", initial: initialOf(p.name), away: p.status === "away" }));
      const staffEmpty = Array.from({ length: Math.max(0, staffCap - staff.length) }, () => ({}));
      // Phase-3 gather preview for the card: present residents' `gather` trait-output ∩ this facility's accepts.
      const acceptsSet = new Set(Array.isArray(e.accepts) ? e.accepts : []);
      const gatherTotals = {};
      if (acceptsSet.size) {
        for (const s of staff) {
          if (s.away || !s.npcUuid) continue;
          const npc = fromUuidSync(s.npcUuid);
          if (npc) for (const [k, v] of Object.entries(collectGather(npc))) if (acceptsSet.has(k) && v > 0) gatherTotals[k] = (gatherTotals[k] || 0) + v;
        }
      }
      const yieldGold = Math.max(0, Math.round(Number(e.yieldGold) || 0));
      const yieldSP = Math.max(0, Math.round(Number(e.yieldSP) || 0));
      const yieldItemNames = (e.yieldItems ?? []).map((o) => o?.name ?? "—");
      const serviceKind = e.serviceKind || "";
      // Any facility may carry a projected effect = the full Effect-Builder rule list (tier-scaled
      // summary), plus any legacy attribute-only boonChanges. Authored via the Effect Builder (editBoon).
      const boonParts = [
        ...(e.boonRules ?? []).map((r) => normalizeRule(r)).filter(Boolean).map((r) => summarizeRule(scaleRuleByTier(r, tier))).filter(Boolean),
        ...(e.boonChanges ?? []).filter((c) => BOON_ATTRS.includes(c.attr) && Number(c.value))
          .map((c) => { const v = Math.round(Number(c.value)) * tier; return `${v > 0 ? "+" : ""}${v} ${game.i18n.localize(`PROJECTANIME.Attribute.${c.attr}.long`)}`; })
      ];
      // Read-only "produces each turn" summary (tier-scaled, mirrors advanceHQTurn).
      // An unbuilt (tier-0) facility produces nothing yet — leave its "produces each turn" line empty.
      const pp = [];
      if (tier > 0) {
        if (yieldGold) pp.push(`${yieldGold * tier} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
        if (yieldSP) pp.push(`${yieldSP * tier} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
        if (yieldItemNames.length) pp.push(yieldItemNames.join(", "));
        for (const [k, v] of Object.entries(gatherTotals)) pp.push(`${v} ${materialCategoryLabel(k)}`);
        if (e.role === "service" && serviceKind) pp.push(game.i18n.localize(`PROJECTANIME.HQ.serviceKind.${serviceKind}`));
      }
      return {
        id: e.id,
        name: e.name,
        roleLabel: game.i18n.localize(`PROJECTANIME.Covenant.role.${e.role}`),
        facilityIcon: e.role === "service" ? "fa-heart-pulse" : e.role === "vendor" ? "fa-store" : e.role === "passive" ? "fa-hand-sparkles" : e.role === "upgrade" ? "fa-arrow-up-right-dots" : e.role === "workshop" ? "fa-screwdriver-wrench" : "fa-chess-rook",
        isVendor: e.role === "vendor",
        isWorkshop: e.role === "workshop",
        tier,
        tierPips: [1, 2, 3].map((n) => ({ n, on: n <= tier })),
        staff,
        staffEmpty,
        staffCount: staff.length,
        staffCap,
        hasBoon: boonParts.length > 0,
        boonSummary: boonParts.join(", "),
        produces: pp.length > 0,
        producesSummary: pp.join(" · ")
      };
    });
    // The Facilities tab shows only ACTIVE buildings (tier ≥ 1). Unbuilt Structures (tier 0) and all
    // facility authoring/building live in the standalone Structures window (apps/structures.mjs).
    const facilities = allFacilities.filter((f) => f.tier >= 1);

    // Dispatch missions — the job board. Idle dispatch agents become the squad-picker CARDS (portrait +
    // their die for the mission's stat); the GM taps cards to assemble a squad whose combined odds (the
    // Sum rule) preview live above. Agents already out show as "away" chips. Tier = clickable pips.
    // A person posted to a facility (Phase-2 staffing) is on duty there, so they're not also dispatchable.
    const idle = hq.people.filter((e) => e.recruited && e.role === "dispatch" && !e.status && !e.facilityId);
    const missions = (hq.missions ?? []).map((m) => {
      const tier = Math.min(5, Math.max(1, Number(m.tier) || 1));
      const dc = Math.max(1, Math.round(Number(m.difficulty) || 1));
      const picking = this.#squadPickMission === m.id;
      const candidates = idle.map((e) => {
        const npc = e.npcUuid ? fromUuidSync(e.npcUuid) : null;
        const d = statDieFor(npc, m.stat);
        const bonus = statBonusFor(npc, m.stat);
        const haste = hqHasteBonus(npc); // HQ turns this agent would shave off the run (hq.haste Trait/effect)
        return {
          id: e.id,
          name: e.name,
          img: e.img || npc?.img || "",
          initial: initialOf(e.name),
          faces: d.faces,
          die: `d${d.faces}`,
          bonus,
          bonusStr: bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "",
          haste,
          selected: picking && this.#squadPick.has(e.id)
        };
      });
      const chosen = candidates.filter((c) => c.selected);
      const picked = chosen.map((c) => ({ faces: c.faces, bonus: c.bonus }));
      // Effective return time for the currently-assembled squad — base duration minus the squad's
      // combined Mission-haste (floored at 1). Drives the "Returns in N turns" readout in the picker.
      const pickedHaste = chosen.reduce((s, c) => s + Math.max(0, c.haste || 0), 0);
      const squadReadyTurns = Math.max(1, (Math.max(1, Number(m.durationTurns) || 1)) - pickedHaste);
      const away = hq.people.filter((e) => e.status === "away" && e.assignedMissionId === m.id);
      const agentsOut = away.map((e) => ({ name: e.name, initial: initialOf(e.name), img: e.img || "", returnsTurn: e.returnsTurn || 0 }));
      const rewardItems = (m.rewardItems ?? []).map((o, idx) => ({ idx, name: o?.name ?? "—", img: o?.img ?? "icons/svg/item-bag.svg" }));
      const rp = [];
      if (m.rewardGold) rp.push(`${m.rewardGold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
      if (m.rewardSP) rp.push(`${m.rewardSP} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
      if (rewardItems.length) rp.push(rewardItems.map((i) => i.name).join(", "));
      return {
        id: m.id,
        title: m.title,
        img: m.img || "",
        isOpen: this.#openHqDrawer === m.id,
        tier,
        tierStars: [1, 2, 3, 4, 5].map((n) => ({ on: n <= tier })),
        tierPips: [1, 2, 3, 4, 5].map((n) => ({ n, on: n <= tier })),
        durationTurns: m.durationTurns,
        squadReadyTurns,
        difficulty: dc,
        statLabel: statLabelFor(m.stat),
        statEmblem: missionStatIcon(m.stat),
        statTalentOpts: missionStatOptions(m.stat),
        candidates,
        hasCandidates: candidates.length > 0,
        squadN: picked.length,
        squadPct: picked.length ? teamSuccessPct(picked, dc) : 0,
        hasPick: picked.length > 0,
        rewardGold: m.rewardGold,
        rewardSP: m.rewardSP,
        rewardItems,
        rewardSummary: rp.join(" · "),
        hasReward: rp.length > 0,
        agentsOut,
        hasAgentsOut: agentsOut.length > 0
      };
    });

    // Civ-style resource stockpile — one chip per GM-configured Resource Type (helpers/materials.mjs),
    // shown even at 0 so the full set is always visible. The GM edits amounts inline; players read-only.
    const resources = resTypes.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      iconImg: isImageIcon(c.icon),
      amount: Math.max(0, Math.round(Number(hq.resources?.[c.key]) || 0))
    }));

    return {
      isGM,
      // Which sub-tab is showing, rendered straight into the template (`.active`) so a scoped re-render
      // is born on the right tab; #applyHqTabs handles the instant, no-re-render switch on click. The
      // per-entity DETAIL books still carry their own `isOpen` (added to each item above) +
      // #applyHqDrawers for the overlay open/close.
      hqTabIs: {
        roster: this.#hqTab === "roster",
        recruitment: this.#hqTab === "recruitment",
        facilities: this.#hqTab === "facilities",
        missions: this.#hqTab === "missions"
      },
      turn: hq.turn,
      identity: {
        name: hq.name,
        crest: hq.crest,
        initial: hq.name ? initialOf(hq.name) : "",
        accent: hq.accent,
        motto: hq.motto,
        hasBanner: !!hq.banner,
        bannerStyle: hq.banner
          ? `background-image:url('${hq.banner}'); background-position:${hq.bannerPos.x}% ${hq.bannerPos.y}%`
          : `background:${factionHeroGrad(hq.accent)}`
      },
      recruits,
      hasRecruits: recruits.length > 0,
      roster,
      hasRoster: roster.length > 0,
      facilities,
      facilityCount: facilities.length,
      level: hqLevel(hq),
      hasFacilities: facilities.length > 0,
      missions,
      hasMissions: missions.length > 0,
      resources,
      hasResources: resources.length > 0
    };
  }

  /** Skip exactly one render — see #skipRenderOnce — so a quiet HQ save doesn't flicker the open drawer. */
  render(...args) {
    if (this.#skipRenderOnce) { this.#skipRenderOnce = false; return this; }
    return super.render(...args);
  }

  /** A signature of exactly what the Home pane draws from the HQ object: every field EXCEPT the per-
   *  facility Workshop `recipes` / Shop `stock` collections and the craft queue (those surface only in
   *  the satellite windows, never the Home tab). So authoring a recipe or restocking a vendor — which
   *  changes the HQ object — leaves this digest untouched and the tab doesn't flash. */
  #hqViewDigest() {
    const hq = getHQ();
    const facilities = (hq.facilities ?? []).map((f) => { const { recipes, stock, ...rest } = f; return rest; });
    return JSON.stringify({ ...hq, facilities, crafting: undefined });
  }

  /** The HQ world object changed — refresh the Home pane, but only if what it shows actually changed.
   *  The single seamless-refresh entry point the setting's onChange calls (see project-anime.mjs).
   *  When we DON'T render, consume any pending one-shot skip (a quiet edit armed it expecting to eat this
   *  onChange's render): otherwise a quiet edit whose digest matches the last-rendered sig — e.g. a value
   *  typed then reverted — would leak the flag and silently swallow the next legitimate render. */
  notifyHQChanged() {
    if (!game.settings.get("project-anime", PARTY_FACTIONS_SETTING) || this.#hqViewDigest() === this.#hqSig) {
      this.#skipRenderOnce = false; // nothing to render → don't let an armed skip linger
      return;
    }
    this.render({ parts: ["hq"] });
  }

  /** A signature of what THIS viewer's Archive pane draws: the categories plus the entries they can see
   *  (the GM sees all; a player only the revealed ones). Folding in `isGM` + filtering to revealed means a
   *  GM-only edit to a hidden entry leaves a player's digest untouched, while a reveal toggle flips it. */
  #archiveViewDigest() {
    const isGM = this.isGM;
    const arc = getArchive();
    const entries = isGM ? arc.entries : arc.entries.filter((e) => e.revealed);
    return JSON.stringify({ isGM, categories: arc.categories, entries });
  }

  /** The Archive world object changed — refresh the Archive pane, but only if what this viewer sees moved.
   *  The seamless-refresh entry point the ARCHIVE setting's onChange calls (see project-anime.mjs). */
  notifyArchiveChanged() {
    if (this.#archiveViewDigest() === this.#archiveSig) { this.#skipRenderOnce = false; return; } // no render → don't leak an armed skip
    this.render({ parts: ["archive"] });
  }

  /** Mutate the party HQ and persist (GM only). Saving re-renders the Codex via the setting's onChange;
   *  pass { quiet: true } to suppress THIS instance's re-render (the caller has already patched the DOM). */
  async #mutateHQ(fn, { quiet = false } = {}) {
    if (!game.user.isGM) return;
    const hq = getHQ();
    const before = JSON.stringify(hq);
    fn(hq);
    // No-op guard: a quiet mutation that changes nothing (e.g. duration − at the floor of 1, or
    // re-clicking the current tier pip) would `set` an identical value, which fires NO onChange — so
    // the skip-flag would leak and silently eat the NEXT render (the one that should show, say, a
    // freshly-picked mission image). Only arm the flag when there's a real change to persist.
    if (JSON.stringify(hq) === before) return;
    if (quiet) this.#skipRenderOnce = true;
    await saveHQ(hq);
  }

  /** Find a recruit-pool/Roster PERSON or a FACILITY by id (ids are unique across both lists). */
  #findRec(hq, id) {
    return hq.people.find((e) => e.id === id) ?? hq.facilities.find((e) => e.id === id) ?? null;
  }

  /** Open a Home entity's detail/authoring DRAWER. The clicked card carries its id in data-recruit-id
   *  / data-mission-id, or data-hq-drawer="recruitment" for the candidate pool. Pure DOM (re-applied
   *  on render via #applyHqDrawers, so an edit inside the drawer keeps it open). */
  static #onOpenHqDrawer(event, target) {
    this.#openHqDrawer = target.dataset.recruitId ?? target.dataset.missionId ?? target.dataset.hqDrawer ?? null;
    this.#applyHqDrawers();
  }

  /** Close any open Home drawer (backdrop / close button). */
  static #onCloseHqDrawer() {
    this.#openHqDrawer = null;
    this.#applyHqDrawers();
  }

  /** Reflect #openHqDrawer on the live DOM so the slide transition plays without a full re-render. */
  #applyHqDrawers() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="hq"]');
    if (!pane) return;
    for (const el of pane.querySelectorAll(".section-drawer")) el.classList.toggle("open", el.dataset.drawer === this.#openHqDrawer);
  }

  /** Switch Home sub-tabs (Roster / Recruitment / Facilities / Missions) via CSS — instant, no re-render
   *  (mirrors the top-level #onSelectTab). The clicked list stays inline; the per-card books still overlay. */
  static #onSelectHqTab(event, target) {
    const tab = target.dataset.hqtab;
    if (!tab || tab === this.#hqTab) return;
    this.#hqTab = tab;
    this.#applyHqTabs();
  }

  /** Reflect #hqTab on the live DOM (active pane + active tab button), so a click swaps lists with no
   *  re-render and a scoped re-render reconciles to the current tab. */
  #applyHqTabs() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="hq"]');
    if (!pane) return;
    for (const p of pane.querySelectorAll(".hq-tabpane")) p.classList.toggle("active", p.dataset.hqtab === this.#hqTab);
    for (const b of pane.querySelectorAll(".hq-tab")) b.classList.toggle("active", b.dataset.hqtab === this.#hqTab);
  }

  /** Drawer inline "delete" → remove the person/facility (confirms; cascades person↔facility). */
  static #onRemoveRecruitAction(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) this.#removeRecruit(id);
  }

  /** Drawer inline "open sheet" → open the recruit/facility's backing NPC sheet. */
  static #onOpenRecruitActorAction(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) this.#openRecruitActor(id);
  }

  /** Mutate one world faction and persist (GM only). Saving re-renders the Codex via the setting;
   *  pass { quiet: true } to suppress THIS instance's re-render (the caller has already patched the DOM).
   *  Same no-op guard as #mutateHQ: an unchanged save fires no onChange, so the skip-flag must not arm. */
  async #mutateFaction(id, fn, { quiet = false } = {}) {
    if (!game.user.isGM) return;
    const factions = getFactions();
    const f = factions.find((x) => x.id === id);
    if (!f) return;
    const before = JSON.stringify(f);
    fn(f);
    if (JSON.stringify(f) === before) return;
    if (quiet) this.#skipRenderOnce = true;
    await saveFactions(factions);
  }

  /** Commit an inline faction edit (a field or a perk). Inputs carry data-* (never `name`). GM only. */
  async #onFactionFieldChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.fid;
    if (!id) return;
    const val = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.fperk !== undefined) {
      return this.#mutateFaction(id, (f) => {
        const p = (f.perks ?? []).find((x) => x.tier === el.dataset.fperk);
        if (p) p.text = val;
      });
    }
    const field = el.dataset.ffield;
    if (field === "standing") return setFactionStanding(id, val);
    if (field) return this.#mutateFaction(id, (f) => { f[field] = val; }); // name / motto / lore / accent
  }

  /** Bind the Factions-pane inline-edit listeners + tier-reward drop zones (GM only). */
  #bindFactionEdits() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="factions"]');
    if (!pane) return;
    for (const el of pane.querySelectorAll("[data-ffield], [data-fperk]")) {
      el.addEventListener("change", this.#onFactionFieldChange.bind(this));
    }
    for (const el of pane.querySelectorAll("[data-freward-field]")) {
      el.addEventListener("change", this.#onFactionRewardChange.bind(this));
    }
    for (const zone of pane.querySelectorAll("[data-faction-reward-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.remove("drag-over");
        this.#onFactionRewardDrop(ev, zone.dataset.fid, zone.dataset.factionRewardDrop);
      });
    }
  }

  /** Commit a tier-reward gold/SP edit (GM only). data-* only → never collected by any form. */
  async #onFactionRewardChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.fid;
    const tier = el.dataset.frewardRank;
    const fieldName = el.dataset.frewardField;
    if (!id || !tier || !fieldName) return;
    const num = Math.max(0, Math.round(Number(el.value) || 0));
    return this.#mutateFaction(id, (f) => {
      const p = (f.perks ?? []).find((x) => x.tier === tier);
      if (p) p[fieldName] = num;
    });
  }

  /** Drop an Item onto a tier's reward slot → store a self-contained snapshot as that tier's reward. */
  async #onFactionRewardDrop(event, id, tier) {
    if (!game.user.isGM || !id || !tier) return;
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    return this.#mutateFaction(id, (f) => {
      const p = (f.perks ?? []).find((x) => x.tier === tier);
      if (p) (p.rewardItems ??= []).push(snap);
    });
  }

  static async #onRemoveFactionRewardItem(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-fid]")?.dataset.fid;
    const tier = target.dataset.frewardRank;
    const idx = Number(target.dataset.rewardItem);
    await this.#mutateFaction(id, (f) => {
      const p = (f.perks ?? []).find((x) => x.tier === tier);
      if (p && Array.isArray(p.rewardItems)) p.rewardItems.splice(idx, 1);
    });
  }

  static async #onNewFaction() {
    if (!game.user.isGM) return;
    const factions = getFactions();
    factions.unshift(blankFaction());
    await saveFactions(factions);
  }

  /** Open a faction's detail BOOK (an overlay drawer). Pure DOM (re-applied on render via
   *  #applyFactionDrawers, so an edit inside the book keeps it open). Clicking the card body opens it. */
  static #onOpenFactionDrawer(event, target) {
    this.#openFactionDrawer = target.dataset.fid ?? target.closest("[data-fid]")?.dataset.fid ?? null;
    this.#applyFactionDrawers();
  }

  /** Close the open faction book (backdrop / close button). */
  static #onCloseFactionDrawer() {
    this.#openFactionDrawer = null;
    this.#applyFactionDrawers();
  }

  /** Reflect #openFactionDrawer on the live DOM so the book fades in without a full re-render. */
  #applyFactionDrawers() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="factions"]');
    if (!pane) return;
    for (const el of pane.querySelectorAll(".section-drawer")) el.classList.toggle("open", el.dataset.drawer === this.#openFactionDrawer);
  }

  /* --------------------------- relationship web --------------------------- */

  /** Wire the interactive relationship WEB. Hover-highlight and click-to-open-the-book are bound for
   *  EVERYONE; node drag-to-reposition, "Link" mode, and edge-cycling are GM-only. Re-bound each
   *  factions render against fresh DOM, so no listeners stack. */
  #bindFactionWeb() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="factions"]');
    const stage = pane?.querySelector(".fweb-stage");
    if (!stage) return;
    for (const node of stage.querySelectorAll(".fweb-node")) {
      node.addEventListener("pointerenter", () => this.#highlightWeb(pane, node.dataset.fid, true));
      node.addEventListener("pointerleave", () => this.#highlightWeb(pane, node.dataset.fid, false));
      node.addEventListener("click", (ev) => this.#onWebNodeClick(ev, node, pane));
      if (this.isGM) node.addEventListener("pointerdown", (ev) => {
        if (this.#factionLinkMode) return; // in Link mode a node press is a pick, not a drag
        this.#startNodeDrag(ev, node, stage);
      });
    }
    if (this.isGM) for (const g of stage.querySelectorAll(".fweb-edge")) {
      g.querySelector(".hit")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.#cycleFactionRelation(g.dataset.a, g.dataset.b);
      });
    }
    // Right-drag anywhere on the stage pans the web (everyone). Suppress the context menu so the
    // right-drag doesn't pop one; a plain right-click (no drag) is harmless.
    stage.addEventListener("contextmenu", (ev) => ev.preventDefault());
    stage.addEventListener("pointerdown", (ev) => { if (ev.button === 2) this.#startWebPan(ev, stage); });
    this.#applyWebPan();
    this.#applyLinkMode();
  }

  /** Apply the current pan offset to the web canvas (re-asserted after every factions re-render). */
  #applyWebPan() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="factions"]');
    const canvas = pane?.querySelector(".fweb-canvas");
    if (canvas) canvas.style.transform = `translate(${this.#webPan.x}px, ${this.#webPan.y}px)`;
  }

  /** Right-drag the stage to pan the web (everyone). The offset is clamped to ~half the stage in each
   *  axis so the web can be moved about but never lost off-screen. Transient (per window). */
  #startWebPan(ev, stage) {
    ev.preventDefault();
    const rect = stage.getBoundingClientRect();
    const maxX = rect.width * 0.5, maxY = rect.height * 0.5;
    const start = { x: ev.clientX, y: ev.clientY };
    const origin = { ...this.#webPan };
    stage.classList.add("panning");
    const move = (e) => {
      this.#webPan = {
        x: Math.max(-maxX, Math.min(maxX, origin.x + (e.clientX - start.x))),
        y: Math.max(-maxY, Math.min(maxY, origin.y + (e.clientY - start.y)))
      };
      this.#applyWebPan();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      stage.classList.remove("panning");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Spotlight a node and its ties: mark the node, its incident edges, and its neighbours `.hot`, and
   *  put the stage in `.focusing` so the CSS dims everything else. `on=false` clears it. */
  #highlightWeb(pane, fid, on) {
    const stage = pane?.querySelector(".fweb-stage");
    if (!stage) return;
    stage.classList.toggle("focusing", on);
    const neighbours = new Set();
    for (const g of stage.querySelectorAll(".fweb-edge")) {
      const inc = g.dataset.a === fid || g.dataset.b === fid;
      g.classList.toggle("hot", on && inc);
      if (on && inc) neighbours.add(g.dataset.a === fid ? g.dataset.b : g.dataset.a);
    }
    for (const node of stage.querySelectorAll(".fweb-node")) {
      const id = node.dataset.fid;
      node.classList.toggle("hot", on && (id === fid || neighbours.has(id)));
    }
  }

  /** A node click: open its book (everyone), unless it's the tail of a drag (suppressed) or the GM is
   *  in Link mode (then it picks/links a pair instead). */
  #onWebNodeClick(ev, node, pane) {
    const fid = node.dataset.fid;
    if (this.#suppressNodeClick === fid) { this.#suppressNodeClick = null; return; }
    if (this.isGM && this.#factionLinkMode) { ev.preventDefault(); this.#linkPick(fid, pane); return; }
    this.#openFactionDrawer = fid;
    this.#applyFactionDrawers();
  }

  /** Link mode: first click selects a node, a second (different) node cycles the pair's tie, the same
   *  node again deselects. */
  #linkPick(fid, pane) {
    const stage = pane?.querySelector(".fweb-stage");
    const mark = (id, on) => stage?.querySelector(`.fweb-node[data-fid="${id}"]`)?.classList.toggle("sel", on);
    if (this.#linkSel === fid) { mark(fid, false); this.#linkSel = null; return; }
    if (this.#linkSel) {
      const a = this.#linkSel;
      mark(a, false);
      this.#linkSel = null;
      this.#cycleFactionRelation(a, fid); // saves → re-render rebuilds the web with the new edge
      return;
    }
    this.#linkSel = fid;
    mark(fid, true);
  }

  /** Cycle the symmetric tie between two factions neutral → ally → rival → neutral (GM only). Saving
   *  re-renders the factions pane (setting onChange), which rebuilds the web with the changed edge. */
  async #cycleFactionRelation(aId, bId) {
    if (!this.isGM || !aId || !bId || aId === bId) return;
    const a = factionById(aId);
    const cur = (a?.relations ?? []).find((r) => r.factionId === bId)?.stance || "";
    const next = cur === "" ? "ally" : cur === "ally" ? "rival" : "";
    await setFactionRelation(aId, bId, next);
  }

  /** Drag a faction node to reposition it on the stage (GM only), moving its incident edge endpoints
   *  live; on release the position is persisted as a normalized `webPos`. Movement under a small
   *  threshold isn't a drag, so a plain click still opens the book. */
  #startNodeDrag(ev, node, stage) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const fid = node.dataset.fid;
    const rect = stage.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY };
    const edges = [...stage.querySelectorAll(`.fweb-edge[data-a="${fid}"], .fweb-edge[data-b="${fid}"]`)];
    let moved = false;
    let pos = { x: parseFloat(node.style.left) || 0, y: parseFloat(node.style.top) || 0 };
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true;
      node.classList.add("dragging");
      // Map the cursor into the canvas's own space — subtract the pan offset, since the canvas (which
      // the node's % coords are relative to) is translated by it.
      pos = {
        x: Math.max(5, Math.min(95, ((e.clientX - rect.left - this.#webPan.x) / rect.width) * 100)),
        y: Math.max(5, Math.min(95, ((e.clientY - rect.top - this.#webPan.y) / rect.height) * 100))
      };
      node.style.left = `${pos.x}%`;
      node.style.top = `${pos.y}%`;
      for (const g of edges) {
        const isA = g.dataset.a === fid;
        for (const ln of g.querySelectorAll("line")) {
          ln.setAttribute(isA ? "x1" : "x2", pos.x);
          ln.setAttribute(isA ? "y1" : "y2", pos.y);
        }
      }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      node.classList.remove("dragging");
      if (!moved) return;
      this.#suppressNodeClick = fid;       // swallow the click that fires right after a drag
      // DOM already shows the final spot — quiet save (arms skip-flag only if webPos actually moved).
      await this.#mutateFaction(fid, (f) => { f.webPos = { x: pos.x / 100, y: pos.y / 100 }; }, { quiet: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Toggle the GM "Link" authoring mode (click two factions to set their tie). */
  static #onToggleFactionLink() {
    if (!this.isGM) return;
    this.#factionLinkMode = !this.#factionLinkMode;
    this.#linkSel = null;
    this.#applyLinkMode();
  }

  /** Reflect Link mode on the live DOM (button + hint + stage cursor), and clear any pick when off. */
  #applyLinkMode() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="factions"]');
    if (!pane) return;
    const on = this.isGM && this.#factionLinkMode;
    pane.querySelector(".fweb-wrap")?.classList.toggle("linking", on);
    pane.querySelector(".fweb-link-btn")?.classList.toggle("active", on);
    if (!on) {
      this.#linkSel = null;
      for (const sel of pane.querySelectorAll(".fweb-node.sel")) sel.classList.remove("sel");
    }
  }

  static async #onDeleteFaction(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-fid]")?.dataset.fid;
    const factions = getFactions();
    const f = factions.find((x) => x.id === id);
    if (!f) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Covenant.deleteFactionTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Covenant.deleteConfirm", { name: f.name })}</p>`
    }).catch(() => false);
    if (!ok) return;
    if (this.#openFactionDrawer === id) this.#openFactionDrawer = null;
    // Cascade: strip this faction from every other faction's relationship web before saving.
    const remaining = factions.filter((x) => x.id !== id).map((x) => {
      x.relations = (x.relations ?? []).filter((r) => r.factionId !== id);
      return x;
    });
    await saveFactions(remaining);
  }

  static async #onFactionRepUp(event, target) {
    const id = target.closest("[data-fid]")?.dataset.fid;
    const f = factionById(id);
    if (f) await setFactionStanding(id, clampStanding(f.standing) + 5);
  }

  static async #onFactionRepDown(event, target) {
    const id = target.closest("[data-fid]")?.dataset.fid;
    const f = factionById(id);
    if (f) await setFactionStanding(id, clampStanding(f.standing) - 5);
  }


  static async #onPickFactionBanner(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-fid]")?.dataset.fid;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getFactions().find((x) => x.id === id)?.banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateFaction(id, (f) => { f.banner = path; }) }).browse();
  }

  static async #onPickFactionCrest(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-fid]")?.dataset.fid;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getFactions().find((x) => x.id === id)?.crest ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateFaction(id, (f) => { f.crest = path; }) }).browse();
  }

  /* =============================== HOME / HQ =============================== */

  /** Bind the Home pane (GM only): HQ identity fields, recruit-card config inputs, and the recruit
   *  drop zone. data-* only → never collected by a form. */
  #bindHqEdits() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="hq"]');
    if (!pane) return;
    // The hero banner is interactive: a plain click opens the image FilePicker; a drag repositions
    // its focal point (only when a banner image exists — gated by the `.repos` class in the handler).
    const hero = pane.querySelector(".hq-hero");
    if (hero) hero.addEventListener("pointerdown", (ev) => this.#startHqBannerDrag(ev, hero));
    for (const el of pane.querySelectorAll("[data-hq-field]")) {
      el.addEventListener("change", this.#onHqFieldChange.bind(this));
    }
    for (const el of pane.querySelectorAll("[data-resource-field]")) {
      el.addEventListener("change", this.#onResourceField.bind(this));
    }
    for (const el of pane.querySelectorAll("[data-recruit-field]")) {
      el.addEventListener("change", this.#onRecruitFieldChange.bind(this));
    }
    for (const zone of pane.querySelectorAll("[data-recruit-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.remove("drag-over");
        this.#onRecruitDrop(ev);
      });
    }
    // Mission authoring: field edits + per-mission reward-item drop zones.
    for (const el of pane.querySelectorAll("[data-mission-field]")) {
      el.addEventListener("change", this.#onMissionField.bind(this));
    }
    // Dispatch squad picker: tapping a candidate card toggles it into the squad (DOM-only — no persist;
    // the squad odds meter recomputes live). The "Send squad" button commits the selection.
    for (const card of pane.querySelectorAll(".m-cand[data-agent-id]")) {
      card.addEventListener("click", (ev) => { ev.preventDefault(); this.#onToggleCandidate(card); });
    }
    for (const zone of pane.querySelectorAll("[data-mission-reward-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onMissionRewardDrop(ev, zone.dataset.missionRewardDrop); });
    }
    // GM right-click a recruit POOL card → context menu (recruit / unlock / open sheet / delete). The
    // recruited member cards (roster + facilities) are bound separately for EVERYONE (#bindHqMemberMenus).
    for (const card of pane.querySelectorAll(".rcard[data-recruit-id]")) {
      card.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest("input, textarea, select")) return;
        ev.preventDefault();
        this.#openRecruitContext(card.dataset.recruitId, ev, "pool");
      });
    }
  }

  /** Right-click a recruited member card (roster or facility) → context menu, bound for EVERYONE so a
   *  player can open the member's sheet. A right-click inside a text field keeps its native paste menu. */
  #bindHqMemberMenus() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="hq"]');
    if (!pane) return;
    for (const card of pane.querySelectorAll(".hq-card[data-recruit-id], .hq-tcard[data-recruit-id]")) {
      const kind = card.classList.contains("hq-card") ? "facility" : "member"; // facility (building) vs roster (NPC)
      card.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest("input, textarea")) return;
        ev.preventDefault();
        this.#openRecruitContext(card.dataset.recruitId, ev, kind);
      });
    }
  }

  /** Right-click context menu on a Home card, reusing the quest-rail #contextMenu. `kind` is "pool"
   *  (GM-only recruit flip-card: Edit / Recruit / Unlock / Delete) or "member" (a recruited roster/
   *  facility card: Open Sheet for everyone, + Delete for the GM). */
  #openRecruitContext(id, ev, kind) {
    if ((kind === "pool" || kind === "facility") && !this.isGM) return; // players: no pool / facility actions
    const entry = this.#findRec(getHQ(), id);
    if (!entry) return;
    const { add, show } = this.#contextMenu(ev);
    if (kind === "pool") {
      if (recruitAvailable(entry)) add("fa-user-check", "PROJECTANIME.Covenant.recruitBtn", () => recruitMember(id));
      else if (entry.condition?.type === "manual") add("fa-lock-open", "PROJECTANIME.Covenant.unlockBtn", () => this.#unlockRecruit(id));
      if (entry.npcUuid) add("fa-up-right-from-square", "PROJECTANIME.Covenant.openSheet", () => this.#openRecruitActor(id));
    } else if (kind === "facility") {
      // The building's full editor is the Structures window — make "Edit Building" the primary right-click
      // action (the card's left-click opens it too). Vendors/workshops also get a direct Visit shortcut;
      // a building isn't an NPC, so there's no Open Sheet.
      add("fa-helmet-safety", "PROJECTANIME.HQ.manageFacility", () => StructuresWindow.open(id));
      if (entry.role === "vendor") add("fa-store", "PROJECTANIME.Shop.visit", () => ShopWindow.open(id));
      if (entry.role === "workshop") add("fa-screwdriver-wrench", "PROJECTANIME.Workshop.visit", () => WorkshopWindow.open(id));
      if (entry.role === "vendor" || entry.role === "workshop") {
        // Vendors (stock) and workshops (recipes) can export/import their content to share between worlds.
        add("fa-file-import", "PROJECTANIME.Share.import", () => importFacility(id));
        add("fa-file-export", "PROJECTANIME.Share.export", () => exportFacility(id));
      }
      add("fa-wand-magic-sparkles", "PROJECTANIME.HQ.editBoon", () => this.#openBoonBuilder(id)); // a building isn't an NPC — no Open Sheet
    } else {
      add("fa-up-right-from-square", "PROJECTANIME.Covenant.openSheet", () => this.#openRecruitActor(id));
    }
    if (this.isGM) add("fa-trash", "PROJECTANIME.Covenant.delete", () => this.#removeRecruit(id), "danger");
    show();
  }

  /** Open a recruited member's underlying NPC sheet. */
  async #openRecruitActor(id) {
    const entry = this.#findRec(getHQ(), id);
    const actor = entry?.npcUuid ? await fromUuid(entry.npcUuid).catch(() => null) : null;
    actor?.sheet?.render(true);
  }

  /** Flip a manual recruit's unlock on (GM only) — the context-menu twin of the back-face Unlock. */
  #unlockRecruit(id) {
    return this.#mutateHQ((hq) => { const e = hq.people.find((x) => x.id === id); if (e) e.unlocked = true; });
  }

  /** Delete a recruit / roster member / facility from the HQ pool (GM only), confirming first like
   *  the quest-rail delete. The underlying NPC actor (and any party-folder membership) is untouched. */
  async #removeRecruit(id) {
    if (!this.isGM) return;
    const entry = this.#findRec(getHQ(), id);
    if (!entry) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.HQ.removeRecruitTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Covenant.deleteConfirm", { name: entry.name })}</p>`
    }).catch(() => false);
    if (!ok) return;
    await this.#mutateHQ((hq) => {
      // People and Facilities are separate now (multi-staff). Removing a PERSON just vacates them from
      // any building they staffed (the building stays); removing a FACILITY frees its residents.
      if (hq.people.some((p) => p.id === id)) {
        hq.people = hq.people.filter((x) => x.id !== id);
        for (const f of hq.facilities) if (Array.isArray(f.staffIds)) f.staffIds = f.staffIds.filter((s) => s !== id);
      } else {
        const fac = hq.facilities.find((f) => f.id === id);
        for (const pid of fac?.staffIds ?? []) { const o = hq.people.find((p) => p.id === pid); if (o) o.facilityId = ""; }
        hq.facilities = hq.facilities.filter((f) => f.id !== id);
      }
    });
  }

  /** Commit an HQ identity field (name / motto / accent). GM only. */
  async #onHqFieldChange(event) {
    const el = event.currentTarget;
    const field = el.dataset.hqField;
    if (!field) return;
    // `turn` is the integer HQ clock (GM can set it directly, e.g. to reset after testing); the rest
    // (name / motto / accent) are free text. The input the GM is typing in already shows the value, so
    // save it quietly — no pane re-render (the seamless authoring path; mirrors #onResourceField).
    const val = field === "turn" ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
    return this.#mutateHQ((hq) => { hq[field] = val; }, { quiet: true });
  }

  /** Set a resource stockpile amount (GM only) — keyed by the Resource Type. Quiet: the number box the
   *  GM edited already shows the value and nothing else in the Home pane derives from it. */
  async #onResourceField(event) {
    const el = event.currentTarget;
    const key = el.dataset.resourceField;
    if (!key) return;
    const val = Math.max(0, Math.round(Number(el.value) || 0));
    return this.#mutateHQ((hq) => { (hq.resources ??= {})[key] = val; }, { quiet: true });
  }

  /** Edit a recruit's role / condition / facility effect (GM only). */
  async #onRecruitFieldChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.recruitId;
    const field = el.dataset.recruitField;
    if (!id || !field) return;
    const val = el.value;
    // Every recruit-field edit saves quietly so the pane (and the prominent roster portraits) doesn't
    // flash — the edited control already shows its value. `condType` ALSO swaps which condition pickers
    // are shown; that's a no-re-render CSS toggle (data-cond) + a tiny DOM sync below. Dependent COSMETIC
    // bits (role crest, the gate lock/summary) refresh on the next real render.
    await this.#mutateHQ((hq) => {
      const e = this.#findRec(hq, id);
      if (!e) return;
      if (field === "role") e.role = val;
      else if (field === "name") e.name = val;
      else if (field === "effect") e.effect = val;
      else if (field === "yieldGold") e.yieldGold = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "yieldSP") e.yieldSP = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "unlocked") e.unlocked = el.type === "checkbox" ? el.checked : !!val;
      else if (field === "buildTime") e.buildTime = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "serviceKind") e.serviceKind = val;
      else if (field === "upgradeTarget") e.upgradeTarget = val;
      else if (field === "condType") {
        e.condition = { ...(e.condition || {}), type: val };
        if (val !== "manual") e.unlocked = false;                       // re-locking a manual gate clears its flip
        if (val === "repTier") {                                        // seed a usable gate (a blank faction never unlocks)
          if (!e.condition.tier) e.condition.tier = "friendly";
          if (!e.condition.factionId) e.condition.factionId = getFactions()[0]?.id || "";
        }
        if (val === "hqLevel" && !e.condition.level) e.condition.level = 3; // seed a usable HQ-level gate
      } else if (field === "condFaction") e.condition = { ...(e.condition || {}), factionId: val };
      else if (field === "condTier") e.condition = { ...(e.condition || {}), tier: val };
      else if (field === "condLevel") e.condition = { ...(e.condition || {}), level: Math.max(0, Math.round(Number(val) || 0)) };
      else if (field === "condLabel") e.condition = { ...(e.condition || {}), label: val };
    }, { quiet: true });
    // condType swapped the gate kind → flip which pickers show (CSS, via data-cond) and sync the seeded
    // values into the now-visible controls, all without a re-render.
    if (field === "condType") {
      const cfg = el.closest(".rcard-cfg");
      if (cfg) {
        cfg.dataset.cond = val;
        const c = this.#findRec(getHQ(), id)?.condition ?? {};
        const sync = (f, v) => { const ctl = cfg.querySelector(`[data-recruit-field="${f}"]`); if (ctl && v != null && v !== "") ctl.value = v; };
        if (val === "repTier") { sync("condFaction", c.factionId); sync("condTier", c.tier); }
        else if (val === "hqLevel") sync("condLevel", c.level);
      }
    }
  }

  /** Drop an NPC onto the Home recruit zone → add it to the recruit pool. */
  async #onRecruitDrop(event) {
    if (!game.user.isGM) return;
    const data = this.#dropData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid).catch(() => null);
    if (!actor || actor.type !== "npc") return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Covenant.rosterNeedsNpc"));
    return this.#mutateHQ((hq) => {
      hq.people.push({
        id: foundry.utils.randomID(),
        npcUuid: actor.uuid,
        name: actor.name,
        img: actor.img,
        role: "party",
        condition: { type: "auto", factionId: "", tier: "", label: "" },
        effect: "",
        recruited: false,
        unlocked: false
      });
    });
  }

  /** Pick the HQ crest emblem image (the shield) — replaces the old text glyph. GM only. */
  static async #onPickHqCrest() {
    if (!game.user.isGM) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getHQ().crest ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateHQ((hq) => { hq.crest = path; }) }).browse();
  }

  static async #onRecruitMember(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) await recruitMember(id);
  }

  static async #onUnlockRecruit(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) await this.#unlockRecruit(id);
  }

  /** Advance the HQ one downtime turn: pay out every facility's per-turn output (saveHQ → re-render). */
  static async #onAdvanceHQTurn() {
    if (!game.user.isGM) return;
    await advanceHQTurn();
  }

  /** A safe filename stem for the current HQ (lower-kebab, never empty). */
  #hqSlug(hq) {
    return String(hq.name || "headquarters").trim().toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "headquarters";
  }

  /** Trigger a browser download of a Blob (used for the .zip export; saveDataToFile only takes strings). */
  #downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Export the ENTIRE Headquarters (identity, resources, roster/recruits, facilities, missions, craft
   *  jobs) the GM can carry into another world. The HQ blob alone snapshots each card's name/img/role/
   *  yields, but its actor LINKS (`npcUuid`) are world-local — so we bundle the FULL backing NPC actor
   *  for every linked recruit/facility into a `.zip` (`hq.json` + `actors.json`), letting Import recreate
   *  those actors in the destination world and re-point the links. Falls back to a bare JSON (HQ only) if
   *  JSZip isn't available. */
  static async #onExportHQ() {
    if (!game.user.isGM) return;
    const hq = getHQ();
    const slug = this.#hqSlug(hq);
    // Full data for every backing NPC actor a recruit/facility links to (deduped by uuid).
    const uuids = [...new Set([...(hq.people ?? []), ...(hq.facilities ?? [])].map((e) => e?.npcUuid).filter(Boolean))];
    const actors = {};
    for (const uuid of uuids) {
      try { const doc = await fromUuid(uuid); if (doc?.toObject) actors[uuid] = doc.toObject(); }
      catch (_) { /* unresolved link — skip; the card snapshot still carries name/img */ }
    }
    const meta = { type: "project-anime-hq", version: game.system?.version ?? "" };
    const JSZ = globalThis.JSZip;
    if (JSZ) {
      const zip = new JSZ();
      zip.file("hq.json", JSON.stringify({ ...meta, hq }, null, 2));
      zip.file("actors.json", JSON.stringify(actors, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      this.#downloadBlob(blob, `pa-hq-${slug}.zip`);
    } else {
      // No zip support — fall back to a single JSON that still carries the bundled actors inline.
      const fn = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
      fn(JSON.stringify({ ...meta, hq, actors }, null, 2), "application/json", `pa-hq-${slug}.json`);
    }
  }

  /** Import a Headquarters export, REPLACING the current HQ after a confirm. Accepts a `.zip` (from the
   *  bundled export — recreates the packaged NPC actors and re-points each recruit/facility `npcUuid` at
   *  its new copy) or a `.json` (wrapped `{hq,actors}`, a bare `{hq}`, or a bare HQ object). normalizeHQ
   *  repairs/upgrades any older shape on the way in. */
  static async #onImportHQ() {
    if (!game.user.isGM) return;
    const file = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,.json,application/json,application/zip";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
      input.click();
    });
    if (!file) return;

    let hqRaw = null, actors = {};
    try {
      if (/\.zip$/i.test(file.name) && globalThis.JSZip) {
        const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
        const hqStr = await zip.file("hq.json")?.async("string");
        const acStr = await zip.file("actors.json")?.async("string");
        const parsed = hqStr ? JSON.parse(hqStr) : null;
        hqRaw = (parsed && parsed.hq) ? parsed.hq : parsed;
        actors = acStr ? JSON.parse(acStr) : {};
      } else {
        const parsed = JSON.parse(await file.text());
        hqRaw = (parsed && typeof parsed === "object" && parsed.hq) ? parsed.hq : parsed;
        actors = (parsed && typeof parsed === "object" && parsed.actors) ? parsed.actors : {};
      }
    } catch (e) { ui.notifications.error(game.i18n.localize("PROJECTANIME.HQ.importBadFile")); return; }
    if (!hqRaw || typeof hqRaw !== "object") { ui.notifications.error(game.i18n.localize("PROJECTANIME.HQ.importBadFile")); return; }

    const hq = normalizeHQ(hqRaw);
    const actorCount = actors && typeof actors === "object" ? Object.keys(actors).length : 0;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.HQ.importTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.HQ.importConfirm", { name: hq.name || game.i18n.localize("PROJECTANIME.HQ.title"), actors: actorCount })}</p>`,
      rejectClose: false, modal: true
    });
    if (!ok) return;

    // Recreate the bundled NPC actors, then re-point every recruit/facility link at its new copy.
    if (actorCount) {
      const entries = Object.entries(actors).filter(([, d]) => d && typeof d === "object");
      const datas = entries.map(([, d]) => { const c = foundry.utils.deepClone(d); delete c._id; return c; });
      let created = [];
      try { created = await Actor.createDocuments(datas, { keepId: false }); }
      catch (e) { console.error("project-anime | HQ import: actor creation failed", e); }
      const uuidMap = {};
      created.forEach((doc, i) => { if (doc) uuidMap[entries[i][0]] = doc.uuid; });
      for (const e of [...(hq.people ?? []), ...(hq.facilities ?? [])]) {
        if (e?.npcUuid && uuidMap[e.npcUuid]) e.npcUuid = uuidMap[e.npcUuid];
      }
    }
    await saveHQ(hq); // world setting onChange → notifyHQChanged re-renders every open Codex
    ui.notifications.info(game.i18n.localize("PROJECTANIME.HQ.importDone"));
  }

  /** GM: nudge the HQ Level up / down. The Level is the facility-tier sum + a stored `levelAdjust`
   *  offset; the ± buttons move the effective level (floored at 0) and store the result as that offset,
   *  so building a facility still raises the Level and the GM's nudge rides on top. A level change can
   *  unlock `hqLevel`-gated recruits, so it goes through a normal re-render (not the quiet path). */
  static #onHqLevelUp() { this.#adjustHqLevel(1); }
  static #onHqLevelDown() { this.#adjustHqLevel(-1); }

  #adjustHqLevel(delta) {
    if (!game.user.isGM) return;
    const hq0 = getHQ();
    const base = (hq0.facilities ?? []).reduce((n, f) => n + Math.min(3, Math.max(0, Number(f.facilityTier) || 0)), 0);
    const before = Math.max(0, base + Math.round(Number(hq0.levelAdjust) || 0));
    const next = Math.max(0, before + delta);
    if (next === before) return; // floored at 0 — nothing changes
    // Crossing a not-yet-recruited hqLevel gate (un)locks that recruit, so the pane must re-render to
    // show it. Otherwise the only visible change is the badge number — patch it and stay quiet (no flash).
    const flips = (hq0.people ?? []).some((p) => !p.recruited && p.condition?.type === "hqLevel"
      && ((before >= (Number(p.condition.level) || 0)) !== (next >= (Number(p.condition.level) || 0))));
    this.#mutateHQ((hq) => { hq.levelAdjust = next - base; }, { quiet: !flips }); // keep levelAdjust = (effective − base)
    if (!flips) {
      const b = this.element?.querySelector?.('.codex-pane[data-pane="hq"] .hq-level b');
      if (b) b.textContent = next;
    }
  }

  /** Open a vendor facility's Shop (everyone — players transact as their own character). */
  static #onVisitShop(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) ShopWindow.open(id);
  }

  /** Open a workshop facility's crafting window (everyone — players craft when the GM unlocks it). */
  static #onVisitWorkshop(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) WorkshopWindow.open(id);
  }

  /** Open the standalone Structures window — the full HQ building manager (everyone). A facility id on
   *  the clicked building card pre-selects it; the bare button opens with the first structure selected. */
  static #onOpenStructures(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId ?? null;
    StructuresWindow.open(id);
  }

  /** Click a building card → open its most useful window: a workshop's crafting window, a vendor's Shop,
   *  else the Structures editor. Editing any building stays on the right-click menu's "Edit Building". */
  static #onOpenFacility(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (!id) return;
    const role = getHQ().facilities.find((x) => x.id === id)?.role;
    if (role === "workshop") WorkshopWindow.open(id);
    else if (role === "vendor") ShopWindow.open(id);
    else StructuresWindow.open(id);
  }

  /* --- Dispatch missions --- */

  /** Mutate one dispatch mission in the HQ pool (GM only), persist, re-render (unless opts.quiet). */
  async #mutateMission(id, fn, opts) {
    return this.#mutateHQ((hq) => { const m = (hq.missions ?? []).find((x) => x.id === id); if (m) fn(m); }, opts);
  }

  /** Edit a mission field (GM): title + stat (text/select), the rest clamped integers. */
  async #onMissionField(event) {
    const el = event.currentTarget;
    const id = el.dataset.missionId;
    const field = el.dataset.missionField;
    if (!id || !field) return;
    const num = Math.max(0, Math.round(Number(el.value) || 0));
    // Every mission-field edit saves quietly (no pane flash) — the control already shows its value.
    // `stat` and `difficulty` drive live displays (candidate dice, the success-odds meter, the poster);
    // those are patched in place below so they stay correct without a re-render.
    await this.#mutateMission(id, (m) => {
      if (field === "title") m.title = el.value;
      else if (field === "stat") m.stat = el.value;
      else if (field === "difficulty") m.difficulty = Math.max(1, num);
      else if (field === "tier") m.tier = Math.min(5, Math.max(1, num));
      else if (field === "durationTurns") m.durationTurns = Math.max(1, num);
      else if (field === "rewardGold") m.rewardGold = num;
      else if (field === "rewardSP") m.rewardSP = num;
    }, { quiet: true });
    if (field === "stat" || field === "difficulty") this.#patchMissionLive(el.closest(".section-drawer"), id);
  }

  /** Patch a mission drawer's stat/DC-dependent displays in place (candidate dice + data attrs, the odds
   *  meter, and the poster emblem / DC seal / tested-by) so a stat or difficulty edit doesn't re-render
   *  the pane. Fail-safe: a missing node is skipped — it refreshes on the next real render. */
  #patchMissionLive(scope, id) {
    if (!scope) return;
    const hq = getHQ();
    const m = (hq.missions ?? []).find((x) => x.id === id);
    if (!m) return;
    // Re-derive each idle candidate's die for the current stat (the odds meter reads these attrs).
    for (const card of scope.querySelectorAll(".m-cand[data-agent-id]")) {
      const p = hq.people.find((x) => x.id === card.dataset.agentId);
      const npc = p?.npcUuid ? fromUuidSync(p.npcUuid) : null;
      const faces = statDieFor(npc, m.stat).faces;
      const bonus = statBonusFor(npc, m.stat);
      card.dataset.faces = faces;
      card.dataset.bonus = bonus;
      const bonusStr = bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
      const cdie = card.querySelector(".m-cdie");
      if (cdie) cdie.innerHTML = `<span class="m-cck"><i class="fas fa-check"></i></span>d${faces}${bonusStr ? ` <b>${bonusStr}</b>` : ""}`;
    }
    const statLabel = statLabelFor(m.stat);
    const dcShort = game.i18n.localize("PROJECTANIME.HQ.dcShort");
    const oddsL = scope.querySelector(".m-odds-l"); if (oddsL) oddsL.textContent = `${statLabel} · ${dcShort} ${m.difficulty}`;
    const emblem = scope.querySelector(".m-emblem i"); if (emblem) emblem.className = missionStatIcon(m.stat);
    const seal = scope.querySelector(".m-pseal b"); if (seal) seal.textContent = m.difficulty;
    const gStat = scope.querySelector(".m-g-stat"); if (gStat) gStat.textContent = statLabel;
    this.#recomputeSquadOdds(scope); // %/bar/send-count, from the updated cards + the live DC input
  }

  /** Drop an Item onto a mission's reward slot → store a snapshot as a mission reward (GM). */
  async #onMissionRewardDrop(event, id) {
    if (!game.user.isGM || !id) return;
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    return this.#mutateMission(id, (m) => { (m.rewardItems ??= []).push(snap); });
  }

  static async #onNewMission() {
    if (!game.user.isGM) return;
    await this.#mutateHQ((hq) => { (hq.missions ??= []).unshift(blankMission()); });
  }

  /** Pick a mission's front-of-card banner image via FilePicker (GM only). */
  static async #onPickMissionImage(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-mission-id]")?.dataset.missionId;
    if (!id) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getHQ().missions.find((m) => m.id === id)?.img ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateHQ((hq) => { const m = (hq.missions ?? []).find((x) => x.id === id); if (m) m.img = path; }) }).browse();
  }

  static async #onDeleteMission(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-mission-id]")?.dataset.missionId;
    await this.#mutateHQ((hq) => { hq.missions = (hq.missions ?? []).filter((m) => m.id !== id); });
  }

  /** Set a mission's tier (the ✦ prestige rating) from a clicked pip (GM). Patches the pips + poster
   *  stars in place and saves quietly — no re-render, so the open drawer doesn't flicker. */
  static async #onSetMissionTier(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-mission-id]")?.dataset.missionId;
    const n = Math.min(5, Math.max(1, Number(target.dataset.mtier) || 1));
    const drawer = target.closest(".section-drawer");
    if (drawer) {
      drawer.querySelectorAll(".m-pips .m-pip").forEach((p, i) => p.classList.toggle("on", i < n));
      drawer.querySelectorAll(".m-ptier i").forEach((s, i) => s.classList.toggle("on", i < n));
    }
    await this.#mutateMission(id, (m) => { m.tier = n; }, { quiet: true });
  }

  /** Step a mission's duration by data-delta turns (GM). Patches the stepper value + poster glance in
   *  place and saves quietly — no re-render. */
  static async #onBumpMissionDuration(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-mission-id]")?.dataset.missionId;
    const delta = Number(target.dataset.delta) || 0;
    const drawer = target.closest(".section-drawer");
    const sv = drawer?.querySelector(".m-stepval");
    const val = Math.max(1, (Math.max(1, Number(sv?.textContent) || 1)) + delta);
    if (sv) sv.textContent = val;
    const gd = drawer?.querySelector(".m-gd");
    if (gd) gd.textContent = `${val} ${game.i18n.localize("PROJECTANIME.HQ.turnsUnit")}`;
    this.#recomputeSquadOdds(drawer); // refresh the "Returns in N turns" readout off the new base
    await this.#mutateMission(id, (m) => { m.durationTurns = val; }, { quiet: true });
  }

  /** Send the assembled squad on this mission (GM) — each picked idle agent goes away until turn +
   *  duration. Reads the transient #squadPick selection, dispatches all, then clears it. */
  static async #onDispatchAgent(event, target) {
    if (!game.user.isGM) return;
    const missionId = target.closest("[data-mission-id]")?.dataset.missionId;
    if (!missionId || this.#squadPickMission !== missionId) return;
    const ids = [...this.#squadPick];
    if (!ids.length) return;
    this.#squadPick.clear();
    this.#squadPickMission = "";
    await this.#mutateHQ((hq) => {
      const m = (hq.missions ?? []).find((x) => x.id === missionId);
      if (!m) return;
      // Re-check the full idle gate at commit time (the transient pick could have gone stale — e.g. an
      // agent got posted to a facility in the Structures window while the squad was being assembled).
      const sent = ids
        .map((aid) => hq.people.find((e) => e.id === aid && e.recruited && e.role === "dispatch" && !e.status && !e.facilityId))
        .filter(Boolean);
      if (!sent.length) return;
      // The squad's combined Mission-haste (hq.haste Trait/effect) shortens the run, floored at 1 turn —
      // so a hastening agent brings the WHOLE squad home earlier. Resolve from the backing actors.
      const actors = sent.map((a) => (a.npcUuid ? fromUuidSync(a.npcUuid) : null));
      const returnsTurn = (Number(hq.turn) || 0) + effectiveMissionDuration(m, actors);
      for (const a of sent) {
        a.status = "away";
        a.assignedMissionId = m.id;
        a.returnsTurn = returnsTurn;
      }
    });
  }

  /** Send ONE idle dispatch agent on a mission straight from their Roster card (GM) — the person-action
   *  shortcut. Reads the chosen mission from the card's dropdown and commits immediately (no squad
   *  assembly / odds preview — that lives on the Missions tab). They join whatever squad forms for that
   *  mission and resolve together on the HQ Turn. */
  static async #onDispatchFromRoster(event, target) {
    if (!game.user.isGM) return;
    const pid = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const sel = target.closest(".section-drawer")?.querySelector("[data-roster-dispatch-mission]");
    const mid = sel?.value;
    if (!pid || !mid) return;
    await this.#mutateHQ((hq) => {
      const m = (hq.missions ?? []).find((x) => x.id === mid);
      const a = hq.people.find((e) => e.id === pid && e.recruited && e.role === "dispatch" && !e.status && !e.facilityId);
      if (!m || !a) return;
      // This agent's own Mission-haste (hq.haste Trait/effect) shortens their run, floored at 1 turn.
      const npc = a.npcUuid ? fromUuidSync(a.npcUuid) : null;
      a.status = "away";
      a.assignedMissionId = m.id;
      a.returnsTurn = (Number(hq.turn) || 0) + effectiveMissionDuration(m, [npc]);
    });
  }

  /** Tap a candidate card into / out of the squad for its mission (GM; DOM-only, no persist). Switching
   *  to a different mission's picker resets the selection. Recomputes the live odds meter in the drawer. */
  #onToggleCandidate(card) {
    if (!game.user.isGM) return;
    const mid = card.closest("[data-mission-id]")?.dataset.missionId;
    const aid = card.dataset.agentId;
    if (!mid || !aid) return;
    if (this.#squadPickMission !== mid) { this.#squadPick.clear(); this.#squadPickMission = mid; }
    if (this.#squadPick.has(aid)) this.#squadPick.delete(aid);
    else this.#squadPick.add(aid);
    card.classList.toggle("sel-on", this.#squadPick.has(aid));
    this.#recomputeSquadOdds(card.closest(".section-drawer"));
  }

  /** Recompute a mission drawer's squad-odds meter (% + bar + send count) live from the selected
   *  candidate cards and the drawer's difficulty input (no re-render). */
  #recomputeSquadOdds(scope) {
    if (!scope) return;
    const dcEl = scope.querySelector('[data-mission-field="difficulty"]');
    const dc = Math.max(1, Math.round(Number(dcEl?.value) || 1));
    const entries = [];
    let haste = 0;
    for (const c of scope.querySelectorAll(".m-cand.sel-on")) {
      entries.push({ faces: Number(c.dataset.faces) || 1, bonus: Number(c.dataset.bonus) || 0 });
      haste += Math.max(0, Number(c.dataset.haste) || 0);
    }
    const pct = entries.length ? teamSuccessPct(entries, dc) : 0;
    const pctEl = scope.querySelector(".m-pct"); if (pctEl) pctEl.textContent = entries.length ? `${pct}%` : "—";
    const barEl = scope.querySelector(".m-bar > i"); if (barEl) barEl.style.width = `${pct}%`;
    const nEl = scope.querySelector(".m-sendn"); if (nEl) nEl.textContent = entries.length ? `(${entries.length})` : "";
    // "Returns in N turns": base duration (read live from the stepper) shaved by the picked squad's
    // combined Mission-haste, floored at 1 — so the readout matches what dispatch will actually commit.
    const base = Math.max(1, Math.round(Number(scope.querySelector(".m-stepval")?.textContent) || 1));
    const readyEl = scope.querySelector(".m-readyn"); if (readyEl) readyEl.textContent = Math.max(1, base - haste);
  }

  /** Recall an away agent early — back to idle, no reward (GM). */
  static async #onRecallAgent(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    await this.#mutateHQ((hq) => { const e = hq.people.find((x) => x.id === id); if (e) { e.status = ""; e.assignedMissionId = ""; e.returnsTurn = 0; } });
  }

  static async #onRemoveMissionItem(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-mission-id]")?.dataset.missionId;
    const idx = Number(target.dataset.missionItem);
    await this.#mutateMission(id, (m) => { if (Array.isArray(m.rewardItems)) m.rewardItems.splice(idx, 1); });
  }

  /* --- Passive boons --- */

  static async #onEditBoon(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) this.#openBoonBuilder(id);
  }

  /** Author ANY facility's projected effect in the shared Effect Builder (data mode, full vocabulary) —
   *  saving its name / icon / rules back to the facility, which reconcileHQBoons projects onto the party.
   *  Reached from the facility drawer's Edit-boon button and the facility right-click menu. */
  #openBoonBuilder(id) {
    if (!game.user.isGM) return;
    const fac = getHQ().facilities.find((x) => x.id === id);
    if (!fac) return;
    const winId = `hqboon-${id}`;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${winId}`);
    if (existing) return existing.bringToFront();
    EffectBuilder.forData({
      id: winId,
      title: game.i18n.localize("PROJECTANIME.HQ.editBoon"),
      name: fac.name || game.i18n.localize("PROJECTANIME.HQ.boonDefault"),
      img: fac.img || "icons/svg/aura.svg",
      rules: fac.boonRules ?? [],
      onSave: ({ name, img, rules }) => this.#mutateHQ((hq) => {
        const e = hq.facilities.find((x) => x.id === id);
        if (e) { e.name = name || e.name; e.img = img || e.img; e.boonRules = rules; }
      })
    }).render(true);
  }

  /* =============================== CODEX / ARCHIVE =============================== */

  /** Resolve a monster-tier key to its crest meta ({label, icon, color}), or null. */
  #tierMeta(key) {
    const t = key ? CONFIG.PROJECTANIME?.monsterTiers?.[key] : null;
    return t ? { key, label: game.i18n.localize(t.label), icon: t.icon, color: t.color } : null;
  }

  /** One entry's grid-card view-model (used both by the pane render and the live-DOM splicer). A player
   *  sees an un-revealed entry as a locked "???" silhouette; the GM/owner sees the real card. */
  #entryCardVM(e) {
    if (!this.isGM && !e.revealed) {
      return { id: e.id, locked: true, revealed: false, revealLabel: "", name: "", img: "", initial: "?", accent: "#6b6478", tier: null };
    }
    const actor = e.actorUuid ? entryActor(e) : null;
    const name = e.name || actor?.name || "";
    return {
      id: e.id,
      locked: false,
      revealed: e.revealed,
      revealLabel: game.i18n.localize(e.revealed ? "PROJECTANIME.Archive.revealed" : "PROJECTANIME.Archive.hidden"),
      name: name || game.i18n.localize("PROJECTANIME.Archive.untitled"),
      img: e.img || actor?.img || "",
      initial: initialOf(name),
      accent: e.accent || "var(--pa-gold-soft)",
      tier: this.#tierMeta(e.tier)
    };
  }

  /* ----- Archive fragment rendering: the card + book markup lives in shared partials so a single entry
     can be rendered on its own and SPLICED into the live DOM (no pane re-render / flash). loadTemplates
     registers each partial under its path, the same key `{{> path}}` and renderTemplate resolve. ----- */

  /** Make sure the card/book partials are loaded + registered before the archive renders (idempotent;
     getTemplate returns the cached partial after the first call). */
  async #ensureArchivePartials() {
    const lt = foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
    try {
      await lt([
        "systems/project-anime/templates/codex/archive-card.hbs",
        "systems/project-anime/templates/codex/archive-book.hbs"
      ]);
    } catch (_e) { /* a render falls back to a loud part-render if a partial can't be fetched */ }
  }

  /** Render one of the archive partials to an HTML string. */
  #renderArchiveTemplate(name, ctx) {
    const rt = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    return rt(`systems/project-anime/templates/codex/${name}.hbs`, ctx);
  }

  /** Parse a fragment string into its single root element (or null). */
  #htmlToEl(html) {
    const t = document.createElement("template");
    t.innerHTML = (html ?? "").trim();
    return t.content.firstElementChild;
  }

  /** Build one entry's grid card as a detached element. */
  async #renderArchiveCardEl(e) {
    const html = await this.#renderArchiveTemplate("archive-card", { ...this.#entryCardVM(e), isGM: this.isGM });
    return this.#htmlToEl(html);
  }

  /** Build one entry's detail book as a detached element (async — enriches dossier/item description). */
  async #renderArchiveBookEl(e) {
    const viewer = canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const cats = getArchive().categories;
    const vm = await this.#entryBookVM(e, { isGM: this.isGM, viewer, TE, cats });
    const html = await this.#renderArchiveTemplate("archive-book", { ...vm, isGM: this.isGM });
    return this.#htmlToEl(html);
  }

  /** Build the Codex/Archive pane view-model: category sub-tabs (+ counts) with their entry cards, plus
   *  a flat list of openable entry detail books. Players see revealed entries in full and unrevealed
   *  ones as locked "???" cards (and get no book for them). */
  async #archiveContext() {
    await this.#ensureArchivePartials();   // the card/book partials are shared with the live-DOM splicer
    const isGM = this.isGM;
    const arc = getArchive();
    const cats = arc.categories;
    if (!cats.some((c) => c.id === this.#archiveTab)) this.#archiveTab = cats[0]?.id ?? "";

    // The viewer whose Scouter gates actor-backed stat blocks (GM/owner bypass it inside actorStatBlock).
    const viewer = canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

    const byCat = {};
    for (const c of cats) byCat[c.id] = [];
    for (const e of arc.entries) (byCat[e.category] ??= []).push(e);
    for (const id of Object.keys(byCat)) byCat[id].sort((a, b) => (a.sort - b.sort) || (a.name || "").localeCompare(b.name || ""));

    const categories = cats.map((c) => {
      const list = byCat[c.id] ?? [];
      return {
        id: c.id,
        label: c.label,
        icon: c.icon,
        active: c.id === this.#archiveTab,
        count: list.length,
        cards: list.map((e) => this.#entryCardVM(e))
      };
    });

    // Detail books — only for entries this viewer may open (GM: all; players: revealed). One open at a time.
    const openable = arc.entries.filter((e) => isGM || e.revealed);
    const books = [];
    for (const e of openable) books.push(await this.#entryBookVM(e, { isGM, viewer, TE, cats }));

    return { isGM, hasCategories: cats.length > 0, categories, books };
  }

  /** The per-entry detail-book view-model (async — enriches the dossier + item description). */
  async #entryBookVM(e, { isGM, viewer, TE, cats }) {
    const actor = e.actorUuid ? entryActor(e) : null;
    const item = e.itemUuid ? entryItem(e) : null;
    const full = isGM || !!actor?.isOwner;
    const reveals = full ? null : (viewer ? collectReveals(viewer) : new Set());
    const accent = e.accent || "#8a6fc0";
    const name = e.name || actor?.name || "";

    let dossier = "";
    try { dossier = await TE.enrichHTML(e.dossier ?? "", { secrets: isGM }); } catch (_e) { dossier = escHtml(e.dossier ?? ""); }

    // Live, reveal-gated stat block for an actor-backed entry (only when the GM left it on).
    const stat = (actor && e.showStatBlock) ? actorStatBlock(actor, { full, reveals }) : null;
    const hasStatBlock = !!(stat && (stat.attributes || stat.combat || stat.affinities.length || stat.customFields.length || full));
    const vit = (actor && full)
      ? {
          hp: { value: actor.system?.hp?.value ?? 0, max: actor.system?.hp?.max ?? 0 },
          energy: { value: actor.system?.energy?.value ?? 0, max: actor.system?.energy?.max ?? 0 }
        }
      : null;

    let itemDescription = "";
    if (item) { try { itemDescription = await TE.enrichHTML(item.system?.description ?? "", { secrets: isGM }); } catch (_e) { itemDescription = ""; } }

    const tierOptions = [
      { key: "", label: game.i18n.localize("PROJECTANIME.Archive.tierNone"), sel: !e.tier },
      ...(CONFIG.PROJECTANIME?.monsterTierKeys ?? []).map((k) => ({ key: k, label: game.i18n.localize(CONFIG.PROJECTANIME.monsterTiers[k].label), sel: k === e.tier }))
    ];

    return {
      id: e.id,
      isOpen: this.#openArchiveEntry === e.id,
      accent,
      name,
      subtitle: e.subtitle ?? "",
      img: e.img || actor?.img || "",
      initial: initialOf(name),
      bannerStyle: e.banner ? `background-image:url('${e.banner}')` : `background:${factionHeroGrad(accent)}`,
      revealed: e.revealed,
      revealLabel: game.i18n.localize(e.revealed ? "PROJECTANIME.Archive.revealed" : "PROJECTANIME.Archive.hidden"),
      showStatBlock: e.showStatBlock,
      catOptions: cats.map((c) => ({ id: c.id, label: c.label, sel: c.id === e.category })),
      tier: this.#tierMeta(e.tier),
      tierOptions,
      tags: e.tags,
      tagStr: (e.tags ?? []).join(", "),
      dossier,
      dossierRaw: e.dossier ?? "",
      quote: e.quote ?? "",
      vitals: (e.vitals ?? []).map((v) => ({ id: v.id, k: v.k, v: v.v })),
      gmNotesRaw: e.gmNotes ?? "",
      hasActor: !!actor,
      hasItem: !!item,
      itemName: item?.name ?? "",
      itemDescription,
      stat,
      hasStatBlock,
      vit
    };
  }

  /** Mutate the Codex archive and persist (GM only). Saving re-renders via the setting's onChange;
   *  { quiet:true } suppresses THIS instance's re-render (the caller has already patched the DOM). Same
   *  no-op guard as #mutateHQ — an unchanged save fires no onChange, so the skip flag must not arm. */
  async #mutateArchive(fn, { quiet = false } = {}) {
    if (!game.user.isGM) return;
    const arc = getArchive();
    const before = JSON.stringify(arc);
    fn(arc);
    if (JSON.stringify(arc) === before) return;
    if (quiet) this.#skipRenderOnce = true;
    await saveArchive(arc);
  }

  /** Mutate one entry by id (GM only). */
  async #mutateEntry(id, fn, opts) {
    return this.#mutateArchive((arc) => { const e = arc.entries.find((x) => x.id === id); if (e) fn(e, arc); }, opts);
  }

  /** Reflect #archiveTab on the live DOM (active category pane + tab button) — no re-render. */
  #applyArchiveTabs() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="archive"]');
    if (!pane) return;
    for (const p of pane.querySelectorAll(".arc-pane")) p.classList.toggle("active", p.dataset.arctab === this.#archiveTab);
    for (const b of pane.querySelectorAll(".arc-subnav .hq-tab")) b.classList.toggle("active", b.dataset.arctab === this.#archiveTab);
  }

  /** Reflect #openArchiveEntry on the live DOM so the entry book slides in without a full re-render. */
  #applyArchiveDrawers() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="archive"]');
    if (!pane) return;
    for (const el of pane.querySelectorAll(".section-drawer")) el.classList.toggle("open", el.dataset.drawer === this.#openArchiveEntry);
  }

  /** Bind the Archive pane (GM only): entry field edits, category field edits, vital edits, and the
   *  per-category Actor/Item drop zones. data-* only → never collected by any form. */
  #bindArchiveEdits(scope) {
    const root = scope ?? this.element?.querySelector?.('.codex-pane[data-pane="archive"]');
    if (!root) return;
    for (const el of root.querySelectorAll("[data-arc-field]")) el.addEventListener("change", this.#onArchiveFieldChange.bind(this));
    for (const el of root.querySelectorAll("[data-vital-field]")) el.addEventListener("change", this.#onArchiveVitalChange.bind(this));
    // Category drop zones live at the pane level (each category foot), not inside a single book — so they
    // are bound only on a full-pane bind, never when re-binding one spliced-in book.
    if (!scope) for (const zone of root.querySelectorAll("[data-archive-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onArchiveDrop(ev, zone.dataset.archiveDrop); });
    }
  }

  /** Commit an inline entry-field edit (GM only): name / subtitle / category / tier / dossier / quote /
   *  gmNotes / tags (comma list) / showStatBlock. */
  async #onArchiveFieldChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.arcId;
    const field = el.dataset.arcField;
    if (!id || !field) return;
    const val = el.type === "checkbox" ? el.checked : el.value;

    // Category change: relocate the card to the new sub-tab's grid in place (no pane flash). The book's
    // category <select> already shows the new value; the move uses `val`, so patch before the save.
    if (field === "category") {
      const patched = this.#patchMoveEntryCategory(id, val);
      return this.#mutateEntry(id, (e) => { e.category = val; }, { quiet: patched });
    }

    // Stat-block toggle restructures the book's right page — save first (so the rebuild reads the new
    // value), then re-render just this entry's book fragment in place.
    if (field === "showStatBlock") {
      await this.#mutateEntry(id, (e) => { e.showStatBlock = !!val; }, { quiet: true });
      await this.#patchEntryOrHeal(id, { card: false, book: true });
      return;
    }

    // Plain inline edits — quiet (the edited control already shows its own value).
    await this.#mutateEntry(id, (e) => {
      if (field === "tags") e.tags = String(val).split(",").map((t) => t.trim()).filter(Boolean);
      else e[field] = val;
    }, { quiet: true });
    // Refresh the bits the edit mirrors elsewhere: the grid card shows the name + tier crest, and the
    // book's right-page tier badge also reads off `tier`, so a tier change re-renders the book too.
    if (field === "name") await this.#patchEntryOrHeal(id, { card: true, book: false });
    else if (field === "tier") await this.#patchEntryOrHeal(id, { card: true, book: true });
  }

  /** Commit a free-form vital row's key/value edit (GM only). */
  async #onArchiveVitalChange(event) {
    const el = event.currentTarget;
    const id = el.dataset.arcId;
    const vid = el.dataset.arcVital;
    const field = el.dataset.vitalField;
    if (!id || !vid || !field) return;
    return this.#mutateEntry(id, (e) => { const row = (e.vitals ?? []).find((x) => x.id === vid); if (row) row[field] = el.value; }, { quiet: true });
  }

  /** Drop an Actor or Item onto a category's zone → create a linked entry there, snapshotting its
   *  name / image (an Actor also snapshots its monster tier), and open the new entry's book to author. */
  async #onArchiveDrop(event, categoryId) {
    if (!game.user.isGM || !categoryId) return;
    const data = this.#dropData(event);
    if (!data?.type || !data.uuid) return;
    const doc = await fromUuid(data.uuid).catch(() => null);
    if (!doc) return;
    const entry = blankEntry(categoryId);
    if (data.type === "Actor") {
      entry.actorUuid = doc.uuid;
      entry.name = doc.name;
      entry.img = doc.img;
      entry.tier = doc.system?.tier ?? "";
    } else if (data.type === "Item") {
      entry.itemUuid = doc.uuid;
      entry.name = doc.name;
      entry.img = doc.img;
    } else return;
    this.#archiveTab = categoryId;
    this.#openArchiveEntry = entry.id;
    const patched = await this.#insertEntryDom(entry);
    await this.#mutateArchive((arc) => { entry.sort = arc.entries.filter((x) => x.category === categoryId).length; arc.entries.push(entry); }, { quiet: patched });
  }

  /** Switch Archive category sub-tabs via CSS — instant, no re-render (mirrors #onSelectHqTab). */
  static #onSelectArchiveTab(event, target) {
    const tab = target.dataset.arctab;
    if (!tab || tab === this.#archiveTab) return;
    this.#archiveTab = tab;
    this.#applyArchiveTabs();
  }

  /** Open an entry's detail book (pure DOM; re-applied on render via #applyArchiveDrawers). */
  static #onOpenArchiveEntry(event, target) {
    this.#openArchiveEntry = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId ?? null;
    this.#applyArchiveDrawers();
  }

  /** Close the open entry book (backdrop / close button). */
  static #onCloseArchiveEntry() {
    this.#openArchiveEntry = null;
    this.#applyArchiveDrawers();
  }

  /** Create a fresh blank entry in the given (or active) category and open its book (GM only). */
  static async #onNewArchiveEntry(event, target) {
    if (!this.isGM) return;
    const catId = target.dataset.arctab ?? target.closest("[data-arctab]")?.dataset.arctab ?? this.#archiveTab;
    const entry = blankEntry(catId);
    this.#archiveTab = catId;
    this.#openArchiveEntry = entry.id;
    const patched = await this.#insertEntryDom(entry);
    await this.#mutateArchive((arc) => { entry.sort = arc.entries.filter((x) => x.category === catId).length; arc.entries.push(entry); }, { quiet: patched });
  }

  /** Delete an entry (GM only), confirming first. */
  static async #onDeleteArchiveEntry(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    const e = getArchive().entries.find((x) => x.id === id);
    if (!e) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Archive.deleteEntryTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Covenant.deleteConfirm", { name: e.name || game.i18n.localize("PROJECTANIME.Archive.untitled") })}</p>`
    }).catch(() => false);
    if (!ok) return;
    if (this.#openArchiveEntry === id) this.#openArchiveEntry = null;
    const patched = this.#patchDeleteEntry(id);
    await this.#mutateArchive((arc) => { arc.entries = arc.entries.filter((x) => x.id !== id); }, { quiet: patched });
  }

  /** Toggle an entry's discovery reveal (GM only) — flips whether players can read it. Patches the GM's
   *  card/book in place (quiet); players still re-render off the setting change to (un)hide the entry. */
  static async #onToggleReveal(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    if (!id) return;
    const next = !getArchive().entries.find((x) => x.id === id)?.revealed;
    const patched = this.#patchReveal(id, next);
    await this.#mutateEntry(id, (e) => { e.revealed = next; }, { quiet: patched });
  }

  /** Add a new category and switch to it (GM only). Appends the tab + empty pane in place (quiet); only
   *  the first-ever category (no pane structure yet) falls back to a full render. */
  static async #onNewArchiveCategory() {
    if (!this.isGM) return;
    const cat = blankCategory();
    cat.sort = getArchive().categories.length;
    this.#archiveTab = cat.id;
    const patched = this.#patchNewCategory(cat);
    await this.#mutateArchive((arc) => { arc.categories.push(cat); }, { quiet: patched });
  }

  /** Delete a category (GM only) — refuses the last one; its entries re-file into the first survivor. */
  static async #onDeleteArchiveCategory(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcCatId ?? target.closest("[data-arc-cat-id]")?.dataset.arcCatId;
    const arc0 = getArchive();
    if (arc0.categories.length <= 1) { ui.notifications.warn(game.i18n.localize("PROJECTANIME.Archive.lastCategory")); return; }
    const cat = arc0.categories.find((c) => c.id === id);
    if (!cat) return;
    const count = arc0.entries.filter((e) => e.category === id).length;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Archive.deleteCategory") },
      content: `<p>${game.i18n.format("PROJECTANIME.Archive.deleteCategoryConfirm", { name: cat.label, n: count })}</p>`
    }).catch(() => false);
    if (!ok) return;
    const fallback = arc0.categories.find((c) => c.id !== id)?.id ?? "";
    if (this.#archiveTab === id) this.#archiveTab = fallback;
    const patched = this.#patchDeleteCategory(id, fallback);
    await this.#mutateArchive((arc) => {
      for (const e of arc.entries) if (e.category === id) e.category = fallback;
      arc.categories = arc.categories.filter((c) => c.id !== id);
    }, { quiet: patched });
  }

  /** Reorder a category left/right (GM only); dir = ±1. Reorders the tab + pane DOM in place (quiet). */
  static async #onMoveCategory(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcCatId ?? target.closest("[data-arc-cat-id]")?.dataset.arcCatId;
    const dir = Number(target.dataset.dir) || 0;
    if (!id || !dir) return;
    const order = getArchive().categories.slice().sort((a, b) => a.sort - b.sort);
    const i = order.findIndex((c) => c.id === id);
    if (i < 0 || i + dir < 0 || i + dir >= order.length) return; // already at the end → nothing to do
    await this.#mutateArchive((arc) => {
      const sorted = arc.categories.slice().sort((a, b) => a.sort - b.sort);
      const ii = sorted.findIndex((c) => c.id === id);
      const jj = ii + dir;
      [sorted[ii], sorted[jj]] = [sorted[jj], sorted[ii]];
      sorted.forEach((c, k) => { c.sort = k; });
    }, { quiet: true });
    if (!this.#patchReorderCategories()) this.render({ parts: ["archive"] });
  }

  /** Pick an entry's portrait image (GM only). */
  static async #onPickEntryImage(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    const cur = getArchive().entries.find((x) => x.id === id)?.img ?? "";
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    // Save quietly, then patch the card + book img in place (a new portrait shows on both).
    new FP({ type: "image", current: cur, callback: async (path) => {
      await this.#mutateEntry(id, (e) => { e.img = path; }, { quiet: true });
      await this.#patchEntryOrHeal(id, { card: true, book: true });
    } }).browse();
  }

  /** Pick an entry's banner image (GM only). */
  static async #onPickEntryBanner(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    const cur = getArchive().entries.find((x) => x.id === id)?.banner ?? "";
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    // The banner only shows on the book — save quietly, then re-render just that book in place.
    new FP({ type: "image", current: cur, callback: async (path) => {
      await this.#mutateEntry(id, (e) => { e.banner = path; }, { quiet: true });
      await this.#patchEntryOrHeal(id, { card: false, book: true });
    } }).browse();
  }

  /** Open an entry's linked Actor (or Item) sheet. */
  static async #onOpenEntryActor(event, target) {
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    const e = getArchive().entries.find((x) => x.id === id);
    const ref = e?.actorUuid || e?.itemUuid || "";
    const doc = ref ? await fromUuid(ref).catch(() => null) : null;
    doc?.sheet?.render(true);
  }

  /** Add a blank free-form vital row to an entry (GM only). Appends the row to the open book in place
   *  (no flash, keeps focus) and focuses it; the id is minted here so the patch + save agree. */
  static async #onAddEntryVital(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    if (!id) return;
    const vid = foundry.utils.randomID();
    const patched = this.#patchAddVital(id, vid);
    await this.#mutateEntry(id, (e) => { (e.vitals ??= []).push({ id: vid, k: "", v: "" }); }, { quiet: patched });
  }

  /** Remove a vital row from an entry (GM only). Removes the row node in place (no flash). */
  static async #onRemoveEntryVital(event, target) {
    if (!this.isGM) return;
    const id = target.dataset.arcId ?? target.closest("[data-arc-id]")?.dataset.arcId;
    const vid = target.dataset.vital;
    if (!id || !vid) return;
    const patched = this.#patchRemoveVital(id, vid);
    await this.#mutateEntry(id, (e) => { e.vitals = (e.vitals ?? []).filter((x) => x.id !== vid); }, { quiet: patched });
  }

  /* ----------------------------- Archive context menus ----------------------------- */

  /** Bind right-click context menus on the Archive pane: entry CARDS for everyone (open / open-sheet),
   *  and — GM only — the category TABS (rename / icon / move / new / delete). Re-bound each archive
   *  render against fresh DOM, so no listeners stack; quiet edits don't re-render, so they persist. */
  #bindArchiveMenus() {
    const pane = this.element?.querySelector?.('.codex-pane[data-pane="archive"]');
    if (!pane) return;
    for (const card of pane.querySelectorAll(".arc-card[data-arc-id]")) {
      card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openArchiveEntryContext(card.dataset.arcId, ev); });
    }
    if (this.isGM) for (const tab of pane.querySelectorAll(".arc-subnav .hq-tab[data-arctab]")) {
      tab.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openArchiveCatContext(tab.dataset.arctab, ev); });
    }
  }

  /** Category-tab right-click menu (GM): rename, change icon, move, new entry / section, delete. The row
   *  actions reuse the existing static handlers (called with a synthesized target) so there's one path. */
  #openArchiveCatContext(id, ev) {
    if (!this.isGM || !id) return;
    const arc = getArchive();
    const cat = arc.categories.find((c) => c.id === id);
    if (!cat) return;
    const sorted = arc.categories.slice().sort((a, b) => a.sort - b.sort);
    const i = sorted.findIndex((c) => c.id === id);
    const tgt = { dataset: { arcCatId: id } };
    const { add, show } = this.#contextMenu(ev);
    add("fa-pen", "PROJECTANIME.Archive.renameCategory", () => this.#renameCategory(id));
    add("fa-icons", "PROJECTANIME.Archive.changeIcon", () => this.#pickCategoryIcon(id));
    if (i > 0) add("fa-arrow-left", "PROJECTANIME.Archive.moveLeft", () => Codex.#onMoveCategory.call(this, ev, { dataset: { arcCatId: id, dir: "-1" } }));
    if (i < sorted.length - 1) add("fa-arrow-right", "PROJECTANIME.Archive.moveRight", () => Codex.#onMoveCategory.call(this, ev, { dataset: { arcCatId: id, dir: "1" } }));
    add("fa-plus", "PROJECTANIME.Archive.newEntry", () => Codex.#onNewArchiveEntry.call(this, ev, { dataset: { arctab: id } }));
    add("fa-folder-plus", "PROJECTANIME.Archive.newCategory", () => Codex.#onNewArchiveCategory.call(this));
    if (arc.categories.length > 1) add("fa-trash", "PROJECTANIME.Archive.deleteCategory", () => Codex.#onDeleteArchiveCategory.call(this, ev, tgt), "danger");
    show();
  }

  /** Entry-card right-click menu: open + open-sheet for everyone; the GM also gets reveal/hide, set
   *  portrait/banner, and delete. Row actions reuse the existing static handlers (synthesized target). */
  #openArchiveEntryContext(id, ev) {
    if (!id) return;
    const e = getArchive().entries.find((x) => x.id === id);
    if (!e) return;
    const tgt = { dataset: { arcId: id } };
    const { add, show } = this.#contextMenu(ev);
    add("fa-book-open", "PROJECTANIME.Archive.openEntry", () => { this.#openArchiveEntry = id; this.#applyArchiveDrawers(); });
    if (e.actorUuid || e.itemUuid) add("fa-up-right-from-square", "PROJECTANIME.Covenant.openSheet", () => Codex.#onOpenEntryActor.call(this, ev, tgt));
    if (this.isGM) {
      add(e.revealed ? "fa-eye-slash" : "fa-eye", e.revealed ? "PROJECTANIME.Archive.hide" : "PROJECTANIME.Archive.reveal", () => Codex.#onToggleReveal.call(this, ev, tgt));
      add("fa-image-portrait", "PROJECTANIME.Archive.pickImage", () => Codex.#onPickEntryImage.call(this, ev, tgt));
      add("fa-panorama", "PROJECTANIME.Archive.setBanner", () => Codex.#onPickEntryBanner.call(this, ev, tgt));
      add("fa-trash", "PROJECTANIME.Archive.deleteEntry", () => Codex.#onDeleteArchiveEntry.call(this, ev, tgt), "danger");
    }
    show();
  }

  /** Rename a category via a prompt dialog (the context-menu rename). GM only. */
  async #renameCategory(id) {
    if (!this.isGM) return;
    const cat = getArchive().categories.find((c) => c.id === id);
    if (!cat) return;
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("PROJECTANIME.Archive.renameCategory"), icon: "fa-solid fa-pen" },
      classes: ["project-anime", "theme-dark"],
      content: `<input type="text" name="label" value="${escHtml(cat.label)}" autofocus style="width:100%;box-sizing:border-box">`,
      ok: { label: game.i18n.localize("PROJECTANIME.Archive.rename"), callback: (event, button) => button.form?.elements?.label?.value?.trim() ?? "" },
      rejectClose: false
    }).catch(() => null);
    if (!name) return;
    const patched = this.#patchCategoryTab(id, { label: name });
    await this.#mutateArchive((arc) => { const c = arc.categories.find((x) => x.id === id); if (c) c.label = name; }, { quiet: patched });
  }

  /** Pick a category's icon from the curated set via a small grid dialog (GM only). */
  async #pickCategoryIcon(id) {
    if (!this.isGM) return;
    const cur = getArchive().categories.find((c) => c.id === id)?.icon ?? "";
    const content = `<div class="arc-ico-grid">${CATEGORY_ICONS.map((ic) => `<button type="button" class="arc-ico-opt${ic === cur ? " on" : ""}" data-ico="${ic}"><i class="fas ${ic}"></i></button>`).join("")}</div>`;
    const dlg = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("PROJECTANIME.Archive.changeIcon"), icon: "fa-solid fa-icons" },
      classes: ["project-anime", "theme-dark"],
      content,
      buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
    });
    await dlg.render(true);
    for (const b of dlg.element.querySelectorAll("[data-ico]")) {
      b.addEventListener("click", () => {
        const ico = b.dataset.ico;
        const patched = this.#patchCategoryTab(id, { icon: ico });
        this.#mutateArchive((arc) => { const c = arc.categories.find((x) => x.id === id); if (c) c.icon = ico; }, { quiet: patched });
        dlg.close();
      });
    }
  }

  /* ----- Archive in-place patches: structural ops patch the live DOM instead of re-rendering the whole
     pane (which would reflow every card + every pre-built book = the flash). Each returns whether it
     patched; the caller saves { quiet: patched }, so a missed element falls back to a normal re-render. ----- */

  /** The live Archive pane element (or null). */
  #archivePane() { return this.element?.querySelector?.('.codex-pane[data-pane="archive"]'); }

  /** Toggle a card's reveal cue (dashed "unrevealed" frame + corner pip) + the open book's reveal control. */
  #patchReveal(id, revealed) {
    const pane = this.#archivePane();
    const card = pane?.querySelector(`.arc-card[data-arc-id="${id}"]`);
    if (!card) return false;
    card.classList.toggle("unrevealed", !revealed);
    const pip = card.querySelector(".arc-reveal-pip");
    if (pip) {
      pip.classList.toggle("on", revealed);
      pip.title = game.i18n.localize(revealed ? "PROJECTANIME.Archive.revealed" : "PROJECTANIME.Archive.hidden");
      const i = pip.querySelector("i");
      if (i) i.className = `fas ${revealed ? "fa-eye" : "fa-eye-slash"}`;
    }
    const lbl = pane.querySelector(`.section-drawer[data-drawer="${id}"] .ab-reveal`);
    if (lbl) {
      lbl.classList.toggle("on", revealed);
      lbl.innerHTML = `<i class="fas ${revealed ? "fa-eye" : "fa-eye-slash"}"></i> ${escHtml(game.i18n.localize(revealed ? "PROJECTANIME.Archive.revealed" : "PROJECTANIME.Archive.hidden"))}`;
    }
    return true;
  }

  /** Bind one spliced-in card's right-click context menu (open / open-sheet / GM authoring). Card clicks
   *  (`data-action="openArchiveEntry"`) ride the app's delegated listener, so only the menu needs wiring. */
  #bindCardMenu(cardEl) {
    if (!cardEl?.dataset?.arcId) return;
    cardEl.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openArchiveEntryContext(cardEl.dataset.arcId, ev); });
  }

  /** Re-derive a category tab's count badge from the cards now in its grid (adds / updates / drops `.nb`). */
  #updateCatCount(catId) {
    const pane = this.#archivePane();
    if (!pane || !catId) return;
    const grid = pane.querySelector(`.arc-pane[data-arctab="${catId}"] .arc-grid`);
    const n = grid ? grid.querySelectorAll(".arc-card").length : 0;
    const tab = pane.querySelector(`.arc-subnav .hq-tab[data-arctab="${catId}"]`);
    if (!tab) return;
    let nb = tab.querySelector(".nb");
    if (n > 0) { if (!nb) { nb = document.createElement("span"); nb.className = "nb"; tab.appendChild(nb); } nb.textContent = String(n); }
    else nb?.remove();
  }

  /** If a category's grid is now empty, swap it back to the "no entries" placeholder. */
  #restoreEmptyIfNeeded(catId) {
    const arcPane = this.#archivePane()?.querySelector(`.arc-pane[data-arctab="${catId}"]`);
    const grid = arcPane?.querySelector(".arc-grid");
    if (!grid || grid.querySelectorAll(".arc-card").length) return;
    const icon = getArchive().categories.find((c) => c.id === catId)?.icon || "fa-book";
    const empty = document.createElement("div");
    empty.className = "hq-empty sm";
    empty.innerHTML = `<i class="fas ${icon}"></i><p></p>`;
    empty.querySelector("p").textContent = game.i18n.localize("PROJECTANIME.Archive.empty");
    grid.replaceWith(empty);
  }

  /** The grid for a category, created (replacing the empty-state placeholder) if it doesn't exist yet. */
  #ensureGrid(catId) {
    const arcPane = this.#archivePane()?.querySelector(`.arc-pane[data-arctab="${catId}"]`);
    if (!arcPane) return null;
    let grid = arcPane.querySelector(".arc-grid");
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "tgrid arc-grid";
      const empty = arcPane.querySelector(".hq-empty");
      if (empty) empty.replaceWith(grid); else arcPane.prepend(grid);
    }
    return grid;
  }

  /** Splice a freshly created/dropped entry into the live DOM: its card into the category grid + its book
   *  appended to the pane, then open the book. Returns true if it placed both (→ caller saves quiet). */
  async #insertEntryDom(entry) {
    const pane = this.#archivePane();
    const grid = this.#ensureGrid(entry.category);
    if (!pane || !grid) return false;
    const cardEl = await this.#renderArchiveCardEl(entry);
    if (!cardEl) return false;
    grid.appendChild(cardEl);
    this.#bindCardMenu(cardEl);
    this.#updateCatCount(entry.category);
    const bookEl = await this.#renderArchiveBookEl(entry);
    if (bookEl) { pane.appendChild(bookEl); this.#bindArchiveEdits(bookEl); }
    this.#applyArchiveTabs();      // a drop into a non-active category switches to it
    this.#applyArchiveDrawers();   // open the new entry's book
    return !!bookEl;               // book somehow didn't build → save loud so a full render heals it
  }

  /** Re-render an entry's card and/or book fragment in place (no pane flash). Returns true only if every
   *  requested node was found + replaced; a miss → false so the caller can save loud and self-heal. */
  async #patchEntry(id, { card = true, book = true } = {}) {
    const pane = this.#archivePane();
    const e = getArchive().entries.find((x) => x.id === id);
    if (!pane || !e) return false;
    let ok = true;
    if (card) {
      const old = pane.querySelector(`.arc-card[data-arc-id="${id}"]`);
      const el = old ? await this.#renderArchiveCardEl(e) : null;
      if (old && el) { old.replaceWith(el); this.#bindCardMenu(el); } else ok = false;
    }
    if (book) {
      const old = pane.querySelector(`.section-drawer[data-drawer="${id}"]`);
      const el = old ? await this.#renderArchiveBookEl(e) : null;
      if (old && el) { old.replaceWith(el); this.#bindArchiveEdits(el); this.#applyArchiveDrawers(); } else ok = false;
    }
    return ok;
  }

  /** Patch an entry's card/book in place; if a target node was missing, fall back to a loud archive render
   *  so the change still lands. For the SAVE-FIRST ops (image/banner/stat-block/tier, where the fragment
   *  must read the freshly-saved value) the quiet save has already spent the one-shot skip flag, so this
   *  explicit render heals a miss instead of being swallowed. */
  async #patchEntryOrHeal(id, opts) {
    if (!(await this.#patchEntry(id, opts))) this.render({ parts: ["archive"] });
  }

  /** Move an entry's card from its current grid to another category's grid, reconciling both tab counts +
   *  the source's empty-state. The entry's book stays put (its category <select> already shows the value). */
  #patchMoveEntryCategory(id, newCat) {
    const pane = this.#archivePane();
    const card = pane?.querySelector(`.arc-card[data-arc-id="${id}"]`);
    const oldCat = card?.closest(".arc-pane")?.dataset.arctab;
    const destGrid = this.#ensureGrid(newCat);
    if (!card || !destGrid || !oldCat || oldCat === newCat) return false;
    destGrid.appendChild(card);
    this.#updateCatCount(newCat);
    this.#updateCatCount(oldCat);
    this.#restoreEmptyIfNeeded(oldCat);
    return true;
  }

  /** Delete a category in place: move its cards into the fallback category's grid, drop its tab + pane.
   *  The re-filed entries' books stay (flat, keyed by id); their category <select> self-heals next render. */
  #patchDeleteCategory(id, fallbackId) {
    const pane = this.#archivePane();
    const delPane = pane?.querySelector(`.arc-pane[data-arctab="${id}"]`);
    const delTab = pane?.querySelector(`.arc-subnav .hq-tab[data-arctab="${id}"]`);
    if (!pane || !delPane || !delTab || !fallbackId) return false;
    const cards = [...delPane.querySelectorAll(".arc-card")];
    if (cards.length) {
      const destGrid = this.#ensureGrid(fallbackId);
      if (!destGrid) return false;
      for (const c of cards) destGrid.appendChild(c);
    }
    delTab.remove();
    delPane.remove();
    this.#updateCatCount(fallbackId);
    this.#applyArchiveTabs();   // #archiveTab was repointed to the fallback by the caller
    return true;
  }

  /** Append a blank vital row to an entry's open book and focus it. Mirrors the template's `.ab-vrow`
   *  (the delete link rides the app's delegated `data-action`; the inputs need an explicit change bind). */
  #patchAddVital(id, vid) {
    const wrap = this.#archivePane()?.querySelector(`.section-drawer[data-drawer="${id}"] .ab-vitals.edit`);
    if (!wrap) return false;
    const row = document.createElement("div");
    row.className = "ab-vrow";
    const mk = (field, ph) => {
      const i = document.createElement("input");
      i.dataset.arcId = id; i.dataset.arcVital = vid; i.dataset.vitalField = field;
      i.placeholder = game.i18n.localize(ph);
      i.addEventListener("change", this.#onArchiveVitalChange.bind(this));
      return i;
    };
    const del = document.createElement("a");
    del.className = "ab-vdel"; del.dataset.action = "removeEntryVital"; del.dataset.arcId = id; del.dataset.vital = vid;
    del.innerHTML = `<i class="fas fa-xmark"></i>`;
    row.append(mk("k", "PROJECTANIME.Archive.vitalKey"), mk("v", "PROJECTANIME.Archive.vitalVal"), del);
    wrap.appendChild(row);
    row.querySelector("input")?.focus();
    return true;
  }

  /** Remove a vital row from an entry's open book in place. Returns true if the row was found. */
  #patchRemoveVital(id, vid) {
    const row = this.#archivePane()
      ?.querySelector(`.section-drawer[data-drawer="${id}"] .ab-vrow input[data-arc-vital="${vid}"]`)
      ?.closest(".ab-vrow");
    if (!row) return false;
    row.remove();
    return true;
  }

  /** Remove a deleted entry's card + detail book in place, and reconcile its category tab's count badge
   *  (and restore the "no entries" empty-state if that was the last card). Returns true if found. */
  #patchDeleteEntry(id) {
    const pane = this.#archivePane();
    if (!pane) return false;
    pane.querySelector(`.section-drawer[data-drawer="${id}"]`)?.remove();
    const card = pane.querySelector(`.arc-card[data-arc-id="${id}"]`);
    if (!card) return false;
    const catId = card.closest(".arc-pane")?.dataset.arctab;
    card.remove();
    if (catId) { this.#updateCatCount(catId); this.#restoreEmptyIfNeeded(catId); }
    return true;
  }

  /** Reorder the category tabs + panes to match the stored sort. Returns true if the containers exist. */
  #patchReorderCategories() {
    const pane = this.#archivePane();
    const subnav = pane?.querySelector(".arc-subnav");
    const scroll = pane?.querySelector(".arc-scroll");
    if (!subnav || !scroll) return false;
    for (const c of getArchive().categories.slice().sort((a, b) => a.sort - b.sort)) {
      const tab = subnav.querySelector(`.hq-tab[data-arctab="${c.id}"]`);
      if (tab) subnav.appendChild(tab);
      const p = scroll.querySelector(`.arc-pane[data-arctab="${c.id}"]`);
      if (p) scroll.appendChild(p);
    }
    return true;
  }

  /** Patch a category tab's label and/or icon in place. Returns true if the tab was found. */
  #patchCategoryTab(id, { label, icon } = {}) {
    const tab = this.#archivePane()?.querySelector(`.arc-subnav .hq-tab[data-arctab="${id}"]`);
    if (!tab) return false;
    if (label != null) { const span = tab.querySelector("span:not(.nb)"); if (span) span.textContent = label; }
    if (icon != null) { const i = tab.querySelector("i"); if (i) i.className = `fas ${icon}`; }
    return true;
  }

  /** Append a new (empty) category tab + pane in place and switch to it. Returns false (→ caller saves
   *  loud, so the onChange renders) if the pane structure isn't present (e.g. the first-ever category).
   *  The new tab/foot use EXPLICIT listeners (not data-action) so they work without depending on the
   *  framework's action delegation for dynamically-added nodes. */
  #patchNewCategory(cat) {
    const pane = this.#archivePane();
    const subnav = pane?.querySelector(".arc-subnav");
    const scroll = pane?.querySelector(".arc-scroll");
    if (!subnav || !scroll) return false;
    const L = (k) => game.i18n.localize(k);
    const tab = document.createElement("button");
    tab.type = "button"; tab.className = "hq-tab"; tab.dataset.arctab = cat.id;
    tab.innerHTML = `<i class="fas ${cat.icon}"></i> <span></span>`;
    tab.querySelector("span").textContent = cat.label;
    tab.addEventListener("click", () => { if (this.#archiveTab !== cat.id) { this.#archiveTab = cat.id; this.#applyArchiveTabs(); } });
    tab.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#openArchiveCatContext(cat.id, ev); });
    subnav.appendChild(tab);
    const p = document.createElement("div");
    p.className = "hq-tabpane arc-pane"; p.dataset.arctab = cat.id;
    const empty = document.createElement("div");
    empty.className = "hq-empty sm";
    empty.innerHTML = `<i class="fas ${cat.icon}"></i><p></p>`;
    empty.querySelector("p").textContent = L("PROJECTANIME.Archive.empty");
    const foot = document.createElement("div");
    foot.className = "arc-foot";
    const newBtn = document.createElement("button");
    newBtn.type = "button"; newBtn.className = "arc-new-entry";
    newBtn.innerHTML = `<i class="fas fa-plus"></i> `;
    newBtn.append(L("PROJECTANIME.Archive.newEntry"));
    newBtn.addEventListener("click", (ev) => Codex.#onNewArchiveEntry.call(this, ev, { dataset: { arctab: cat.id } }));
    const drop = document.createElement("div");
    drop.className = "rec-drop arc-drop"; drop.dataset.archiveDrop = cat.id;
    drop.innerHTML = `<i class="fas fa-hand-pointer"></i> <span class="frew-drop-hint"></span>`;
    drop.querySelector(".frew-drop-hint").textContent = L("PROJECTANIME.Archive.dropHint");
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("drag-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
    drop.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.remove("drag-over"); this.#onArchiveDrop(ev, cat.id); });
    foot.append(newBtn, drop);
    p.append(empty, foot);
    scroll.appendChild(p);
    this.#applyArchiveTabs();
    return true;
  }

}

/* -------------------------------------------------------------------------- */
/*  On-canvas quest tracker — per client, driven by the tracked-quest setting. */
/* -------------------------------------------------------------------------- */

export const ChronicleTracker = {
  el: null,
  pos: null,    // { x, y } in px (left/top) once the user has dragged it; null = default CSS corner
  min: false,   // collapsed to just its header + title?
  STORE: "project-anime.trackerState", // per-client persistence (localStorage)

  /** Load the persisted position + minimized state (per client). */
  loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(this.STORE) || "{}");
      this.pos = (Number.isFinite(s.x) && Number.isFinite(s.y)) ? { x: s.x, y: s.y } : null;
      this.min = !!s.min;
    } catch (_e) { this.pos = null; this.min = false; }
  },

  /** Persist position + minimized state. */
  saveState() {
    try {
      localStorage.setItem(this.STORE, JSON.stringify({ x: this.pos?.x ?? null, y: this.pos?.y ?? null, min: this.min }));
    } catch (_e) { /* non-fatal (private mode / quota) */ }
  },

  /** Apply the stored minimized class + position to the live element, clamped to the viewport. */
  applyState() {
    if (!this.el) return;
    this.el.classList.toggle("min", this.min);
    if (this.pos) {
      const w = this.el.offsetWidth || 246, h = this.el.offsetHeight || 80;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, this.pos.x));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, this.pos.y));
      Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
    }
  },

  /** Rebuild (or remove) the floating tracker for the currently tracked quest. */
  refresh() {
    const visible = game.settings.get("project-anime", TRACKER_VISIBLE_SETTING);
    const id = game.settings.get("project-anime", TRACKED_SETTING);
    const quest = id ? getQuests().find((q) => q.id === id) : null;
    if (!visible || !quest || quest.status === "done") {
      this.el?.remove();
      this.el = null;
      return;
    }
    if (!this.el) {
      this.loadState();
      this.el = document.createElement("aside");
      this.el.className = "project-anime theme-dark chronicle-tracker";
      document.body.appendChild(this.el);
    }
    const cat = QUEST_CATEGORIES[quest.category] ?? QUEST_CATEGORIES.main;
    const prog = questProgress(quest);
    const objs = (quest.objectives ?? [])
      .filter((o) => !o.hidden)
      .slice(0, 4)
      .map((o) => `<div class="ct-obj ${o.done ? "done" : ""}"><span class="b"></span><span>${escHtml(o.text)}</span></div>`)
      .join("");
    this.el.style.setProperty("--cat", cat.color);
    this.el.innerHTML = `
      <div class="ct-head" title="${game.i18n.localize("PROJECTANIME.Chronicle.minimizeHint")}">
        <span class="tk">${game.i18n.localize("PROJECTANIME.Chronicle.tracking")}</span>
        <span class="ct-btn ct-hide" data-ct="hide" title="${game.i18n.localize("PROJECTANIME.Chronicle.hideTracker")}"><i class="fa-solid fa-eye-slash"></i></span>
        <span class="ct-btn ct-x" data-ct="untrack" title="${game.i18n.localize("PROJECTANIME.Chronicle.untrack")}">✕</span>
      </div>
      <div class="ct-name" data-ct="open" title="${escHtml(quest.title)}">${escHtml(quest.title)}</div>
      <div class="ct-objs">${objs}</div>
      <div class="ct-foot"><div class="bar"><div class="fill" style="width:${prog.pct}%"></div></div></div>`;
    this.applyState();
    this.bindControls();
  },

  /** (Re)bind the header drag + control buttons after each rebuild (innerHTML wipes prior handlers). */
  bindControls() {
    const el = this.el;
    el.querySelector('[data-ct="untrack"]')?.addEventListener("click", () =>
      game.settings.set("project-anime", TRACKED_SETTING, "")
    );
    el.querySelector('[data-ct="hide"]')?.addEventListener("click", () =>
      game.settings.set("project-anime", TRACKER_VISIBLE_SETTING, false)
    );
    el.querySelector('[data-ct="open"]')?.addEventListener("click", () => Codex.open("quests"));
    const head = el.querySelector(".ct-head");
    // Double-click the header bar to minimize / restore — like a Foundry sheet's title bar.
    head?.addEventListener("dblclick", (ev) => {
      if (ev.target.closest("[data-ct]")) return; // ignore the ✕ control
      this.min = !this.min;
      el.classList.toggle("min", this.min);
      this.saveState();
    });
    head?.addEventListener("pointerdown", (ev) => this.startDrag(ev));
  },

  /** Drag the tracker by its header bar (clicks on the control buttons are left alone). */
  startDrag(ev) {
    if (ev.button !== 0 || ev.target.closest("[data-ct]")) return;
    ev.preventDefault();
    const el = this.el;
    const rect = el.getBoundingClientRect();
    const offX = ev.clientX - rect.left, offY = ev.clientY - rect.top;
    el.classList.add("dragging");
    const move = (e) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - offX));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - offY));
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
      this.pos = { x, y };
    };
    const up = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.saveState();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
};
