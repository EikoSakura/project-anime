/**
 * Project: Anime — hover Token Info panel.
 *
 * A frameless, screen-docked readout that appears beside a token on hover (like a
 * status HUD): portrait, name, a disposition badge, and the token's HP / Energy bars.
 * It is OFF by default — a GM turns it on via the "Token Info Panel" world setting.
 *
 * Visibility model ("read enemies, own your own"): with the setting on, anyone who can
 * SEE a token reads its HP / Energy; the GM and a token's owner see it for their own
 * tokens too. Deeper layers (Skill Points, Attributes, Combat Stats, Skills, Affinities)
 * are added in later phases and gated behind the viewer's Reveal effects + a right-click
 * dossier — this phase is the basic HP / MP glance only.
 *
 * Reuses the sheet's resource-bar styling (`.resource` / `.bar` / `.fill`) and a
 * self-contained dark palette (matching `.pa-tooltip`) so it reads the same in any theme.
 */
import { collectReveals } from "../helpers/effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const TOKEN_INFO_SETTING = "showTokenInfo";
export const TOKEN_INFO_CLIENT_SETTING = "tokenInfoClientShow";

/** The reveal categories the current user's own character / controlled token unlocks (their
 *  Scouter) — the active Reveal rules on the viewer's assigned PC, or whichever token they
 *  control. GM/owners bypass this (they see everything), so it's only consulted for other
 *  viewers. Shared by the hover panel and the right-click dossier. */
export function viewerReveals() {
  const viewer = canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
  return viewer ? collectReveals(viewer) : new Set();
}

/* -------------------------------------------- */
/*  GM-configurable custom fields               */
/* -------------------------------------------- */

export const TOKEN_INFO_FIELDS_SETTING = "tokenInfoFields";

/** Gate options for a custom field: always shown, owner/GM only, or unlocked by one of the
 *  viewer's Reveal categories (reuses the Effect reveal labels). */
export const TOKEN_FIELD_GATES = {
  always: "PROJECTANIME.TokenFields.gate.always",
  owner: "PROJECTANIME.TokenFields.gate.owner",
  skillPoints: "PROJECTANIME.Effect.reveal.skillPoints",
  attributes: "PROJECTANIME.Effect.reveal.attributes",
  combatStats: "PROJECTANIME.Effect.reveal.combatStats",
  skills: "PROJECTANIME.Effect.reveal.skills",
  affinities: "PROJECTANIME.Effect.reveal.affinities"
};

/** Where a custom field appears. */
export const TOKEN_FIELD_SURFACES = {
  panel: "PROJECTANIME.TokenFields.surface.panel",
  dossier: "PROJECTANIME.TokenFields.surface.dossier"
};

/** The GM-configured custom field definitions ({label, path, gate, surface}). */
export function tokenFields() {
  try { return game.settings.get("project-anime", TOKEN_INFO_FIELDS_SETTING) ?? []; }
  catch (_) { return []; }
}

/** Resolve the visible custom-field rows for one surface ("panel" | "dossier"), honoring each
 *  field's gate against the viewer (full = owner/GM; reveals = the viewer's unlocked set). Reads
 *  each field's data path off the actor (e.g. "system.rank", "flags.mod.rank"); skips
 *  empty/object values. @returns {{label:string, value:string}[]} */
export function customFieldRows(actor, { full = false, reveals = null, surface = "dossier" } = {}) {
  const out = [];
  for (const f of tokenFields()) {
    if (!f?.path || (f.surface || "dossier") !== surface) continue;
    const gate = f.gate || "always";
    const visible = gate === "always" ? true : gate === "owner" ? full : (full || !!reveals?.has(gate));
    if (!visible) continue;
    const raw = foundry.utils.getProperty(actor, f.path);
    let value;
    if (typeof raw === "boolean") value = raw ? "✓" : "—";
    else if (typeof raw === "number" || typeof raw === "string") value = String(raw);
    else continue; // skip undefined / objects / arrays
    if (value === "") continue;
    out.push({ label: f.label || f.path, value });
  }
  return out;
}

/** A character/NPC's TOTAL Skill Points: unspent + everything spent + free granted abilities.
 *  Characters use the Skill-Point ledger (`Spent = Σ log.amount`); NPCs (no ledger) fall back
 *  to the derived sum (the advancement `spent` scalar + every owned skill's `spCost`). */
export function totalSkillPoints(actor) {
  const sp = actor?.system?.skillPoints;
  if (!sp) return 0;
  const value = Number(sp.value) || 0;
  if (Array.isArray(sp.log)) {
    const spent = sp.log.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    let granted = 0;
    for (const item of actor.items ?? []) {
      if (item.type === "skill" && item.getFlag("project-anime", "granted")) granted += Number(item.system?.spCost) || 0;
    }
    return value + spent + granted;
  }
  let total = value + (Number(sp.spent) || 0);
  for (const item of actor.items ?? []) if (item.type === "skill") total += Number(item.system?.spCost) || 0;
  return total;
}

