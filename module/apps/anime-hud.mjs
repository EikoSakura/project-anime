/**
 * Project: Anime — Cinematic HUD.
 *
 * A persistent, anime/JRPG-styled action bar that REPLACES Foundry's macro hotbar and the
 * bottom-left Players name list:
 *   • AnimeHud      — bottom-centre console: diamond portrait anchor (click → character
 *                     picker), iridescent HP/EP bars, a row of small chamfered action slots
 *                     you fill by dragging Skills / weapons / items from the character sheet,
 *                     1–5 pages, and a util cluster (open sheet / settings popover).
 *   • AnimePartyRail — small diamond portrait chips at the lower-left, replacing the names
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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SYS = "project-anime";

export const HUD_ENABLED_SETTING = "hudEnabled";
export const HUD_INTENSITY_SETTING = "hudIntensity";
export const HUD_SLOT_SHAPE_SETTING = "hudSlotShape";
export const HUD_SLOT_SIZE_SETTING = "hudSlotSize";
export const HUD_SHOW_PARTY_SETTING = "hudShowParty";
export const HUD_COMBAT_SETTING = "hudCombat";

const SLOTS_PER_PAGE = 10;
const PAGES = 5;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

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

/** Map a combatant's token disposition to a theme accent class — drives the tracker's active-row
 *  tint (ally = accent, enemy = danger, neutral = gold), à la pf2e-hud's disposition colouring. */
const DISP_CLASS = (c) => {
  const D = CONST.TOKEN_DISPOSITIONS;
  const d = c?.token?.disposition ?? c?.actor?.prototypeToken?.disposition ?? D.HOSTILE;
  return d === D.FRIENDLY ? "friendly" : d === D.NEUTRAL ? "neutral" : d === D.SECRET ? "secret" : "hostile";
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
    default: "38",
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
  // config:false so they're not scattered through the list). Not GM-restricted — per-client.
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
   Grouped "Cinematic HUD" settings dialog — one System-Settings entry
   gathering enable + intensity / slot shape / size + party rail + tracker.
   ============================================================ */

export class HudSettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-hud-settings",
    classes: ["project-anime", "element-config", "hud-settings-config"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "PROJECTANIME.Settings.hudSettings.title", icon: "fa-solid fa-gamepad" },
    form: { handler: HudSettingsConfig.#onSubmit, closeOnSubmit: true }
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
      showParty: get(HUD_SHOW_PARTY_SETTING),
      showCombat: get(HUD_COMBAT_SETTING)
    };
  }

  static async #onSubmit(event, form, formData) {
    const o = formData.object;
    await game.settings.set(SYS, HUD_INTENSITY_SETTING, o.intensity);
    await game.settings.set(SYS, HUD_SLOT_SHAPE_SETTING, o.shape);
    await game.settings.set(SYS, HUD_SLOT_SIZE_SETTING, o.size);
    await game.settings.set(SYS, HUD_SHOW_PARTY_SETTING, !!o.showParty);
    await game.settings.set(SYS, HUD_COMBAT_SETTING, !!o.showCombat);
    // Set enabled last: its onChange (applyHudState) re-renders using the values just saved.
    await game.settings.set(SYS, HUD_ENABLED_SETTING, !!o.enabled);
    ui.notifications.info(game.i18n.localize("PROJECTANIME.Settings.hudSettings.saved"));
  }
}

/* ============================================================
   The bottom-centre console
   ============================================================ */

