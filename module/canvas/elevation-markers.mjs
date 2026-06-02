/**
 * Elevation Markers for Token Canvas Display
 *
 * Draws PIXI badge overlays on tokens with non-zero elevation, making it
 * immediately visible which creatures are flying or underground. Follows
 * the same PIXI lifecycle pattern as condition-badges.mjs.
 *
 * - Positive elevation: sky-blue badge with ↑ arrow (flying)
 * - Negative elevation: earth-brown badge with ↓ arrow (underground)
 * - Badge positioned at top-left of token to avoid overlap with condition badges
 */

/** @type {Map<string, PIXI.Container>} Token ID → elevation badge container */
const _markerContainers = new Map();

/* -------------------------------------------- */
/*  Colors                                      */
/* -------------------------------------------- */

const FLYING_COLOR = 0x60c0ff;
const FLYING_BG = 0x103050;
const UNDERGROUND_COLOR = 0xc08040;
const UNDERGROUND_BG = 0x403020;

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/**
 * Hook handler for `refreshToken`. Creates or updates the elevation badge
 * for tokens with non-zero elevation.
 * @param {Token} token - The refreshed token
 */
export function onRefreshToken(token) {
  // Clean up previous badge
  _clearMarker(token.id);

  // Check if elevation markers are enabled
  try {
    if (!game.settings.get("shards-of-mana", "elevationMarkersEnabled")) return;
  } catch {
    // Setting not registered yet — default to enabled
  }

  const elevation = token.document?.elevation ?? 0;
  if (elevation === 0) return;

  const isFlying = elevation > 0;
  const absElev = Math.abs(elevation);
  const arrow = isFlying ? "\u2191" : "\u2193"; // ↑ or ↓
  const displayText = `${arrow}${absElev}`;

  // Create badge container
  const container = new PIXI.Container();
  container.name = "shards-elevation-marker";
  container.eventMode = "none";

  // Measure text to size the background
  const textStyle = new PIXI.TextStyle({
    fontFamily: "Arial, sans-serif",
    fontSize: 12,
    fontWeight: "bold",
    fill: isFlying ? FLYING_COLOR : UNDERGROUND_COLOR,
    align: "center"
  });
  const textMetrics = PIXI.TextMetrics.measureText(displayText, textStyle);
  const padding = 4;
  const pillW = textMetrics.width + padding * 2 + 2;
  const pillH = textMetrics.height + padding;

  // Badge background (rounded pill)
  const bg = new PIXI.Graphics();
  const bgColor = isFlying ? FLYING_BG : UNDERGROUND_BG;
  bg.beginFill(bgColor, 0.85);
  bg.drawRoundedRect(0, 0, pillW, pillH, 4);
  bg.endFill();

  // Border
  const borderColor = isFlying ? FLYING_COLOR : UNDERGROUND_COLOR;
  bg.lineStyle(1.5, borderColor, 0.7);
  bg.drawRoundedRect(0, 0, pillW, pillH, 4);

  container.addChild(bg);

  // Text
  const text = new PIXI.Text(displayText, textStyle);
  text.anchor.set(0.5, 0.5);
  text.position.set(pillW / 2, pillH / 2);
  container.addChild(text);

  // Position at top-left of token with small offset
  const offset = 2;
  container.position.set(offset, offset);

  token.addChild(container);
  _markerContainers.set(token.id, container);
}

/**
 * Clear the elevation marker for a specific token.
 * @param {string} tokenId
 */
function _clearMarker(tokenId) {
  const container = _markerContainers.get(tokenId);
  if (container) {
    container.destroy({ children: true });
    _markerContainers.delete(tokenId);
  }
}

/**
 * Clear all elevation markers (e.g. when settings change).
 */
export function clearAllElevationMarkers() {
  for (const [id, container] of _markerContainers) {
    container.destroy({ children: true });
  }
  _markerContainers.clear();
}