export class TokenInfoPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "project-anime-token-info",
    classes: ["project-anime", "token-info-panel"],
    // Frameless + unpositioned: render only our content (no window chrome); we anchor it
    // ourselves beside the hovered token. Appended to <body> (see _insertElement).
    window: { frame: false, positioned: false }
  };

  static PARTS = {
    panel: { template: "systems/project-anime/templates/apps/token-info.hbs" }
  };

  /** The token currently being displayed (null when hidden). */
  #token = null;

  get token() {
    return this.#token;
  }

  /** Whether the GM has enabled the feature (world setting). */
  static get enabled() {
    return game.settings.get("project-anime", TOKEN_INFO_SETTING);
  }

  /** Whether the hover panel should show for THIS user: the world feature is on AND the user
   *  hasn't hidden it via their per-user Token-controls toggle. (The dossier ignores this.) */
  static get panelEnabled() {
    return this.enabled && game.settings.get("project-anime", TOKEN_INFO_CLIENT_SETTING);
  }

  /** Decide whether to show for a token and compute the viewer's access flags, or null
   *  when nothing should display (no actor, or a hidden/unseen token for a non-GM). */
  static viewFor(token) {
    const actor = token?.actor;
    if (!actor) return null;
    if (!game.user.isGM && (token.document.hidden || !token.visible)) return null;
    return { actor, owner: actor.isOwner };
  }

  /** Map the four token dispositions to a tint key used for the panel frame + badge. */
  static #dispKey(token) {
    const D = CONST.TOKEN_DISPOSITIONS;
    switch (token.document.disposition) {
      case D.HOSTILE: return "hostile";
      case D.FRIENDLY: return "friendly";
      case D.SECRET: return "secret";
      default: return "neutral";
    }
  }

  /** @override */
  async _prepareContext() {
    const token = this.#token;
    const view = token ? TokenInfoPanel.viewFor(token) : null;
    if (!view) return { show: false };

    const actor = view.actor;
    const sys = actor.system ?? {};
    const hp = sys.hp ?? {};
    const energy = sys.energy ?? {};
    const pct = (v, m) => (m > 0 ? Math.clamp(Math.round(((v ?? 0) / m) * 100), 0, 100) : 0);

    // Badge: an NPC reads as its disposition toward the party; a PC reads as "Character".
    const badge = actor.type === "npc"
      ? game.i18n.localize(CONFIG.PROJECTANIME.dispositions[sys.disposition] ?? "TYPES.Actor.npc")
      : game.i18n.localize("TYPES.Actor.character");

    // Reveal gating: owners + the GM (isOwner is true for the GM) see every layer; any other
    // viewer sees a deeper layer only if their own Scouter unlocks that category.
    const reveals = view.owner ? null : viewerReveals();
    const can = (cat) => view.owner || !!reveals?.has(cat);
    const hasSkillPoints = sys.skillPoints !== undefined;

    return {
      show: true,
      disp: TokenInfoPanel.#dispKey(token),
      img: actor.img,
      name: token.document.name || actor.name,
      badge,
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, pct: pct(hp.value, hp.max) },
      energy: { value: energy.value ?? 0, max: energy.max ?? 0, pct: pct(energy.value, energy.max) },
      sp: { show: hasSkillPoints && can("skillPoints"), value: totalSkillPoints(actor) },
      customFields: customFieldRows(actor, { full: view.owner, reveals, surface: "panel" })
    };
  }

  /** @override — render straight into <body> as a fixed-position overlay. */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) { existing.replaceWith(element); return; }
    document.body.appendChild(element);
  }

  /** @override — tag the disposition, toggle empty-hiding, then anchor beside the token. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.classList.remove("ti-disp-hostile", "ti-disp-friendly", "ti-disp-neutral", "ti-disp-secret");
    if (context.show) el.classList.add(`ti-disp-${context.disp}`);
    el.classList.toggle("empty", !context.show);
    if (context.show) this.#position();
  }

  /** Anchor the panel just to the right of the token (flipping left if it would overflow). */
  #position() {
    const token = this.#token;
    const el = this.element;
    if (!token || !el || !canvas?.ready) return;
    const m = canvas.stage.worldTransform;
    const b = token.bounds;
    const right = m.apply({ x: b.right, y: b.top });
    const left = m.apply({ x: b.left, y: b.top });
    const rect = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const gap = 14;
    const width = el.offsetWidth || 220;
    let x = rect.left + right.x + gap;
    if (x + width > window.innerWidth - 8) x = rect.left + left.x - gap - width;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, rect.top + right.y)}px`;
  }

  /** Show the panel for a token (renders + positions). No-op if the feature is off or the
   *  viewer may not see this token. */
  async show(token) {
    // Hidden when: the feature is off for this user, this token's HUD is open (avoids
    // overlapping the Token HUD buttons), or this viewer may not see it.
    if (!TokenInfoPanel.panelEnabled || token?.hasActiveHUD || !TokenInfoPanel.viewFor(token)) return this.hide();
    this.#token = token;
    await this.render({ force: true });
  }

  /** Hide the panel. */
  hide() {
    this.#token = null;
    this.element?.classList.add("empty");
  }

  /** True when the panel is currently showing `actor` (used to live-refresh on changes). */
  isShowing(actor) {
    return !!this.#token && this.#token.actor === actor && !this.element?.classList.contains("empty");
  }
}
