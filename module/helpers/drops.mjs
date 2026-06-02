/**
 * Manacite Drop System — execution engine for monster loot drops.
 * Handles drop table rolling, loot chat cards, claiming, and distribution.
 */

/* -------------------------------------------- */
/*  Drop Table Rolling                           */
/* -------------------------------------------- */

/**
 * Roll a monster's drop table to determine loot.
 * @param {Actor} monster - The monster actor whose drops to roll
 * @returns {object} Drop results: { gold, drops, monsterName, monsterImg, monsterId }
 */
export async function rollDropTable(monster) {
  const sys = monster.system;
  const monsterRank = sys.rank ?? "F";

  // Roll gold within the min/max range
  let gold = 0;
  const goldMin = sys.goldMin ?? 0;
  const goldMax = sys.goldMax ?? 0;
  if (goldMax > 0) {
    if (goldMin >= goldMax) {
      gold = goldMax;
    } else {
      const roll = await new Roll(`${goldMin} + 1d${goldMax - goldMin}`).evaluate();
      gold = roll.total;
    }
  }

  // Roll each drop entry
  const drops = [];
  for (const entry of (sys.dropTable ?? [])) {
    if (!entry.manaciteName) continue;
    const dropRoll = await new Roll("1d100").evaluate();
    const chance = entry.dropChance ?? 0;
    const success = dropRoll.total <= chance;

    const effectiveRank = entry.manaciteRank || monsterRank;
    const skillLevel = CONFIG.SHARDS?.rankToSkillLevel?.[effectiveRank] ?? 1;

    drops.push({
      name: entry.manaciteName,
      rank: effectiveRank,
      skillLevel,
      quantity: entry.quantity ?? 1,
      rolled: dropRoll.total,
      needed: chance,
      success
    });
  }

  return {
    gold,
    drops,
    successfulDrops: drops.filter(d => d.success),
    monsterName: monster.name,
    monsterImg: monster.img ?? "icons/svg/mystery-man.svg",
    monsterId: monster.id
  };
}

/* -------------------------------------------- */
/*  Loot Chat Card                               */
/* -------------------------------------------- */

/**
 * Post a loot summary chat card showing all drops from a defeated monster.
 * @param {Actor} monster - The defeated monster actor
 * @param {object} results - Results from rollDropTable()
 * @param {object} [options]
 * @param {boolean} [options.testMode=false] - If true, whisper to GM only (no claim buttons)
 * @returns {ChatMessage} The created chat message
 */
export async function postLootCard(monster, results, { testMode = false } = {}) {
  const recipients = getEligibleRecipients();
  const partyActor = game.actors.find(a => a.type === "party");

  const templateData = {
    monsterName: results.monsterName,
    monsterImg: results.monsterImg,
    monsterId: results.monsterId,
    gold: results.gold,
    drops: results.drops,
    successfulDrops: results.successfulDrops,
    hasDrops: results.successfulDrops.length > 0 || results.gold > 0,
    recipients: recipients.map(a => ({ id: a.id, name: a.name, img: a.img })),
    partyId: partyActor?.id ?? "",
    partyName: partyActor?.name ?? "Party",
    testMode,
    isGM: game.user.isGM,
    theme: "obsidian",
    systemVoice: results.successfulDrops.length > 0
      ? game.i18n.format("SHARDS.Drops.SystemVoice", { monster: results.monsterName })
      : game.i18n.format("SHARDS.Drops.SystemVoiceNoDrops", { monster: results.monsterName })
  };

  const content = await renderTemplate(
    "systems/shards-of-mana/templates/chat/loot-drop.hbs",
    templateData
  );

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: monster }),
    content
  };

  // Test mode whispers to GM only
  if (testMode) {
    messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  }

  return ChatMessage.create(messageData);
}

/* -------------------------------------------- */
/*  Claim Functions                              */
/* -------------------------------------------- */

/**
 * Claim a manacite drop for a specific actor, creating the item on them.
 * @param {string} actorId - Target actor ID
 * @param {object} dropData - Drop data { name, rank, skillLevel, quantity }
 * @param {string} monsterName - Source monster name
 */
