import { ZONE_KEYWORDS, ZONE_TINTS } from "../config.mjs";
import { postZoneCard } from "../chat.mjs";
import ZoneBehaviorData from "../data/zone.mjs";

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TYPE = "project-anime.zone";

const INK = 0x221a36;
const PAPER = 0xf7f2e7;
const BENI = 0xd92b48;
const GOLD = 0xd9a13b;
const FILL_ALPHA = 0.13;
const FILL_HOVER = 0.27;

/* The Region's enabled Zone behavior, or null. */
export function zoneBehavior(region) {
  return region.behaviors.find(b => (b.type === TYPE) && !b.disabled) ?? null;
}

/* The Zone Regions this client presents: an enabled Zone behavior on the
   viewed level, hidden Regions for the Storyteller only. */
export function presentedZones() {
  if (!canvas.scene) return [];
  return canvas.scene.regions.filter(r =>
    zoneBehavior(r) && r.viewed && (!r.hidden || game.user.isGM) && r.polygons.length);
}

/* ============================================================
   Canvas presentation: tinted fill, dashed border, and a plate,
   drawn by the system for every client from the Region shapes,
   independent of the core region visibility setting. The container
   sits in the primary group above tiles and under tokens.
   ============================================================ */

let layer = null;
let dashShader = null;
let downPos = null;
const displays = new Map();

class ZoneDisplay extends PIXI.Container {
  constructor(region) {
    super();
    this.#region = region;
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.#fill = this.addChild(new PIXI.Graphics());
    this.#fill.alpha = FILL_ALPHA;
    this.#border = this.addChild(new PIXI.Graphics());
    this.#plate = this.addChild(new PIXI.Container());
  }

  #region;

  #fill;

  #border;

  #plate;

  #shadow = null;

  #plateSize = null;

  /* The plate's world-space rectangle, for hit tests. */
  plateRect = null;

  get region() {
    return this.#region;
  }

  get zone() {
    return zoneBehavior(this.#region);
  }

  /* Animated geometry while the Region rides an attached token. */
  get tree() {
    return this.#region.object?.animationState.polygonTree ?? this.#region.polygonTree;
  }

  draw() {
    this.#drawShape();
    this.#drawPlate();
    this.#place();
    this.alpha = this.#region.hidden ? 0.5 : 1;
  }

  refreshShape() {
    this.#drawShape();
    this.#place();
  }

  setHover(shape, plate) {
    this.#fill.alpha = shape ? FILL_HOVER : FILL_ALPHA;
    if (this.#shadow) {
      this.#shadow.tint = plate ? BENI : INK;
      this.#shadow.alpha = plate ? 0.55 : 0.45;
    }
  }

  #drawShape() {
    const s = canvas.dimensions.uiScale;
    const tint = this.zone?.system.tint ?? 0xffffff;
    const tree = this.tree;
    this.#fill.clear();
    this.#fill.beginFill(tint, 1);
    tree.drawShape(this.#fill);
    this.#fill.endFill();
    this.#border.clear();
    this.#border.lineStyle({
      width: 2.5 * s,
      color: tint,
      shader: dashShader,
      cap: PIXI.LINE_CAP.ROUND,
      join: PIXI.LINE_JOIN.ROUND
    });
    for (const node of tree) {
      if (node.polygon) this.#border.drawShape(node.polygon);
    }
  }

  /* The plate: ink ground, beni spine with a paper hairline, the
     display-face name, and one gold chip per effect keyword. */
  #drawPlate() {
    const s = canvas.dimensions.uiScale;
    const zone = this.zone;
    this.#plate.removeChildren().forEach(c => c.destroy({ children: true }));
    this.#shadow = null;
    this.#plateSize = null;
    this.plateRect = null;
    if (!zone?.system.showPlate) return;

    const PreciseText = foundry.canvas.containers.PreciseText;
    const name = new PreciseText((this.#region.name ?? "").toUpperCase(), new PIXI.TextStyle({
      fontFamily: ["Shippori Mincho B1", "serif"],
      fontSize: 18 * s,
      fontWeight: "700",
      fill: PAPER,
      letterSpacing: 1 * s
    }));
    const chipStyle = new PIXI.TextStyle({
      fontFamily: ["Zen Kaku Gothic New", "sans-serif"],
      fontSize: 10 * s,
      fontWeight: "700",
      fill: GOLD,
      letterSpacing: 1.5 * s
    });
    const keywords = [...new Set(zone.system.effects.map(e => e.keyword))];
    const chips = keywords.map(k =>
      new PreciseText(game.i18n.localize(`PROJECTANIME.Zone.${k}`).toUpperCase(), chipStyle));

    const chipsW = chips.reduce((sum, c) => sum + c.width + (20 * s), 0)
      + (Math.max(chips.length - 1, 0) * 8 * s);
    const w = (20 * s) + Math.max(name.width, chipsW) + (16 * s);
    const h = chips.length ? 56 * s : 38 * s;

    const shadow = this.#plate.addChild(new PIXI.Graphics());
    shadow.beginFill(0xffffff, 1).drawRoundedRect(3 * s, 3 * s, w, h, 3 * s).endFill();
    shadow.tint = INK;
    shadow.alpha = 0.45;
    this.#shadow = shadow;

    const bg = this.#plate.addChild(new PIXI.Graphics());
    bg.beginFill(INK, 1).drawRoundedRect(0, 0, w, h, 3 * s).endFill();
    bg.beginFill(BENI, 1).drawRect(0, 0, 6 * s, h).endFill();
    bg.beginFill(PAPER, 0.55).drawRect(7 * s, 0, 1.5 * s, h).endFill();

    name.position.set(20 * s, chips.length ? 6 * s : (h - name.height) / 2);
    this.#plate.addChild(name);

    const chipG = this.#plate.addChild(new PIXI.Graphics());
    chipG.lineStyle({ width: 1.2 * s, color: GOLD });
    let x = 20 * s;
    for (const chip of chips) {
      const cw = chip.width + (20 * s);
      chipG.drawRoundedRect(x, 33 * s, cw, 17 * s, 8.5 * s);
      chip.position.set(x + (10 * s), (33 * s) + (((17 * s) - chip.height) / 2));
      this.#plate.addChild(chip);
      x += cw + (8 * s);
    }

    this.#plateSize = { w, h };
  }

  #place() {
    if (!this.#plateSize) return;
    const s = canvas.dimensions.uiScale;
    const bounds = this.tree.bounds;
    const x = bounds.x + (16 * s);
    const y = bounds.y + (16 * s);
    this.#plate.position.set(x, y);
    this.plateRect = { x, y, w: this.#plateSize.w, h: this.#plateSize.h };
  }
}

