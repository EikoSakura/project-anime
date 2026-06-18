/**
 * Project: Anime — Aura field overlay (canvas).
 *
 * Draws a visible ring around every token that is currently projecting an Aura Skill, and — PF2e
 * style — fills that ring with a translucent highlight while the token is hovered, so you can read
 * the field's reach at a glance. Purely cosmetic and per-client: it mirrors the same live-aura set
 * the reconcile uses (helpers/aura.mjs `liveAuraSkills`) and the same circular catchment radius
 * (each Skill's Aura radius — base = the Skill's Rank plus any Tune growth; the ring shows the
 * widest active field), so the ring bounds exactly who the aura affects.
 *
 * Drawn on `canvas.controls` (the world-space overlay above tokens), mirroring the hover Range Line.
 * Rings follow their token live — the `refreshToken` hook repositions them each animation frame —
 * and the set is rebuilt whenever an aura starts / stops / moves (wired in project-anime.mjs onto the
 * same triggers that drive the reconcile).
 */

import { PROJECTANIME, modifierValue } from "../helpers/config.mjs";
import { liveAuraSkills } from "../helpers/aura.mjs";
import { tokenHalfExtentTiles } from "../helpers/templates.mjs";

/** Ring colour — a soft theme purple (matches the system accent). */
const AURA_COLOR = 0xb39ddb;

export class AuraField {
  /** Our overlay container on the active ControlsLayer (lazily (re)built). */
  #container = null;
  /** tokenId → ring Graphics (geometry in local space, positioned at the token centre). */
  #rings = new Map();
  /** The token currently hovered (its ring shows the filled area highlight). Null when none. */
  #hoveredId = null;

  /** (Re)build the overlay container on the current ControlsLayer if it's missing or stale (a scene
   *  change destroys the old one). World-space, so rings are positioned with token-centre coords. */
  #ensure() {
    const layer = canvas?.ready ? canvas.controls : null;
    if (!layer) return false;
    if (this.#container && !this.#container.destroyed && this.#container.parent === layer) return true;
    const c = new PIXI.Container();
    c.eventMode = "none";                 // never intercept clicks — tokens stay selectable
    layer.addChildAt(c, 0);               // beneath the range line / cursors / ruler
    this.#container = c;
    this.#rings = new Map();              // the old rings died with the old container
    return true;
  }

  /** The aura circle's pixel radius, measured from the token's EDGE — the largest active Aura radius
   *  on the token (its base + any "Tune a Modifier" growth, per-skill) plus the token's half-extent,
   *  from its centre — so the field reads as a full N tiles beyond the body and grows with a larger
   *  creature's footprint. A token with several auras shows its widest field's bound. Matches the
   *  reconcile's edge-to-edge catchment, so the ring bounds exactly who's affected. */
  #radiusPx(token) {
    const skills = liveAuraSkills(token);
    const auraTiles = skills.length
      ? Math.max(...skills.map((s) => modifierValue(s, "aura")))
      : (PROJECTANIME.auraTiles ?? 2);
    const tiles = auraTiles + tokenHalfExtentTiles(token);
    return tiles * (canvas.dimensions?.size ?? 100);
  }

  /** Draw (or redraw) one token's ring; `hovered` adds the translucent area fill. */
  #drawRing(token, hovered) {
    let g = this.#rings.get(token.id);
    if (!g || g.destroyed) {
      g = new PIXI.Graphics();
      g.eventMode = "none";
      this.#container.addChild(g);
      this.#rings.set(token.id, g);
    }
    const r = this.#radiusPx(token);
    const s = canvas.dimensions.uiScale;
    g.clear();
    if (hovered) {                        // PF2e-style: hovering the bearer highlights the whole area
      g.beginFill(AURA_COLOR, 0.12);
      g.drawCircle(0, 0, r);
      g.endFill();
    }
    // Two-pass outline (dark halo, then coloured core) so the ring reads over any map.
    g.lineStyle({ width: 3 * s, color: 0x000000, alpha: 0.35 });
    g.drawCircle(0, 0, r);
    g.lineStyle({ width: 2 * s, color: AURA_COLOR, alpha: hovered ? 0.95 : 0.55 });
    g.drawCircle(0, 0, r);
    g.position.set(token.center.x, token.center.y);
    g.visible = true;
  }

  /** Rebuild the whole set: a ring for every visible, undefeated token projecting a live aura. */
  refresh() {
    if (!this.#ensure()) return;
    const seen = new Set();
    for (const token of canvas.tokens?.placeables ?? []) {
      if (token.isPreview || !token.actor) continue;
      if (token.document.hidden || !token.visible) continue;        // not projecting / unseen here
      if ((token.actor.system?.hp?.value ?? 1) <= 0) continue;      // defeated bearers have no field
      if (!liveAuraSkills(token).length) continue;
      seen.add(token.id);
      this.#drawRing(token, this.#hoveredId === token.id);
    }
    for (const [id, g] of this.#rings) {                            // drop rings no longer wanted
      if (!seen.has(id)) { if (!g.destroyed) g.destroy(); this.#rings.delete(id); }
    }
  }

  /** Keep a ring glued to its token as it animates (cheap: just moves the Graphics, no redraw). */
  reposition(token) {
    const g = this.#rings.get(token?.id);
    if (g && !g.destroyed && token) g.position.set(token.center.x, token.center.y);
  }

  /** Toggle the hover highlight, clearing the previously-hovered ring's fill. */
  setHover(token, hovered) {
    const id = token?.id ?? null;
    const prev = this.#hoveredId;
    if (hovered) this.#hoveredId = id;
    else if (prev === id) this.#hoveredId = null;
    if (prev && prev !== this.#hoveredId) this.#redraw(prev);
    if (id) this.#redraw(id);
  }

  /** Redraw a single ring by token id (no-op if that token isn't an aura-bearer). */
  #redraw(id) {
    const token = canvas.tokens?.get(id);
    if (token && this.#rings.has(id)) this.#drawRing(token, this.#hoveredId === id);
  }
}
