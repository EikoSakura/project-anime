/**
 * AoE Template Placement System for Shards of Mana.
 * Places Foundry MeasuredTemplates on the canvas, auto-targets tokens
 * within the template area, and provides cleanup utilities.
 */

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Place a MeasuredTemplate for an AoE skill and auto-target tokens within.
 * The user clicks to set the template origin and (for line/cross) rotates
 * to choose direction.
 *
 * @param {Token} casterToken - The token of the actor casting the skill
 * @param {object} options
 * @param {string} options.shape - "burst", "line", or "cross"
 * @param {number} options.size - Distance in grid units
 * @param {string} [options.filter="all"] - "all", "enemies", "allies"
 * @returns {Promise<{targets: Token[], templateIds: string[]}|null>}
 *          null if cancelled
 */
export async function placeAoETemplate(casterToken, { shape, size, filter = "all" }) {
  if (!canvas.scene) return null;

  const templateType = CONFIG.SHARDS.areaShapeToTemplateType?.[shape] ?? "circle";
  const isCross = shape === "cross";
  const needsDirection = shape !== "burst";

  // Enter interactive placement mode
  const placement = await _awaitTemplatePlacement(templateType, size, needsDirection);
  if (!placement) return null;

  // Build template data
  const baseData = {
    t: shape === "burst" ? "circle" : "ray",
    x: placement.x,
    y: placement.y,
    distance: size,
    direction: placement.direction,
    fillColor: _filterColor(filter),
    fillAlpha: 0.3,
    flags: { "shards-of-mana": { aoeTemplate: true } }
  };

  // For rays, set width to 1 grid unit
  if (baseData.t === "ray") {
    baseData.width = canvas.dimensions.distance;
  }

  const docs = [baseData];

  // Cross: add a second perpendicular ray
  if (isCross) {
    docs.push({ ...baseData, direction: placement.direction + 90 });
  }

  const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", docs);
  const templateIds = created.map(d => d.id);

  // Wait a tick for the template objects to render on canvas
  await new Promise(r => setTimeout(r, 150));

  // Auto-target tokens within the template(s)
  const targets = _findTokensInTemplates(created, casterToken, filter);

  // Set targets on the current user
  const targetIds = new Set(targets.map(t => t.id));
  for (const token of canvas.tokens.placeables) {
    const shouldTarget = targetIds.has(token.id);
    token.setTarget(shouldTarget, { releaseOthers: false, groupSelection: false });
  }

  return { targets, templateIds };
}

/**
 * Remove AoE templates created by the system.
 * @param {string[]} templateIds - Array of MeasuredTemplate document IDs
 */
export async function cleanupAoETemplates(templateIds) {
  if (!templateIds?.length || !canvas.scene) return;
  const existing = templateIds.filter(id => canvas.scene.templates.get(id));
  if (existing.length) {
    await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", existing);
  }
}

/* -------------------------------------------- */
/*  Internal — Interactive Placement             */
/* -------------------------------------------- */

/**
 * Enter an interactive placement mode.
 * Phase 1: user moves mouse to position the template origin, clicks to confirm.
 * Phase 2 (if needsDirection): user moves mouse to set rotation, clicks to confirm.
 * Right-click or Escape cancels.
 *
 * @param {string} templateType - "circle" or "ray"
 * @param {number} distance - Template distance in grid units
 * @param {boolean} needsDirection - Whether rotation matters (line/cross)
 * @returns {Promise<{x: number, y: number, direction: number}|null>}
 */
