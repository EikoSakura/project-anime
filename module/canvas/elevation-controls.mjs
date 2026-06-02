/**
 * Elevation Controls — Keybinding Handlers
 *
 * Provides quick keyboard shortcuts for adjusting token elevation:
 * - PageUp: raise elevation by step
 * - PageDown: lower elevation by step
 * - Home: reset elevation to 0 (land)
 *
 * Works on all currently controlled tokens. Step size is configurable
 * via the "elevationStep" game setting.
 */

/**
 * Register elevation keybindings with Foundry's keybinding system.
 * Must be called during the `init` hook.
 */
export function registerElevationKeybindings() {
  game.keybindings.register("shards-of-mana", "elevationUp", {
    name: "SHARDS.Keybindings.ElevationUp",
    hint: "SHARDS.Keybindings.ElevationUpHint",
    editable: [{ key: "PageUp" }],
    onDown: () => {
      _adjustElevation(1);
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register("shards-of-mana", "elevationDown", {
    name: "SHARDS.Keybindings.ElevationDown",
    hint: "SHARDS.Keybindings.ElevationDownHint",
    editable: [{ key: "PageDown" }],
    onDown: () => {
      _adjustElevation(-1);
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register("shards-of-mana", "elevationReset", {
    name: "SHARDS.Keybindings.ElevationReset",
    hint: "SHARDS.Keybindings.ElevationResetHint",
    editable: [{ key: "Home" }],
    onDown: () => {
      _resetElevation();
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

/* -------------------------------------------- */
/*  Internal Handlers                           */
/* -------------------------------------------- */

/**
 * Adjust elevation of all controlled tokens by a signed multiplier.
 * @param {number} direction - +1 for up, -1 for down
 */
function _adjustElevation(direction) {
  const controlled = canvas.tokens?.controlled;
  if (!controlled?.length) return;

  let step;
  try {
    step = game.settings.get("shards-of-mana", "elevationStep") ?? 1;
  } catch {
    step = 1;
  }

  const delta = direction * step;
  const updates = [];

  for (const token of controlled) {
    const current = token.document.elevation ?? 0;
    const newElev = current + delta;
    // Clamp to reasonable range
    const clamped = Math.max(-99, Math.min(99, newElev));
    if (clamped !== current) {
      updates.push({ _id: token.id, elevation: clamped });
    }
  }

  if (updates.length) {
    canvas.scene.updateEmbeddedDocuments("Token", updates);
    // Brief notification
    const label = delta > 0
      ? game.i18n.localize("SHARDS.Elevation.Raised")
      : game.i18n.localize("SHARDS.Elevation.Lowered");
    const absStep = Math.abs(delta);
    ui.notifications.info(`${label} ${absStep}`);
  }
}

/**
 * Reset elevation of all controlled tokens to 0.
 */
function _resetElevation() {
  const controlled = canvas.tokens?.controlled;
  if (!controlled?.length) return;

  const updates = [];
  for (const token of controlled) {
    if ((token.document.elevation ?? 0) !== 0) {
      updates.push({ _id: token.id, elevation: 0 });
    }
  }

  if (updates.length) {
    canvas.scene.updateEmbeddedDocuments("Token", updates);
    ui.notifications.info(game.i18n.localize("SHARDS.Elevation.Landed"));
  }
}
