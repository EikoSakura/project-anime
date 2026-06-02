/**
 * Positioning utilities for Shards of Mana.
 * Provides token-proximity checks for features like Pack Tactics.
 */

/**
 * Count allied tokens within reach of a target token.
 * "Allied" = same disposition as the attacker (FRIENDLY, HOSTILE, or NEUTRAL).
 * "Within reach" = grid distance between ally center and target center <= ally's size.
 * Downed allies (HP <= 0) are excluded.
 *
 * @param {Token} targetToken - The target being attacked
 * @param {Token} attackerToken - The attacker (excluded from count)
 * @returns {number} Count of allies adjacent to the target
 */
export function countAlliesInReach(targetToken, attackerToken) {
  if (!canvas.scene || !canvas.tokens) return 0;

  const attackerDisposition = attackerToken.document.disposition;
  let count = 0;

  for (const token of canvas.tokens.placeables) {
    // Skip the attacker and the target themselves
    if (token.id === attackerToken.id || token.id === targetToken.id) continue;

    // Only count tokens with the same disposition (allies)
    if (token.document.disposition !== attackerDisposition) continue;

    // Skip downed allies (HP <= 0)
    const hp = token.actor?.system?.health?.value;
    if (hp !== undefined && hp <= 0) continue;

    // Check if ally is within their own reach of the target
    const allyReach = token.actor?.system?.size ?? 1;
    const distance = _measureGridDistance(token, targetToken);
    if (distance !== null && distance <= allyReach) count++;
  }

  return count;
}

/**
 * Measure grid distance between two tokens using Foundry's grid measurement.
 * Falls back to Euclidean distance if grid measurement fails.
 *
 * @param {Token} tokenA - First token
 * @param {Token} tokenB - Second token
 * @returns {number|null} Distance in grid units, or null if measurement fails
 * @private
 */
function _measureGridDistance(tokenA, tokenB) {
  if (!canvas.grid) return null;
  try {
    const ray = new Ray(tokenA.center, tokenB.center);
    const result = canvas.grid.measurePath([{ ray }]);
    return Math.round(result.distance);
  } catch {
    // Fallback to Euclidean in scene distance units
    try {
      const gridSize = canvas.grid.size;
      const gridDistance = canvas.scene?.grid?.distance ?? 1;
      const dx = Math.abs(tokenA.center.x - tokenB.center.x) / gridSize * gridDistance;
      const dy = Math.abs(tokenA.center.y - tokenB.center.y) / gridSize * gridDistance;
      return Math.round(Math.sqrt(dx * dx + dy * dy));
    } catch {
      return null;
    }
  }
}
