/**
 * Targeting Line & Distance Display
 *
 * When a single token is selected and the mouse hovers over a different token,
 * draws a glowing line between the two and displays the 3D distance (accounting
 * for elevation). Makes range checks, spell targeting, and tactical positioning
 * instant and visual.
 *
 * Renders on `canvas.interface` (same layer as the movement range overlay).
 */

/* -------------------------------------------- */
/*  Module State                                */
/* -------------------------------------------- */

/** @type {PIXI.Container|null} The line + label overlay container */
let _container = null;

/** @type {string|null} The controlled (source) token ID */
let _sourceTokenId = null;

/** @type {string|null} The hovered (target) token ID */
let _targetTokenId = null;

/* -------------------------------------------- */
/*  Colors & Style Constants                    */
/* -------------------------------------------- */

const LINE_COLOR = 0x00d4a0;
const LINE_ALPHA = 0.6;
const LINE_WIDTH = 2;
const DASH_LENGTH = 12;
const GAP_LENGTH = 8;
const GLOW_COLOR = 0x00d4a0;
const GLOW_ALPHA = 0.15;
const GLOW_WIDTH = 8;

const LABEL_BG_COLOR = 0x040810;
const LABEL_BG_ALPHA = 0.88;
const LABEL_BORDER_COLOR = 0x00d4a0;
const LABEL_BORDER_ALPHA = 0.5;
const LABEL_TEXT_COLOR = 0xf0f4ff;
const ELEV_TEXT_COLOR = 0x60c0ff;

/* -------------------------------------------- */
/*  Public Hook Handlers                        */
/* -------------------------------------------- */

/**
 * Hook handler for `hoverToken`. Shows or clears the targeting line.
 * @param {Token} token - The token being hovered
 * @param {boolean} hovered - Whether the mouse entered or left
 */
export function onHoverTokenTargeting(token, hovered) {
  if (hovered) {
    // Need exactly one controlled token
    const controlled = canvas.tokens?.controlled;
    if (!controlled || controlled.length !== 1) return;

    const source = controlled[0];
    // Don't target self
    if (source.id === token.id) return;

    _sourceTokenId = source.id;
    _targetTokenId = token.id;
    _drawLine(source, token);
  } else {
    // Only clear if this was the target token
    if (_targetTokenId === token.id) {
      clearTargetingLine();
    }
  }
}

/**
 * Hook handler for `controlToken`. Clears on deselect or multi-select.
 * @param {Token} token
 * @param {boolean} controlled
 */
export function onControlTokenTargeting(token, controlled) {
  if (!controlled) {
    // Source token was deselected
    if (_sourceTokenId === token.id) {
      clearTargetingLine();
    }
  } else {
    // If multi-select, clear
    if (canvas.tokens?.controlled?.length > 1) {
      clearTargetingLine();
    }
  }
}

/**
 * Hook handler for `refreshToken`. Repositions line if source or target moves.
 * @param {Token} token
 */
export function onRefreshTokenTargeting(token) {
  if (!_container || !_sourceTokenId || !_targetTokenId) return;
  if (token.id !== _sourceTokenId && token.id !== _targetTokenId) return;

  // Redraw with updated positions
  const source = canvas.tokens?.get(_sourceTokenId);
  const target = canvas.tokens?.get(_targetTokenId);
  if (source && target) {
    _drawLine(source, target);
  } else {
    clearTargetingLine();
  }
}

/**
 * Hook handler for `updateToken`. Repositions on elevation changes.
 * @param {TokenDocument} tokenDoc
 * @param {object} changes
 */
export function onUpdateTokenTargeting(tokenDoc, changes) {
  if (!_container || !_sourceTokenId || !_targetTokenId) return;
  if (!("elevation" in changes)) return;
  if (tokenDoc.id !== _sourceTokenId && tokenDoc.id !== _targetTokenId) return;

  // Small delay for document to settle
  setTimeout(() => {
    const source = canvas.tokens?.get(_sourceTokenId);
    const target = canvas.tokens?.get(_targetTokenId);
    if (source && target) {
      _drawLine(source, target);
    } else {
      clearTargetingLine();
    }
  }, 50);
}