async function claimDrop(actorId, dropData, monsterName) {
  const actor = game.actors.get(actorId);
  if (!actor) return ui.notifications.warn("Target actor not found.");

  const quantity = dropData.quantity ?? 1;
  const items = [];

  for (let i = 0; i < quantity; i++) {
    items.push({
      name: dropData.name,
      type: "manacite",
      img: "icons/svg/gem.svg",
      system: {
        rank: dropData.rank,
        manaciteType: "monster",
        source: monsterName,
        skillGranted: dropData.skillGranted ?? "",
        goldValue: _rankToGoldValue(dropData.rank)
      }
    });
  }

  await actor.createEmbeddedDocuments("Item", items);

  ui.notifications.info(
    game.i18n.format("SHARDS.Drops.Claimed", { name: actor.name })
  );
}

/**
 * Claim gold for a specific actor or party.
 * @param {string} actorId - Target actor ID
 * @param {number} amount - Gold amount
 */
async function claimGold(actorId, amount) {
  const actor = game.actors.get(actorId);
  if (!actor) return ui.notifications.warn("Target actor not found.");

  const currentGold = actor.system.gold ?? 0;
  await actor.update({ "system.gold": currentGold + amount });

  ui.notifications.info(
    game.i18n.format("SHARDS.Drops.GoldObtained", { gold: amount }) +
    ` → ${actor.name}`
  );
}

/**
 * Send all unclaimed drops + gold to the party stash.
 * @param {string} partyId - Party actor ID
 * @param {object} results - Drop results from rollDropTable
 */
async function claimAllToParty(partyId, results) {
  const party = game.actors.get(partyId);
  if (!party || party.type !== "party") {
    return ui.notifications.warn("No party actor found.");
  }

  // Add gold to party treasury
  if (results.gold > 0) {
    const currentGold = party.system.gold ?? 0;
    await party.update({ "system.gold": currentGold + results.gold });
  }

  // Create manacite items on party
  const items = [];
  for (const drop of results.successfulDrops) {
    const qty = drop.quantity ?? 1;
    for (let i = 0; i < qty; i++) {
      items.push({
        name: drop.name,
        type: "manacite",
        img: "icons/svg/gem.svg",
        system: {
          rank: drop.rank,
          manaciteType: "monster",
          source: results.monsterName,
          skillGranted: drop.skillGranted ?? "",
          goldValue: _rankToGoldValue(drop.rank)
        }
      });
    }
  }

  if (items.length) {
    await party.createEmbeddedDocuments("Item", items);
  }

  ui.notifications.info(
    game.i18n.localize("SHARDS.Drops.ClaimAllParty") + ` → ${party.name}`
  );
}

/* -------------------------------------------- */
/*  Recipients                                   */
/* -------------------------------------------- */

/**
 * Get adventurer actors eligible to receive loot.
 * Prioritizes combat participants; falls back to all owned adventurers.
 * @returns {Actor[]}
 */
export function getEligibleRecipients() {
  // If in combat, return adventurer combatants
  if (game.combat) {
    const combatants = [];
    for (const c of game.combat.combatants) {
      if (c.actor?.type === "adventurer") combatants.push(c.actor);
    }
    if (combatants.length) return combatants;
  }

  // Fallback: all adventurer actors owned by players
  return game.actors.filter(a => a.type === "adventurer" && a.hasPlayerOwner);
}

/* -------------------------------------------- */
/*  Chat Button Listeners                        */
/* -------------------------------------------- */

/**
 * Activate loot-related chat button listeners.
 * Called from the renderChatMessageHTML hook.
 * @param {HTMLElement} html
 */
export function activateLootListeners(html) {
  // Claim drop buttons
  for (const btn of html.querySelectorAll("[data-action='claim-drop']")) {
    btn.addEventListener("click", _onClaimDrop);
  }

  // Claim gold buttons
  for (const btn of html.querySelectorAll("[data-action='claim-gold']")) {
    btn.addEventListener("click", _onClaimGold);
  }

  // Send all to party
  for (const btn of html.querySelectorAll("[data-action='claim-all-party']")) {
    btn.addEventListener("click", _onClaimAllParty);
  }

  // Re-roll drops (GM only)
  for (const btn of html.querySelectorAll("[data-action='reroll-drops']")) {
    btn.addEventListener("click", _onRerollDrops);
  }

  // Open loot dialog
  for (const btn of html.querySelectorAll("[data-action='open-loot-dialog']")) {
    btn.addEventListener("click", _onOpenLootDialog);
  }
}

/* -------------------------------------------- */
/*  Chat Button Event Handlers                   */
/* -------------------------------------------- */

