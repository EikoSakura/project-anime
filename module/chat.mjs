import { DIFFICULTY, LADDER } from "./config.mjs";

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

/* Combo or Fumble, read from two faces as they stand, or null. */
export function readSplash(faces) {
  if (faces.length !== 2 || faces[0] !== faces[1]) return null;
  if (faces[0] >= 6) return "combo";
  if (faces[0] === 1) return "fumble";
  return null;
}

/* Band of a roll against an effective Difficulty Grade, in rules order:
   Fumble, then the SS rule, then the next-Grade and own-Grade numbers. */
export function evaluateBand(faces, total, effective) {
  if (faces.length === 2 && faces[0] === 1 && faces[1] === 1) return "Fumble";
  if (effective >= 6) return total >= DIFFICULTY[6].number ? "Clean" : "Failure";
  if (total >= DIFFICULTY[effective + 1].number) return "Clean";
  if (total >= DIFFICULTY[effective].number) return "Success";
  return "Failure";
}

const RIDERS = {
  Clean: [],
  Success: ["Tension"],
  Failure: ["Tension", "Spotlight"],
  Fumble: ["Tension", "Spotlight", "Luck"]
};

/* Template context from a roll card's stored state: { title, faces, lucky,
   luck, trait, bonus, opening }. The total is recomputed from the faces so
   Luck replacements re-total. */
function rollCardContext(card) {
  let band = null;
  if (card.difficulty) {
    const d = card.difficulty;
    const step = DIFFICULTY[d.effective];
    band = {
      rank: step.rank,
      number: step.number,
      cssVar: step.cssVar,
      word: game.i18n.localize(`PROJECTANIME.Band.${d.band}`),
      fumble: d.band === "Fumble",
      limitBreak: d.limitBreak > 0 ? game.i18n.format("PROJECTANIME.Roll.LimitBreakTag", { n: d.limitBreak }) : null,
      riders: RIDERS[d.band].map(k => ({ key: k, text: game.i18n.localize(`PROJECTANIME.Rider.${k}`) }))
    };
  }
  return {
    band,
    title: card.title,
    faces: card.faces.map((value, i) => ({ value, lucky: card.lucky[i] })),
    total: card.faces.reduce((a, b) => a + b, 0) + (card.trait?.mod ?? 0) + card.bonus,
    trait: card.trait,
    bonus: card.bonus ? `${card.bonus > 0 ? "+" : "−"}${Math.abs(card.bonus)}` : null,
    luck: card.luck.map(name => game.i18n.format("PROJECTANIME.Roll.Luck", { name })),
    openings: (card.openings ?? []).map(o => game.i18n.format(
      o.kind === "energy" ? "PROJECTANIME.Opening.EnergyLine" : "PROJECTANIME.Opening.LuckLine", o))
  };
}

/* Post an Action Roll: two dice, one optional Trait bonus, one optional flat
   bonus, backed by a real Roll. first and second are { name, rank } with any
   die steps already applied; trait is { name, rank } or null; bonus is a
   signed integer; grade is a DIFFICULTY index or null, raised by limitBreak
   steps and capped at SS. The card's state rides the message as a flag so
   Luck spends can re-render it. */
export async function postActionRoll(actor, first, second, trait, bonus = 0, grade = null, limitBreak = 0) {
  const parts = [first, second].map(d => `1${LADDER[d.rank].die}`);
  if (trait) parts.push(String(LADDER[trait.rank].mod));
  let formula = parts.join(" + ");
  if (bonus > 0) formula += ` + ${bonus}`;
  else if (bonus < 0) formula += ` - ${-bonus}`;
  const roll = await new foundry.dice.Roll(formula).evaluate();
  const card = {
    title: `${first.name} + ${second.name}`,
    faces: roll.dice.map(d => d.total),
    lucky: [false, false],
    luck: [],
    trait: trait ? { name: trait.name, mod: LADDER[trait.rank].mod } : null,
    bonus,
    openings: []
  };
  if (grade !== null) {
    const effective = Math.min(grade + limitBreak, 6);
    card.difficulty = { grade, limitBreak, effective, band: evaluateBand(card.faces, roll.total, effective) };
  }
  const splash = readSplash(card.faces);
  const content = await renderTemplate("systems/project-anime/templates/chat/roll-card.hbs", rollCardContext(card));
  return ChatMessage.implementation.create({
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: { "project-anime": splash ? { card, splash } : { card } }
  });
}

/* Replace one die of a roll card with a spent Luck Die's recorded number and
   re-render. Runs on a client allowed to update the message; a spend that
   lands on a card already standing on a Fumble is refused. The splash flag
   updates when the Combo or Fumble state changes, and every client plays the
   splash from the update. */
export async function applyLuckSwap(message, dieIndex, value, spenderName) {
  const card = foundry.utils.deepClone(message.getFlag("project-anime", "card"));
  if (!card || !(dieIndex in card.faces)) return;
  if (readSplash(card.faces) === "fumble") return;
  card.faces[dieIndex] = value;
  card.lucky[dieIndex] = true;
  card.luck.push(spenderName);
  if (card.difficulty) {
    const total = card.faces.reduce((a, b) => a + b, 0) + (card.trait?.mod ?? 0) + card.bonus;
    card.difficulty.band = evaluateBand(card.faces, total, card.difficulty.effective);
  }
  const splash = readSplash(card.faces);
  const prior = message.getFlag("project-anime", "splash") ?? null;
  const flags = { "project-anime": { card } };
  if (splash !== prior) {
    if (splash) flags["project-anime"].splash = splash;
    else flags["project-anime"]["-=splash"] = null;
  }
  const content = await renderTemplate("systems/project-anime/templates/chat/roll-card.hbs", rollCardContext(card));
  await message.update({ content, flags });
}

/* Append an Opening benefit line to a roll card: { kind: "energy" } or
   { kind: "luck", from, to }. Runs on a client allowed to update the
   message. */
export async function applyOpening(message, spent) {
  const card = foundry.utils.deepClone(message.getFlag("project-anime", "card"));
  if (!card) return;
  card.openings = [...(card.openings ?? []), spent];
  const content = await renderTemplate("systems/project-anime/templates/chat/roll-card.hbs", rollCardContext(card));
  await message.update({ content, flags: { "project-anime": { card } } });
}