/**
 * Clear the targeting line overlay.
 */
export function clearTargetingLine() {
  if (_container) {
    _container.destroy({ children: true });
    _container = null;
  }
  _sourceTokenId = null;
  _targetTokenId = null;
}

/**
 * Get the current targeting line state for external consumers (e.g. Token HUD positioning).
 * Returns the source token ID if a targeting line is active, or null.
 * @returns {string|null} The source (controlled) token ID, or null if no line is active
 */
export function getTargetingSourceTokenId() {
  return _container ? _sourceTokenId : null;
}

/* -------------------------------------------- */
/*  Internal Drawing                            */
/* -------------------------------------------- */

/**
 * Draw the targeting line and distance label between two tokens.
 * @param {Token} source - The controlled token
 * @param {Token} target - The hovered token
 */
function _drawLine(source, target) {
  // Clean up previous drawing
  if (_container) {
    _container.destroy({ children: true });
    _container = null;
  }

  _container = new PIXI.Container();
  _container.name = "shards-targeting-line";
  _container.eventMode = "none";

  const gridSize = canvas.grid.size;

  // Calculate token centers in world coords
  const srcX = source.document.x + (source.document.width * gridSize) / 2;
  const srcY = source.document.y + (source.document.height * gridSize) / 2;
  const tgtX = target.document.x + (target.document.width * gridSize) / 2;
  const tgtY = target.document.y + (target.document.height * gridSize) / 2;

  // --- Draw glow line (wide, soft) ---
  const glow = new PIXI.Graphics();
  glow.lineStyle(GLOW_WIDTH, GLOW_COLOR, GLOW_ALPHA);
  glow.moveTo(srcX, srcY);
  glow.lineTo(tgtX, tgtY);
  _container.addChild(glow);

  // --- Draw dashed line ---
  const line = new PIXI.Graphics();
  _drawDashedLine(line, srcX, srcY, tgtX, tgtY, DASH_LENGTH, GAP_LENGTH);
  _container.addChild(line);

  // --- Calculate distance ---
  const { distance3D, distance2D, elevDelta, units } = _calculateDistance(source, target);

  // --- Distance label at midpoint ---
  const midX = (srcX + tgtX) / 2;
  const midY = (srcY + tgtY) / 2;

  // Format distance text
  const distText = `${Math.round(distance3D * 10) / 10} ${units}`;
  _container.addChild(_createLabel(distText, midX, midY, elevDelta));

  // Add to canvas interface layer
  canvas.interface.addChild(_container);
}

/**
 * Draw a dashed line between two points.
 * @param {PIXI.Graphics} graphics
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} dashLen - Length of each dash
 * @param {number} gapLen - Length of each gap
 */
function _drawDashedLine(graphics, x1, y1, x2, y2, dashLen, gapLen) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.sqrt(dx * dx + dy * dy);
  if (totalLen === 0) return;

  const ux = dx / totalLen;
  const uy = dy / totalLen;
  const segLen = dashLen + gapLen;
  let pos = 0;

  graphics.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA);

  while (pos < totalLen) {
    const dashEnd = Math.min(pos + dashLen, totalLen);
    graphics.moveTo(x1 + ux * pos, y1 + uy * pos);
    graphics.lineTo(x1 + ux * dashEnd, y1 + uy * dashEnd);
    pos += segLen;
  }
}

/**
 * Calculate the 3D distance between two tokens, accounting for elevation.
 * @param {Token} source
 * @param {Token} target
 * @returns {{ distance3D: number, distance2D: number, elevDelta: number, units: string }}
 */