export class AnimeHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-hud",
    // theme-dark: this floats over the (dark) canvas, so it stays dark regardless of the
    // user's Foundry UI theme — same call the token-info panel makes.
    classes: ["project-anime", "theme-dark", "anime-hud"],
    window: { frame: false, positioned: false },
    actions: {
      hudPage: AnimeHud.#onPage,
      hudPicker: AnimeHud.#onTogglePicker,
      hudChoose: AnimeHud.#onChoose,
      hudSheet: AnimeHud.#onOpenSheet,
      hudSettings: AnimeHud.#onToggleSettings,
      hudSet: AnimeHud.#onSet
    }
  };

  static PARTS = {
    hud: { template: "systems/project-anime/templates/apps/anime-hud.hbs" }
  };

  /** Current hotbar page (1..5). Transient — resets to 1 on reload. */
  #page = 1;
  /** Which popover is open, if any: "picker" | "settings" | null. */
  #popover = null;

  refresh = foundry.utils.debounce(this.render.bind(this), 100);

  /** The actor this HUD drives: the user's assigned character first (it's YOUR bar), else the
   *  controlled token's actor (lets a GM with no character drive the selected creature). */
  get actor() {
    return game.user?.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
  }

  /** @override */
  async _prepareContext() {
    const actor = this.actor;
    const intensity = game.settings.get(SYS, HUD_INTENSITY_SETTING);
    const shape = game.settings.get(SYS, HUD_SLOT_SHAPE_SETTING);
    const size = game.settings.get(SYS, HUD_SLOT_SIZE_SETTING);

    const ctx = {
      hasActor: !!actor,
      intensity, shape, size,
      page: this.#page,
      pages: Array.from({ length: PAGES }, (_, i) => ({ p: i + 1, active: (i + 1) === this.#page })),
      popoverPicker: this.#popover === "picker",
      popoverSettings: this.#popover === "settings",
      dragHint: game.i18n.localize("PROJECTANIME.Hud.dragHint")
    };
    ctx.img = actor?.img || FALLBACK_IMG;

    // Character picker + settings popover are available even with NO active actor, so a GM (no
    // assigned character, nothing selected) can still open the picker / configure / toggle off.
    ctx.picks = game.actors
      .filter((a) => a.isOwner && (a.type === "character" || a.type === "npc"))
      .map((a) => ({ id: a.id, name: a.name, img: a.img || FALLBACK_IMG, sel: a.id === actor?.id }));

    const seg = (key, cur, opts) => opts.map((o) => ({
      key, value: o.v, label: game.i18n.localize(o.l), active: o.v === String(cur)
    }));
    ctx.segIntensity = seg(HUD_INTENSITY_SETTING, intensity, [
      { v: "restrained", l: "PROJECTANIME.Hud.intensity.restrained" },
      { v: "cinematic", l: "PROJECTANIME.Hud.intensity.cinematic" },
      { v: "anime", l: "PROJECTANIME.Hud.intensity.anime" }
    ]);
    ctx.segShape = seg(HUD_SLOT_SHAPE_SETTING, shape, [
      { v: "chamfer", l: "PROJECTANIME.Hud.shape.chamfer" },
      { v: "skew", l: "PROJECTANIME.Hud.shape.skew" },
      { v: "round", l: "PROJECTANIME.Hud.shape.round" }
    ]);
    ctx.segSize = seg(HUD_SLOT_SIZE_SETTING, size, [
      { v: "38", l: "PROJECTANIME.Hud.size.small" },
      { v: "44", l: "PROJECTANIME.Hud.size.medium" },
      { v: "52", l: "PROJECTANIME.Hud.size.large" }
    ]);
    ctx.showParty = game.settings.get(SYS, HUD_SHOW_PARTY_SETTING);
    ctx.showCombat = game.settings.get(SYS, HUD_COMBAT_SETTING);

    if (actor) {
      ctx.name = actor.name;
      const hp = actor.system?.hp ?? { value: 0, max: 0 };
      const en = actor.system?.energy ?? { value: 0, max: 0 };
      ctx.vitals = {
        hp: { value: hp.value ?? 0, max: hp.max ?? 0, pct: pct(hp) },
        en: { value: en.value ?? 0, max: en.max ?? 0, pct: pct(en) }
      };
      ctx.slots = await this.#slotData(actor);
    } else {
      ctx.noActorName = game.i18n.localize("PROJECTANIME.Hud.noActorName");
      ctx.prompt = game.i18n.localize("PROJECTANIME.Hud.noActor");
    }
    return ctx;
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

  /** @override — mount into #interface (untransformed, full-area) so we can position the bar
   *  centered in the play area while reserving the chat sidebar's width on the right (CSS).
   *  #ui-bottom is the centered 60% band, whose right edge runs under the sidebar on smaller
   *  screens — hence positioning relative to #interface instead. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    (document.getElementById("interface") ?? document.body).appendChild(element);
  }

  /** @override — apply style classes, hide when actorless, and bind slot use/clear/drag. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.classList.remove("intensity-restrained", "intensity-cinematic", "intensity-anime");
    root.classList.add(`intensity-${context.intensity}`);

    // Positioning is CSS-only now: a CONSTANT right-edge reservation (--sidebar-width × --ui-scale)
    // that doesn't change when the sidebar collapses, so the bar stays put. We deliberately no longer
    // re-measure the live #ui-right width here — that shrank on collapse and made the bar jump.
    const slotsEl = root.querySelector(".anime-slots");
    if (slotsEl) {
      slotsEl.classList.remove("shape-chamfer", "shape-skew", "shape-round");
      slotsEl.classList.add(`shape-${context.shape}`);
      slotsEl.style.setProperty("--slot", `${context.size}px`);
    }

    // Slots are rebuilt every render, so binding here can't stack handlers.
    for (const s of root.querySelectorAll(".slot")) {
      const i = Number(s.dataset.i);
      s.addEventListener("click", () => {
        for (const x of root.querySelectorAll(".slot")) x.classList.remove("is-selected");
        if (!s.classList.contains("is-empty")) s.classList.add("is-selected");
        this.#use(i);
      });
      s.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.#clear(i); });
      s.addEventListener("dragover", (ev) => { ev.preventDefault(); s.classList.add("drag-over"); });
      s.addEventListener("dragleave", () => s.classList.remove("drag-over"));
      s.addEventListener("drop", (ev) => { ev.preventDefault(); s.classList.remove("drag-over"); this.#drop(ev, i); });
    }
  }

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

  /** Right-click a slot → clear it. */
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
}

/* ============================================================
   The lower-left party rail (replaces the names list)
   ============================================================ */

export class AnimePartyRail extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-party",
    classes: ["project-anime", "theme-dark", "anime-party"],
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
    // Exclude the viewer's own character — it's already shown in the console anchor, so listing it
    // here too is redundant and crowds the corner. (A GM with no character still sees everyone.)
    const members = game.actors
      .filter((a) => a.type === "character" && a.hasPlayerOwner && a.id !== meId)
      .map((a) => ({
        id: a.id,
        name: a.name,
        img: a.img || FALLBACK_IMG,
        hpPct: pct(a.system?.hp),
        me: a.id === meId,
        online: game.users.some((u) => u.active && u.character?.id === a.id)
      }));
    members.sort((a, b) => (b.online - a.online) || (b.me - a.me) || a.name.localeCompare(b.name));
    return { members, empty: !members.length };
  }

  /** @override — mount into the left column where the native players list lives. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    const col = document.getElementById("players")?.parentElement
      ?? document.getElementById("ui-left-column-1")
      ?? document.body;
    col.appendChild(element);
  }

  /** @override — hide entirely when there's no party to show. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("empty", context.empty);
  }

  /** Click a chip → select & pan to that actor's token if present, else open its sheet. */
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
   Encounter tracker — pinned just left of the chat sidebar (mounted in the
   right overlay #ui-right, anchored to its stable right edge so it holds its
   place when the sidebar collapses). Shows turn order + initiative during
   combat so chat and initiative are visible together, with an End Turn
   button (players end their own turn via a GM socket relay).
   ============================================================ */

export class AnimeCombatTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-combat",
    classes: ["project-anime", "theme-dark", "anime-combat"],
    window: { frame: false, positioned: false },
    actions: {
      combatEndTurn: AnimeCombatTracker.#onEndTurn,
      combatGoto: AnimeCombatTracker.#onGoto,
      combatRoll: AnimeCombatTracker.#onRoll,
      combatRollAll: AnimeCombatTracker.#onRollAll,
      combatRollNpc: AnimeCombatTracker.#onRollNpc,
      combatBegin: AnimeCombatTracker.#onBegin,
      combatReset: AnimeCombatTracker.#onReset,
      combatToggleHidden: AnimeCombatTracker.#onToggleHidden,
      combatToggleDefeated: AnimeCombatTracker.#onToggleDefeated,
      combatToggleCollapse: AnimeCombatTracker.#onToggleCollapse,
      combatPrevTurn: AnimeCombatTracker.#onPrevTurn,
      combatPrevRound: AnimeCombatTracker.#onPrevRound,
      combatNextRound: AnimeCombatTracker.#onNextRound,
      combatEndCombat: AnimeCombatTracker.#onEndCombat,
      combatTarget: AnimeCombatTracker.#onTarget,
      combatPing: AnimeCombatTracker.#onPing
    }
  };

  static PARTS = {
    tracker: { template: "systems/project-anime/templates/apps/anime-combat.hbs" }
  };

  /** Resolve the encounter to mirror: the native tracker's VIEWED combat (`ui.combat.viewed`) — exactly
   *  what the sidebar shows — then the active combat, then any scene combat with combatants. Using
   *  ui.combat.viewed is the reliable "people are in the encounter" signal (it's set immediately, unlike
   *  game.combats.active which lags a beat behind createCombat — the old reload-needed bug). */
  #combat() {
    return ui.combat?.viewed
      ?? game.combats?.active
      ?? game.combats?.find?.((c) => c.combatants.size > 0 && (!c.scene || c.scene.id === canvas?.scene?.id))
      ?? null;
  }

  /** Whether the tracker should be on screen now: feature enabled + an encounter with ≥1 combatant the
   *  viewer is allowed to see. */
  #shouldShow() {
    if (!game.settings.get(SYS, HUD_COMBAT_SETTING)) return false;
    const combat = this.#combat();
    const isGM = game.user.isGM;
    return !!combat && combat.turns.some((c) => isGM || !c.hidden);
  }

  /** pf2e-hud-style render/close lifecycle: FORCE-render when there's an encounter to show, else close.
   *  Force re-mounts the element via _insertElement, so the tracker reliably (re)appears the instant
   *  people are added — a plain re-render of a never-mounted/detached app silently no-op'd, which is
   *  why it used to require a reload. */
  refresh = foundry.utils.debounce(() => {
    if (this.#shouldShow()) this.render({ force: true });
    else if (this.rendered) this.close();
  }, 60);

  /** Collapsed view — show only the current turn's combatant (or, before the encounter begins, the
   *  first one). Client-side + transient (resets on reload), like the console's page. */
  #collapsed = false;

  /** @override */
  async _prepareContext() {
    const combat = this.#combat();
    const isGM = game.user.isGM;
    const L = (k) => game.i18n.localize(k);
    const visible = combat ? combat.turns.filter((c) => isGM || !c.hidden) : [];
    if (!combat || !visible.length) return { show: false };

    const started = !!combat.started;
    const current = combat.combatant;
    const currentId = current?.id;
    // The single row kept in the collapsed view: the current turn — or, before the encounter begins
    // (nobody active yet), the first combatant, so the collapsed view is never empty.
    const keepId = currentId ?? visible[0]?.id;

    const turns = visible.map((c) => {
      const actor = c.actor;
      const hp = actor?.system?.hp;
      const en = actor?.system?.energy;
      const tok = c.token?.object ?? null;
      // Vitals (HP + Energy) show to exactly who may see this token's — GM/owner always, others per
      // the shared Token-Settings gate (same rule as the on-canvas bars / hover panel / dossier).
      const seeVitals = isGM || actor?.isOwner || (tok ? canSeeTokenVitals(tok) : false);
      const seeHP = seeVitals && !!hp?.max;
      const seeEN = seeVitals && !!en?.max;
      const hpPct = seeHP ? pct(hp) : 0;
      return {
        id: c.id,
        name: c.name,
        img: c.img || actor?.img || FALLBACK_IMG,
        init: c.initiative != null ? Math.floor(c.initiative) : null,   // whole number; tie fractions stay in the stored value for sorting
        rolled: c.initiative != null,
        active: c.id === currentId,
        keep: c.id === keepId,            // the one row kept when collapsed
        defeated: c.isDefeated,
        hidden: c.hidden,
        disp: DISP_CLASS(c),
        canRoll: isGM || c.isOwner,
        targeted: !!tok && !!tok.targeted?.has?.(game.user),   // the viewer is targeting this token
        seeHP,
        hp: seeHP ? { value: hp.value ?? 0, max: hp.max ?? 0, pct: hpPct, hue: Math.round(1.2 * hpPct) } : null,
        seeEN,
        en: seeEN ? { value: en.value ?? 0, max: en.max ?? 0 } : null,
        hideLabel: L(c.hidden ? "PROJECTANIME.Hud.combat.show" : "PROJECTANIME.Hud.combat.hide"),
        defeatLabel: L(c.isDefeated ? "PROJECTANIME.Hud.combat.revive" : "PROJECTANIME.Hud.combat.defeat")
      };
    });

    const myTurn = !!current && current.isOwner;   // viewer owns the active combatant
    return {
      show: true,
      gm: isGM,
      started,
      collapsed: this.#collapsed,
      collapseLabel: L(this.#collapsed ? "PROJECTANIME.Hud.combat.expand" : "PROJECTANIME.Hud.combat.collapse"),
      round: combat.round,
      turns,
      canEnd: started && (isGM || myTurn)   // a player may end their own turn (GM uses the header nav)
    };
  }

  /** @override — mount into the right overlay (#ui-right) and pin it (CSS) just left of the chat
   *  sidebar. Anchoring to #ui-right's stable right edge instead of the chat column — which slides
   *  inward as the sidebar collapses — keeps the tracker put when the sidebar toggles. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    (document.getElementById("ui-right") ?? document.body).appendChild(element);
  }

  /** @override — hide entirely when there's no active combat (or the feature is off), and flag the
   *  body while shown so CSS hides the floating chat input (the tracker takes over that bottom spot,
   *  like pf2e-hud). The flag clears the moment the tracker goes empty, restoring the chat input. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("empty", !context.show);
    document.body.classList.toggle("pa-combat-shown", !!context.show);
  }

  /** @override — the lifecycle closes the tracker when combat ends / the feature is off; clear the
   *  chat-input-hiding flag so the floating "Enter message" box returns. */
  async _onClose(options) {
    await super._onClose(options);
    document.body.classList.remove("pa-combat-shown");
  }

  /** End/advance the turn: GM advances directly; a player whose combatant is active relays to the
   *  active GM over the system socket (Combat docs are GM-owned, so players can't advance directly). */
  static async #onEndTurn() {
    const combat = game.combats?.active;
    if (!combat?.started) return;
    if (game.user.isGM) return combat.nextTurn();
    const current = combat.combatant;
    if (!current?.isOwner) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Hud.combat.notYourTurn"));
    game.socket.emit("system.project-anime", { type: "endTurn", combatId: combat.id, userId: game.user.id });
  }

  /** Roll initiative for a combatant — GM for anyone, a player for one they own. */
  static async #onRoll(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const combat = game.combats?.active;
    if (combat && id) await combat.rollInitiative([id]);
  }

  /** GM only: roll initiative for every combatant that hasn't rolled yet (NPCs + any unrolled PCs). */
  static async #onRollAll() {
    if (game.user.isGM) await game.combats?.active?.rollAll();
  }

  /** GM only: roll initiative for unrolled NPC combatants (no player owner) only. */
  static async #onRollNpc() {
    if (game.user.isGM) await game.combats?.active?.rollNPC();
  }

  /** Click a combatant row → select & pan to its token. */
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

  /** GM only: begin the encounter (round 1, first turn). */
  static async #onBegin() {
    if (game.user.isGM) await game.combats?.active?.startCombat();
  }

  /** GM only: clear every combatant's rolled initiative. */
  static async #onReset() {
    if (game.user.isGM) await game.combats?.active?.resetAll();
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

  /* ----- GM header navigation (turn / round controls, à la pf2e-hud) ----- */
  static async #onPrevTurn() { if (game.user.isGM) await game.combats?.active?.previousTurn(); }
  static async #onPrevRound() { if (game.user.isGM) await game.combats?.active?.previousRound(); }
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
