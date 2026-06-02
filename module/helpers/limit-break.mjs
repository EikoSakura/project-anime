/**
 * Limit Break gauge management for Shards of Mana.
 * Centralized functions for filling, consuming, and adjusting the gauge.
 */

/**
 * Increase an adventurer's limit break gauge by a specified amount.
 * Handles capping at max, notifications, and "ready" state.
 * @param {Actor} actor - The adventurer actor
 * @param {number} amount - Percentage to add (0-100)
 * @param {string} reason - Localization key for the fill reason
 */
export async function fillLimitBreak(actor, amount, reason) {
  if (actor.type !== "adventurer") return;
  if (amount <= 0) return;

  const lb = actor.system.limitBreak;
  if (lb.value >= lb.max) return; // Already full

  const oldValue = lb.value;
  const newValue = Math.min(oldValue + amount, lb.max);
  await actor.update({ "system.limitBreak.value": newValue });

  // Post fill notification to chat (whisper to GM + actor owner)
  const reasonLabel = game.i18n.localize(reason);
  const fillMsg = game.i18n.format("SHARDS.LimitBreak.Fill", {
    name: actor.name,
    amount,
    reason: reasonLabel
  });

  const whisperTargets = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);

  await ChatMessage.create({
    content: `<p class="shards-chat-confirm shards-lb-fill">${fillMsg} (${newValue}%)</p>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: whisperTargets
  });

  // If gauge just hit max, show dramatic notification + chat card
  if (newValue >= lb.max && oldValue < lb.max) {
    ui.notifications.info(game.i18n.format("SHARDS.LimitBreak.Ready", { name: actor.name }));

    const theme = actor.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
    const content = await renderTemplate(
      "systems/shards-of-mana/templates/chat/limit-break-ready.hbs",
      { actorName: actor.name, actorImg: actor.img, theme }
    );

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      sound: CONFIG.sounds.notification
    });
  }
}

/**
 * Consume an adventurer's limit break gauge (reset to 0).
 * Called when a limitBreak-timed skill is used.
 * @param {Actor} actor - The adventurer actor
 */
export async function consumeLimitBreak(actor) {
  if (actor.type !== "adventurer") return;
  await actor.update({ "system.limitBreak.value": 0 });

  await ChatMessage.create({
    content: `<p class="shards-chat-confirm shards-lb-consumed"><strong>${game.i18n.format("SHARDS.LimitBreak.Consumed", { name: actor.name })}</strong></p>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

/**
 * GM manual adjustment of limit break gauge.
 * @param {Actor} actor - The adventurer actor
 * @param {number} newValue - Direct value to set (0-100)
 */
export async function setLimitBreak(actor, newValue) {
  if (actor.type !== "adventurer") return;
  const clamped = Math.clamp(newValue, 0, actor.system.limitBreak.max);
  await actor.update({ "system.limitBreak.value": clamped });
}