function buildLayer() {
  const s = canvas.dimensions.uiScale;
  dashShader = new foundry.canvas.rendering.shaders.DashLineShader({ dash: 7 * s, gap: 5 * s });
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  layer.elevation = 0;
  layer.sortLayer = 550;
  layer.sort = 0;
  canvas.primary.addChild(layer);
  for (const region of presentedZones()) addDisplay(region);
  canvas.stage.on("pointerdown", onStagePointerDown);
  canvas.stage.on("pointerup", onStagePointerUp);
  canvas.stage.on("pointermove", onStagePointerMove);
}

function teardownLayer() {
  canvas.stage?.off("pointerdown", onStagePointerDown);
  canvas.stage?.off("pointerup", onStagePointerUp);
  canvas.stage?.off("pointermove", onStagePointerMove);
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = null;
  dashShader = null;
  downPos = null;
  displays.clear();
}

function addDisplay(region) {
  const display = layer.addChild(new ZoneDisplay(region));
  displays.set(region.id, display);
  display.draw();
}

function removeDisplay(id) {
  const display = displays.get(id);
  if (!display) return;
  displays.delete(id);
  if (!display.destroyed) display.destroy({ children: true });
}

function rebuildRegion(region) {
  if (!layer) return;
  removeDisplay(region.id);
  if (presentedZones().includes(region)) addDisplay(region);
}

/* ============================================================
   Clicks and hover. Zone graphics sit in the primary group, which
   takes no pointer events, so the stage listeners hit-test the
   shapes and plates themselves. A clean left click on open ground
   posts the Zone card; clicks claimed by a placeable never arrive
   here as open ground.
   ============================================================ */

function interactionAllowed() {
  if (canvas.tokens.active) return true;
  return canvas.regions.active && (ui.controls.tool?.name === "select");
}

function hitTest(point) {
  const list = [...displays.values()].reverse();
  for (const d of list) {
    const r = d.plateRect;
    if (r && (point.x >= r.x) && (point.x <= r.x + r.w) && (point.y >= r.y) && (point.y <= r.y + r.h)) {
      return d.region;
    }
  }
  for (const d of list) {
    if (d.tree.testPoint(point)) return d.region;
  }
  return null;
}

function clearHover() {
  for (const d of displays.values()) d.setHover(false, false);
}

function onStagePointerDown(event) {
  if (event.button !== 0) return;
  downPos = { x: event.global.x, y: event.global.y };
}

