/**
 * Right-click context menu for Shards chat cards.
 * Provides reroll options (full reroll, condition-only reroll).
 * Only the original roller or the GM can trigger rerolls.
 */

import { rollStatTest, rollAttack, rollHealing, rollContest, rollWeaponAttack, activateChatListeners } from "./rolls.mjs";

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Show a context menu for a Shards chat card.
 * @param {MouseEvent} event - The contextmenu event
 * @param {ChatMessage} message - The chat message document
 */
export function showChatContextMenu(event, message) {
  event.preventDefault();
  event.stopPropagation();

  const flags = message.flags?.["shards-of-mana"];
  if (!flags?.rollType) return;

  // Permission check: only original author or GM
  if (!message.isAuthor && !game.user.isGM) return;

  // Remove any existing context menu
  document.querySelector(".shards-context-menu")?.remove();

  const menu = document.createElement("div");
  menu.classList.add("shards-context-menu");

  // Build menu items based on roll type
  const items = [];

  // All roll types get a "Reroll" option
  items.push({
    icon: "fa-solid fa-dice",
    label: game.i18n.localize("SHARDS.Reroll.Full"),
    action: "reroll"
  });

  // Attack/weapon attack rolls with condition data get "Reroll Condition" option
  if ((flags.rollType === "attack" || flags.rollType === "weaponAttack") && flags.conditionData?.length) {
    items.push({
      icon: "fa-solid fa-bolt",
      label: game.i18n.localize("SHARDS.Reroll.Condition"),
      action: "reroll-condition"
    });
  }

  // Render menu items
  menu.innerHTML = items.map(item => `
    <div class="shards-ctx-item" data-ctx-action="${item.action}">
      <i class="${item.icon}"></i>
      <span>${item.label}</span>
    </div>
  `).join("");

  // Position at cursor
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  // Bind action handlers
  menu.querySelector("[data-ctx-action='reroll']")?.addEventListener("click", async () => {
    menu.remove();
    await _handleReroll(flags);
  });

  menu.querySelector("[data-ctx-action='reroll-condition']")?.addEventListener("click", async () => {
    menu.remove();
    await _handleConditionReroll(flags);
  });

  // Close handlers (same pattern as effect-context-menu.mjs)
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

  // Viewport clamping
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escClose);
  });
}

/* -------------------------------------------- */
/*  Reroll Handlers                              */
/* -------------------------------------------- */

/**
 * Handle a full reroll by re-calling the original roll function.
 * Passes { isReroll: true } to skip resource deduction.
 * @param {object} flags - The stored roll metadata
 */
async function _handleReroll(flags) {
  switch (flags.rollType) {
    case "statTest": {
      const actor = game.actors.get(flags.actorId);
      if (!actor) return _warnMissing("Actor");
      await rollStatTest(actor, flags.statKey, {
        modifier: flags.modifier ?? 0,
        isReroll: true
      });
      break;
    }

    case "attack": {
      const actor = game.actors.get(flags.actorId);
      if (!actor) return _warnMissing("Actor");
      const skill = actor.items.get(flags.skillId);
      if (!skill) return _warnMissing("Skill");
      const targets = _resolveTargets(flags.targetIds);
      await rollAttack(actor, skill, targets, { isReroll: true });
      break;
    }

    case "healing": {
      const actor = game.actors.get(flags.actorId);
      if (!actor) return _warnMissing("Actor");
      const skill = actor.items.get(flags.skillId);
      if (!skill) return _warnMissing("Skill");
      const targets = _resolveTargets(flags.targetIds);
      await rollHealing(actor, skill, targets, { isReroll: true });
      break;
    }

    case "contest": {
      const actorA = game.actors.get(flags.actorIdA);
      const actorB = game.actors.get(flags.actorIdB);
      if (!actorA || !actorB) return _warnMissing("Actor");
      await rollContest(actorA, flags.statKeyA, actorB, flags.statKeyB);
      break;
    }

    case "weaponAttack": {
      const actor = game.actors.get(flags.actorId);
      if (!actor) return _warnMissing("Actor");
      const weapon = actor.items.get(flags.weaponId);
      if (!weapon) return _warnMissing("Weapon");
      const targets = _resolveTargets(flags.targetIds);
      await rollWeaponAttack(actor, weapon, targets, { isReroll: true });
      break;
    }
  }
}

/**
 * Handle condition-only reroll: re-roll d100 vs conditionChance, post small card.
 * @param {object} flags - The stored roll metadata
 */
async function _handleConditionReroll(flags) {
  if (!flags.conditionData?.length) return;

  const results = [];
  for (const cd of flags.conditionData) {
    const targetActor = game.actors.get(cd.targetId);
    const condResist = targetActor?.system?.conditionResistances?.[cd.conditionKey] ?? 0;
    const effectiveChance = Math.clamp(cd.conditionChance - condResist, 0, 100);

    const roll = new Roll("1d100");
    await roll.evaluate();
    const inflicted = effectiveChance > 0 && roll.total <= effectiveChance;
    const condLabel = game.i18n.localize(
      CONFIG.SHARDS.conditions[cd.conditionKey] ?? cd.conditionKey
    );
    results.push({
      targetId: cd.targetId,
      targetName: targetActor?.name ?? "Unknown",
      conditionKey: cd.conditionKey,
      conditionLabel: condLabel,
      conditionChance: cd.conditionChance,
      conditionResist: condResist,
      effectiveChance,
      condRoll: roll.total,
      inflicted
    });
  }

  // Render the condition reroll chat card
  const content = await renderTemplate(
    "systems/shards-of-mana/templates/chat/condition-reroll.hbs",
    { results }
  );

  const actor = game.actors.get(flags.actorId);
  const msg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    sound: CONFIG.sounds.dice
  });

  // Activate chat listeners on the new message element so Apply buttons work
  const msgEl = document.querySelector(`[data-message-id="${msg.id}"]`);
  if (msgEl) activateChatListeners(msgEl);
}

/* -------------------------------------------- */
/*  Utility Helpers                              */
/* -------------------------------------------- */

/**
 * Resolve target actor IDs to tokens on canvas.
 * @param {string[]} targetIds - Actor IDs
 * @returns {Token[]}
 */
function _resolveTargets(targetIds) {
  if (!targetIds?.length || !canvas?.tokens?.placeables) return [];
  return canvas.tokens.placeables.filter(t =>
    t.actor && targetIds.includes(t.actor.id)
  );
}

/**
 * Show a warning notification for missing data.
 * @param {string} what - What was missing
 */
function _warnMissing(what) {
  ui.notifications.warn(game.i18n.format("SHARDS.Reroll.NotFound", { what }));
}
