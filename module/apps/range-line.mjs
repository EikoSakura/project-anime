/**
 * Project: Anime — hover Range Line.
 *
 * While you have a token selected and hover another token, this draws a measured line
 * between them on the canvas with a tile-distance label at its midpoint — a quick
 * "how far is that?" read without picking up the ruler.
 *
 * It is a local, client-side overlay (only you see your own line) and OFF by default —
 * a GM turns it on via the "Range Line" world setting; each player can additionally hide
 * it for themselves from the Token scene-controls toggle (mirrors the Token Info panel).
 *
 * The tile count comes from `canvas.grid.measurePath`, so it honors the SCENE's grid
 * diagonal rule — set the scene to "Equidistant" for the rules' diagonal = 1 tile.
 *
 * Drawn on `canvas.controls` (the world-space overlay layer, above tokens), mirroring the
 * core Ruler's outline-then-core stroke so the line stays legible over any map.
 */

const { PreciseText } = foundry.canvas.containers;

export const RANGE_LINE_SETTING = "showRangeLine";
export const RANGE_LINE_CLIENT_SETTING = "rangeLineClientShow";

export class RangeLine {
  /** The token currently hovered (the line's far end). Null when nothing is hovered. */
  #hovered = null;

  /** Our overlay objects, lazily (re)built on the active ControlsLayer. */
  #container = null;
  #line = null;
  #bg = null;
  #label = null;

  /** Whether the GM has enabled the feature (world setting). */
  static get enabled() {
    return game.settings.get("project-anime", RANGE_LINE_SETTING);
  }

  /** Whether the line should draw for THIS user: the world feature is on AND the user hasn't
   *  hidden it via their per-user Token-controls toggle. */
  static get lineEnabled() {
    return this.enabled && game.settings.get("project-anime", RANGE_LINE_CLIENT_SETTING);
  }

  /** The token currently hovered (so the hover-out handler only hides for the right token). */
  get hovered() {
    return this.#hovered;
  }

  /** A token usable as a line endpoint: present, not destroyed, and still on the canvas. */
  #valid(token) {
    return !!token && !token.destroyed && !token.isPreview && !!canvas.tokens?.placeables?.includes(token);
  }

  /** (Re)build the PIXI overlay on the current ControlsLayer if it's missing or stale. That layer
   *  is world-space, so we draw directly with token-centre coordinates. @returns {boolean} ready */
  #ensure() {
    const layer = canvas?.ready ? canvas.controls : null;
    if (!layer) return false;
    if (this.#container && !this.#container.destroyed && this.#container.parent === layer) return true;
    const c = new PIXI.Container();
    c.eventMode = "none";
    const line = new PIXI.Graphics();
    const bg = new PIXI.Graphics();
    const label = new PreciseText("", PreciseText.getTextStyle({ stroke: 0x000000, strokeThickness: 4 }));
    label.anchor.set(0.5, 0.5);
    c.addChild(line, bg, label); // line (bottom) → pill background → label (top)
    layer.addChild(c);
    this.#container = c;
    this.#line = line;
    this.#bg = bg;
    this.#label = label;
    return true;
  }

  /** Show / update the line for the token being hovered (the controlled token is the near end). */
  show(token) {
    this.#hovered = token ?? null;
    this.refresh();
  }

  /** Hide the line AND forget the hovered token (true hover-out). */
  hide() {
    this.#hovered = null;
    this.#conceal();
  }

  /** Just hide the drawn overlay, keeping the hovered token — so the line reappears if the
   *  reason it can't draw clears (e.g. you hover first, then select your token). */
  #conceal() {
    if (this.#container && !this.#container.destroyed) this.#container.visible = false;
  }

  /** Recompute and redraw from the hovered token + the controlled (source) token. Conceals when
   *  the feature is off for this user, nothing is hovered/selected, or source === target. */
  refresh() {
    if (!RangeLine.lineEnabled) return this.hide();
    const target = this.#hovered;
    const source = canvas?.tokens?.controlled?.[0] ?? null;
    if (!this.#valid(target) || !this.#valid(source) || source === target) return this.#conceal();
    if (!target.visible && !game.user.isGM) return this.#conceal();
    if (!this.#ensure()) return;

    const a = source.center;
    const b = target.center;
    const per = canvas.dimensions.distance || 1;
    const tiles = canvas.grid.measurePath([a, b]).distance / per;

    this.#draw(a, b, tiles);
    this.#container.visible = true;
  }

  /** Draw the two-pass line (dark outline + user-colour core), endpoint dots, and a midpoint
   *  distance pill sized to a fraction of a tile so it reads at any zoom. */
  #draw(a, b, tiles) {
    const scale = canvas.dimensions.uiScale;
    const col = Number(game.user.color ?? 0xffffff) || 0xffffff;
    const core = 3 * scale;
    const halo = 2 * scale;

    const line = this.#line.clear();
    // Dark outline pass for contrast, then the coloured core.
    line.lineStyle({ width: core + halo * 2, color: 0x000000, alpha: 0.45, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    line.moveTo(a.x, a.y).lineTo(b.x, b.y);
    line.lineStyle({ width: core, color: col, alpha: 0.95, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    line.moveTo(a.x, a.y).lineTo(b.x, b.y);
    // Endpoint dots.
    line.lineStyle(0);
    line.beginFill(col, 0.95).drawCircle(a.x, a.y, 4 * scale).drawCircle(b.x, b.y, 4 * scale).endFill();

    // Midpoint distance pill.
    const label = this.#label;
    label.style.fontSize = Math.round(Math.clamp(canvas.dimensions.size * 0.34, 16, 64));
    label.style.strokeThickness = Math.max(2, Math.round(scale * 4));
    const n = Math.round(tiles * 10) / 10;
    const num = Number.isInteger(n) ? String(n) : n.toFixed(1);
    label.text = `${num} ${game.i18n.localize("PROJECTANIME.RangeLine.tiles")}`;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    label.position.set(mid.x, mid.y);

    const padX = 8 * scale;
    const padY = 4 * scale;
    const w = label.width + padX * 2;
    const h = label.height + padY * 2;
    this.#bg.clear()
      .lineStyle(scale, col, 0.85)
      .beginFill(0x11101a, 0.72)
      .drawRoundedRect(mid.x - w / 2, mid.y - h / 2, w, h, 5 * scale)
      .endFill();
  }
}
