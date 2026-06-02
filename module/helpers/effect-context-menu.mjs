/**
 * Shared right-click context menu for Active Effects.
 * Used by actor sheets and item sheets.
 */

/**
 * Show an MMO-style right-click context menu for an Active Effect.
 * @param {MouseEvent} event - The contextmenu event
 * @param {ActiveEffect} effect - The effect document
 * @param {HTMLElement} appElement - The application root element
 */
export function showEffectContextMenu(event, effect, appElement) {
  event.preventDefault();
  event.stopPropagation();

  // Remove any existing context menu
  document.querySelector(".effect-context-menu")?.remove();

  const isDisabled = effect.disabled;
  const toggleLabel = isDisabled
    ? game.i18n.localize("SHARDS.EffectCreator.CtxEnable")
    : game.i18n.localize("SHARDS.EffectCreator.CtxDisable");
  const toggleIcon = isDisabled ? "fa-eye" : "fa-eye-slash";

  // Current manual override
  const currentType = effect.flags?.["shards-of-mana"]?.effectType ?? "auto";

  const menu = document.createElement("div");
  menu.classList.add("effect-context-menu");

  menu.innerHTML = `
    <div class="effect-ctx-item" data-ctx-action="toggle">
      <i class="fa-solid ${toggleIcon}"></i>
      <span>${toggleLabel}</span>
    </div>
    <div class="effect-ctx-item" data-ctx-action="edit">
      <i class="fa-solid fa-pen-to-square"></i>
      <span>${game.i18n.localize("SHARDS.EffectCreator.CtxEdit")}</span>
    </div>
    <hr class="effect-ctx-divider" />
    <div class="effect-ctx-item ${currentType === "buff" ? "effect-ctx-item--active" : ""}" data-ctx-action="mark-buff">
      <i class="fa-solid fa-arrow-up"></i>
      <span>${game.i18n.localize("SHARDS.Effects.MarkBuff")}</span>
    </div>
    <div class="effect-ctx-item ${currentType === "debuff" ? "effect-ctx-item--active" : ""}" data-ctx-action="mark-debuff">
      <i class="fa-solid fa-arrow-down"></i>
      <span>${game.i18n.localize("SHARDS.Effects.MarkDebuff")}</span>
    </div>
    <div class="effect-ctx-item ${currentType === "auto" ? "effect-ctx-item--active" : ""}" data-ctx-action="mark-auto">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
      <span>${game.i18n.localize("SHARDS.Effects.MarkAuto")}</span>
    </div>
    <hr class="effect-ctx-divider" />
    <div class="effect-ctx-item effect-ctx-item--danger" data-ctx-action="delete">
      <i class="fa-solid fa-trash"></i>
      <span>${game.i18n.localize("SHARDS.EffectCreator.CtxDelete")}</span>
    </div>
  `;

  // Position the menu at cursor
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  // Action handlers
  menu.querySelector("[data-ctx-action='toggle']").addEventListener("click", async () => {
    menu.remove();
    await effect.update({ disabled: !effect.disabled });
  });
  menu.querySelector("[data-ctx-action='edit']").addEventListener("click", () => {
    menu.remove();
    effect.sheet.render(true);
  });
  menu.querySelector("[data-ctx-action='mark-buff']").addEventListener("click", async () => {
    menu.remove();
    await effect.update({ "flags.shards-of-mana.effectType": "buff" });
  });
  menu.querySelector("[data-ctx-action='mark-debuff']").addEventListener("click", async () => {
    menu.remove();
    await effect.update({ "flags.shards-of-mana.effectType": "debuff" });
  });
  menu.querySelector("[data-ctx-action='mark-auto']").addEventListener("click", async () => {
    menu.remove();
    await effect.update({ "flags.shards-of-mana.-=effectType": null });
  });
  menu.querySelector("[data-ctx-action='delete']").addEventListener("click", async () => {
    menu.remove();
    await effect.delete();
  });

  // Close menu on click outside or Escape
  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escClose);
    }
  };
  const escClose = (e) => {
    if (e.key === "Escape") {
      menu.remove();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escClose);
    }
  };

  document.body.appendChild(menu);

  // Clamp position to viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  // Defer so the current event doesn't immediately close it
  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escClose);
  });
}