function onStagePointerUp(event) {
  const down = downPos;
  downPos = null;
  if (!down || (event.button !== 0) || !layer) return;
  if (Math.hypot(event.global.x - down.x, event.global.y - down.y) > 5) return;
  if (!interactionAllowed()) return;
  for (let t = event.target; t; t = t.parent) {
    if (t instanceof foundry.canvas.placeables.PlaceableObject) return;
  }
  const region = hitTest(event.getLocalPosition(canvas.stage));
  if (region) postZoneCard(region);
}

function onStagePointerMove(event) {
  if (!layer) return;
  if (!interactionAllowed()) return clearHover();
  const point = event.getLocalPosition(canvas.stage);
  let plateHit = null;
  let shapeHit = null;
  for (const d of [...displays.values()].reverse()) {
    const r = d.plateRect;
    if (!plateHit && r && (point.x >= r.x) && (point.x <= r.x + r.w)
      && (point.y >= r.y) && (point.y <= r.y + r.h)) plateHit = d;
    if (!shapeHit && d.tree.testPoint(point)) shapeHit = d;
  }
  for (const d of displays.values()) d.setHover(d === shapeHit, d === plateHit);
}

/* ============================================================
   Token drag ruler: beni past the first Zone border crossing and a
   beni diamond at each crossing. Display only.
   ============================================================ */

export class ZoneTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
  #overlay = new PIXI.Graphics();

  /* Beni piece of the segment holding the first crossing. */
  #pieces = [];

  #diamonds = [];

  async draw() {
    await super.draw();
    this.#overlay.visible = this.visible;
    this.token.layer._rulerPaths.addChild(this.#overlay);
  }

  clear() {
    super.clear();
    this.#overlay.clear();
  }

  destroy() {
    super.destroy();
    this.#overlay.destroy({ children: true });
  }

  _onVisibleChange() {
    super._onVisibleChange();
    this.#overlay.visible = this.visible;
  }

  refresh(rulerData) {
    this.#pieces = [];
    this.#diamonds = [];
    super.refresh(rulerData);
    this.#drawOverlay();
  }

  /* Crossings of the segment ending at this waypoint against every
     presented Zone border, and whether an earlier segment already
     crossed. Stashed on the waypoint; the waypoints are rebuilt every
     refresh and styled in path order. */
  #crossState(waypoint) {
    if (waypoint._paZones) return waypoint._paZones;
    const state = { crossings: [], before: false };
    waypoint._paZones = state;
    const prev = waypoint.previous;
    if (!prev) return state;
    /* A planned path renders only from the end of the passed history;
       the bridge between the two is not drawn. */
    if ((waypoint.stage === "planned") && (prev.stage === "passed")) return state;
    const prior = prev._paZones;
    state.before = !!prior && (prior.before || (prior.crossings.length > 0));
    const from = { x: prev.center.x, y: prev.center.y, elevation: prev.elevation };
    const to = { x: waypoint.center.x, y: waypoint.center.y, elevation: waypoint.elevation };
    if ((from.x === to.x) && (from.y === to.y) && (from.elevation === to.elevation)) return state;
    const S = CONST.REGION_MOVEMENT_SEGMENTS;
    for (const region of presentedZones()) {
      for (const segment of region.segmentizeMovementPath([from, to], [{ x: 0, y: 0 }])) {
        if (segment.type === S.ENTER) state.crossings.push({ x: segment.to.x, y: segment.to.y });
        else if (segment.type === S.EXIT) state.crossings.push({ x: segment.from.x, y: segment.from.y });
      }
    }
    state.crossings.sort((a, b) =>
      Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    return state;
  }

  _getWaypointStyle(waypoint) {
    const style = super._getWaypointStyle(waypoint);
    const state = this.#crossState(waypoint);
    if ((style.radius > 0) && (state.before || state.crossings.length)) style.color = BENI;
    return style;
  }

  _getSegmentStyle(waypoint) {
    const style = super._getSegmentStyle(waypoint);
    const state = this.#crossState(waypoint);
    if (style.width > 0) {
      if (state.before) style.color = BENI;
      else if (state.crossings.length) {
        this.#pieces.push({
          from: state.crossings[0],
          to: { x: waypoint.center.x, y: waypoint.center.y },
          width: style.width,
          alpha: style.alpha ?? 1
        });
      }
      if (state.crossings.length) this.#diamonds.push(...state.crossings);
    }
    return style;
  }

  #drawOverlay() {
    const g = this.#overlay;
    g.clear();
    if (!this.#pieces.length && !this.#diamonds.length) return;
    const s = canvas.dimensions.uiScale;
    for (const piece of this.#pieces) {
      g.lineStyle({
        width: piece.width,
        color: BENI,
        alpha: piece.alpha,
        cap: PIXI.LINE_CAP.ROUND,
        join: PIXI.LINE_JOIN.ROUND
      });
      g.moveTo(piece.from.x, piece.from.y);
      g.lineTo(piece.to.x, piece.to.y);
    }
    g.lineStyle({ width: 1.5 * s, color: PAPER });
    g.beginFill(BENI, 1);
    const r = 8 * s;
    for (const d of this.#diamonds) {
      g.drawPolygon(d.x + r, d.y, d.x, d.y + r, d.x - r, d.y, d.x, d.y - r);
    }
    g.endFill();
  }
}

