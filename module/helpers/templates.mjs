import { PROJECTANIME } from "./config.mjs";

/**
 * Project: Anime — Area-of-Effect targeting helpers.
 *
 * The combat engine (dice.mjs) is single-target by default. The four area
 * modifiers — Burst, Line, Mass, Chain — drive multi-target resolution from here:
 *   • Burst → a circular MeasuredTemplate (radius from growableModifiers.burst, in tiles).
 *   • Line  → a ray MeasuredTemplate (length = the Skill's Range, 1 tile wide).
 *   • Mass  → every token within Range of the caster, then a pick dialog.
 *   • Chain → handled in dice.mjs (sequential leaps), using tokensInRange here.
 *
 * Templates are placed interactively (cursor preview → click) and the tokens caught
 * under the final shape become the user's targets. The V13 preview mechanism mirrors
 * core's TemplateLayer#_onDragLeftStart (canvas/layers/templates.mjs). Foundry V14
 * removed Measured Templates outright (absorbed by Scene Regions), so there the preview
 * is a hand-rolled PIXI overlay (placeAreaPixi) and nothing persists — the final shape
 * flashes on the controls layer instead.
 */

const i18n = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

const FDE = () => foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;

/** Scene distance-units per tile (e.g. 5 ft). Templates measure in distance-units. */
function unitsPerTile() {
  return canvas?.dimensions?.distance || 1;
}

/** Whether this Foundry generation still has Measured Templates — v14 deleted the document
 *  type and its canvas layer. When absent, placement runs on the PIXI fallback below. */
const hasTemplateLayer = () => !!canvas?.templates && !!CONFIG.MeasuredTemplate?.objectClass;

/** The acting user's color as a PIXI-ready number. */
const userColor = () => Number(game.user?.color ?? 0xff0000) || 0xff0000;

/* -------------------------------------------- */
/*  Skill → area kind                           */
/* -------------------------------------------- */

/** Which area modifier (if any) a Skill carries — drives multi-target resolution. */
export function aoeKind(item) {
  const mods = item?.system?.modifiers ?? [];
  for (const k of PROJECTANIME.areaModifiers) if (mods.includes(k)) return k;
  return null;
}

/** The acting actor's token on the current scene (an active token, else a matching
 *  controlled token). Null if the actor isn't represented on the canvas. */
export function casterToken(actor) {
  if (!actor || !canvas?.ready) return null;
  const active = actor.getActiveTokens?.() ?? [];
  if (active.length) return active[0];
  const controlled = canvas.tokens?.controlled?.[0];
  return controlled?.actor === actor ? controlled : null;
}

/* -------------------------------------------- */
/*  Token gathering                             */
/* -------------------------------------------- */

/** Sample points for a token: its center plus each occupied grid-cell centre (large tokens). */
function tokenSamplePoints(token) {
  const pts = [token.center];
  const gs = canvas.grid.size;
  const w = Math.max(1, Math.round(token.document.width));
  const h = Math.max(1, Math.round(token.document.height));
  if (w > 1 || h > 1) {
    const { x, y } = token.document;
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) pts.push({ x: x + (i + 0.5) * gs, y: y + (j + 0.5) * gs });
    }
  }
  return pts;
}

/** Tokens whose footprint falls inside a template shape positioned at (ox, oy). The
 *  shape is in the template's local space, so points are tested relative to its origin. */
export function templateTokens(shape, ox, oy) {
  const out = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.isPreview || !token.actor) continue;
    if (tokenSamplePoints(token).some((p) => shape.contains(p.x - ox, p.y - oy))) out.push(token);
  }
  return out;
}

/** A token's centre from its DOCUMENT position (its committed grid coordinates) rather than its
 *  on-screen `center`, which lags behind while a movement animation plays. Range checks must use
 *  this: an aura has to apply / remove against where a token actually IS once a move resolves, not
 *  where it's still visually sliding through — the aura reconcile fires the instant the move commits
 *  (the updateToken hook), long before the slide finishes. For a stationary token this equals
 *  `token.center`, so targeting that runs at rest (Mass / Chain) is unaffected. */
function tokenDocCenter(token) {
  const d = token.document;
  const gs = canvas.grid?.size ?? 100;
  return { x: d.x + (d.width * gs) / 2, y: d.y + (d.height * gs) / 2 };
}

