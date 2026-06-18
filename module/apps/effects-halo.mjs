/**
 * Project: Anime — Effects Halo.
 *
 * Replaces the token's default corner stack of status icons with a PF2e-style HALO: every ACTIVE
 * EFFECT on the token's actor — not just status conditions, but auras, buffs, skill effects,
 * markers, anything in `actor.appliedEffects` — rendered as a round icon badge arranged in a ring
 * around the token (wrapping to concentric rings when there are many). Inspired by 7H3LaughingMan's
 * `pf2e-effects-halo`.
 *
 * It reuses Foundry's own `token.effects` container (a child of the token, so the halo follows it
 * and animates with it for free) by patching three Token methods on the prototype — matching how the
 * system already patches `_drawBar` (project-anime.mjs init), no libWrapper dependency:
 *   • `_drawEffects`  → feed ALL applied effects (core only draws `temporaryEffects`).
 *   • `_drawEffect`   → build each icon as a circular badge (cached render-texture) instead of a square.
 *   • `_refreshEffects` (+ `_refreshSize`) → lay the badges out around the token in rings.
 */

/** Halo tuning + badge styling. */
const PA_HALO = {
  iconScale: 0.11,   // icon RADIUS as a fraction of a grid tile (≈0.22 tile across)
  spacing: 0.08,     // gap between adjacent icons along a ring (× icon diameter — small = snug)
  rowSpacing: 0.12,  // gap between concentric rings (× icon radius)
  bg: 0x0e0b14,      // badge fill (shows through a transparent icon's gaps)
  ring: 0x241d31     // badge border ring (subtle, on-theme dark purple)
};

/** Rounded-badge textures, keyed by icon src — each is rendered once and reused on every token. */
const PA_TEX_CACHE = new Map();

const loadTex = (src, opts) => (foundry.canvas?.loadTexture ?? globalThis.loadTexture)(src, opts);

/* -------------------------------------------- */
/*  Badge texture                               */
/* -------------------------------------------- */

/** Render a raw icon texture into a circular badge (dark backing + border ring + circle-cropped art)
 *  and bake it to a reusable texture. Returns the raw texture unchanged if the renderer isn't up. */
