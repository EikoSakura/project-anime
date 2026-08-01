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

/* Post an Action Roll: two dice, one optional Trait bonus, backed by a real Roll.
   first and second are { name, rank }; trait is { name, rank } or null. */
export async function postActionRoll(actor, first, second, trait) {
  const parts = [first, second].map(d => `1${LADDER[d.rank].die}`);
  if (trait) parts.push(String(LADDER[trait.rank].mod));
  const roll = await new foundry.dice.Roll(parts.join(" + ")).evaluate();
  const context = {
    title: `${first.name} + ${second.name}`,
    faces: roll.dice.map(d => d.total),
    total: roll.total,
    trait: trait ? { name: trait.name, mod: LADDER[trait.rank].mod } : null
  };
  const content = await renderTemplate("systems/project-anime/templates/chat/roll-card.hbs", context);
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  });
}