/** A token's "radius" in tiles — half of its larger footprint dimension (0.5 for a 1×1, 1 for a 2×2,
 *  1.5 for a 3×3). Lets an aura's reach — and the ring drawn for it — extend from a creature's EDGE
 *  rather than its centre point, so a bigger creature projects a correspondingly bigger field. */
export function tokenHalfExtentTiles(token) {
  const d = token?.document;
  if (!d) return 0.5;
  return Math.max(Number(d.width) || 1, Number(d.height) || 1) / 2;
}

/** Tokens within `tiles` of an origin token, nearest first (origin excluded by default).
 *  By default distance is Foundry's path measurement, so it follows the SCENE's grid-diagonal rule —
 *  i.e. Mass / Chain reach counts diagonals the same way movement does (set the scene to
 *  "Equidistant" for the rules' diagonal = 1). Pass `euclidean: true` for a footprint-aware circular
 *  reach instead — the straight-line gap between token EDGES, so size counts on BOTH ends (a bigger
 *  source reaches further, a bigger target is caught sooner). Auras use this; their round field,
 *  growing with the source's footprint, is exactly what the on-canvas ring draws. Measured between
 *  DOCUMENT centres so an in-flight move animation never skews who counts as in range. */
export function tokensInRange(originToken, tiles, { excludeSelf = true, euclidean = false } = {}) {
  if (!originToken) return [];
  const o = tokenDocCenter(originToken);
  const per = unitsPerTile();
  const sizePx = canvas?.dimensions?.size || 1;
  const halfO = euclidean ? tokenHalfExtentTiles(originToken) : 0;
  const found = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.isPreview || !token.actor) continue;
    if (excludeSelf && token === originToken) continue;
    const c = tokenDocCenter(token);
    // euclidean (Auras): the EDGE-to-edge gap — subtract both tokens' half-extents from the
    // centre-to-centre line, so the field is N tiles out from the source's body and a large target
    // counts once any part of it reaches in. Otherwise: the scene's grid path measurement.
    const dist = euclidean
      ? Math.max(0, Math.hypot(c.x - o.x, c.y - o.y) / sizePx - halfO - tokenHalfExtentTiles(token))
      : canvas.grid.measurePath([o, c]).distance / per;
    if (dist <= tiles) found.push({ token, dist });
  }
  found.sort((a, b) => a.dist - b.dist);
  return found.map((e) => e.token);
}

/** Set the acting user's targets to exactly these tokens (highlights reticles + broadcasts). */
export function setUserTargets(tokens) {
  canvas.tokens.setTargets(tokens.map((t) => t.id), { mode: "replace" });
}

/** The point on a box (centre `c`, half-extents `hw`×`hh`) where a ray heading (dx,dy) exits —
 *  i.e. the edge of the caster's square in the aim direction, so a Line starts at the edge,
 *  not the middle. Returns the centre if the box has no size. */