async function _onClaimDrop(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const actorId = btn.dataset.actorId;
  const monsterName = btn.dataset.monsterName;
  const dropData = {
    name: btn.dataset.dropName,
    rank: btn.dataset.dropRank,
    skillLevel: Number(btn.dataset.dropSkillLevel) || 1,
    skillGranted: btn.dataset.dropSkillGranted || "",
    quantity: Number(btn.dataset.dropQuantity) || 1
  };

  await claimDrop(actorId, dropData, monsterName);

  // Disable the row's claim buttons
  const row = btn.closest(".shards-loot-drop__drop-row");
  if (row) {
    for (const b of row.querySelectorAll("[data-action='claim-drop']")) {
      b.disabled = true;
      b.classList.add("used");
    }
  }
}

async function _onClaimGold(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const actorId = btn.dataset.actorId;
  const amount = Number(btn.dataset.gold) || 0;

  await claimGold(actorId, amount);

  // Disable all gold claim buttons in this section
  const section = btn.closest(".shards-loot-drop__gold-section");
  if (section) {
    for (const b of section.querySelectorAll("[data-action='claim-gold']")) {
      b.disabled = true;
      b.classList.add("used");
    }
  }
}

async function _onClaimAllParty(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const partyId = btn.dataset.partyId;
  const party = game.actors.get(partyId);
  if (!party || party.type !== "party") {
    return ui.notifications.warn("No party actor found.");
  }

  const card = btn.closest(".shards-loot-drop");
  if (!card) return;

  // Parse gold from the card
  const goldBtn = card.querySelector("[data-action='claim-gold']:not(.used)");
  if (goldBtn) {
    const gold = Number(goldBtn.dataset.gold) || 0;
    if (gold > 0) {
      const currentGold = party.system.gold ?? 0;
      await party.update({ "system.gold": currentGold + gold });
    }
  }

  // Parse drops from unclaimed claim buttons in the card
  const claimedDrops = new Set();
  const items = [];
  for (const dropBtn of card.querySelectorAll("[data-action='claim-drop']:not(.used)")) {
    const dropName = dropBtn.dataset.dropName;
    const dropKey = `${dropName}-${dropBtn.dataset.dropRank}`;
    if (claimedDrops.has(dropKey)) continue; // Skip dupes from multiple recipient buttons
    claimedDrops.add(dropKey);

    const qty = Number(dropBtn.dataset.dropQuantity) || 1;
    for (let i = 0; i < qty; i++) {
      items.push({
        name: dropName,
        type: "manacite",
        img: "icons/svg/gem.svg",
        system: {
          rank: dropBtn.dataset.dropRank,
          manaciteType: "monster",
          source: dropBtn.dataset.monsterName ?? "",
          skillGranted: dropBtn.dataset.dropSkillGranted ?? "",
          goldValue: _rankToGoldValue(dropBtn.dataset.dropRank)
        }
      });
    }
  }

  if (items.length) {
    await party.createEmbeddedDocuments("Item", items);
  }

  ui.notifications.info(
    game.i18n.localize("SHARDS.Drops.ClaimAllParty") + ` → ${party.name}`
  );

  // Disable all claim buttons in the card
  for (const b of card.querySelectorAll("[data-action='claim-drop'], [data-action='claim-gold'], [data-action='claim-all-party']")) {
    b.disabled = true;
    b.classList.add("used");
  }
}

async function _onRerollDrops(event) {
  event.preventDefault();
  if (!game.user.isGM) return;

  const btn = event.currentTarget;
  const monsterId = btn.dataset.monsterId;
  const monster = game.actors.get(monsterId);
  if (!monster) return;

  // Reset the dropsRolled flag and re-roll
  await monster.update({ "system.dropsRolled": false });
  const results = await rollDropTable(monster);
  await postLootCard(monster, results);
  await monster.update({ "system.dropsRolled": true });
}

async function _onOpenLootDialog(event) {
  event.preventDefault();
  const monsterId = event.currentTarget.dataset.monsterId;
  const { ShardsLootDialog } = await import("../apps/loot-dialog.mjs");
  ShardsLootDialog.open(monsterId);
}

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

/**
 * Estimate gold value based on manacite rank.
 * @param {string} rank
 * @returns {number}
 */
function _rankToGoldValue(rank) {
  const values = { F: 50, E: 150, D: 300, C: 600, B: 1200, A: 2500, S: 5000 };
  return values[rank] ?? 50;
}
