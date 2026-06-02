/**
 * Movement Range Overlay for Shards of Mana
 *
 * Draws a semi-transparent circle on the canvas showing remaining movement range
 * for the selected token during active combat. Movement is tracked but unenforced —
 * the GM adjudicates.
 */

/** @type {PIXI.Container|null} Persistent overlay container on the canvas */
let _overlayContainer = null;

/** @type {string|null} Token ID of the currently displayed overlay */
let _activeTokenId = null;

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Show a movement range circle around a token based on its remaining MOV.
 * Only displayed during active combat for combatants who can still move.
 * @param {Token} token - The token to show movement range for
 */
export function showMovementRange(token) {
  clearMovementRange();

  // Only show during active combat
  const combat = game.combat;
  if (!combat?.started) return;

  const actor = token.actor;
  if (!actor) return;

  // Don't show for actor types without MOV (merchant, party)
  const mov = actor.system?.mov;
  if (mov == null || mov <= 0) return;

  // Check for root or downed — no movement allowed
  const conditions = actor.system?.conditions;
  if (conditions?.root > 0 || conditions?.downed > 0) return;

  // Get the combatant to check distance already moved
  const combatant = combat.combatants.find(c => c.tokenId === token.id);
  if (!combatant) return;

  const distanceMoved = combatant.distanceMoved ?? 0;
  const remaining = Math.max(0, mov - distanceMoved);
  if (remaining <= 0) return;

  // Calculate pixel radius from grid units
  const gridSize = canvas.grid.size;
  const pixelRadius = remaining * gridSize;

  // Create overlay container
  _overlayContainer = new PIXI.Container();
  _overlayContainer.name = "shards-movement-overlay";

  // Draw the range circle
  const circle = new PIXI.Graphics();

  // Semi-transparent blue fill
  circle.beginFill(0x4080d4, 0.1);
  circle.drawCircle(0, 0, pixelRadius);
  circle.endFill();

  // Border ring
  circle.lineStyle(2, 0x4080d4, 0.5);
  circle.drawCircle(0, 0, pixelRadius);

  // Dashed inner ring at half range for visual reference
  const halfRadius = pixelRadius * 0.5;
  if (halfRadius > gridSize) {
    circle.lineStyle(1, 0x4080d4, 0.2);
    circle.drawCircle(0, 0, halfRadius);
  }

  _overlayContainer.addChild(circle);

  // Position at token center
  const { x, y, width, height } = token.document;
  _overlayContainer.position.set(
    x + (width * gridSize) / 2,
    y + (height * gridSize) / 2
  );

  // Add to canvas grid layer (renders below tokens)
  canvas.interface.addChild(_overlayContainer);
  _activeTokenId = token.id;
}

/**
 * Remove the current movement range overlay from the canvas.
 */
export function clearMovementRange() {
  if (_overlayContainer) {
    _overlayContainer.destroy({ children: true });
    _overlayContainer = null;
  }
  _activeTokenId = null;
}

/**
 * Refresh the overlay for the currently active token (e.g. after movement).
 * If no overlay is active, does nothing.
 */
export function refreshMovementOverlay() {
  if (!_activeTokenId) return;
  const token = canvas.tokens?.get(_activeTokenId);
  if (token) {
    showMovementRange(token);
  } else {
    clearMovementRange();
  }
}

/* -------------------------------------------- */
/*  Hook Handlers                                */
/* -------------------------------------------- */

/**
 * Hook handler for `controlToken`. Shows overlay when selecting a token
 * during combat, clears it on deselect.
 * @param {Token} token - The controlled/released token
 * @param {boolean} controlled - Whether the token is now controlled
 */
export function onControlToken(token, controlled) {
  if (controlled) {
    showMovementRange(token);
  } else {
    // Only clear if this was the token being tracked
    if (_activeTokenId === token.id) {
      clearMovementRange();
    }
  }
}

/**
 * Hook handler for `preUpdateToken`. Calculates distance moved BEFORE the
 * token position updates, so we have access to the old position on tokenDoc
 * and new position in changes.
 * @param {TokenDocument} tokenDoc - The token document (still has OLD position)
 * @param {object} changes - The new values being applied
 * @param {object} options - Update options
 * @param {string} userId - The ID of the user who triggered the update
 */
export async function onPreUpdateToken(tokenDoc, changes, options, userId) {
  // Track position and/or elevation changes during combat
  const hasPositionChange = ("x" in changes || "y" in changes);
  const hasElevationChange = ("elevation" in changes);
  if (!hasPositionChange && !hasElevationChange) return;

  const combat = game.combat;
  if (!combat?.started) return;

  // Only the GM tracks movement to avoid duplicate updates
  if (!game.user.isGM) return;

  const combatant = combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  // tokenDoc has OLD values, changes has NEW values
  const oldX = tokenDoc.x;
  const oldY = tokenDoc.y;
  const newX = changes.x ?? oldX;
  const newY = changes.y ?? oldY;

  const oldElev = tokenDoc.elevation ?? 0;
  const newElev = changes.elevation ?? oldElev;

  if (oldX === newX && oldY === newY && oldElev === newElev) return;

  // Measure 2D distance in scene units
  let distance2D = 0;
  if (oldX !== newX || oldY !== newY) {
    const ray = new Ray({ x: oldX, y: oldY }, { x: newX, y: newY });
    try {
      const result = canvas.grid.measurePath([{ ray }]);
      distance2D = result.distance ?? 0;
    } catch {
      // Fallback to simple Euclidean calculation in scene distance units
      const gridSize = canvas.grid.size;
      const gridDistance = canvas.scene?.grid?.distance ?? 1;
      const dx = Math.abs(newX - oldX) / gridSize * gridDistance;
      const dy = Math.abs(newY - oldY) / gridSize * gridDistance;
      distance2D = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // Calculate 3D distance including elevation change
  const elevDelta = Math.abs(newElev - oldElev);
  const gridDistance = canvas.scene?.grid?.distance ?? 1;
  const elevDistance = elevDelta * gridDistance;

  let totalDistance;
  if (distance2D > 0 && elevDistance > 0) {
    // Pythagorean 3D distance
    totalDistance = Math.sqrt(distance2D * distance2D + elevDistance * elevDistance);
  } else {
    totalDistance = distance2D + elevDistance;
  }

  if (totalDistance > 0) {
    // Convert from scene distance units to grid squares
    const gridSquares = totalDistance / gridDistance;
    await combatant.markMoved(gridSquares);
  }
}

/**
 * Hook handler for `updateToken`. Refreshes overlay after token position changes.
 * @param {TokenDocument} tokenDoc - The updated token document
 * @param {object} changes - The changed data
 */
export function onUpdateToken(tokenDoc, changes) {
  if (!("x" in changes || "y" in changes || "elevation" in changes)) return;

  // Refresh overlay if this is the tracked token
  if (_activeTokenId === tokenDoc.id) {
    // Small delay to let the token position update settle
    setTimeout(() => refreshMovementOverlay(), 50);
  }
}

/**
 * Hook handler for `deleteCombat`. Clears overlay when combat ends.
 */
export function onDeleteCombat() {
  clearMovementRange();
}