/**
 * Show a rich MMO-style tooltip panel for an Active Effect.
 * @param {MouseEvent} event - The mouseenter event
 * @param {object} effectData - The prepared effect display data
 * @param {HTMLElement} appElement - The application root element
 * @returns {HTMLElement} The tooltip element (for removal on mouseleave)
 */
export function showEffectTooltip(event, effectData, appElement) {
  // Remove any existing tooltip
  document.querySelector(".effect-tooltip-panel")?.remove();

  const tooltip = document.createElement("div");
  tooltip.classList.add("effect-tooltip-panel");

  // Build changes list — split on newlines or commas
  let changesHtml = "";
  if (effectData.tooltip) {
    const lines = effectData.tooltip.split(/[,\n]/).map(l => l.trim()).filter(Boolean);
    changesHtml = lines.map(l => `<div class="effect-tt-change">${l}</div>`).join("");
  }

  // Source info
  const sourceHtml = effectData.sourceName
    ? `<div class="effect-tt-source">${effectData.sourceName}</div>`
    : "";

  // Duration info
  let durationHtml = "";
  if (effectData.isTemporary && effectData.duration?.label) {
    durationHtml = `<div class="effect-tt-duration"><i class="fa-solid fa-clock"></i> ${effectData.duration.label}</div>`;
  } else if (!effectData.isTemporary) {
    durationHtml = `<div class="effect-tt-duration"><i class="fa-solid fa-infinity"></i> ${game.i18n.localize("SHARDS.EffectCreator.Permanent")}</div>`;
  }

  // Status badge
  const statusClass = effectData.disabled ? "effect-off" : effectData.effectType;
  const statusLabel = effectData.disabled
    ? game.i18n.localize("SHARDS.AE.Disabled")
    : effectData.effectType === "buff"
      ? game.i18n.localize("SHARDS.Effects.BuffLabel")
      : effectData.effectType === "debuff"
        ? game.i18n.localize("SHARDS.Effects.DebuffLabel")
        : "";

  tooltip.innerHTML = `
    <div class="effect-tt-header">
      <img class="effect-tt-icon" src="${effectData.img}" width="28" height="28" />
      <div class="effect-tt-title">
        <span class="effect-tt-name">${effectData.name}</span>
        ${statusLabel ? `<span class="effect-tt-status ${statusClass}">${statusLabel}</span>` : ""}
      </div>
    </div>
    ${sourceHtml}
    ${changesHtml ? `<div class="effect-tt-changes">${changesHtml}</div>` : ""}
    ${durationHtml}
  `;

  // Position above the hovered element
  const targetRect = event.currentTarget.getBoundingClientRect();
  tooltip.style.left = `${targetRect.left + targetRect.width / 2}px`;
  tooltip.style.top = `${targetRect.top - 4}px`;

  document.body.appendChild(tooltip);

  // Adjust if overflows viewport
  const ttRect = tooltip.getBoundingClientRect();
  if (ttRect.top < 4) {
    // Show below instead
    tooltip.style.top = `${targetRect.bottom + 4}px`;
    tooltip.classList.add("below");
  }
  if (ttRect.left < 4) {
    tooltip.style.left = `${4 + ttRect.width / 2}px`;
  }
  if (ttRect.right > window.innerWidth - 4) {
    tooltip.style.left = `${window.innerWidth - 4 - ttRect.width / 2}px`;
  }

  return tooltip;
}

/**
 * Remove the active tooltip panel.
 */
export function hideEffectTooltip() {
  document.querySelector(".effect-tooltip-panel")?.remove();
}
