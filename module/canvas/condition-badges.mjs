/**
 * Condition Magnitude Badges for Token HUD
 *
 * Draws small PIXI text badges on token effect icons showing the condition's
 * magnitude value. This makes DoT/HoT strength and stacking levels visible
 * at a glance during combat.
 */

/** @type {Map<string, PIXI.Container>} Token ID → badge container */
const _badgeContainers = new Map();

/**
 * Hook handler for `refreshToken`. Updates or creates condition magnitude
 * badges on the token's effect icons.
 * @param {Token} token - The refreshed token
 */
export function onRefreshToken(token) {
  // Clean up previous badges for this token
  _clearBadges(token.id);

  const actor = token.actor;
  if (!actor?.system?.conditions) return;

  // Only show during active combat for clarity
  if (!game.combat?.started) return;

  const conditions = actor.system.conditions;
  const activeConditions = {};
  for (const [key, value] of Object.entries(conditions)) {
    if (value > 0) activeConditions[key] = value;
  }
  if (!Object.keys(activeConditions).length) return;

  // Find the token's effect icons container
  const effects = token.effects;
  if (!effects?.children?.length) return;

  // Create a badge container as a child of the token
  const container = new PIXI.Container();
  container.name = "shards-condition-badges";
  container.eventMode = "none";
  token.addChild(container);
  _badgeContainers.set(token.id, container);

  // Match effect icons to conditions and add magnitude badges
  // Foundry V13 stores effect icons as PIXI.Sprite children in token.effects
  const statusEffects = CONFIG.statusEffects;
  let iconIndex = 0;

  for (const child of effects.children) {
    if (!(child instanceof PIXI.Sprite) || !child.texture?.baseTexture) continue;

    // Try to match this icon to a condition by source URL
    const iconSrc = child.texture?.baseTexture?.resource?.src ?? "";
    const matchedStatus = statusEffects.find(s => iconSrc.includes(s.img?.replace(/^\//, "")));

    if (matchedStatus && activeConditions[matchedStatus.id] != null) {
      const magnitude = activeConditions[matchedStatus.id];
      if (magnitude > 1) {
        // Add magnitude badge
        const badge = _createBadge(magnitude, child);
        container.addChild(badge);
      }
    }
    iconIndex++;
  }
}

/**
 * Create a PIXI text badge showing the condition magnitude.
 * Positioned at the bottom-right of the effect icon.
 * @param {number} magnitude - The condition magnitude value
 * @param {PIXI.Sprite} iconSprite - The effect icon sprite to position relative to
 * @returns {PIXI.Container}
 */
function _createBadge(magnitude, iconSprite) {
  const badgeContainer = new PIXI.Container();

  // Badge background (rounded rect)
  const bg = new PIXI.Graphics();
  const textStr = String(magnitude);
  const padding = 2;
  const width = textStr.length * 6 + padding * 2 + 2;
  const height = 12;

  bg.beginFill(0x000000, 0.75);
  bg.drawRoundedRect(0, 0, width, height, 3);
  bg.endFill();

  bg.lineStyle(1, 0xd4a843, 0.8);
  bg.drawRoundedRect(0, 0, width, height, 3);

  badgeContainer.addChild(bg);

  // Badge text
  const text = new PIXI.Text(textStr, {
    fontFamily: "Arial, sans-serif",
    fontSize: 10,
    fontWeight: "bold",
    fill: 0xffd866,
    align: "center"
  });
  text.anchor.set(0.5, 0.5);
  text.position.set(width / 2, height / 2);
  badgeContainer.addChild(text);

  // Position at bottom-right of the icon
  const iconBounds = iconSprite.getBounds();
  badgeContainer.position.set(
    iconSprite.x + iconSprite.width - width + 2,
    iconSprite.y + iconSprite.height - height + 2
  );

  return badgeContainer;
}

/**
 * Clear badges for a specific token.
 * @param {string} tokenId
 */
function _clearBadges(tokenId) {
  const container = _badgeContainers.get(tokenId);
  if (container) {
    container.destroy({ children: true });
    _badgeContainers.delete(tokenId);
  }
}

/**
 * Clear all badge containers (e.g. when combat ends).
 */
export function clearAllBadges() {
  for (const [id, container] of _badgeContainers) {
    container.destroy({ children: true });
  }
  _badgeContainers.clear();
}
