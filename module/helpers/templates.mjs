/**
 * Preload Handlebars template partials.
 * @returns {Promise}
 */
export async function preloadHandlebarsTemplates() {
  const templatePaths = [
    // Adventurer sheet
    "systems/shards-of-mana/templates/actors/adventurer/adv-card.hbs",
    "systems/shards-of-mana/templates/actors/adventurer/tab-combat.hbs",
    "systems/shards-of-mana/templates/actors/adventurer/tab-equipment.hbs",
    "systems/shards-of-mana/templates/actors/adventurer/tab-skills.hbs",

    "systems/shards-of-mana/templates/actors/adventurer/tab-bonds.hbs",
    "systems/shards-of-mana/templates/actors/adventurer/tab-biography.hbs",
    "systems/shards-of-mana/templates/actors/adventurer/tab-build.hbs",

    // Monster sheet
    "systems/shards-of-mana/templates/actors/monster/monster-card.hbs",
    "systems/shards-of-mana/templates/actors/monster/tab-combat.hbs",
    "systems/shards-of-mana/templates/actors/monster/tab-skills.hbs",
    "systems/shards-of-mana/templates/actors/monster/tab-drops.hbs",
    "systems/shards-of-mana/templates/actors/monster/tab-biography.hbs",

    // NPC sheet
    "systems/shards-of-mana/templates/actors/npc/npc-card.hbs",
    "systems/shards-of-mana/templates/actors/npc/tab-combat.hbs",
    "systems/shards-of-mana/templates/actors/npc/tab-inventory.hbs",
    "systems/shards-of-mana/templates/actors/npc/tab-biography.hbs",

    // Merchant sheet
    "systems/shards-of-mana/templates/actors/merchant/merchant-header.hbs",
    "systems/shards-of-mana/templates/actors/merchant/tab-shop.hbs",
    "systems/shards-of-mana/templates/actors/merchant/tab-biography.hbs",

    // Party sheet
    "systems/shards-of-mana/templates/actors/party/party-header.hbs",
    "systems/shards-of-mana/templates/actors/party/tab-members.hbs",
    "systems/shards-of-mana/templates/actors/party/tab-treasury.hbs",
    "systems/shards-of-mana/templates/actors/party/tab-quests.hbs",

    // Item partials
    "systems/shards-of-mana/templates/items/parts/item-header.hbs",
    "systems/shards-of-mana/templates/items/item-body.hbs",

    // App templates
    "systems/shards-of-mana/templates/apps/codex-hub.hbs",
    "systems/shards-of-mana/templates/apps/item-browser-header.hbs",
    "systems/shards-of-mana/templates/apps/item-browser-list.hbs",
    "systems/shards-of-mana/templates/apps/skill-browser-header.hbs",

    // Item effects partial
    "systems/shards-of-mana/templates/items/parts/item-effects.hbs",

    // Job sheet
    "systems/shards-of-mana/templates/items/job/job-header.hbs",
    "systems/shards-of-mana/templates/items/job/tab-growth.hbs",
    "systems/shards-of-mana/templates/items/job/tab-progression.hbs",
    "systems/shards-of-mana/templates/items/job/tab-mastery.hbs",
    "systems/shards-of-mana/templates/items/job/tab-description.hbs",
    "systems/shards-of-mana/templates/items/job/tab-effects.hbs",

    // Skill sheet
    "systems/shards-of-mana/templates/items/skill/skill-header.hbs",
    "systems/shards-of-mana/templates/items/skill/tab-details.hbs",
    "systems/shards-of-mana/templates/items/skill/tab-description.hbs",
    "systems/shards-of-mana/templates/items/skill/tab-effects.hbs",

    // Equipment sheet
    "systems/shards-of-mana/templates/items/equipment/equipment-header.hbs",
    "systems/shards-of-mana/templates/items/equipment/tab-details.hbs",
    "systems/shards-of-mana/templates/items/equipment/tab-description.hbs",
    "systems/shards-of-mana/templates/items/equipment/tab-effects.hbs",

    // Manacite sheet
    "systems/shards-of-mana/templates/items/manacite/manacite-header.hbs",
    "systems/shards-of-mana/templates/items/manacite/tab-description.hbs",
    "systems/shards-of-mana/templates/items/manacite/tab-effects.hbs",



    // Lineage item sheet
    "systems/shards-of-mana/templates/items/lineage/lineage-header.hbs",
    "systems/shards-of-mana/templates/items/lineage/tab-description.hbs",
    "systems/shards-of-mana/templates/items/lineage/tab-details.hbs",

    // Effect item sheet
    "systems/shards-of-mana/templates/items/effect/effect-header.hbs",
    "systems/shards-of-mana/templates/items/effect/tab-description.hbs",
    "systems/shards-of-mana/templates/items/effect/tab-effects.hbs",

    // Effect Creator
    "systems/shards-of-mana/templates/apps/effect-creator.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-builder-controls.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-stat-modifier.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-derived-modifier.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-hpmp-modifier.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-growth-rate.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-movement-speed.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-choice-set.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-grant-item.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-damage-alteration.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-critical-hp.hbs",
    "systems/shards-of-mana/templates/apps/ec-parts/ec-choice-linked.hbs",

    // Choice Set Dialog
    "systems/shards-of-mana/templates/apps/choice-set-dialog.hbs",

    // Active Effect sheet
    "systems/shards-of-mana/templates/effects/ae-header.hbs",
    "systems/shards-of-mana/templates/effects/ae-details.hbs",
    "systems/shards-of-mana/templates/effects/ae-changes.hbs",
    "systems/shards-of-mana/templates/effects/ae-duration.hbs",

    // Skill Grant Dialog
    "systems/shards-of-mana/templates/apps/skill-grant-dialog.hbs",

    // Chat cards
    "systems/shards-of-mana/templates/chat/stat-test.hbs",
    "systems/shards-of-mana/templates/chat/attack-roll.hbs",
    "systems/shards-of-mana/templates/chat/healing-roll.hbs",
    "systems/shards-of-mana/templates/chat/contest-roll.hbs",
    "systems/shards-of-mana/templates/chat/weapon-attack.hbs",
    "systems/shards-of-mana/templates/chat/skill-card.hbs",

    "systems/shards-of-mana/templates/chat/level-up.hbs",
    "systems/shards-of-mana/templates/chat/skill-acquired.hbs",
    "systems/shards-of-mana/templates/chat/condition-reroll.hbs",

    // Contest dialog
    "systems/shards-of-mana/templates/apps/contest-dialog.hbs",

    // Character Creation Wizard
    "systems/shards-of-mana/templates/apps/chargen/chargen-shell.hbs",
    "systems/shards-of-mana/templates/apps/chargen/chargen-settings.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-identity.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-species.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-stats.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-growth.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-job.hbs",

    "systems/shards-of-mana/templates/apps/chargen/step-equipment.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-biography.hbs",
    "systems/shards-of-mana/templates/apps/chargen/step-review.hbs",

    // Level Up Wizard
    "systems/shards-of-mana/templates/apps/levelup/levelup-shell.hbs",
    "systems/shards-of-mana/templates/apps/levelup/step-overview.hbs",
    "systems/shards-of-mana/templates/apps/levelup/step-growth.hbs",
    "systems/shards-of-mana/templates/apps/levelup/step-summary.hbs",
    "systems/shards-of-mana/templates/apps/levelup/step-finalize.hbs",

    // Level Up Summary Chat Card
    "systems/shards-of-mana/templates/chat/levelup-summary.hbs",

    // Pre-Roll Confirmation Dialog
    "systems/shards-of-mana/templates/apps/preroll-dialog.hbs",

    // Stat Test Dialog
    "systems/shards-of-mana/templates/apps/stat-test-dialog.hbs",

    // Limit Break Ready Chat Card
    "systems/shards-of-mana/templates/chat/limit-break-ready.hbs",

    // Turn Start Summary Chat Card
    "systems/shards-of-mana/templates/chat/turn-start.hbs",

    // Loot Drop System
    "systems/shards-of-mana/templates/chat/loot-drop.hbs",
    "systems/shards-of-mana/templates/apps/loot-dialog.hbs",

    // GM Tools
    "systems/shards-of-mana/templates/apps/encounter-builder.hbs",
    "systems/shards-of-mana/templates/apps/quest-creator.hbs",

    // Party HUD
    "systems/shards-of-mana/templates/apps/party-hud.hbs",

    // Enemy HUD
    "systems/shards-of-mana/templates/apps/enemy-hud.hbs",

    // Token HUD Overlay
    "systems/shards-of-mana/templates/apps/token-hud-overlay.hbs"
  ];
  return foundry.applications.handlebars.loadTemplates(templatePaths);
}
