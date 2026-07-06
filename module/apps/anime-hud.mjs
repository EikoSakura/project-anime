/**
 * Project: Anime â€” Cinematic HUD.
 *
 * A persistent, anime/JRPG-styled action bar that REPLACES Foundry's macro hotbar and the
 * bottom-left Players name list:
 *   â€¢ AnimeHud      â€” bottom-centre console: diamond portrait anchor (click â†’ character
 *                     picker), iridescent HP/EP bars, a row of small chamfered action slots
 *                     you fill by dragging Skills / weapons / items from the character sheet,
 *                     1â€“5 pages, and a util cluster (open sheet / settings popover).
 *   â€¢ AnimePartyRail â€” small diamond portrait chips at the lower-left, replacing the names
 *                     list (hover for the name; your own character is purple-framed).
 *
 * Both are frameless ApplicationV2 widgets anchored from CSS, mirroring effects-panel.mjs /
 * token-info.mjs. Everything is per-client and reversible: a player can turn the whole HUD
 * off from Settings (the "Cinematic HUD" toggle), which restores the native hotbar/players.
 *
 * Slot loadouts are stored on the ACTOR (`flags.project-anime.hudSlots[page][index] = uuid`)
 * so they follow the character and are shared by everyone who controls it. Reuses the
 * existing "Cinematic Dossier" design tokens (--pa-*) plus its diamond-portrait and
 * iridescent-bar motifs, so it reads as one cohesive theme.
 */

import { canSeeTokenVitals } from "./token-info.mjs";
import { PROJECTANIME, combatantSide, activeSide, pendingOnSide, hasActed, isSkippable, healthStatus, enemyRoleThreat } from "../helpers/config.mjs";
import { rollCheck } from "../helpers/dice.mjs";
import { liveEffects } from "../helpers/effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SYS = "project-anime";

export const HUD_ENABLED_SETTING = "hudEnabled";
export const HUD_SELECT_MODE_SETTING = "hudSelectMode";
export const HUD_INTENSITY_SETTING = "hudIntensity";
export const HUD_SLOT_SHAPE_SETTING = "hudSlotShape";
export const HUD_SLOT_SIZE_SETTING = "hudSlotSize";
export const HUD_SHOW_PARTY_SETTING = "hudShowParty";
export const HUD_COMBAT_SETTING = "hudCombat";
export const HUD_PARTY_POS_SETTING = "hudPartyPos";    // { left, top } viewport px; {} = default corner
export const HUD_PARTY_SIZE_SETTING = "hudPartySize";  // "280" | "340" | "420" (--ph-w width)
export const HUD_PARTY_COLLAPSED_SETTING = "hudPartyCollapsed";  // bool — grip double-click minimizes to the title bar

const SLOTS_PER_PAGE = 14;   // 7 columns × 2 rows — packs the shortcut span with no gaps
const PAGES = 5;
const KEYS = Array.from({ length: SLOTS_PER_PAGE }, (_, i) => String(i + 1));

/** Per-item-type accent colour for the slot's top stripe / glow (Genshin-style tinting). */
const TYPE_ACCENT = {
  skill: "var(--pa-accent)",
  weapon: "var(--pa-gold)",
  shield: "var(--pa-gold)",
  consumable: "var(--pa-hp-b)",
  armor: "var(--pa-energy-b)",
  accessory: "var(--pa-energy-b)",
  container: "var(--pa-ink-soft)"
};

const FALLBACK_IMG = "icons/svg/mystery-man.svg";
const pct = (r) => (r?.max ? Math.clamp(Math.round((Number(r.value) / Number(r.max)) * 100), 0, 100) : 0);

/** Map a combatant's token disposition to a theme accent class â€” drives the tracker's active-row
 *  tint (ally = accent, enemy = danger, neutral = gold), Ã  la pf2e-hud's disposition colouring. */
const DISP_CLASS = (c) => {
  const D = CONST.TOKEN_DISPOSITIONS;
  const d = c?.token?.disposition ?? c?.actor?.prototypeToken?.disposition ?? D.HOSTILE;
  return d === D.FRIENDLY ? "friendly" : d === D.NEUTRAL ? "neutral" : d === D.SECRET ? "secret" : "hostile";
};

/** The colour a Party HUD entry is tinted — its owning player's chosen sheet accent, synced to a user
 *  flag (`flags.project-anime.accent`, so every client can read it), else that player's Foundry user
 *  colour, else null (→ the CSS gold default). The viewer's OWN entry keys off `--pa-player-accent`
 *  directly (CSS), so this returns null for self. */