function _calculateDistance(source, target) {
  const gridDistance = canvas.scene?.grid?.distance ?? 1;
  const units = canvas.scene?.grid?.units ?? "";

  // 2D distance using Foundry's grid measurement
  const srcX = source.document.x;
  const srcY = source.document.y;
  const tgtX = target.document.x;
  const tgtY = target.document.y;

  // Use token centers for the ray
  const gridSize = canvas.grid.size;
  const srcCX = srcX + (source.document.width * gridSize) / 2;
  const srcCY = srcY + (source.document.height * gridSize) / 2;
  const tgtCX = tgtX + (target.document.width * gridSize) / 2;
  const tgtCY = tgtY + (target.document.height * gridSize) / 2;

  let distance2D = 0;
  const ray = new Ray({ x: srcCX, y: srcCY }, { x: tgtCX, y: tgtCY });
  try {
    const result = canvas.grid.measurePath([{ ray }]);
    distance2D = result.distance ?? 0;
  } catch {
    // Fallback: Euclidean in scene distance units
    const dx = Math.abs(srcCX - tgtCX) / gridSize * gridDistance;
    const dy = Math.abs(srcCY - tgtCY) / gridSize * gridDistance;
    distance2D = Math.sqrt(dx * dx + dy * dy);
  }

  // Elevation
  const srcElev = source.document.elevation ?? 0;
  const tgtElev = target.document.elevation ?? 0;
  const elevDelta = Math.abs(srcElev - tgtElev);
  const elevDistance = elevDelta * gridDistance;

  // 3D Pythagorean
  let distance3D;
  if (distance2D > 0 && elevDistance > 0) {
    distance3D = Math.sqrt(distance2D * distance2D + elevDistance * elevDistance);
  } else {
    distance3D = distance2D + elevDistance;
  }

  return { distance3D, distance2D, elevDelta, units };
}

/**
 * Create the distance label with background pill.
 * @param {string} text - The distance text (e.g. "35 ft")
 * @param {number} x - World X position (midpoint)
 * @param {number} y - World Y position (midpoint)
 * @param {number} elevDelta - Elevation difference (0 = no callout)
 * @returns {PIXI.Container}
 */
function _createLabel(text, x, y, elevDelta) {
  const labelContainer = new PIXI.Container();
  labelContainer.eventMode = "none";

  // Distance text
  const distStyle = new PIXI.TextStyle({
    fontFamily: "Arial, sans-serif",
    fontSize: 14,
    fontWeight: "bold",
    fill: LABEL_TEXT_COLOR,
    align: "center"
  });
  const distText = new PIXI.Text(text, distStyle);
  distText.anchor.set(0.5, 0.5);

  // Measure for background
  const padding = 6;
  let totalHeight = distText.height;
  let elevText = null;

  // Elevation delta callout
  if (elevDelta > 0) {
    const elevStyle = new PIXI.TextStyle({
      fontFamily: "Arial, sans-serif",
      fontSize: 11,
      fontWeight: "bold",
      fill: ELEV_TEXT_COLOR,
      align: "center"
    });
    elevText = new PIXI.Text(`\u2195${elevDelta}`, elevStyle);
    elevText.anchor.set(0.5, 0.5);
    totalHeight += elevText.height + 2;
  }

  const pillW = Math.max(distText.width, elevText?.width ?? 0) + padding * 2 + 4;
  const pillH = totalHeight + padding * 2;

  // Background pill
  const bg = new PIXI.Graphics();
  bg.beginFill(LABEL_BG_COLOR, LABEL_BG_ALPHA);
  bg.drawRoundedRect(-pillW / 2, -pillH / 2, pillW, pillH, 6);
  bg.endFill();
  bg.lineStyle(1, LABEL_BORDER_COLOR, LABEL_BORDER_ALPHA);
  bg.drawRoundedRect(-pillW / 2, -pillH / 2, pillW, pillH, 6);
  labelContainer.addChild(bg);

  // Position text
  if (elevText) {
    distText.position.set(0, -elevText.height / 2 - 1);
    elevText.position.set(0, distText.height / 2 + 1);
    labelContainer.addChild(distText);
    labelContainer.addChild(elevText);
  } else {
    distText.position.set(0, 0);
    labelContainer.addChild(distText);
  }

  // Position the label at midpoint, offset slightly above the line
  labelContainer.position.set(x, y - pillH / 2 - 4);

  return labelContainer;
}