function boxEdgePoint(c, hw, hh, dx, dy) {
  if (!(hw > 0) && !(hh > 0)) return { x: c.x, y: c.y };
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return { x: c.x + (hw || 0), y: c.y };
  const tx = adx > 0 ? hw / adx : Infinity;
  const ty = ady > 0 ? hh / ady : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/* -------------------------------------------- */
/*  Mass: choose targets in range               */
/* -------------------------------------------- */

/** Mass: a checkbox list of in-range tokens (all checked by default). Returns the chosen
 *  tokens, [] if none, or null if cancelled. */
export async function pickTargetsDialog(tokens) {
  if (!tokens.length) return [];
  const rows = tokens.map((t) => {
    const name = foundry.utils.escapeHTML(t.document.name || t.actor?.name || "?");
    const img = t.document.texture?.src || t.actor?.img || "icons/svg/mystery-man.svg";
    return `<label class="pa-target-pick"><input type="checkbox" name="${t.id}" checked />
      <img src="${img}" width="28" height="28" /> <span>${name}</span></label>`;
  }).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Roll.massPickTitle") },
    content: `<div class="project-anime roll-dialog mass-pick">${rows}</div>`,
    buttons: [
      { action: "ok", label: i18n("PROJECTANIME.Roll.roll"), icon: "fas fa-bullseye", default: true,
        callback: (event, button) => new (FDE())(button.form).object },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return tokens.filter((t) => result[t.id]);
}

/* -------------------------------------------- */
/*  PIXI area preview (V14 — no template layer) */
/* -------------------------------------------- */

/** Local-space geometry for an area shape: a circle of `radiusPx`, or a ray polygon of
 *  `lengthPx` × `widthPx` aimed along `radians` — the direction baked into the points and the
 *  origin at the placement point, exactly the space templateTokens tests in. */
function areaShape(t, { radiusPx = 0, lengthPx = 0, widthPx = 0, radians = 0 } = {}) {
  if (t === "ray") {
    const ux = Math.cos(radians), uy = Math.sin(radians);
    const nx = -uy * (widthPx / 2), ny = ux * (widthPx / 2);
    return new PIXI.Polygon([
      { x: nx, y: ny },
      { x: -nx, y: -ny },
      { x: -nx + ux * lengthPx, y: -ny + uy * lengthPx },
      { x: nx + ux * lengthPx, y: ny + uy * lengthPx }
    ]);
  }
  return new PIXI.Circle(0, 0, radiusPx);
}

/** (Re)draw an area shape into a Graphics, template-style: translucent fill + solid border. */
function drawAreaShape(g, shape, color) {
  g.clear();
  g.lineStyle(3, color, 0.9);
  g.beginFill(color, 0.18);
  if (shape instanceof PIXI.Circle) g.drawCircle(0, 0, shape.radius);
  else g.drawPolygon(shape.points);
  g.endFill();
}

/** Transient flash of a committed area: drawn on the controls layer and faded out over ~1.5s,
 *  so the table still sees where the area landed even with nothing persisted. */
function flashAreaShape(shape, x, y, color) {
  const layer = canvas?.controls;
  if (!layer) return;
  const g = new PIXI.Graphics();
  drawAreaShape(g, shape, color);
  g.position.set(x, y);
  layer.addChild(g);
  const started = Date.now();
  const life = 1500;
  const tick = () => {
    const t = (Date.now() - started) / life;
    if (t >= 1 || g.destroyed) {
      canvas.app?.ticker?.remove(tick);
      if (!g.destroyed) g.destroy({ children: true });
      return;
    }
    g.alpha = 1 - t;
  };
  canvas.app?.ticker?.add(tick);
}

/* -------------------------------------------- */
/*  Self-centered Burst (emanation)             */
/* -------------------------------------------- */

/** A SELF-CENTERED Burst: a circle of `distanceTiles` radius centered on the origin token — no
 *  interactive placement, the caster IS the centre. Persists a MeasuredTemplate for visual feedback
 *  (best-effort; targets are captured first so it works even without create permission) and returns
 *  every token caught under it (the caster included — the Skill's Target filters who's affected). */
export async function emanateBurst(originToken, distanceTiles) {
  if (!originToken || !canvas?.ready) return [];
  const c = originToken.center;
  const per = unitsPerTile();
  const radiusPx = Math.max(0, distanceTiles) * (canvas.dimensions?.size ?? 100);
  // A plain geometric circle (origin-local) is all templateTokens needs to test containment.
  const tokens = templateTokens(new PIXI.Circle(0, 0, radiusPx), c.x, c.y);
  if (hasTemplateLayer()) {
    try {
      await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
        user: game.user.id, t: "circle", x: c.x, y: c.y,
        distance: distanceTiles * per, direction: 0,
        fillColor: game.user.color?.toString?.() ?? "#ff0000"
      }]);
    } catch (_e) { /* creation denied — targets are already captured */ }
  } else {
    // V14: nothing to persist — flash the emanation so the table sees its reach.
    flashAreaShape(new PIXI.Circle(0, 0, radiusPx), c.x, c.y, userColor());
  }
  return tokens;
}

/* -------------------------------------------- */
/*  Interactive template placement              */
/* -------------------------------------------- */

/**
 * Interactively place a MeasuredTemplate, then capture the tokens caught under it.
 * Distances are given in TILES (converted to scene distance-units internally).
 *
 * @param {object} opts
 * @param {"circle"|"ray"} opts.t          Template shape.
 * @param {number} opts.distanceTiles      Radius (circle) or length (ray) in tiles.
 * @param {{x,y}|null} [opts.origin]       Anchor point (caster token centre).
 * @param {"point"|"direction"} [opts.follow]  Cursor controls the centre (circle) or the aim (ray).
 * @param {number|null} [opts.maxRangeTiles]   Clamp a "point" template within this many tiles of origin.
 * @param {number} [opts.widthTiles]       Ray width in tiles (default 1).
 * @param {string} [opts.hint]             Notification shown while placing.
 * @returns {Promise<{tokens: Token[], point: {x:number,y:number}, doc: MeasuredTemplateDocument|null}|null>}
 *          The caught tokens + final point + persisted template (null doc if creation was denied),
 *          or null if the user cancelled.
 */
