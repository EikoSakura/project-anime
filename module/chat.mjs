import { LADDER } from "./config.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/* Post a Trait or Technique to chat. The card is a snapshot at post time. */
export async function postItemCard(item) {
  const step = LADDER[item.system.rank];
  const isTechnique = item.type === "technique";
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    isTechnique,
    rulings: item.system.rulings.filter(r => r.trim()),
    enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.text, {
      relativeTo: item,
      secrets: false
    })
  };
  if (isTechnique) {
    context.kindLabel = game.i18n.localize(`PROJECTANIME.Technique.${item.system.kind}`);
    context.costLabel = game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod });
    context.activated = item.system.kind === "Activated";
  }
  const content = await renderTemplate("systems/project-anime/templates/chat/item-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor })
  });
}

/* Post the blocked-roll card: a Technique the actor cannot pay for. */
export async function postEnergyCard(actor, item) {
  const step = LADDER[item.system.rank];
  const context = {
    name: item.name,
    rank: step.rank,
    cssVar: step.cssVar,
    costLabel: game.i18n.format("PROJECTANIME.Technique.Energy", { n: step.mod }),
    line: game.i18n.format("PROJECTANIME.Chat.NoEnergy", { left: actor.system.energy.value })
  };
  const content = await renderTemplate("systems/project-anime/templates/chat/energy-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  });
}

/* Post an Action Roll: two dice, one optional Trait bonus, one optional flat
   bonus, backed by a real Roll. first and second are { name, rank } with any
   die steps already applied; trait is { name, rank } or null; bonus is a
   signed integer. */
export async function postActionRoll(actor, first, second, trait, bonus = 0) {
  const parts = [first, second].map(d => `1${LADDER[d.rank].die}`);
  if (trait) parts.push(String(LADDER[trait.rank].mod));
  let formula = parts.join(" + ");
  if (bonus > 0) formula += ` + ${bonus}`;
  else if (bonus < 0) formula += ` - ${-bonus}`;
  const roll = await new foundry.dice.Roll(formula).evaluate();
  const faces = roll.dice.map(d => d.total);
  let splash = null;
  if (faces.length === 2 && faces[0] === faces[1]) {
    if (faces[0] >= 6) splash = "combo";
    else if (faces[0] === 1) splash = "fumble";
  }
  const context = {
    title: `${first.name} + ${second.name}`,
    faces,
    total: roll.total,
    trait: trait ? { name: trait.name, mod: LADDER[trait.rank].mod } : null,
    bonus: bonus ? `${bonus > 0 ? "+" : "−"}${Math.abs(bonus)}` : null
  };
  const content = await renderTemplate("systems/project-anime/templates/chat/roll-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: splash ? { "project-anime": { splash } } : {}
  });
}
