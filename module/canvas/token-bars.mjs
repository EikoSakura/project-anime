/**
 * Log Horizon-style Token Bars
 *
 * Draws sleek PIXI HP/MP bar overlays to the LEFT of each token, replacing
 * the default Foundry resource bars. Positioned on the left so they never
 * overlap with the token nameplate below.
 *
 * Features:
 * - Disposition-based accent colors (teal/crimson/gold)
 * - HP color shifts teal → orange → red as health drops
 * - Forces ALL token names to always be visible
 * - Auto-locks prototype token disposition by actor type
 *
 * Controlled by the "shardsTokenBarsEnabled" world setting.
 */

/** @type {Map<string, PIXI.Container>} Token ID → bar container */
const _barContainers = new Map();

/* -------------------------------------------- */
/*  Colors                                      */
/* -------------------------------------------- */

/** HP fill color shifts with health percentage. */
function _hpColor(ratio) {
  if (ratio > 0.5) return 0x00d4a0;   // Teal
  if (ratio > 0.25) return 0xf0a030;  // Orange
  return 0xff3040;                     // Red
}

const MP_FILL = 0x4488ff;          // Blue
const TRACK_BG = 0x0a0e18;        // Dark track background
const CONTAINER_BG = 0x040810;     // Container background

/** Disposition → border/accent color */
const DISPOSITION_ACCENT = {
  friendly: 0x00d4a0,  // Teal
  hostile: 0xff3040,   // Crimson
  neutral: 0xffd040    // Gold
};

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Determine disposition key from token document.
 * @param {TokenDocument} tokenDoc
 * @returns {"friendly"|"hostile"|"neutral"}
 */
function _disposition(tokenDoc) {
  const d = tokenDoc.disposition;
  if (d === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "friendly";
  if (d === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "hostile";
  return "neutral";
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/**
 * Hook handler for `refreshToken`. Draws custom HP/MP bars to the left of
 * the token and forces nameplate visibility for all tokens.
 * @param {Token} token - The refreshed token
 */
export function onRefreshTokenBars(token) {
  // Clean up previous bars
  _clearBars(token.id);

  // Check setting
  try {
    if (!game.settings.get("shards-of-mana", "shardsTokenBarsEnabled")) {
      // Restore default bar visibility when disabled
      if (token.bars) token.bars.visible = token.document.displayBars !== CONST.TOKEN_DISPLAY_MODES.NONE;
      return;
    }
  } catch {
    return;
  }

  // Get actor data
  const actor = token.document?.actor ?? token.actor;
  if (!actor) return;

  const hp = actor.system?.health;
  if (!hp) return;
  const mp = actor.system?.mana;

  // Hide default Foundry bars
  if (token.bars) token.bars.visible = false;

  // Force name display for ALL tokens
  if (token.nameplate) {
    token.nameplate.visible = true;
  }

  // --- Dimensions ---
  const gridSize = canvas.grid.size;
  const tokenW = token.document.width * gridSize;
  const tokenH = token.document.height * gridSize;

  const barW = Math.max(Math.round(tokenW * 0.55), 30);
  const hpBarH = 6;
  const mpBarH = mp ? 4 : 0;
  const gap = mp ? 2 : 0;
  const pad = 3;
  const totalH = pad + hpBarH + gap + mpBarH + pad;

  const container = new PIXI.Container();
  container.name = "shards-token-bars";
  container.eventMode = "none";

  // Position to the LEFT of the token, vertically centered
  container.position.set(-(barW + 3), (tokenH - totalH) / 2);

  // Disposition accent color
  const accent = DISPOSITION_ACCENT[_disposition(token.document)] ?? 0x00d4a0;

  // Background panel — high opacity for readability
  const bg = new PIXI.Graphics();
  bg.beginFill(CONTAINER_BG, 0.95);
  bg.drawRoundedRect(0, 0, barW, totalH, 3);
  bg.endFill();
  bg.lineStyle(1, accent, 0.5);
  bg.drawRoundedRect(0, 0, barW, totalH, 3);
  container.addChild(bg);

  // --- HP Bar ---
  const innerW = barW - pad * 2;
  const hpY = pad;

  // Track
  const hpTrack = new PIXI.Graphics();
  hpTrack.beginFill(TRACK_BG, 1.0);
  hpTrack.drawRoundedRect(pad, hpY, innerW, hpBarH, 2);
  hpTrack.endFill();
  container.addChild(hpTrack);

  // Fill
  const hpRatio = hp.max > 0 ? Math.clamp(hp.value / hp.max, 0, 1) : 0;
  if (hpRatio > 0) {
    const fillW = innerW * hpRatio;
    const hpFill = new PIXI.Graphics();
    hpFill.beginFill(_hpColor(hpRatio), 1.0);
    hpFill.drawRoundedRect(pad, hpY, fillW, hpBarH, 2);
    hpFill.endFill();
    container.addChild(hpFill);
  }

  // --- MP Bar ---
  if (mp) {
    const mpY = pad + hpBarH + gap;
    const mpRatio = mp.max > 0 ? Math.clamp(mp.value / mp.max, 0, 1) : 0;

    // Track
    const mpTrack = new PIXI.Graphics();
    mpTrack.beginFill(TRACK_BG, 1.0);
    mpTrack.drawRoundedRect(pad, mpY, innerW, mpBarH, 2);
    mpTrack.endFill();
    container.addChild(mpTrack);

    // Fill
    if (mpRatio > 0) {
      const fillW = innerW * mpRatio;
      const mpFill = new PIXI.Graphics();
      mpFill.beginFill(MP_FILL, 1.0);
      mpFill.drawRoundedRect(pad, mpY, fillW, mpBarH, 2);
      mpFill.endFill();
      container.addChild(mpFill);
    }
  }

  // Subtle glow line at top of container (scan-line nod)
  const glow = new PIXI.Graphics();
  glow.lineStyle(1, accent, 0.2);
  glow.moveTo(2, 1);
  glow.lineTo(barW - 2, 1);
  container.addChild(glow);

  token.addChild(container);
  _barContainers.set(token.id, container);
}

/**
 * Clear bar container for a specific token.
 * @param {string} tokenId
 */
function _clearBars(tokenId) {
  const container = _barContainers.get(tokenId);
  if (container) {
    container.destroy({ children: true });
    _barContainers.delete(tokenId);
  }
}

/**
 * Clear all bar containers (e.g. on scene change or setting toggle).
 */
export function clearAllTokenBars() {
  for (const [, container] of _barContainers) {
    container.destroy({ children: true });
  }
  _barContainers.clear();
}
