/**
 * Experiential Skill Learning — core logic for granting skills through
 * gameplay events and tracking condition exposure.
 */

/**
 * Grant an experiential skill to an adventurer.
 * @param {Actor} actor - The adventurer actor
 * @param {string|Item} skillRef - A skill name (creates blank) or Item (copies from)
 * @param {string} [originNote=""] - Narrative origin text
 * @returns {Promise<Item|null>} The created skill item, or null if cancelled
 */
export async function grantExperientialSkill(actor, skillRef, originNote = "") {
  if (!actor || actor.type !== "adventurer") {
    ui.notifications.warn(game.i18n.localize("SHARDS.Experience.NoActor"));
    return null;
  }

  // Resolve skill data from reference
  let itemData;
  if (typeof skillRef === "string") {
    // Free-text name — create a minimal skill item
    itemData = {
      name: skillRef,
      type: "skill",
      img: "icons/svg/lightning.svg",
      system: {
        source: "experience",
        skillLevel: 1,
        originNote
      }
    };
  } else if (skillRef instanceof Item || skillRef?.system) {
    // Copy from an existing Item
    itemData = skillRef.toObject();
    itemData.system.source = "experience";
    itemData.system.skillLevel = 1;
    itemData.system.originNote = originNote;
    delete itemData._id;
  } else {
    ui.notifications.warn(game.i18n.localize("SHARDS.Experience.NoSkill"));
    return null;
  }

  // Check for duplicate (stackable skills bypass this check)
  const skillName = itemData.name;
  const existing = actor.items.find(i => i.type === "skill" && i.name === skillName);
  if (existing && !itemData.system?.stackable) {
    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SHARDS.Experience.GrantTitle") },
      content: `<p>${game.i18n.format("SHARDS.Experience.AlreadyHasSkill", {
        actor: actor.name,
        skill: skillName
      })}</p>`,
      yes: { label: game.i18n.localize("SHARDS.Experience.Grant") },
      no: { label: game.i18n.localize("SHARDS.Cancel") }
    });
    if (!confirm) return null;
  }

  // Create the skill on the actor
  const created = await actor.createEmbeddedDocuments("Item", [itemData]);
  const newSkill = created[0];

  // Post the announcement chat card
  await postSkillAcquiredCard(actor, newSkill);

  ui.notifications.info(game.i18n.format("SHARDS.Experience.GrantedSkill", {
    skill: skillName,
    actor: actor.name
  }));

  return newSkill;
}

/**
 * Post a crystal-themed "Skill Acquired" announcement to chat.
 * @param {Actor} actor - The actor who gained the skill
 * @param {Item} skillItem - The newly created skill item
 */
export async function postSkillAcquiredCard(actor, skillItem) {
  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: actor.getFlag?.("shards-of-mana", "sheetTheme") ?? "silver",
    skillName: skillItem.name,
    skillImg: skillItem.img,
    skillLevel: skillItem.system.skillLevel,
    originNote: skillItem.system.originNote ?? "",
    systemVoice: game.i18n.format("SHARDS.Experience.SystemVoice", {
      skill: skillItem.name
    })
  };

  const content = await renderTemplate(
    "systems/shards-of-mana/templates/chat/skill-acquired.hbs",
    templateData
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

/**
 * Increment the exposure counter for a condition on an adventurer.
 * If the threshold is reached, notify the GM.
 * @param {Actor} actor - The adventurer actor
 * @param {string} conditionKey - The condition key (e.g., "poison")
 */
export async function trackConditionExposure(actor, conditionKey) {
  if (!game.user.isGM) return;
  if (!actor || actor.type !== "adventurer") return;

  const thresholdConfig = CONFIG.SHARDS.exposureThresholds?.[conditionKey];
  if (!thresholdConfig) return;

  // Clone the current log
  const log = foundry.utils.deepClone(actor.system.exposureLog ?? []);

  // Find or create entry for this condition
  let entry = log.find(e => e.condition === conditionKey);
  if (!entry) {
    entry = { condition: conditionKey, count: 0, lastTimestamp: 0 };
    log.push(entry);
  }

  entry.count += 1;
  entry.lastTimestamp = Date.now();

  await actor.update({ "system.exposureLog": log });

  // Notify on threshold reached (exact match to avoid repeat notifications)
  if (entry.count === thresholdConfig.threshold) {
    await _notifyExposureThreshold(actor, conditionKey, thresholdConfig, entry.count);
  }
}

/**
 * Notify the GM that an adventurer has reached a condition exposure threshold.
 * Posts a GM-whispered chat message with a "Grant Skill" button.
 * @param {Actor} actor
 * @param {string} conditionKey
 * @param {{threshold: number, suggestedSkill: string}} config
 * @param {number} count
 * @private
 */
async function _notifyExposureThreshold(actor, conditionKey, config, count) {
  const conditionLabel = game.i18n.localize(
    CONFIG.SHARDS.conditions[conditionKey] ?? conditionKey
  );

  const message = game.i18n.format("SHARDS.Experience.ExposureNotice", {
    actor: actor.name,
    condition: conditionLabel,
    count,
    threshold: config.threshold,
    skill: config.suggestedSkill
  });

  const originNote = `Developed through repeated exposure to ${conditionLabel}`;

  const buttonHtml = `
    <button type="button" class="shards-chat-btn shards-chat-btn--experience"
      data-action="open-skill-grant"
      data-actor-id="${actor.id}"
      data-skill-name="${foundry.utils.escapeHTML(config.suggestedSkill)}"
      data-origin-note="${foundry.utils.escapeHTML(originNote)}">
      <i class="fa-solid fa-hand-sparkles"></i>
      ${game.i18n.localize("SHARDS.Experience.GrantFromExposure")}
    </button>
  `;

  await ChatMessage.create({
    content: `<div class="shards-chat-card shards-exposure-notice">
      <div class="shards-exposure-notice__body">
        <p><i class="fa-solid fa-shield-virus"></i> ${message}</p>
        ${buttonHtml}
      </div>
    </div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}