function paBuildRoundIconTexture(rawTexture) {
  const renderer = canvas?.app?.renderer;
  if (!renderer) return rawTexture;
  const S = 128, b = 7, R = S / 2;

  const container = new PIXI.Container();
  const bg = new PIXI.Graphics();
  bg.beginFill(PA_HALO.bg, 1).drawCircle(R, R, R - b).endFill();
  bg.lineStyle(b, PA_HALO.ring, 1, 0.5).drawCircle(R, R, R - b);
  container.addChild(bg);

  const icon = new PIXI.Sprite(rawTexture);
  icon.anchor.set(0.5);
  const inner = S - 3 * b;
  const scale = inner / Math.max(rawTexture.width || S, rawTexture.height || S);
  icon.scale.set(scale);
  icon.position.set(R, R);
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawCircle(R, R, R - 2 * b).endFill();
  icon.mask = mask;
  container.addChild(mask, icon);

  const tex = PIXI.RenderTexture.create({ width: S, height: S, resolution: 2 });
  renderer.render(container, { renderTexture: tex });   // PIXI v7 render-to-texture (as pf2e-effects-halo does)
  container.destroy({ children: true });                // children only — the shared raw texture survives
  return tex;
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/** Ramanujan ellipse-circumference approximation (a circle when a === b). */
function paEllipseCirc(a, b) {
  if (a === b) return 2 * Math.PI * a;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  const c = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  return Number.isFinite(c) ? c : 2 * Math.PI * Math.max(a, b);
}

/** The k-th icon on a ring sized to hold `rowMax`: one icon-slot of arc each, so consecutive icons
 *  sit snug with a constant small gap — NO big empty spaces. Starts at the TOP (12 o'clock) and runs
 *  CLOCKWISE, filling the ring IN ORDER — each new icon directly beside the previous, the way the
 *  reference halo packs them; a partly-filled ring is a continuous arc from the top, never a
 *  spread-out scatter (icon 0 → icon 1 are always neighbours, never opposite sides). */
function paRingPoint(k, rowMax, rw, rh) {
  const theta = -Math.PI / 2 + (k / rowMax) * 2 * Math.PI;
  return { x: rw * Math.cos(theta), y: rh * Math.sin(theta) };
}

/* -------------------------------------------- */
/*  Patched Token methods (run with `this` = Token)  */
/* -------------------------------------------- */

/** Every ACTIVE effect on the actor that carries an icon (temporary AND permanent) — the halo's
 *  content. Core's `temporaryEffects` would drop passive buffs / gear effects / aura markers. */
function paTokenEffects(actor) {
  if (!actor) return [];
  return (actor.appliedEffects ?? []).filter((e) => e?.img);
}

/** OVERRIDE of Token#_drawEffects — identical to core except it draws ALL applied effects. */
async function paDrawEffects() {
  this.effects.renderable = false;
  this.effects.removeChildren().forEach((c) => c.destroy());
  this.effects.bg = this.effects.addChild(new PIXI.Graphics());
  this.effects.bg.zIndex = -1;
  this.effects.overlay = null;

  const activeEffects = paTokenEffects(this.actor);
  const overlayEffect = activeEffects.findLast((e) => e.img && e.getFlag("core", "overlay"));

  const promises = [];
  for (const [i, effect] of activeEffects.entries()) {
    if (!effect.img) continue;
    const promise = effect === overlayEffect
      ? this._drawOverlay(effect.img, effect.tint)
      : this._drawEffect(effect.img, effect.tint);
    promises.push(promise.then((e) => { if (e) e.zIndex = i; }));
  }
  await Promise.allSettled(promises);

  this.effects.sortChildren();
  this.effects.renderable = true;
  this.renderFlags.set({ refreshEffects: true });
}

/** OVERRIDE of Token#_drawEffect — adds a circular badge sprite (cached) rather than a square icon. */
async function paDrawEffect(src, _tint) {
  if (!src) return undefined;
  let texture = PA_TEX_CACHE.get(src);
  if (!texture) {
    const raw = await loadTex(src, { fallback: "icons/svg/hazard.svg" });
    if (!canvas?.app?.renderer) return this.effects.addChild(new PIXI.Sprite(raw));   // pre-renderer: plain, uncached
    texture = paBuildRoundIconTexture(raw);
    PA_TEX_CACHE.set(src, texture);
  }
  return this.effects.addChild(new PIXI.Sprite(texture));
}

/** OVERRIDE of Token#_refreshEffects — lay the badges out in concentric rings around the token. */
function paRefreshEffects() {
  const fx = this.effects;
  if (!fx) return;
  if (fx.bg) fx.bg.clear();                       // badges carry their own backing; core's plate unused

  const grid = canvas.dimensions?.size || 100;
  const iconR = grid * PA_HALO.iconScale;
  const sp = iconR * PA_HALO.spacing;
  const rsp = iconR * PA_HALO.rowSpacing;
  const { width, height } = this.document.getSize();
  const cx = width / 2, cy = height / 2;
  const halfW = (grid * this.document.width) / 2;
  const halfH = (grid * this.document.height) / 2;

  const icons = [];
  for (const c of fx.children) {
    if (c === fx.bg) continue;
    if (c === fx.overlay) {                        // a core "overlay" effect (e.g. a death mark) stays centred
      const sz = Math.min(width, height) * 0.6;
      c.anchor.set(0.5); c.width = c.height = sz; c.position.set(cx, cy);
      continue;
    }
    icons.push(c);
  }
  if (!icons.length) return;

  // Each ring sits one icon-diameter further out than the last; rowMax = how many fit on it.
  const geom = (row) => {
    const expand = (2 * row - 1) * iconR + row * rsp;
    const rw = halfW + expand, rh = halfH + expand;
    const rowMax = Math.max(1, Math.floor(paEllipseCirc(rw, rh) / ((iconR + sp) * 2)));
    return { rw, rh, rowMax };
  };

  // Fill rings from the inside out, packing icons SEQUENTIALLY at a fixed one-slot spacing (snug, no
  // big gaps) starting at the top — a partly-filled ring is a continuous arc from the top; a full
  // ring (the goblin-style many-effect case) wraps all the way around.
  let idx = 0, row = 1;
  while (idx < icons.length) {
    const ring = geom(row);
    const count = Math.min(icons.length - idx, ring.rowMax);
    for (let k = 0; k < count; k++) {
      const p = paRingPoint(k, ring.rowMax, ring.rw, ring.rh);
      const icon = icons[idx++];
      icon.anchor.set(0.5);
      icon.width = icon.height = iconR * 2;
      icon.position.set(cx + p.x, cy + p.y);
    }
    row += 1;
  }
}

/* -------------------------------------------- */
/*  Install                                     */
/* -------------------------------------------- */

/** Patch the Token prototype to render the Effects Halo. Call once in `init` (guarded, like the
 *  system's other Token patches). */
export function patchEffectsHalo(TokenClass) {
  if (!TokenClass || TokenClass.prototype._paEffectsHaloPatched) return;
  TokenClass.prototype._drawEffects = paDrawEffects;
  TokenClass.prototype._drawEffect = paDrawEffect;
  TokenClass.prototype._refreshEffects = paRefreshEffects;
  // A live size change re-lays the halo (core doesn't always set refreshEffects on resize).
  const baseRefreshSize = TokenClass.prototype._refreshSize;
  TokenClass.prototype._refreshSize = function (...args) {
    const r = baseRefreshSize?.apply(this, args);
    try { this._refreshEffects(); } catch (_e) { /* effects not built yet */ }
    return r;
  };
  TokenClass.prototype._paEffectsHaloPatched = true;
}