export async function placeTemplate({
  t = "circle", distanceTiles = 1, origin = null, follow = "point",
  maxRangeTiles = null, widthTiles = 1, originHalfW = 0, originHalfH = 0, hint = ""
} = {}) {
  if (!canvas?.ready) return null;
  // V14 removed Measured Templates — same contract, PIXI preview, nothing persisted (doc: null).
  if (!hasTemplateLayer()) {
    return placeAreaPixi({ t, distanceTiles, origin, follow, maxRangeTiles, widthTiles, originHalfW, originHalfH, hint });
  }
  const per = unitsPerTile();
  const cls = foundry.utils.getDocumentClass("MeasuredTemplate");
  const seed = origin ?? canvas.mousePosition ?? { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };
  const data = {
    user: game.user.id,
    t,
    x: seed.x,
    y: seed.y,
    distance: distanceTiles * per,
    direction: 0,
    fillColor: game.user.color?.toString?.() ?? "#ff0000"
  };
  if (t === "ray") data.width = widthTiles * per;

  const doc = new cls(data, { parent: canvas.scene });
  const object = new CONFIG.MeasuredTemplate.objectClass(doc);
  doc._object = object;

  const initialLayer = canvas.activeLayer;
  canvas.templates.activate();
  canvas.templates.preview.addChild(object);
  await object.draw();

  if (hint) ui.notifications.info(hint);

  return new Promise((resolve) => {
    const stage = canvas.stage;
    const view = canvas.app?.view;
    const prevContext = view ? view.oncontextmenu : null;
    let done = false;
    let moveTime = 0;

    const redraw = () => object.renderFlags.set({ refreshShape: true, refreshPosition: true, refreshGrid: true });

    const update = (cursor) => {
      if (follow === "direction" && origin) {
        const dx = cursor.x - origin.x, dy = cursor.y - origin.y;
        let dir = Math.toDegrees(Math.atan2(dy, dx));
        if (Math.normalizeDegrees) dir = Math.normalizeDegrees(dir);
        // Start the ray at the caster's square edge facing the cursor, not its centre.
        const start = boxEdgePoint(origin, originHalfW, originHalfH, dx, dy);
        doc.updateSource({ x: start.x, y: start.y, direction: dir });
      } else {
        let p = canvas.templates.getSnappedPoint(cursor);
        if (origin && maxRangeTiles != null) {
          const maxPx = maxRangeTiles * canvas.dimensions.size;
          const dx = p.x - origin.x, dy = p.y - origin.y;
          const px = Math.hypot(dx, dy);
          if (px > maxPx && px > 0) p = { x: origin.x + (dx / px) * maxPx, y: origin.y + (dy / px) * maxPx };
        }
        doc.updateSource({ x: p.x, y: p.y });
      }
      redraw();
    };

    const onMove = (event) => {
      event.stopPropagation?.();
      const now = Date.now();
      if (now - moveTime <= 20) return;
      moveTime = now;
      update(event.getLocalPosition(stage));
    };

    const finish = async (commit) => {
      if (done) return;
      done = true;
      stage.off("pointermove", onMove);
      stage.off("pointerdown", onDown);
      if (view) view.oncontextmenu = prevContext;
      window.removeEventListener("keydown", onKey, true);

      let payload = null;
      if (commit) {
        // Recompute the shape synchronously so capture matches the final cursor, then
        // gather tokens BEFORE any persist — so capture works even if the player lacks
        // template-create permission.
        object._refreshShape();
        const tokens = templateTokens(object.shape, doc.x, doc.y);
        let created = null;
        try {
          const [c] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [doc.toObject()]);
          created = c ?? null;
        } catch (_e) { /* creation denied — targets are already captured */ }
        payload = { tokens, point: { x: doc.x, y: doc.y }, doc: created };
      }

      try { canvas.templates.preview.removeChild(object); object.destroy({ children: true }); } catch (_e) { /* already gone */ }
      initialLayer?.activate?.();
      resolve(payload);
    };

    const onDown = (event) => {
      if (event.button != null && event.button !== 0) return; // left only
      event.stopPropagation?.();
      finish(true);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    };

    if (view) view.oncontextmenu = (event) => { event.preventDefault(); finish(false); };
    stage.on("pointermove", onMove);
    stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);

    update(canvas.mousePosition ?? seed);
  });
}