function memberAccent(actor) {
  if (!actor) return null;
  const owner = game.users.find((u) => !u.isGM && u.character?.id === actor.id)
    ?? game.users.find((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER"));
  if (!owner) return null;
  const flag = owner.getFlag(SYS, "accent");
  if (flag) return flag;
  const col = owner.color;
  return col?.css ?? (typeof col === "string" ? col : null);
}

/** Tint palette for the Party HUD's small status dots; unknown conditions fall back to the accent. */
const STATUS_TINT = {
  poison: "#8ad35f", poisoned: "#8ad35f", burning: "#ff8a5c", burn: "#ff8a5c",
  bleeding: "#c34155", bleed: "#c34155", stun: "#ffd24a", stunned: "#ffd24a",
  slow: "#7c8fe8", slowed: "#7c8fe8", bound: "#b079e6", prone: "#a39db8", sealed: "#c58cff"
};

/* ============================================================
   Settings + global on/off
   ============================================================ */

export function registerHudSettings() {
  game.settings.register(SYS, HUD_ENABLED_SETTING, {
    name: "PROJECTANIME.Settings.hud.enabled.name",
    hint: "PROJECTANIME.Settings.hud.enabled.hint",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => applyHudState()
  });

  // pf2e-hud "Selection Mode": whether the bar drives your assigned character (default) or follows the
  // owned token you have selected on the canvas. Per-client.
  game.settings.register(SYS, HUD_SELECT_MODE_SETTING, {
    name: "PROJECTANIME.Settings.hud.selectMode.name",
    hint: "PROJECTANIME.Settings.hud.selectMode.hint",
    scope: "client",
    config: false,
    type: String,
    default: "character",
    choices: {
      character: "PROJECTANIME.Hud.selectMode.character",
      selection: "PROJECTANIME.Hud.selectMode.selection"
    },
    onChange: () => globalThis.projectanime?.hud?.refresh()
  });

  game.settings.register(SYS, HUD_INTENSITY_SETTING, {
    name: "PROJECTANIME.Settings.hud.intensity.name",
    hint: "PROJECTANIME.Settings.hud.intensity.hint",
    scope: "client",
    config: false,
    type: String,
    default: "cinematic",
    choices: {
      restrained: "PROJECTANIME.Hud.intensity.restrained",
      cinematic: "PROJECTANIME.Hud.intensity.cinematic",
      anime: "PROJECTANIME.Hud.intensity.anime"
    },
    onChange: () => globalThis.projectanime?.hud?.refresh()
  });

  game.settings.register(SYS, HUD_SLOT_SHAPE_SETTING, {
    name: "PROJECTANIME.Settings.hud.shape.name",
    scope: "client",
    config: false,
    type: String,
    default: "chamfer",
    choices: {
      chamfer: "PROJECTANIME.Hud.shape.chamfer",
      skew: "PROJECTANIME.Hud.shape.skew",
      round: "PROJECTANIME.Hud.shape.round"
    },
    onChange: () => globalThis.projectanime?.hud?.refresh()
  });

  game.settings.register(SYS, HUD_SLOT_SIZE_SETTING, {
    name: "PROJECTANIME.Settings.hud.size.name",
    scope: "client",
    config: false,
    type: String,
    default: "44",
    choices: {
      "38": "PROJECTANIME.Hud.size.small",
      "44": "PROJECTANIME.Hud.size.medium",
      "52": "PROJECTANIME.Hud.size.large"
    },
    onChange: () => globalThis.projectanime?.hud?.refresh()
  });

  game.settings.register(SYS, HUD_SHOW_PARTY_SETTING, {
    name: "PROJECTANIME.Settings.hud.party.name",
    hint: "PROJECTANIME.Settings.hud.party.hint",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => { applyHudState(); }
  });

  // Party HUD position (per-client, drag-driven) + size. Position has no config row — it's set by
  // dragging the grip / reset; size mirrors the slot-size 3-choice pattern.
  game.settings.register(SYS, HUD_PARTY_POS_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Party HUD minimized state (per-client) — double-clicking the grip collapses the roster to its title bar.
  game.settings.register(SYS, HUD_PARTY_COLLAPSED_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(SYS, HUD_PARTY_SIZE_SETTING, {
    name: "PROJECTANIME.Settings.hud.partySize.name",
    scope: "client",
    config: false,
    type: String,
    default: "340",
    choices: {
      "280": "PROJECTANIME.Hud.size.small",
      "340": "PROJECTANIME.Hud.size.medium",
      "420": "PROJECTANIME.Hud.size.large"
    },
    onChange: () => globalThis.projectanime?.party?.refresh()
  });

  game.settings.register(SYS, HUD_COMBAT_SETTING, {
    name: "PROJECTANIME.Settings.hud.combat.name",
    hint: "PROJECTANIME.Settings.hud.combat.hint",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => { globalThis.projectanime?.combat?.refresh(); globalThis.projectanime?.hud?.refresh(); }
  });

  // One grouped "Cinematic HUD" menu in System Settings (the individual settings above are
  // config:false so they're not scattered through the list). Not GM-restricted â€” per-client.
  game.settings.registerMenu(SYS, "hudSettingsMenu", {
    name: "PROJECTANIME.Settings.hudSettings.name",
    label: "PROJECTANIME.Settings.hudSettings.label",
    hint: "PROJECTANIME.Settings.hudSettings.hint",
    icon: "fa-solid fa-gamepad",
    type: HudSettingsConfig,
    restricted: false
  });
}

/** Apply the on/off + show-party state: toggle the body class that CSS-hides the native
 *  hotbar/players, then render or close our widgets. Safe to call any time after `ready`. */
export function applyHudState() {
  const on = game.settings.get(SYS, HUD_ENABLED_SETTING);
  const party = on && game.settings.get(SYS, HUD_SHOW_PARTY_SETTING);
  document.body.classList.toggle("pa-hud-on", !!on);
  document.body.classList.toggle("pa-party-on", !!party);
  const pa = globalThis.projectanime;
  if (on) pa?.hud?.render({ force: true }); else pa?.hud?.close();
  if (party) pa?.party?.render({ force: true }); else pa?.party?.close();
}

/* ============================================================
   Grouped "Cinematic HUD" settings dialog â€” one System-Settings entry
   gathering enable + intensity / slot shape / size + party rail + tracker.
   ============================================================ */

export class HudSettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-hud-settings",
    classes: ["project-anime", "element-config", "hud-settings-config"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "PROJECTANIME.Settings.hudSettings.title", icon: "fa-solid fa-gamepad" },
    form: { handler: HudSettingsConfig.#onSubmit, closeOnSubmit: true },
    actions: { resetPartyPos: HudSettingsConfig.#onResetPartyPos }
  };

  static PARTS = {
    form: { template: "systems/project-anime/templates/apps/hud-settings.hbs" }
  };

  /** @override */
  async _prepareContext() {
    const L = (k) => game.i18n.localize(k);
    const get = (k) => game.settings.get(SYS, k);
    return {
      enabled: get(HUD_ENABLED_SETTING),
      selectMode: get(HUD_SELECT_MODE_SETTING),
      selectModeChoices: {
        character: L("PROJECTANIME.Hud.selectMode.character"),
        selection: L("PROJECTANIME.Hud.selectMode.selection")
      },
      intensity: get(HUD_INTENSITY_SETTING),
      intensityChoices: {
        restrained: L("PROJECTANIME.Hud.intensity.restrained"),
        cinematic: L("PROJECTANIME.Hud.intensity.cinematic"),
        anime: L("PROJECTANIME.Hud.intensity.anime")
      },
      shape: get(HUD_SLOT_SHAPE_SETTING),
      shapeChoices: {
        chamfer: L("PROJECTANIME.Hud.shape.chamfer"),
        skew: L("PROJECTANIME.Hud.shape.skew"),
        round: L("PROJECTANIME.Hud.shape.round")
      },
      size: get(HUD_SLOT_SIZE_SETTING),
      sizeChoices: {
        "38": L("PROJECTANIME.Hud.size.small"),
        "44": L("PROJECTANIME.Hud.size.medium"),
        "52": L("PROJECTANIME.Hud.size.large")
      },
      partySize: get(HUD_PARTY_SIZE_SETTING),
      partySizeChoices: {
        "280": L("PROJECTANIME.Hud.size.small"),
        "340": L("PROJECTANIME.Hud.size.medium"),
        "420": L("PROJECTANIME.Hud.size.large")
      },
      showParty: get(HUD_SHOW_PARTY_SETTING),
      showCombat: get(HUD_COMBAT_SETTING)
    };
  }

  static async #onSubmit(event, form, formData) {
    const o = formData.object;
    await game.settings.set(SYS, HUD_SELECT_MODE_SETTING, o.selectMode);
    await game.settings.set(SYS, HUD_INTENSITY_SETTING, o.intensity);
    await game.settings.set(SYS, HUD_SLOT_SHAPE_SETTING, o.shape);
    await game.settings.set(SYS, HUD_SLOT_SIZE_SETTING, o.size);
    await game.settings.set(SYS, HUD_PARTY_SIZE_SETTING, o.partySize);
    await game.settings.set(SYS, HUD_SHOW_PARTY_SETTING, !!o.showParty);
    await game.settings.set(SYS, HUD_COMBAT_SETTING, !!o.showCombat);
    // Set enabled last: its onChange (applyHudState) re-renders using the values just saved.
    await game.settings.set(SYS, HUD_ENABLED_SETTING, !!o.enabled);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.hudSettings.saved"));
  }

  /** Reset the Party HUD to its default corner — clears the saved drag position, then re-renders it. */
  static async #onResetPartyPos() {
    await game.settings.set(SYS, HUD_PARTY_POS_SETTING, {});
    globalThis.projectanime?.party?.render();
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.hud.resetPartyPosDone"));
  }
}

/* ============================================================
   The bottom-centre console
   ============================================================ */

export class AnimeHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-hud",
    // theme-dark: this floats over the (dark) canvas, so it stays dark regardless of the
    // user's Foundry UI theme â€” same call the token-info panel makes.
    classes: ["project-anime", "theme-dark", "pa-glass", "anime-hud"],
    window: { frame: false, positioned: false },
    actions: {
      hudPage: AnimeHud.#onPage,
      hudPicker: AnimeHud.#onTogglePicker,
      hudChoose: AnimeHud.#onChoose,
      hudSheet: AnimeHud.#onOpenSheet,
      hudSettings: AnimeHud.#onToggleSettings,
      hudSet: AnimeHud.#onSet,
      hudStat: AnimeHud.#onStat,
      hudSidebar: AnimeHud.#onSidebar,
      hudUse: AnimeHud.#onUse,
      hudAlliance: AnimeHud.#onAlliance,
      hudClearPage: AnimeHud.#onClearPage,
      hudEffect: AnimeHud.#onEffect
    }
  };

  static PARTS = {
    hud: { template: "systems/project-anime/templates/apps/anime-hud.hbs" }
  };

  /** Current hotbar page (1..5). Transient â€” resets to 1 on reload. */
  #page = 1;
  /** Which popover is open, if any: "picker" | "settings" | null. */
  #popover = null;
  /** Which sidebar tab is open, if any: "skills" | "arms" | "items" | null. */
  #sidebar = null;
  /** Transient name filter for the open sidebar — applied client-side in _onRender so typing never
   *  triggers a re-render (which would drop focus). */
  #sbFilter = "";

  refresh = foundry.utils.debounce(this.render.bind(this), 100);

  /** The actor this HUD drives, per the pf2e-hud-style Selection Mode:
   *  • "character" (default): your assigned character first (it's YOUR bar), falling back to a
   *    controlled token's actor (lets a GM with no character drive the selected creature).
   *  • "selection": an owned controlled token leads (drive any creature — companion, summon, NPC —
   *    with its full stats + sidebars, no sheet), falling back to your character when nothing's picked. */
  get actor() {
    const controlled = canvas?.tokens?.controlled?.find((t) => t.actor?.isOwner)?.actor ?? null;
    const mine = game.user?.character ?? null;
    if (game.settings.get(SYS, HUD_SELECT_MODE_SETTING) === "selection") return controlled ?? mine;
    return mine ?? controlled;
  }

  /** @override — build every pf2e region for the driven actor: effects strip · vitals overlay ·
   *  5 attributes (info) · 6 derived (statistics) · 2 identity stats (details) · Luck (resources) ·
   *  disposition (alliance) · sidebar tabs · 10 shortcut slots · page slider. Popovers (picker /
   *  settings / sidebar panel) are reachable even with no actor so a GM can still configure. */
  async _prepareContext() {
    const actor = this.actor;
    const L = (k) => game.i18n.localize(k);
    const intensity = game.settings.get(SYS, HUD_INTENSITY_SETTING);

    const ctx = {
      hasActor: !!actor,
      intensity,
      page: this.#page,
      popoverPicker: this.#popover === "picker",
      popoverSettings: this.#popover === "settings",
      pageSlider: {
        value: this.#page, prev: this.#page - 1, next: this.#page + 1,
        canBack: this.#page > 1, canForward: this.#page < PAGES
      }
    };
    ctx.img = actor?.img || FALLBACK_IMG;

    // Picker + settings popover are reachable even with NO active actor, so a GM (no assigned
    // character, nothing selected) can still pick a character / configure / toggle the HUD off.
    ctx.picks = game.actors
      .filter((a) => a.isOwner && (a.type === "character" || a.type === "npc"))
      .map((a) => ({ id: a.id, name: a.name, img: a.img || FALLBACK_IMG, sel: a.id === actor?.id }));

    const seg = (key, cur, opts) => opts.map((o) => ({
      key, value: o.v, label: L(o.l), active: o.v === String(cur)
    }));
    ctx.segIntensity = seg(HUD_INTENSITY_SETTING, intensity, [
      { v: "restrained", l: "PROJECTANIME.Hud.intensity.restrained" },
      { v: "cinematic", l: "PROJECTANIME.Hud.intensity.cinematic" },
      { v: "anime", l: "PROJECTANIME.Hud.intensity.anime" }
    ]);
    const selectMode = game.settings.get(SYS, HUD_SELECT_MODE_SETTING);
    ctx.segSelect = seg(HUD_SELECT_MODE_SETTING, selectMode, [
      { v: "character", l: "PROJECTANIME.Hud.selectMode.character" },
      { v: "selection", l: "PROJECTANIME.Hud.selectMode.selection" }
    ]);
    // In selection mode, flag when the bar drives a selected token rather than your own character,
    // so a small crosshair on the name makes the swap obvious.
    ctx.selection = selectMode === "selection" && !!actor && actor.id !== game.user?.character?.id;
    ctx.showParty = game.settings.get(SYS, HUD_SHOW_PARTY_SETTING);
    ctx.showCombat = game.settings.get(SYS, HUD_COMBAT_SETTING);

    if (actor) {
      const s = actor.system ?? {};
      ctx.name = actor.name;
      const hp = s.hp ?? { value: 0, max: 0 };
      const en = s.energy ?? { value: 0, max: 0 };
      ctx.vitals = {
        hp: { value: hp.value ?? 0, max: hp.max ?? 0, pct: pct(hp) },
        en: { value: en.value ?? 0, max: en.max ?? 0, pct: pct(en) }
      };

      // info → the 5 ATTRIBUTES (click rolls a Check via the sheet's rollCheck path).
      ctx.attrs = PROJECTANIME.attributeKeys.map((k) => ({
        key: k,
        icon: PROJECTANIME.attributeIcons?.[k] ?? "fa-solid fa-circle",
        label: L(PROJECTANIME.attributes?.[k] ?? PROJECTANIME.attributeAbbr[k] ?? k),
        value: Number(s.attributes?.[k]?.value ?? 0)
      }));

      // statistics → the 6 DERIVED (reference values, click posts a compact line to chat).
      ctx.derived = [
        { key: "evasion",  icon: "fa-solid fa-person-running", label: L("PROJECTANIME.Stat.evasion"),     value: Number(s.evasion?.value ?? 0) },
        { key: "defense",  icon: "fa-solid fa-shield-halved",  label: L("PROJECTANIME.Stat.defense"),     value: Number(s.defense?.value ?? 0) },
        { key: "res",      icon: "fa-solid fa-hand-sparkles",  label: L("PROJECTANIME.Stat.resistance"),  value: Number(s.res?.value ?? 0) },
        { key: "atk",      icon: "fa-solid fa-khanda",         label: L("PROJECTANIME.Stat.atk"),         value: Number(s.atk?.value ?? 0) },
        { key: "as",       icon: "fa-solid fa-gauge-high",     label: L("PROJECTANIME.Stat.attackSpeed"), value: Number(s.as?.value ?? 0) },
        { key: "movement", icon: "fa-solid fa-shoe-prints",    label: L("PROJECTANIME.Stat.movement"),    value: Number(s.movement?.value ?? 0) }
      ];

      // details → 2 identity stats (Carry · Movement — the pf2e level/speed slot).
      const carry = s.carryingCapacity ?? {};
      ctx.details = [
        { key: "carry",    icon: "fa-solid fa-weight-hanging", label: L("PROJECTANIME.Hud.carry"),     value: Number(carry.value ?? 0), danger: !!carry.overloaded },
        { key: "movement", icon: "fa-solid fa-shoe-prints",    label: L("PROJECTANIME.Stat.movement"), value: Number(s.movement?.value ?? 0) }
      ];

      // resources → Luck dice (the hero-points analog).
      const luck = Array.isArray(s.luckDice) ? s.luckDice : [];
      ctx.luck = { dice: luck, count: luck.length, tooltip: luck.length ? `${L("PROJECTANIME.Hud.luck")}: ${luck.join(", ")}` : L("PROJECTANIME.Hud.luck") };

      // alliance → token disposition / side.
      ctx.alliance = this.#allianceData(actor);

      // effects → live-effect icon strip (reuse the engine's "what's live" set).
      const eff = this.#effectData(actor);
      ctx.effects = eff;
      ctx.noEffects = !eff.length;

      ctx.slots = await this.#slotData(actor);
      ctx.sbTabs = this.#sidebarTabs();
      if (this.#sidebar) ctx.sbPanel = this.#sidebarPanel(actor, this.#sidebar);
    } else {
      ctx.noActorName = L("PROJECTANIME.Hud.noActorName");
    }
    return ctx;
  }

  /** The alliance region's disposition badge: the actor's active-token disposition (else the
   *  prototype token's), mapped to an icon + side label. Owners / the GM may click to cycle it
   *  (Friendly → Neutral → Hostile), mirroring pf2e's alliance toggle. */
  #allianceData(actor) {
    const D = CONST.TOKEN_DISPOSITIONS;
    const L = (k) => game.i18n.localize(k);
    const tok = actor.getActiveTokens?.()?.[0]?.document ?? null;
    const disp = tok?.disposition ?? actor.prototypeToken?.disposition ?? D.FRIENDLY;
    const MAP = {
      [D.FRIENDLY]: { key: "friendly", icon: "fa-solid fa-handshake-simple", label: "PROJECTANIME.Hud.alliance.friendly" },
      [D.NEUTRAL]:  { key: "neutral",  icon: "fa-solid fa-face-meh",         label: "PROJECTANIME.Hud.alliance.neutral" },
      [D.HOSTILE]:  { key: "hostile",  icon: "fa-solid fa-skull",            label: "PROJECTANIME.Hud.alliance.hostile" },
      [D.SECRET]:   { key: "secret",   icon: "fa-solid fa-user-secret",      label: "PROJECTANIME.Hud.alliance.secret" }
    };
    const m = MAP[disp] ?? MAP[D.FRIENDLY];
    return { key: m.key, icon: m.icon, label: L(m.label), canCycle: game.user.isGM || actor.isOwner };
  }

  /** The effects strip: the engine's live effects (equip- / toggle-gated, never unequipped gear),
   *  each an icon + optional remaining-duration badge, tooltip = name (+ duration). */
  #effectData(actor) {
    const timers = actor.getFlag(SYS, "statusTimers") ?? {};
    const timerN = (t) => (t && typeof t === "object" ? Number(t.n) : Number(t)) || 0;   // {n,side} or legacy number
    const remaining = (e) => {
      for (const id of e.statuses ?? []) if (id in timers) return timerN(timers[id]);
      const r = e.duration?.remaining;
      return Number.isFinite(r) && r > 0 ? Math.ceil(r) : null;
    };
    return liveEffects(actor).map((e) => {
      const dur = e.isTemporary ? (e.duration?.label ?? "") : "";
      return { uuid: e.uuid, img: e.img, name: e.name, tooltip: dur ? `${e.name} · ${dur}` : e.name, dur: remaining(e) };
    });
  }

  /** The always-visible sidebar tab strip (Skills / Arms / Items) seated on the bar's top edge, with
   *  the open one flagged. pf2e-hud's "browse everything without opening the sheet" entry point. */
  #sidebarTabs() {
    const L = (k) => game.i18n.localize(k);
    return [
      { key: "skills", label: L("PROJECTANIME.Hud.sidebar.skills"), icon: "fa-wand-magic-sparkles" },
      { key: "arms",   label: L("PROJECTANIME.Hud.sidebar.arms"),   icon: "fa-khanda" },
      { key: "items",  label: L("PROJECTANIME.Hud.sidebar.items"),  icon: "fa-flask" }
    ].map((t) => ({ ...t, active: t.key === this.#sidebar }));
  }

  /** Build the open sidebar's rows for `key` ("skills" | "arms" | "items"). Each row is click-to-use
   *  (item.roll() — a Skill rolls, a weapon attacks, a consumable posts its Use card) and drag-to-slot
   *  (native Item drag data the slot #drop already reads). Lists everything the actor owns of that
   *  category, so it genuinely replaces opening the sheet to arm a slot. */
  #sidebarPanel(actor, key) {
    const L = (k) => game.i18n.localize(k);
    const bySort = (a, b) => (a.sort || 0) - (b.sort || 0);
    const curEN = actor.system?.energy?.value ?? 0;
    const ATLABEL = { action: "PROJECTANIME.Quick.active", react: "PROJECTANIME.Quick.react", passive: "PROJECTANIME.Quick.passive" };
    let items = [];
    if (key === "skills") {
      items = actor.items.filter((i) => i.type === "skill").sort(bySort).map((i) => {
        const cost = i.system?.energyCost || 0;
        const at = i.system?.actionType || "action";
        return { uuid: i.uuid, name: i.name, img: i.img || FALLBACK_IMG, sub: L(ATLABEL[at] ?? ATLABEL.action), cost, dim: cost > curEN };
      });
    } else if (key === "arms") {
      const nat = (i) => !!i.getFlag(SYS, "natural");
      items = actor.items.filter((i) => i.type === "weapon" || i.type === "shield")
        .sort((a, b) => (!!b.system?.equipped - !!a.system?.equipped) || bySort(a, b))
        .map((i) => ({
          uuid: i.uuid, name: i.name, img: i.img || FALLBACK_IMG,
          sub: nat(i) ? L("PROJECTANIME.NaturalAttack.tag") : L(`TYPES.Item.${i.type}`),
          on: !!i.system?.equipped
        }));
    } else {
      const GEAR = ["armor", "accessory", "consumable", "gear"];
      items = actor.items.filter((i) => GEAR.includes(i.type)).sort(bySort).map((i) => {
        const qty = i.system?.quantity;
        return {
          uuid: i.uuid, name: i.name, img: i.img || FALLBACK_IMG, sub: L(`TYPES.Item.${i.type}`),
          badge: (i.type === "consumable" && qty != null) ? `×${qty}` : ""
        };
      });
    }
    return { key, title: L(`PROJECTANIME.Hud.sidebar.${key}`), items, empty: !items.length };
  }

  /** Resolve the actor's stored slot UUIDs for the current page into render rows. */
  async #slotData(actor) {
    const map = actor.getFlag(SYS, "hudSlots")?.[this.#page] ?? {};
    const out = [];
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const uuid = map[i];
      let item = null;
      if (uuid) { try { item = await fromUuid(uuid); } catch (_) { item = null; } }
      if (item) {
        out.push({
          i, key: KEYS[i], filled: true,
          name: item.name, img: item.img || FALLBACK_IMG, type: item.type,
          cost: item.type === "skill" ? (item.system?.energyCost || 0) : 0,
          accent: TYPE_ACCENT[item.type] ?? "var(--pa-accent)"
        });
      } else {
        out.push({ i, key: KEYS[i], filled: false });
      }
    }
    return out;
  }

  /** @override â€” mount into #interface (untransformed, full-area) so we can position the bar
   *  centered in the play area while reserving the chat sidebar's width on the right (CSS).
   *  #ui-bottom is the centered 60% band, whose right edge runs under the sidebar on smaller
   *  screens â€” hence positioning relative to #interface instead. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    (document.getElementById("interface") ?? document.body).appendChild(element);
  }

  /** @override â€” bind the shortcut slots (use / clear / drag) + sidebar rows, then re-home Foundry's
   *  native #hotbar into the grid's bottom row (pf2e-style). Elements are rebuilt every render, so
   *  binding here can't stack handlers. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    // Shortcut slots: click → use, right-click → clear, drag an item on → assign, drag off → move.
    for (const s of root.querySelectorAll(".shortcut[data-i]")) {
      const i = Number(s.dataset.i);
      const empty = s.classList.contains("empty");
      if (!empty) {
        s.addEventListener("click", () => this.#use(i));
        s.addEventListener("dragstart", (ev) => {
          const uuid = this.actor?.getFlag(SYS, "hudSlots")?.[this.#page]?.[i];
          if (!uuid) return;
          ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
          ev.dataTransfer.effectAllowed = "copy";
        });
      }
      s.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#clear(i); });
      s.addEventListener("dragover", (ev) => { ev.preventDefault(); s.classList.add("drag-over"); });
      s.addEventListener("dragleave", () => s.classList.remove("drag-over"));
      s.addEventListener("drop", (ev) => { ev.preventDefault(); s.classList.remove("drag-over"); this.#drop(ev, i); });
    }

    // Sidebar rows: draggable onto a shortcut slot (native Item drag data the slot #drop reads) and a
    // live client-side name filter that never re-renders (so the input keeps focus while typing).
    for (const row of root.querySelectorAll(".sb-row[data-uuid]")) {
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: row.dataset.uuid }));
        ev.dataTransfer.effectAllowed = "copy";
      });
    }
    const filter = root.querySelector(".sb-filter input");
    if (filter) {
      const apply = () => {
        const q = this.#sbFilter.trim().toLowerCase();
        for (const row of root.querySelectorAll(".sb-row")) {
          row.classList.toggle("is-hidden", !!q && !(row.dataset.name || "").toLowerCase().includes(q));
        }
      };
      filter.value = this.#sbFilter;
      apply();                                             // re-apply after a background re-render
      filter.addEventListener("input", () => { this.#sbFilter = filter.value; apply(); });
    }

    // pf2e-style: re-home the native #hotbar into the grid when an actor is driven, else leave it in
    // its native #ui-bottom spot. The element belongs to ui.hotbar, so it survives innerHTML rebuilds
    // and we simply re-append it each render.
    if (context.hasActor) this.#embedHotbar();
    else this.#restoreHotbar();
  }

  /** @override â€” restore the native #hotbar to #ui-bottom when the HUD closes (toggled off). */
  async _onClose(options) {
    this.#restoreHotbar();
    return super._onClose(options);
  }

  /** The native macro hotbar element (owned by ui.hotbar; survives detachment). */
  #hotbarEl() {
    const el = ui.hotbar?.element;
    return el instanceof HTMLElement ? el : document.getElementById("hotbar");
  }

  /** Move the native #hotbar into the grid's bottom row (CSS pins it info→full / bottom). */
  #embedHotbar() {
    const grid = this.element?.querySelector(".hud-bar");
    const hotbar = this.#hotbarEl();
    if (grid && hotbar && hotbar.parentElement !== grid) grid.appendChild(hotbar);
  }

  /** Return the native #hotbar to #ui-bottom (actorless / on close), restoring Foundry's own layout. */
  #restoreHotbar() {
    const bottom = document.getElementById("ui-bottom");
    const hotbar = this.#hotbarEl();
    if (bottom && hotbar && hotbar.parentElement !== bottom) bottom.prepend(hotbar);
  }

  /** Public: re-home the native hotbar into the grid without a full re-render — called from the
   *  `renderHotbar` hook so a native re-render (macro drag / page flip) can't strand it. */
  rehomeHotbar() { if (this.rendered && this.actor) this.#embedHotbar(); }

  /* ----- slot operations ----- */

  /** Use the item bound to slot `i` (re-resolved live so a swapped/edited item still works). */
  async #use(i) {
    const actor = this.actor;
    const uuid = actor?.getFlag(SYS, "hudSlots")?.[this.#page]?.[i];
    if (!uuid) return;
    const item = await fromUuid(uuid);
    if (item?.roll) item.roll();
  }

  /** Bind a dropped Item to slot `i`. Accepts standard item drag data ({type:"Item",uuid}) and
   *  the actor sheet's paperdoll payload ({paItem:id}), resolved against the current actor. */
  async #drop(ev, i) {
    const actor = this.actor;
    if (!actor) return;
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let data;
    try { data = TE.getDragEventData(ev); } catch (_) { return; }
    let item = null;
    if (data?.uuid && (!data.type || data.type === "Item")) item = await fromUuid(data.uuid).catch(() => null);
    else if (data?.paItem) item = actor.items.get(data.paItem);
    if (!item || item.documentName !== "Item") return;
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Hud.noPermission"));

    const flag = foundry.utils.deepClone(actor.getFlag(SYS, "hudSlots") ?? {});
    const page = String(this.#page);
    flag[page] = flag[page] ?? {};
    flag[page][i] = item.uuid;
    await actor.setFlag(SYS, "hudSlots", flag);
    this.render();
  }

  /** Right-click a slot â†’ clear it. */
  async #clear(i) {
    const actor = this.actor;
    if (!actor?.isOwner) return;
    const flag = foundry.utils.deepClone(actor.getFlag(SYS, "hudSlots") ?? {});
    const page = String(this.#page);
    if (flag[page]?.[i] === undefined) return;
    delete flag[page][i];
    await actor.setFlag(SYS, "hudSlots", flag);
    this.render();
  }

  /* ----- action handlers (this === the app instance) ----- */

  static #onPage(event, target) {
    const p = Number(target.dataset.page);
    if (p && p !== this.#page) { this.#page = p; this.render(); }
  }

  static #onTogglePicker() {
    this.#popover = this.#popover === "picker" ? null : "picker";
    this.#sidebar = null;
    this.render();
  }

  static async #onChoose(event, target) {
    const id = target.dataset.actorId;
    if (id) await game.user.update({ character: id });
    this.#popover = null;
    this.render();
    globalThis.projectanime?.party?.refresh();
  }

  static #onOpenSheet() {
    this.actor?.sheet?.render(true);
  }

  static #onToggleSettings() {
    this.#popover = this.#popover === "settings" ? null : "settings";
    this.#sidebar = null;
    this.render();
  }

  static async #onSet(event, target) {
    const { key, value } = target.dataset;
    if (!key) return;
    let v = value;
    if (key === HUD_ENABLED_SETTING || key === HUD_SHOW_PARTY_SETTING || key === HUD_COMBAT_SETTING) v = value === "true";
    await game.settings.set(SYS, key, v);
    // enabled/party route through applyHudState (may close us); style keys re-render via onChange.
  }

  /** Click a centre-zone stat. Attribute chips roll a Check (rollCheck — the sheet's path, so it
   *  honours the roll dialog / Luck / contested targeting); derived chips have no roll, so they post a
   *  compact reference line to chat (announce your Evasion/Defense/etc. at the table). */
  static async #onStat(event, target) {
    const actor = this.actor;
    if (!actor) return;
    const key = target.dataset.stat;
    if (!key) return;
    if (target.dataset.kind === "attr") return rollCheck(actor, { attrA: key, attrB: key });
    const label = target.dataset.label ?? key;
    const value = target.dataset.value ?? "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="pa-stat-ref"><span class="k">${label}</span><span class="v">${value}</span></div>`
    });
  }

  /** Toggle a sidebar tab open/closed. Opening one closes any popover; the filter resets. */
  static #onSidebar(event, target) {
    const key = target.dataset.sb;
    this.#sidebar = this.#sidebar === key ? null : key;
    this.#sbFilter = "";
    this.#popover = null;
    this.render();
  }

  /** Click a sidebar row → use that item (roll / attack / consumable Use card), same path as a slot. */
  static async #onUse(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const item = await fromUuid(uuid).catch(() => null);
    if (item?.roll) item.roll();
  }

  /** Cycle the driven actor's disposition (Friendly → Neutral → Hostile), updating its prototype
   *  token + any active tokens. Owners / GM only. */
  static async #onAlliance() {
    const actor = this.actor;
    if (!actor || !(game.user.isGM || actor.isOwner)) return;
    const D = CONST.TOKEN_DISPOSITIONS;
    const order = [D.FRIENDLY, D.NEUTRAL, D.HOSTILE];
    const tok = actor.getActiveTokens?.()?.[0]?.document ?? null;
    const cur = tok?.disposition ?? actor.prototypeToken?.disposition ?? D.FRIENDLY;
    const next = order[(order.indexOf(cur) + 1) % order.length] ?? D.FRIENDLY;
    await actor.update({ "prototypeToken.disposition": next });
    const tokens = actor.getActiveTokens?.() ?? [];
    if (tokens.length && canvas?.scene) {
      await canvas.scene.updateEmbeddedDocuments("Token", tokens.map((t) => ({ _id: t.id, disposition: next })));
    }
    this.render();
  }

  /** Clear every shortcut slot on the current page. */
  static async #onClearPage() {
    const actor = this.actor;
    if (!actor?.isOwner) return;
    const flag = foundry.utils.deepClone(actor.getFlag(SYS, "hudSlots") ?? {});
    if (!flag[String(this.#page)]) return;
    delete flag[String(this.#page)];
    await actor.setFlag(SYS, "hudSlots", flag);
    this.render();
  }

  /** Left-click an effect icon → open its source (the AE config for an actor-owned effect, else the
   *  parent item's sheet). */
  static async #onEffect(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const e = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (!e) return;
    if (e.parent?.documentName === "Actor") e.sheet?.render(true);
    else e.parent?.sheet?.render(true);
  }
}

/* ============================================================
   The lower-left Party HUD (replaces the names list) — a Granblue Relink-style stack of member
   cards (diamond portrait, name, condensed HP + Energy bars), each tinted its owning player's sheet
   accent; the member acting now (side-initiative) glows gold, and the viewer's own is pinned first.
   Kept the class name AnimePartyRail for its stable `projectanime.party` binding + settings wiring.
   ============================================================ */

export class AnimePartyRail extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-party",
    classes: ["project-anime", "theme-dark", "pa-glass", "anime-party"],
    window: { frame: false, positioned: false },
    actions: { partyClick: AnimePartyRail.#onClick }
  };

  static PARTS = {
    rail: { template: "systems/project-anime/templates/apps/anime-party.hbs" }
  };

  refresh = foundry.utils.debounce(this.render.bind(this), 100);

  /** @override */
  async _prepareContext() {
    const meId = game.user?.character?.id;
    const isGM = game.user.isGM;

    // Who's acting now (side-initiative): the current combatant, but only when it's genuinely up.
    const combat = game.combats?.active ?? null;
    let activeActorId = null;
    if (combat?.started) {
      const aSide = activeSide(combat);
      const cur = combat.combatant;
      if (cur && !hasActed(cur, combat.round) && combatantSide(cur) === aSide) activeActorId = cur.actor?.id ?? null;
    }

    const members = game.actors
      .filter((a) => a.type === "character" && a.hasPlayerOwner)
      .map((a) => {
        const tok = a.getActiveTokens?.()?.[0] ?? null;
        // Vitals gate: GM / owner always; others per the shared Token-Settings rule (same as the
        // on-canvas bars, hover panel, and combat tracker). No token on scene → owner/GM only.
        const canSee = isGM || a.isOwner || (tok ? canSeeTokenVitals(tok) : false);
        const hp = a.system?.hp ?? { value: 0, max: 0 };
        const en = a.system?.energy ?? { value: 0, max: 0 };
        const isMe = a.id === meId;
        return {
          id: a.id,
          name: a.name,
          img: a.img || FALLBACK_IMG,
          me: isMe,
          // Self keys off --pa-player-accent in CSS (always live); others get their owner's synced accent.
          accent: isMe ? null : memberAccent(a),
          online: game.users.some((u) => u.active && u.character?.id === a.id),
          active: !!activeActorId && a.id === activeActorId,
          down: canSee && Number(hp.max) > 0 && (Number(hp.value) || 0) <= 0,
          crit: canSee && !!a.system?.critical,
          seeHP: canSee && !!hp.max,
          hp: canSee ? { value: hp.value ?? 0, max: hp.max ?? 0, pct: pct(hp) } : null,
          en: canSee ? { value: en.value ?? 0, max: en.max ?? 0, pct: pct(en) } : null,
          statuses: canSee ? [...(a.statuses ?? [])].slice(0, 4).map((id) => ({ tint: STATUS_TINT[id] ?? "var(--pa-accent-2)" })) : []
        };
      });
    // Pin the viewer's own PC first, then online, then by name.
    members.sort((a, b) => (b.me - a.me) || (b.online - a.online) || a.name.localeCompare(b.name));
    return { members, empty: !members.length };
  }

  /** @override â€” mount into the left column where the native players list lives. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    const col = document.getElementById("players")?.parentElement
      ?? document.getElementById("ui-left-column-1")
      ?? document.body;
    col.appendChild(element);
  }

  /** Bound window-resize handler (added in _onRender, removed in _onClose) so a shrunk window can't
   *  strand a dragged HUD off-screen. */
  #onWinResize = () => this.#clampToViewport();

  /** @override - apply the chosen size + saved drag position, wire the grip drag + card right-click,
   *  and hide when there's no party. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.classList.toggle("empty", context.empty);

    // MINIMIZED: double-clicking the grip collapses the roster to just its title bar (persisted per-client).
    el.classList.toggle("collapsed", game.settings.get(SYS, HUD_PARTY_COLLAPSED_SETTING));

    // BIGGER: one width var drives the JRPG-scale card metrics (CSS does the rest).
    el.style.setProperty("--ph-w", `${game.settings.get(SYS, HUD_PARTY_SIZE_SETTING)}px`);

    // MOVABLE: apply the saved viewport position (top/left anchoring via .pinned), else keep the default
    // CSS corner. An unset client Object setting returns {}, so guard on a real `left`.
    const saved = game.settings.get(SYS, HUD_PARTY_POS_SETTING);
    if (saved && saved.left != null) {
      el.classList.add("pinned");
      el.style.left = `${saved.left}px`;
      el.style.top = `${saved.top}px`;
      this.#clampToViewport();
    } else {
      el.classList.remove("pinned");
      el.style.left = el.style.top = "";
    }
    window.removeEventListener("resize", this.#onWinResize);
    window.addEventListener("resize", this.#onWinResize);

    // Right-click a card opens that member's sheet (left-click pans/selects via the partyClick action).
    // Cards are rebuilt every render, so binding here can't stack handlers.
    for (const card of el.querySelectorAll(".ph-card[data-actor-id]")) {
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        const actor = game.actors.get(card.dataset.actorId);
        if (actor && (actor.isOwner || game.user.isGM)) actor.sheet?.render(true);
      });
    }

    // Drag by the grip ONLY (pointerdown bound there), so cards keep their click / right-click actions.
    const grip = el.querySelector(".ph-grip");
    if (grip) this.#bindDrag(grip);
  }

  /** @override - drop the resize listener when the HUD closes. */
  async _onClose(options) {
    window.removeEventListener("resize", this.#onWinResize);
    return super._onClose(options);
  }

  /** Clamp the applied position into the viewport (Foundry's own formula) - a one-shot measure per
   *  call, not the per-frame chase the AnimeHud console warns against. */
  #clampToViewport() {
    const el = this.element;
    const saved = game.settings.get(SYS, HUD_PARTY_POS_SETTING);
    if (!el || !saved || saved.left == null) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.clamp(saved.left, 0, Math.max(window.innerWidth - r.width, 0))}px`;
    el.style.top = `${Math.clamp(saved.top, 0, Math.max(window.innerHeight - r.height, 0))}px`;
  }

  /** Manual pointer-drag on the grip: Draggable's delta math + ~60fps throttle, writing our own inline
   *  styles (core setPosition is a no-op on this positioned:false app) and persisting once on release.
   *  We flip to top-anchoring (.pinned, which drops the CSS bottom anchor) ONLY once a real drag begins,
   *  so a plain click / double-click never yanks the panel to the top. Double-click minimizes the roster. */
  #bindDrag(grip) {
    const el = this.element;
    let moveT = 0, start = null, base = null, moved = false;

    const onMove = (e) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved) {
        if (Math.hypot(dx, dy) < 4) return;              // movement threshold before it counts as a drag
        moved = true;
        // Freeze the panel at its current spot BEFORE swapping bottom→top anchoring, so it doesn't jump.
        el.style.left = `${base.left}px`; el.style.top = `${base.top}px`;
        el.classList.add("pinned", "dragging");
      }
      const now = Date.now();
      if (now - moveT < 1000 / 60) return;               // ~60fps throttle
      moveT = now;
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.clamp(base.left + dx, 0, Math.max(window.innerWidth - r.width, 0))}px`;
      el.style.top = `${Math.clamp(base.top + dy, 0, Math.max(window.innerHeight - r.height, 0))}px`;
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("dragging");
      if (!moved) return;                                // a plain click on the grip - don't pin or persist
      await game.settings.set(SYS, HUD_PARTY_POS_SETTING, { left: parseFloat(el.style.left), top: parseFloat(el.style.top) });
    };

    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();              // seed from the live rect at its current anchor
      base = { left: r.left, top: r.top };
      start = { x: e.clientX, y: e.clientY };
      moved = false;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    // Double-click the grip → minimize/restore the roster to just the title bar (like a Foundry sheet).
    grip.addEventListener("dblclick", async (e) => {
      e.preventDefault();
      const collapsed = !el.classList.contains("collapsed");
      el.classList.toggle("collapsed", collapsed);
      await game.settings.set(SYS, HUD_PARTY_COLLAPSED_SETTING, collapsed);
    });
  }

  /** Click a chip â†’ select & pan to that actor's token if present, else open its sheet. */
  static async #onClick(event, target) {
    const id = target.dataset.actorId;
    const actor = game.actors.get(id);
    if (!actor) return;
    const token = canvas?.tokens?.placeables?.find((t) => t.actor?.id === id);
    if (token) {
      token.control({ releaseOthers: true });
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    } else if (actor.isOwner) {
      actor.sheet?.render(true);
    }
  }
}