/* ============================================================
   The Zone behavior sheet. Plain inputs save into the schema on
   change; add, remove, and tint clicks write the document directly.
   ============================================================ */

export class ZoneBehaviorSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "zone-config"],
    position: { width: 434, height: "auto" },
    window: { icon: "fa-solid fa-torii-gate" },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      addEffect: this.#onAddEffect,
      removeEffect: this.#onRemoveEffect,
      tint: this.#onTint
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/zone-config.hbs" }
  };

  get title() {
    return game.i18n.format("PROJECTANIME.Zone.Title", { name: this.document.region?.name ?? "" });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const tint = system.tint.css;
    context.name = this.document.region?.name ?? "";
    context.tint = tint;
    context.showPlate = system.showPlate;
    context.effects = system.effects.map((e, index) => ({
      index,
      name: e.name,
      text: e.text,
      keywords: ZONE_KEYWORDS.map(k => ({
        value: k,
        label: game.i18n.localize(`PROJECTANIME.Zone.${k}`),
        selected: k === e.keyword
      }))
    }));
    context.tints = ZONE_TINTS.map(color => ({ color, selected: color === tint }));
    return context;
  }

  /* Effect rows come off the form keyed by index; the schema holds an
     array. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const effects = data.system?.effects;
    if (effects && !Array.isArray(effects)) data.system.effects = Object.values(effects);
    return data;
  }

  static async #onAddEffect() {
    const effects = this.document.system.toObject().effects;
    effects.push({ keyword: ZONE_KEYWORDS[0], name: "", text: "" });
    await this.document.update({ "system.effects": effects });
  }

  static async #onRemoveEffect(event, target) {
    const effects = this.document.system.toObject().effects;
    effects.splice(Number(target.dataset.index), 1);
    await this.document.update({ "system.effects": effects });
  }

  static async #onTint(event, target) {
    await this.document.update({ "system.tint": target.dataset.color });
  }
}

/* ============================================================ */

export function registerZones() {
  CONFIG.RegionBehavior.dataModels[TYPE] = ZoneBehaviorData;
  CONFIG.RegionBehavior.typeIcons[TYPE] = "fa-solid fa-torii-gate";
  CONFIG.Token.rulerClass = ZoneTokenRuler;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.RegionBehavior, "project-anime", ZoneBehaviorSheet,
    { types: [TYPE], makeDefault: true, label: "PROJECTANIME.Sheet.Zone" }
  );

  /* The plate fonts, loaded for canvas text. */
  CONFIG.fontDefinitions["Shippori Mincho B1"] ??= {
    editor: false,
    fonts: [
      { urls: ["systems/project-anime/fonts/ShipporiMinchoB1-Bold.woff2"], weight: "700" },
      { urls: ["systems/project-anime/fonts/ShipporiMinchoB1-ExtraBold.woff2"], weight: "800" }
    ]
  };
  CONFIG.fontDefinitions["Zen Kaku Gothic New"] ??= {
    editor: false,
    fonts: [
      { urls: ["systems/project-anime/fonts/ZenKakuGothicNew-Bold.woff2"], weight: "700" }
    ]
  };

  Hooks.on("canvasReady", buildLayer);
  Hooks.on("canvasTearDown", teardownLayer);
  const behaviorChanged = behavior => {
    if ((behavior.type === TYPE) && (behavior.region?.parent === canvas.scene)) {
      rebuildRegion(behavior.region);
    }
  };
  Hooks.on("createRegionBehavior", behaviorChanged);
  Hooks.on("updateRegionBehavior", behaviorChanged);
  Hooks.on("deleteRegionBehavior", behaviorChanged);
  Hooks.on("updateRegion", region => {
    if ((region.parent === canvas.scene) && (displays.has(region.id) || zoneBehavior(region))) {
      rebuildRegion(region);
    }
  });
  Hooks.on("deleteRegion", region => removeDisplay(region.id));
  Hooks.on("refreshRegion", object => displays.get(object.document.id)?.refreshShape());
}