/**
 * V14 interactive area placement. Measured Templates are gone, so the cursor preview is a
 * hand-rolled PIXI.Graphics on the controls layer and the capture is plain geometry
 * (templateTokens on the same local-space shape). Same contract as placeTemplate; `doc` is
 * always null — the committed shape flashes briefly instead of persisting.
 */
async function placeAreaPixi({
  t = "circle", distanceTiles = 1, origin = null, follow = "point",
  maxRangeTiles = null, widthTiles = 1, originHalfW = 0, originHalfH = 0, hint = ""
} = {}) {
  const layer = canvas?.controls;
  if (!layer) return null;
  const sizePx = canvas.dimensions?.size ?? 100;
  const radiusPx = distanceTiles * sizePx;
  const lengthPx = distanceTiles * sizePx;
  const widthPx = widthTiles * sizePx;
  const color = userColor();
  const seed = origin ?? canvas.mousePosition ?? { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };

  const state = { x: seed.x, y: seed.y, radians: 0 };
  const shapeNow = () => t === "ray"
    ? areaShape("ray", { lengthPx, widthPx, radians: state.radians })
    : areaShape("circle", { radiusPx });

  const g = new PIXI.Graphics();
  g.position.set(state.x, state.y);
  drawAreaShape(g, shapeNow(), color);
  layer.addChild(g);

  if (hint) ui.notifications.info(hint);

  // Snap like the old template layer did: grid centres + vertices.
  const M = CONST.GRID_SNAPPING_MODES;
  const snap = (p) => canvas.grid?.getSnappedPoint?.(p, { mode: M.CENTER | M.VERTEX }) ?? p;

  return new Promise((resolve) => {
    const stage = canvas.stage;
    const view = canvas.app?.view;
    const prevContext = view ? view.oncontextmenu : null;
    let done = false;
    let moveTime = 0;

    const update = (cursor) => {
      if (follow === "direction" && origin) {
        const dx = cursor.x - origin.x, dy = cursor.y - origin.y;
        state.radians = Math.atan2(dy, dx);
        // Start the ray at the caster's square edge facing the cursor, not its centre.
        const start = boxEdgePoint(origin, originHalfW, originHalfH, dx, dy);
        state.x = start.x; state.y = start.y;
      } else {
        let p = snap(cursor);
        if (origin && maxRangeTiles != null) {
          const maxPx = maxRangeTiles * sizePx;
          const dx = p.x - origin.x, dy = p.y - origin.y;
          const px = Math.hypot(dx, dy);
          if (px > maxPx && px > 0) p = { x: origin.x + (dx / px) * maxPx, y: origin.y + (dy / px) * maxPx };
        }
        state.x = p.x; state.y = p.y;
      }
      g.position.set(state.x, state.y);
      drawAreaShape(g, shapeNow(), color);
    };

    const onMove = (event) => {
      event.stopPropagation?.();
      const now = Date.now();
      if (now - moveTime <= 20) return;
      moveTime = now;
      update(event.getLocalPosition(stage));
    };

    const finish = (commit) => {
      if (done) return;
      done = true;
      stage.off("pointermove", onMove);
      stage.off("pointerdown", onDown);
      if (view) view.oncontextmenu = prevContext;
      window.removeEventListener("keydown", onKey, true);

      let payload = null;
      if (commit) {
        const shape = shapeNow();
        const tokens = templateTokens(shape, state.x, state.y);
        flashAreaShape(shape, state.x, state.y, color);
        payload = { tokens, point: { x: state.x, y: state.y }, doc: null };
      }
      try { g.destroy({ children: true }); } catch (_e) { /* already gone */ }
      resolve(payload);
    };

    const onDown = (event) => {
      if (event.button != null && event.button !== 0) return; // left only
      event.stopPropagation?.();
      finish(true);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    };

    if (view) view.oncontextmenu = (event) => { event.preventDefault(); finish(false); };
    stage.on("pointermove", onMove);
    stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);

    update(canvas.mousePosition ?? seed);
  });
}