/* ============================================================
   Encounter tracker â€” pinned just left of the chat sidebar (mounted in the
   right overlay #ui-right, anchored to its stable right edge so it holds its
   place when the sidebar collapses). Shows turn order + initiative during
   combat so chat and initiative are visible together, with an End Turn
   button (players end their own turn via a GM socket relay).
   ============================================================ */

export class AnimeCombatTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-combat",
    classes: ["project-anime", "theme-dark", "pa-glass", "anime-combat"],
    window: { frame: false, positioned: false },
    actions: {
      combatActivate: AnimeCombatTracker.#onActivate,
      combatEndTurn: AnimeCombatTracker.#onEndTurn,
      combatGoto: AnimeCombatTracker.#onGoto,
      combatBegin: AnimeCombatTracker.#onBegin,
      combatToggleHidden: AnimeCombatTracker.#onToggleHidden,
      combatToggleDefeated: AnimeCombatTracker.#onToggleDefeated,
      combatToggleCollapse: AnimeCombatTracker.#onToggleCollapse,
      combatNextRound: AnimeCombatTracker.#onNextRound,
      combatEndCombat: AnimeCombatTracker.#onEndCombat,
      combatTarget: AnimeCombatTracker.#onTarget,
      combatPing: AnimeCombatTracker.#onPing
    }
  };

  static PARTS = {
    tracker: { template: "systems/project-anime/templates/apps/anime-combat.hbs" }
  };

  /** Resolve the encounter to mirror: the native tracker's VIEWED combat (`ui.combat.viewed`) â€” exactly
   *  what the sidebar shows â€” then the active combat, then any scene combat with combatants. Using
   *  ui.combat.viewed is the reliable "people are in the encounter" signal (it's set immediately, unlike
   *  game.combats.active which lags a beat behind createCombat â€” the old reload-needed bug). */
  #combat() {
    return ui.combat?.viewed
      ?? game.combats?.active
      ?? game.combats?.find?.((c) => c.combatants.size > 0 && (!c.scene || c.scene.id === canvas?.scene?.id))
      ?? null;
  }

  /** Whether the tracker should be on screen now: feature enabled + an encounter with â‰¥1 combatant the
   *  viewer is allowed to see. */
  #shouldShow() {
    if (!game.settings.get(SYS, HUD_COMBAT_SETTING)) return false;
    const combat = this.#combat();
    const isGM = game.user.isGM;
    return !!combat && combat.turns.some((c) => isGM || !c.hidden);
  }

  /** pf2e-hud-style render/close lifecycle: FORCE-render when there's an encounter to show, else close.
   *  Force re-mounts the element via _insertElement, so the tracker reliably (re)appears the instant
   *  people are added â€” a plain re-render of a never-mounted/detached app silently no-op'd, which is
   *  why it used to require a reload. */
  refresh = foundry.utils.debounce(() => {
    if (this.#shouldShow()) this.render({ force: true });
    else if (this.rendered) this.close();
  }, 60);

  /** Collapsed view â€” show only the current turn's combatant (or, before the encounter begins, the
   *  first one). Client-side + transient (resets on reload), like the console's page. */
  #collapsed = false;

  /** @override â€” SIDE INITIATIVE view: rows are grouped into Player / Enemy / Neutral phase blocks; the
   *  active phase is highlighted; within it, a viewer's not-yet-acted units are pickable (free-pick), and
   *  the unit currently "on" shows the End Turn control to whoever controls it. */
  async _prepareContext() {
    const combat = this.#combat();
    const isGM = game.user.isGM;
    const L = (k) => game.i18n.localize(k);
    const visible = combat ? combat.turns.filter((c) => isGM || !c.hidden) : [];
    if (!combat || !visible.length) return { show: false };

    const started = !!combat.started;
    const aSide = started ? activeSide(combat) : null;          // which phase is up (null before start / round done)
    const cur = combat.combatant;
    // The unit currently "on": the current combatant, but only when it's genuinely up (started, not yet
    // acted, on the active side) â€” guards against a stale `turn` index so an acted/off-phase row never lights.
    const activeId = (started && cur && !hasActed(cur, combat.round) && combatantSide(cur) === aSide) ? cur.id : null;

    const row = (c) => {
      const actor = c.actor;
      const hp = actor?.system?.hp;
      const en = actor?.system?.energy;
      const tok = c.token?.object ?? null;
      // Vitals (HP + Energy) show to exactly who may see this token's â€” GM/owner always, others per
      // the shared Token-Settings gate (same rule as the on-canvas bars / hover panel / dossier).
      const seeVitals = isGM || actor?.isOwner || (tok ? canSeeTokenVitals(tok) : false);
      const seeHP = seeVitals && !!hp?.max;
      const seeEN = seeVitals && !!en?.max;
      const hpPct = seeHP ? pct(hp) : 0;
      // When the viewer may NOT see exact HP but the creature has an HP track, show a qualitative
      // health word instead (pf2e-hud style — "Badly Hurt", never the number).
      const health = (!seeHP && !!hp?.max) ? healthStatus(actor) : null;
      const acted = started && hasActed(c, combat.round);
      const activeRow = c.id === activeId;
      const mine = isGM || c.isOwner;
      // Pickable = on the active side, un-acted, actable (not stunned/defeated), controlled by the viewer,
      // and nobody currently on (one unit acts at a time within a phase â€” pick, act, End Turn, pick next).
      const activatable = started && !!aSide && combatantSide(c) === aSide && !acted && !isSkippable(c) && mine && !activeId;
      return {
        id: c.id,
        name: c.name,
        img: c.img || actor?.img || FALLBACK_IMG,
        active: activeRow,
        acted,
        activatable,
        canEndRow: activeRow && mine,      // inline End Turn on the acting row, for its controller
        keep: activeRow || (!activeId && activatable),   // collapsed view keeps the acting unit / the pickable set
        defeated: c.isDefeated,
        hidden: c.hidden,
        disp: DISP_CLASS(c),
        targeted: !!tok && !!tok.targeted?.has?.(game.user),   // the viewer is targeting this token
        seeHP,
        hp: seeHP ? { value: hp.value ?? 0, max: hp.max ?? 0, pct: hpPct, hue: Math.round(1.2 * hpPct) } : null,
        health: health ? { label: L(health.key), tint: health.tint } : null,
        seeEN,
        en: seeEN ? { value: en.value ?? 0, max: en.max ?? 0 } : null,
        hideLabel: L(c.hidden ? "PROJECTANIME.Hud.combat.show" : "PROJECTANIME.Hud.combat.hide"),
        defeatLabel: L(c.isDefeated ? "PROJECTANIME.Hud.combat.revive" : "PROJECTANIME.Hud.combat.defeat")
      };
    };

    // Group visible combatants into phase blocks, in Player â†’ Enemy â†’ Neutral order; hide empty phases.
    const bySide = {};
    for (const c of visible) (bySide[combatantSide(c)] ??= []).push(row(c));
    const groups = PROJECTANIME.sides
      .filter((s) => bySide[s]?.length)
      .map((s) => ({ side: s, label: L(PROJECTANIME.sideLabel[s]), active: started && s === aSide, rows: bySide[s] }));

    const activeControlled = !!activeId && (isGM || !!combat.combatants.get(activeId)?.isOwner);
    return {
      show: true,
      threat: this.#threat(combat, isGM),
      gm: isGM,
      started,
      collapsed: this.#collapsed,
      collapseLabel: L(this.#collapsed ? "PROJECTANIME.Hud.combat.expand" : "PROJECTANIME.Hud.combat.collapse"),
      round: combat.round,
      phaseLabel: aSide ? L(PROJECTANIME.sideLabel[aSide]) : "",
      groups,
      canEnd: started && activeControlled   // footer End Turn â€” visible to whoever controls the acting unit
    };
  }

  /** GM-only encounter Threat readout for the header: sum each hostile NPC's Threat cost (Rival 3 ·
   *  Boss = party size · else its Role's Threat) against a Standard budget of the PC count, banded
   *  Easy / Standard / Hard / Climax (the encounter-difficulty thresholds). null = nothing to show. */
  #threat(combat, isGM) {
    if (!isGM) return null;
    const party = combat.turns.filter((c) => c.actor?.type === "character").length;
    if (party < 1) return null;
    let total = 0;
    for (const c of combat.turns) {
      const a = c.actor;
      if (a?.type !== "npc" || combatantSide(c) !== "enemy") continue;
      const s = a.system ?? {};
      total += s.rival ? 3 : s.boss?.enabled ? party : enemyRoleThreat(s.enemyRole);
    }
    if (total <= 0) return null;
    const band = total <= party - 1 ? "easy" : total <= party ? "standard" : total <= party + 1.5 ? "hard" : "climax";
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return { total: fmt(total), party, band, label: game.i18n.localize(PROJECTANIME.encounterDifficulty[band].label) };
  }

  /** @override â€” mount into the right overlay (#ui-right) and pin it (CSS) just left of the chat
   *  sidebar. Anchoring to #ui-right's stable right edge instead of the chat column â€” which slides
   *  inward as the sidebar collapses â€” keeps the tracker put when the sidebar toggles. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    (document.getElementById("ui-right") ?? document.body).appendChild(element);
  }

  /** @override â€” hide entirely when there's no active combat (or the feature is off), and flag the
   *  body while shown so CSS hides the floating chat input (the tracker takes over that bottom spot,
   *  like pf2e-hud). The flag clears the moment the tracker goes empty, restoring the chat input. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("empty", !context.show);
    document.body.classList.toggle("pa-combat-shown", !!context.show);
  }

  /** @override â€” the lifecycle closes the tracker when combat ends / the feature is off; clear the
   *  chat-input-hiding flag so the floating "Enter message" box returns. */
  async _onClose(options) {
    await super._onClose(options);
    document.body.classList.remove("pa-combat-shown");
  }

  /** End the acting unit's turn: GM ends directly through the phase state machine; a player who controls
   *  the unit currently on relays to the active GM over the system socket (Combat docs are GM-owned). */
  static async #onEndTurn() {
    const combat = game.combats?.active;
    if (!combat?.started) return;
    if (game.user.isGM) return globalThis.projectanime?.sideInit?.end(combat);
    const current = combat.combatant;
    if (!current?.isOwner) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Hud.combat.notYourTurn"));
    // Send the SPECIFIC acting unit's id â€” the GM must end this unit, not whatever is current when the
    // relay lands (a concurrent activation could have moved it), which would drop this unit's Combo/ticks.
    game.socket.emit("system.project-anime", { type: "endTurn", combatId: combat.id, combatantId: current.id, userId: game.user.id });
  }

  /** Free-pick: put one of the active phase's units on ("I'm going" / "you're up"). GM activates directly
   *  through the state machine; a player relays to the GM. Only pickable rows carry this action. */
  static async #onActivate(event, target) {
    event.stopPropagation();
    const combat = game.combats?.active;
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if (!combat?.started || !id) return;
    if (game.user.isGM) return globalThis.projectanime?.sideInit?.activate(combat, id);
    game.socket.emit("system.project-anime", { type: "activate", combatId: combat.id, combatantId: id, userId: game.user.id });
  }

  /** Click a combatant row â†’ select & pan to its token. */
  static #onGoto(event, target) {
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const token = id ? game.combats?.active?.combatants?.get(id)?.token?.object : null;
    if (token) {
      token.control({ releaseOthers: true });
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    }
  }

  /** Toggle this client's collapsed view (current turn only). */
  static #onToggleCollapse() { this.#collapsed = !this.#collapsed; this.render(); }

  /** GM only: begin the encounter (round 1). startSideInitiative (project-anime.mjs) then parks the turn
   *  at null so the Player side free-picks. */
  static async #onBegin() {
    if (game.user.isGM) await game.combats?.active?.startCombat();
  }

  /** GM only: show / hide a combatant from the players' tracker (the eye toggle). */
  static async #onToggleHidden(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const c = game.combats?.active?.combatants?.get(id);
    if (c) await c.update({ hidden: !c.hidden });
  }

  /** GM only: mark / unmark a combatant defeated (strikes + dims the row, drops a skull on the avatar). */
  static async #onToggleDefeated(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const c = game.combats?.active?.combatants?.get(id);
    if (c) await c.update({ defeated: !c.isDefeated });
  }

  /* ----- GM header navigation ----- */
  // Force the encounter to the next round (patched Combat#nextRound â†’ forceNextRound: clears acted
  // markers, bumps the round, reopens Player Phase). Backward turn/round stepping is not offered under
  // side initiative â€” reversing the acted-set has no clean meaning.
  static async #onNextRound() { if (game.user.isGM) await game.combats?.active?.nextRound(); }

  /** GM only: end the whole encounter (Foundry confirms first). */
  static async #onEndCombat() { if (game.user.isGM) await game.combats?.active?.endCombat(); }

  /** Resolve the on-canvas token for the clicked row (null if it isn't on the current scene). */
  static #tokenFrom(target) {
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    return id ? (game.combats?.active?.combatants?.get(id)?.token?.object ?? null) : null;
  }

  /** Toggle the current user's target on a combatant's token (the crosshair control). */
  static #onTarget(event, target) {
    event.stopPropagation();
    const tok = AnimeCombatTracker.#tokenFrom(target);
    if (tok) tok.setTarget(!tok.targeted?.has(game.user), { releaseOthers: false });
  }

  /** Ping a combatant's token location on the canvas, drawing everyone's eye to it. */
  static #onPing(event, target) {
    event.stopPropagation();
    const tok = AnimeCombatTracker.#tokenFrom(target);
    if (tok && canvas?.ready) canvas.ping(tok.center);
  }
}