function _awaitTemplatePlacement(templateType, distance, needsDirection) {
  return new Promise(resolve => {
    // Create a preview template
    const previewDoc = new MeasuredTemplateDocument({
      t: templateType,
      distance,
      width: templateType === "ray" ? canvas.dimensions.distance : undefined,
      fillColor: "#8b6fe0",
      fillAlpha: 0.2
    }, { parent: canvas.scene });

    const previewObject = new CONFIG.MeasuredTemplate.objectClass(previewDoc);
    canvas.templates.preview.addChild(previewObject);
    previewObject.draw();

    let phase = "position";
    let originX = 0;
    let originY = 0;

    const onMouseMove = (event) => {
      const pos = event.data?.getLocalPosition(canvas.app.stage)
        ?? canvas.mousePosition
        ?? { x: 0, y: 0 };
      const snapped = canvas.grid.getSnappedPoint(
        { x: pos.x, y: pos.y },
        { mode: CONST.GRID_SNAPPING_MODES.CENTER }
      );

      if (phase === "position") {
        previewDoc.updateSource({ x: snapped.x, y: snapped.y });
        originX = snapped.x;
        originY = snapped.y;
        previewObject.refresh();
      } else if (phase === "direction") {
        const dx = pos.x - originX;
        const dy = pos.y - originY;
        const direction = Math.toDegrees(Math.atan2(dy, dx));
        previewDoc.updateSource({ direction });
        previewObject.refresh();
      }
    };

    const onLeftClick = (event) => {
      // Prevent the click from falling through to other canvas layers
      event.stopPropagation?.();

      if (phase === "position") {
        if (needsDirection) {
          phase = "direction";
          return;
        }
        // Burst: no direction needed
        cleanup();
        resolve({ x: originX, y: originY, direction: 0 });
      } else if (phase === "direction") {
        cleanup();
        resolve({ x: originX, y: originY, direction: previewDoc.direction });
      }
    };

    const onRightClick = (event) => {
      event.stopPropagation?.();
      cleanup();
      resolve(null);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        cleanup();
        resolve(null);
      }
    };

    function cleanup() {
      canvas.stage.off("pointermove", onMouseMove);
      canvas.stage.off("pointerdown", onLeftClick);
      canvas.stage.off("rightdown", onRightClick);
      document.removeEventListener("keydown", onKeyDown);
      canvas.templates.preview.removeChild(previewObject);
      previewObject.destroy();
    }

    canvas.stage.on("pointermove", onMouseMove);
    canvas.stage.on("pointerdown", onLeftClick);
    canvas.stage.on("rightdown", onRightClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

/* -------------------------------------------- */
/*  Internal — Token Detection                   */
/* -------------------------------------------- */

/**
 * Find all tokens within the given template documents.
 * @param {MeasuredTemplateDocument[]} templateDocs
 * @param {Token} casterToken - For disposition filtering
 * @param {string} filter - "all", "enemies", "allies"
 * @returns {Token[]}
 */
function _findTokensInTemplates(templateDocs, casterToken, filter) {
  const casterDisposition = casterToken?.document?.disposition
    ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
  const found = new Set();

  for (const doc of templateDocs) {
    const templateObject = doc.object;
    if (!templateObject) continue;

    const shape = templateObject.shape;
    if (!shape) continue;

    for (const token of canvas.tokens.placeables) {
      // Check if the token center is within the template shape
      const tokenCenter = token.center;
      const local = {
        x: tokenCenter.x - doc.x,
        y: tokenCenter.y - doc.y
      };
      if (!shape.contains(local.x, local.y)) continue;

      // Disposition filter
      const tokenDisposition = token.document.disposition;
      if (filter === "enemies" && tokenDisposition === casterDisposition) continue;
      if (filter === "allies" && tokenDisposition !== casterDisposition) continue;

      found.add(token);
    }
  }

  return Array.from(found);
}

/* -------------------------------------------- */
/*  Internal — Utility                           */
/* -------------------------------------------- */

/**
 * Get a fill color based on the disposition filter.
 * @param {string} filter
 * @returns {string}
 */
function _filterColor(filter) {
  switch (filter) {
    case "enemies": return "#d44040";
    case "allies": return "#40b060";
    default: return "#8b6fe0";
  }
}
