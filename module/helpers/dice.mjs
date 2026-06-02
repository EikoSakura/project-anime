import { PROJECTANIME, modifierValue } from "./config.mjs";
import { elementLabel } from "./elements.mjs";
import { collectRollModifiers, collectInflictedConditions, effectRules, effectCopyData } from "./effects.mjs";
import {
  aoeKind, casterToken, placeTemplate, tokensInRange, pickTargetsDialog, setUserTargets
} from "./templates.mjs";

/**
 * Project: Anime dice engine — Checks/Tests, attacks, damage and skill rolls,
 * plus the chat-card button wiring. A Check is always two attribute dice.
 */

const i18n = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

/** Current value (= die size) of an actor attribute. */
function attrValue(actor, key) {
  return actor?.system?.attributes?.[key]?.value ?? 4;
}

/** The larger of two attributes — the natural pick for a damage/effect die. */
function largerAttr(actor, a, b) {
  return attrValue(actor, a) >= attrValue(actor, b) ? a : b;
}

const DIE_SIZES = [4, 6, 8, 10, 12];

/** Step a die size down one step (minimum d4). */
function stepDownValue(value) {
  const i = DIE_SIZES.indexOf(value);
  return i > 0 ? DIE_SIZES[i - 1] : DIE_SIZES[0];
}

/** Step a die size up one step (maximum d12). */
function stepUpValue(value) {
  const i = DIE_SIZES.indexOf(value);
  return i >= 0 && i < DIE_SIZES.length - 1 ? DIE_SIZES[i + 1] : DIE_SIZES[DIE_SIZES.length - 1];
}

/** True if the actor wields a weapon/shield in BOTH the main and off hand (dual wielding). */
function isDualWielding(actor) {
  let main = false, off = false;
  for (const it of actor?.items ?? []) {
    if ((it.type !== "weapon" && it.type !== "shield") || !it.system?.equipped) continue;
    if (it.system.grip === "two") continue; // a two-handed weapon leaves no off-hand
    if (it.system.hand === "main") main = true;
    else if (it.system.hand === "off") off = true;
  }
  return main && off;
}

/** Blinded or Prone both Step Down the dice of an Accuracy Check. */
function accuracyStepDown(actor) {
  return !!(actor?.statuses?.has?.("blinded") || actor?.statuses?.has?.("prone"));
}

/**
 * Apply Step Down to both Check dice. Overload (carrying capacity exceeded)
 * affects EVERY Check; Blinded/Prone additionally affect Accuracy Checks.
 * @returns {{dieA:number, dieB:number, reasons:string[]}}
 */
function steppedDice(actor, dieA, dieB, { accuracy = false } = {}) {
  const reasons = [];
  if (actor?.system?.carryingCapacity?.overloaded) reasons.push("overload");
  if (accuracy && accuracyStepDown(actor)) reasons.push("accuracy");
  for (let i = 0; i < reasons.length; i++) {
    dieA = stepDownValue(dieA);
    dieB = stepDownValue(dieB);
  }
  return { dieA, dieB, reasons };
}

/** Build the localized "dice stepped down" notes for a set of reasons. */
function stepNotes(reasons) {
  const notes = [];
  if (reasons.includes("overload")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedOverload")}</em>`);
  if (reasons.includes("accuracy")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedDown")}</em>`);
  return notes;
}

/** A chat-card note naming the effects that modified this roll, or null if none. */
function rollModLine(rmods) {
  if (!rmods?.sources?.length) return null;
  const parts = rmods.sources.map((s) => `${s.name} ${s.value > 0 ? "+" : ""}${s.value}`);
  return `<em class="muted">${parts.join(", ")}</em>`;
}

/** Read a DialogV2 form (namespaced FormDataExtended, with a global fallback). */
function readForm(form) {
  const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  return new FDE(form).object;
}

/** Build a `1dA + 1dB (+/- mod)` formula. */
function checkFormula(dieA, dieB, mod = 0) {
  let f = `1d${dieA} + 1d${dieB}`;
  if (mod) f += `${mod > 0 ? " + " : " - "}${Math.abs(mod)}`;
  return f;
}

/** The individual results of the first two dice terms in a roll. */
function dieResults(roll) {
  return [roll.dice[0]?.total ?? 0, roll.dice[1]?.total ?? 0];
}

/** The first targeted token's actor, if any. */
function firstTargetActor() {
  const token = [...(game.user?.targets ?? [])][0];
  return token?.actor ?? null;
}

/* -------------------------------------------- */
/*  Roll dialog                                 */
/* -------------------------------------------- */

function attrSelect(name, actor, selected) {
  const opts = PROJECTANIME.attributeKeys
    .map((k) => {
      const label = `${i18n(PROJECTANIME.attributes[k])} (d${attrValue(actor, k)})`;
      return `<option value="${k}" ${k === selected ? "selected" : ""}>${label}</option>`;
    })
    .join("");
  return `<select name="${name}">${opts}</select>`;
}

/**
 * Open the roll-configuration dialog.
 * @returns {Promise<object|null>} `{ attrA?, attrB?, mod, ct? }` or null if cancelled.
 */
async function promptRoll({ title, actor, attrA, attrB, showAttrs = true, showCT = true, infoHTML = "" }) {
  // No <form> wrapper: DialogV2 supplies the form, so a nested one would break
  // `button.form` field reading. The class lives on a plain <div> for styling.
  const content = `
    <div class="project-anime roll-dialog">
      ${infoHTML}
      ${showAttrs ? `
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.attrA")}</label>${attrSelect("attrA", actor, attrA)}</div>
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.attrB")}</label>${attrSelect("attrB", actor, attrB)}</div>` : ""}
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.modifier")}</label>
        <input type="number" name="mod" value="0" step="1" /></div>
      ${showCT ? `
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.ct")}</label>
        <input type="number" name="ct" placeholder="—" step="1" /></div>` : ""}
    </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content,
    buttons: [
      {
        action: "roll",
        label: i18n("PROJECTANIME.Roll.roll"),
        icon: "fas fa-dice",
        default: true,
        callback: (event, button) => readForm(button.form)
      },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });

  if (!result || result === "cancel") return null;
  return {
    attrA: result.attrA,
    attrB: result.attrB,
    mod: Number(result.mod) || 0,
    ct: result.ct === "" || result.ct == null ? null : Number(result.ct)
  };
}

/* -------------------------------------------- */
/*  Chat card helpers                           */
/* -------------------------------------------- */

/**
 * Build a Project: Anime chat card.
 * @param {object}   o
 * @param {string}   o.title         Card heading (item / actor name).
 * @param {string}   [o.subtitle]    Small uppercase kicker (ATTACK / SKILL / …).
 * @param {string}   [o.icon]        Image path for the identity icon (item.img); omitted if blank.
 * @param {string[]} [o.meta]        Compact stat-chip HTML fragments (rank / energy / …).
 * @param {object[]} [o.badges]      Outcome pills `{cls, text}` (hit / combo / fumble / …).
 * @param {string}   [o.rollHTML]    Rendered dice roll.
 * @param {string}   [o.description] Enriched prose (the item's own description) — shown, not boilerplate.
 * @param {string[]} [o.lines]       Mechanical breakdown lines (vs Evasion, mods, target rows…).
 * @param {object[]} [o.buttons]     Action buttons `{data, label}` (data carries the data-action attrs).
 */
function cardHTML({ title, subtitle = "", icon = "", meta = [], badges = [], rollHTML = "", description = "", lines = [], buttons = [] }) {
  const iconHTML = icon ? `<img class="card-icon" src="${icon}" alt="" />` : "";
  const metaHTML = meta.length
    ? `<div class="card-meta">${meta.map((m) => `<span class="meta-chip">${m}</span>`).join("")}</div>`
    : "";
  const badgeHTML = badges.length
    ? `<div class="card-badges">${badges.map((b) => `<span class="badge ${b.cls}">${b.text}</span>`).join("")}</div>`
    : "";
  const descHTML = description ? `<div class="card-desc">${description}</div>` : "";
  const lineHTML = lines.length
    ? `<div class="card-lines">${lines.map((l) => `<div class="card-line">${l}</div>`).join("")}</div>`
    : "";
  const btnHTML = buttons.length
    ? `<div class="card-buttons">${buttons.map((b) => `<button type="button" class="card-btn" ${b.data}>${b.label}</button>`).join("")}</div>`
    : "";
  return `<div class="project-anime chat-card">
    <header class="card-header">
      ${iconHTML}
      <div class="card-titles">
        <h3 class="card-title">${title}</h3>
        ${subtitle ? `<span class="card-type">${subtitle}</span>` : ""}
      </div>
    </header>
    ${metaHTML}
    ${badgeHTML}
    ${rollHTML}
    ${descHTML}
    ${lineHTML}
    ${btnHTML}
  </div>`;
}

/** Enrich an item's own description for display on its chat card (empty string if none). */
async function enrichDescription(item) {
  const raw = item?.system?.description ?? "";
  if (!raw || !String(raw).trim()) return "";
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return TE.enrichHTML(String(raw), { secrets: false, rollData: item.getRollData?.() ?? {} });
}

/** Compact stat chips for a Skill card: rank stars · effect type · Energy cost. */
function skillMeta(sys) {
  const rank = PROJECTANIME.skillRanks[sys.rank] ?? {};
  const chips = [];
  if (rank.stars) chips.push(`<span class="meta-stars">${rank.stars}</span>`);
  const effectLabel = i18n(PROJECTANIME.skillEffects[sys.effect] ?? "");
  if (effectLabel) chips.push(effectLabel);
  if (sys.actionType !== "passive" && Number(sys.energyCost) > 0) {
    chips.push(`<i class="fas fa-bolt"></i> ${sys.energyCost}`);
  }
  return chips;
}

async function postCard(actor, content, rolls, { combo = false } = {}) {
  const arr = Array.isArray(rolls) ? rolls.filter(Boolean) : (rolls ? [rolls] : []);
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: arr,
    sound: arr.length ? CONFIG.sounds.dice : undefined
  };
  // A scored Combo rides along as a flag on the (broadcast) card; every client's
  // createChatMessage hook reads it to flash the Combo Splash. Carries the roller's
  // name + portrait so the splash can show who landed it.
  if (combo) data.flags = { "project-anime": { combo: { name: actor?.name ?? "", img: actor?.img ?? "" } } };
  return ChatMessage.create(data);
}

/**
 * Post a standalone roll (Initiative, Luck Dice, …) as a themed chat card, so every roll in
 * the system reads the same way rather than falling back to Foundry's plain roll message.
 * `lines` carries any extra notes (e.g. the stored Luck values, a Step-Up note).
 * @returns {Promise<ChatMessage>}
 */
export async function postRollCard(actor, { title, subtitle = "", icon = "", lines = [], roll }) {
  return postCard(actor, cardHTML({
    title, subtitle, icon,
    rollHTML: await roll.render(),
    lines
  }), roll);
}

/** Encode the data a chat card needs to offer a "Spend Luck" die replacement. `targetUuid`
 *  (single-target attacks/skills) rides along so a Luck flip that turns a miss into a hit can
 *  stamp the SAME validated target on its follow-up "Roll Damage" button. */
function luckButtonData({ d1, d2, mod = 0, ct = null, evasion = null, kind, actorUuid = "", itemId = "", targetUuid = "" }) {
  return [
    `data-action="spendLuck"`,
    `data-d1="${d1}"`, `data-d2="${d2}"`, `data-mod="${mod}"`,
    `data-ct="${ct ?? ""}"`, `data-evasion="${evasion ?? ""}"`,
    `data-kind="${kind}"`, `data-actor-uuid="${actorUuid}"`, `data-item-id="${itemId}"`,
    `data-target-uuid="${targetUuid}"`
  ].join(" ");
}

/** A "Spend Luck" chat-card button (every two-die roll offers one). */
function luckButton(opts) {
  return { data: luckButtonData(opts), label: `<i class="fas fa-clover"></i> ${i18n("PROJECTANIME.Roll.spendLuck")}` };
}

/** A "Spend Luck" button for an area Strike: carries every caught target + its Evasion (and the
 *  shared roll mod) so the substitution can recompute per-target hits. */
function aoeLuckButton({ d1, d2, mod = 0, targets, actorUuid = "", itemId = "" }) {
  const payload = encodeURIComponent(JSON.stringify({ d1, d2, mod, targets, actorUuid, itemId }));
  return { data: `data-action="spendLuckAoe" data-aoe-luck="${payload}"`, label: `<i class="fas fa-clover"></i> ${i18n("PROJECTANIME.Roll.spendLuck")}` };
}

/** Recompute a two-die Check outcome — used after a Luck substitution. */
function evalPair(a, b, mod, { ct = null, evasion = null } = {}) {
  const total = a + b + mod;
  const fumble = a === 1 && b === 1;
  const combo = a === b && a >= 6;
  const threshold = ct != null ? ct : evasion;
  let success = null;
  if (combo) success = true;
  else if (fumble) success = false;
  else if (threshold != null) success = total >= threshold;
  return { total, fumble, combo, success };
}

/* -------------------------------------------- */
/*  Public roll functions                       */
/* -------------------------------------------- */

/** A general Check / Test (two attribute dice vs an optional Challenge Threshold). */
export async function rollCheck(actor, { attrA = "might", attrB = "might", mod = 0, ct = null } = {}) {
  const choice = await promptRoll({
    title: i18n("PROJECTANIME.Roll.checkTitle"),
    actor, attrA, attrB
  });
  if (!choice) return null;
  return performCheck(actor, { attrA: choice.attrA, attrB: choice.attrB, modifier: choice.mod, ct: choice.ct });
}

/**
 * Evaluate and post a Check/Test — no dialog. Delegated to by the dialog-based
 * `rollCheck`. Reports Combo (matching ≥6) and Fumble (double 1s) just like an
 * attack, so the Check reads like a real combat roll.
 */
export async function performCheck(actor, { attrA = "might", attrB = "might", modifier = 0, ct = null } = {}) {
  const rmods = collectRollModifiers(actor, "check");
  modifier += rmods.flat;
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB));
  const roll = new Roll(checkFormula(dieA, dieB, modifier));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;

  const labelA = i18n(PROJECTANIME.attributes[attrA]);
  const labelB = i18n(PROJECTANIME.attributes[attrB]);
  const badges = [];
  if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
  const lines = [`<strong>${labelA} + ${labelB}</strong>`, ...stepNotes(reasons)];
  const checkModLine = rollModLine(rmods); if (checkModLine) lines.push(checkModLine);
  if (ct != null) {
    const success = roll.total >= ct;
    badges.push({ cls: success ? "success" : "failure", text: success ? i18n("PROJECTANIME.Roll.success") : i18n("PROJECTANIME.Roll.failure") });
    lines.push(`${i18n("PROJECTANIME.Roll.ct")}: ${ct}`);
  }
  if (combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [luckButton({ d1: r1, d2: r2, mod: modifier, ct, kind: "check" })];

  await postCard(actor, cardHTML({
    title: ct != null ? i18n("PROJECTANIME.Roll.test") : i18n("PROJECTANIME.Roll.check"),
    subtitle: `${labelA} + ${labelB}`,
    badges,
    rollHTML: await roll.render(),
    lines,
    buttons
  }), roll, { combo });
  return roll;
}

/**
 * Roll initiative. If the actor is in the active combat, roll into the tracker;
 * otherwise post the Agility-die + Mind-die formula to chat as a card.
 */
export async function rollInitiative(actor) {
  const inCombat = game.combat?.combatants?.some((c) => c.actorId === actor.id);
  if (inCombat) return actor.rollInitiative({ rerollInitiative: true });
  const roll = new Roll(CONFIG.Combat.initiative.formula, actor.getRollData());
  await roll.evaluate();
  await postRollCard(actor, {
    title: i18n("PROJECTANIME.Roll.initiative"),
    subtitle: `${i18n(PROJECTANIME.attributes.agility)} + ${i18n(PROJECTANIME.attributes.mind)}`,
    roll
  });
  return roll;
}

/** A weapon/shield attack: Accuracy Check vs the target's Evasion, with Fumble & Combo. */
export async function rollAttack(actor, item, { event } = {}) {
  const acc = item.system.accuracy ?? {};
  const attrA = acc.attrA ?? "might";
  const attrB = acc.attrB ?? "agility";
  let mod = Number(acc.mod) || 0;

  const targetActor = firstTargetActor();
  const evasion = targetActor?.system?.evasion?.value ?? null;

  // Shift-click skips the situational-modifier dialog.
  if (!event?.shiftKey) {
    const info = evasion != null
      ? `<p class="hint">${i18n("PROJECTANIME.Roll.vsEvasion")} <strong>${targetActor.name}</strong>: ${evasion}</p>`
      : `<p class="hint">${i18n("PROJECTANIME.Roll.noTarget")}</p>`;
    const choice = await promptRoll({ title: i18n("PROJECTANIME.Roll.attack"), actor, showAttrs: false, showCT: false, infoHTML: info });
    if (!choice) return null;
    mod += choice.mod;
  }

  const rmods = collectRollModifiers(actor, "attack", { target: targetActor });
  mod += rmods.flat;
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, mod));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;

  const badges = [];
  let hit = null;
  if (fumble) { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") }); hit = false; }
  else if (combo) { badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") }); hit = true; }
  else if (evasion != null) { hit = roll.total >= evasion; }

  if (hit === true && !combo) badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
  else if (hit === false && !fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });

  const lines = [...stepNotes(reasons)];
  const atkModLine = rollModLine(rmods); if (atkModLine) lines.push(atkModLine);
  if (evasion != null) lines.push(`${i18n("PROJECTANIME.Roll.vsEvasion")} <strong>${targetActor.name}</strong>: ${evasion}`);
  else lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.noTarget")}</em>`);
  if (combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  if (hit === true && targetActor) {
    for (const c of collectInflictedConditions(item, targetActor)) {
      await applyStatusEffect(targetActor, c.id);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: targetActor.name })}</em>`);
    }
  }

  const buttons = [luckButton({ d1: r1, d2: r2, mod, evasion, kind: "attack", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" })];
  if (hit !== false) {
    // Stamp the resolved target so "Roll Damage" can't drift to a re-target (or to whoever else
    // clicks the broadcast card) — the hit was validated against THIS target's Evasion.
    const tgt = targetActor ? ` data-target-uuid="${targetActor.uuid}"` : "";
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}`,
      label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
    });
  }

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img,
    badges,
    rollHTML: await roll.render(),
    description: await enrichDescription(item),
    lines,
    buttons
  }), roll, { combo });
  return roll;
}

/**
 * Roll the (target-independent) damage/heal amount for a weapon or skill once. Shared by
 * the single-target, area, and chain damage paths — they each apply this raw to their targets.
 * @returns {Promise<{roll, raw, dtype, dieAttr, isSkill, heal, pool, pierces, ignoresDefense, dmgReasons, rmods}>}
 */
async function computeDamageRoll(actor, item, { target = null, charged = false } = {}) {
  const isSkill = item.type === "skill";
  const heal = isSkill && item.system.effect === "mend";

  let attrA, attrB, mod, dtype;
  if (isSkill) {
    attrA = item.system.attributes?.attrA ?? "might";
    attrB = item.system.attributes?.attrB ?? "spirit";
    mod = 0;
    dtype = item.system.damageType || "physical";
  } else {
    attrA = item.system.accuracy?.attrA ?? "might";
    attrB = item.system.accuracy?.attrB ?? "agility";
    mod = Number(item.system.damage?.mod) || 0;
    dtype = item.system.damage?.type || "physical";
  }

  // Skills roll the designer-CHOSEN Attribute die (rules: "choose one of its two
  // Attributes"); weapons roll the larger of the two.
  const dieAttr = isSkill
    ? (item.system.attributes?.[item.system.damageAttr] ?? attrA)
    : largerAttr(actor, attrA, attrB);
  // Weapon/shield grip rules (p.9-10): a two-handed grip Steps the Damage die UP
  // one size (or +1 damage if already d12); dual wielding Steps both dice DOWN one.
  let dieSize = attrValue(actor, dieAttr);
  const dmgReasons = [];
  if (!isSkill && !heal) {
    if (item.system.grip === "two") {
      const up = stepUpValue(dieSize);
      if (up === dieSize) mod += 1; else dieSize = up;
      dmgReasons.push("twoHanded");
    } else if (isDualWielding(actor)) {
      dieSize = stepDownValue(dieSize);
      dmgReasons.push("dualWield");
    }
  }

  // Pierce (a Skill modifier) and Energy damage both bypass Defense: per the rules,
  // Defense reduces only Hit Point damage, so damage dealt to the Energy pool ignores
  // it. ("Energy damage" = damage to the Energy stat — NOT an element/damage type.)
  const isStrike = isSkill && item.system.effect === "strike";
  const pool = (isStrike && item.system.damagePool === "energy") ? "energy" : "hp";
  const pierces = isSkill && (item.system.modifiers ?? []).includes("pierce");
  const ignoresDefense = pierces || pool === "energy";

  const rmods = collectRollModifiers(actor, "damage", { target });
  mod += rmods.flat;
  let f = `1d${dieSize}`;
  if (mod) f += `${mod > 0 ? " + " : " - "}${Math.abs(mod)}`;
  const roll = new Roll(f);
  await roll.evaluate();
  // Charge (a Skill modifier): a charged release resolves at double damage/healing (rules p.13).
  const raw = Math.max(roll.total, 0) * (charged ? 2 : 1);

  return { roll, raw, dtype, dieAttr, isSkill, heal, pool, pierces, ignoresDefense, dmgReasons, rmods, charged };
}

/**
 * Adjust a raw damage amount for ONE target: affinity (+2 weak / −2 resist / immune→0 /
 * absorb→heal) then −Defense then min 0. Returns the applied amount, whether it heals, the
 * affinity badges, and a chat line. Defense/affinity are skipped for healing.
 */
function adjustForTarget(raw, dtype, targetActor, { ignoresDefense = false, heal = false } = {}) {
  const badges = [];
  if (heal) return { amount: raw, heal: true, badges, line: i18n("PROJECTANIME.Roll.healsFor", { n: raw }) };
  if (!targetActor) return { amount: raw, heal: false, badges, line: `<strong>${raw}</strong> ${elementLabel(dtype)}` };

  const def = ignoresDefense ? 0 : (targetActor.system?.defense?.value ?? 0);
  const affinity = targetActor.system?.affinities?.[dtype] ?? "none";
  let amount = raw;
  let appliesHeal = false;
  let parts = `${raw} ${elementLabel(dtype)}`;
  if (affinity === "immune") {
    amount = 0;
    badges.push({ cls: "success", text: i18n("PROJECTANIME.Affinity.immune") });
    parts += ` · ${i18n("PROJECTANIME.Affinity.immune")} = <strong>0</strong>`;
  } else if (affinity === "absorb") {
    amount = raw; appliesHeal = true;
    badges.push({ cls: "success", text: i18n("PROJECTANIME.Affinity.absorb") });
    parts += ` · ${i18n("PROJECTANIME.Affinity.absorb")} → ${i18n("PROJECTANIME.Roll.healsFor", { n: raw })}`;
  } else {
    const adj = PROJECTANIME.affinityDamage[affinity] ?? 0;
    if (affinity === "weak") { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Affinity.weak") }); parts += ` · +2`; }
    else if (affinity === "resist") { badges.push({ cls: "success", text: i18n("PROJECTANIME.Affinity.resist") }); parts += ` · −2`; }
    amount = Math.max(0, raw + adj - def);
    if (def) parts += ` − ${def} ${i18n("PROJECTANIME.Stat.defense")}`;
    parts += ` = <strong>${amount}</strong>`;
  }
  return { amount, heal: appliesHeal, badges, line: parts };
}

/** An "Apply (n) → Target" chat-card button (HP / Energy / heal). */
function applyButton(targetActor, amount, heal, pool) {
  const applyPool = heal ? "hp" : pool;
  const icon = heal ? "heart" : (pool === "energy" ? "bolt" : "tint");
  return {
    data: `data-action="applyDamage" data-target-uuid="${targetActor.uuid}" data-amount="${amount}" data-heal="${heal}" data-pool="${applyPool}"`,
    label: `<i class="fas fa-${icon}"></i> ${i18n("PROJECTANIME.Roll.apply")} (${amount}) → ${targetActor.name}`
  };
}

/** An "Apply to All" button carrying a URL-safe JSON list of {uuid, amount, heal, pool}. */
function applyAllButton(list) {
  const payload = encodeURIComponent(JSON.stringify(list));
  return {
    data: `data-action="applyAll" data-apply-all="${payload}"`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.applyAll")}`
  };
}

/**
 * Roll a weapon's / skill's damage (or healing), reduced by the target's Defense.
 * With `targetUuids` (carried by an area Skill's "Roll Damage" button) it rolls once and
 * applies that raw to every listed target; otherwise it resolves the single primary target.
 */
export async function rollDamage(actor, item, { targetUuids = null, charged = false } = {}) {
  let targets = [];
  if (targetUuids?.length) {
    targets = (await Promise.all(targetUuids.map((u) => fromUuid(u)))).filter(Boolean);
  } else {
    const t = firstTargetActor();
    if (t) targets = [t];
  }
  if (targets.length > 1) return postAoeDamageCard(actor, item, targets, { charged });

  // Single-target (or no target) — the original card.
  const targetActor = targets[0] ?? null;
  const dmg = await computeDamageRoll(actor, item, { target: targetActor, charged });
  const adj = adjustForTarget(dmg.raw, dmg.dtype, targetActor, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal });

  const badges = [...adj.badges];
  const lines = [adj.line];
  lines.push(...damageNotes(dmg));
  const buttons = [];
  if (targetActor && (adj.amount > 0 || adj.heal)) buttons.push(applyButton(targetActor, adj.amount, adj.heal, dmg.pool));
  // Drain HP/Energy: the caster recovers half the damage actually dealt to the target.
  await applyDrain(actor, item, targetActor && !adj.heal ? adj.amount : 0, lines);

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: dmg.heal ? i18n("PROJECTANIME.Roll.healing") : i18n("PROJECTANIME.Roll.damage"),
    icon: item.img,
    badges,
    rollHTML: await dmg.roll.render(),
    lines,
    buttons
  }), dmg.roll);
  return dmg.roll;
}

/** The shared "die used / two-handed / pierce / energy / effect-mods" damage notes. */
function damageNotes(dmg) {
  const lines = [];
  if (dmg.charged) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.charged")}</em>`);
  if (dmg.isSkill) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.dieUsed", { attr: i18n(PROJECTANIME.attributes[dmg.dieAttr] ?? dmg.dieAttr) })}</em>`);
  if (dmg.dmgReasons.includes("twoHanded")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.twoHanded")}</em>`);
  if (dmg.dmgReasons.includes("dualWield")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.dualWield")}</em>`);
  if (dmg.pierces) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.pierce")}</em>`);
  if (dmg.pool === "energy") lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.energyDamage")}</em>`);
  const modLine = rollModLine(dmg.rmods); if (modLine) lines.push(modLine);
  return lines;
}

/** Multi-target damage card: one roll, applied per target (each with its own affinity/Defense). */
async function postAoeDamageCard(actor, item, targetActors, { charged = false } = {}) {
  const dmg = await computeDamageRoll(actor, item, { target: targetActors[0], charged });
  const lines = [`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetActors.length })}</em>`];
  const buttons = [];
  const applyList = [];
  let drainTotal = 0;
  for (const ta of targetActors) {
    const adj = adjustForTarget(dmg.raw, dmg.dtype, ta, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal });
    lines.push(`<span class="card-target-row"><strong>${ta.name}</strong> <span class="muted">${adj.line}</span></span>`);
    if (adj.amount > 0 || adj.heal) {
      buttons.push(applyButton(ta, adj.amount, adj.heal, dmg.pool));
      applyList.push({ uuid: ta.uuid, amount: adj.amount, heal: adj.heal, pool: adj.heal ? "hp" : dmg.pool });
    }
    if (!adj.heal) drainTotal += adj.amount;
  }
  lines.push(...damageNotes(dmg));
  if (applyList.length > 1) buttons.push(applyAllButton(applyList));
  // Drain HP/Energy: the caster recovers half the total damage the area Skill dealt.
  await applyDrain(actor, item, drainTotal, lines);

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: dmg.heal ? i18n("PROJECTANIME.Roll.healing") : i18n("PROJECTANIME.Roll.damage"),
    icon: item.img,
    rollHTML: await dmg.roll.render(),
    lines,
    buttons
  }), dmg.roll);
  return dmg.roll;
}

/**
 * Roll a Skill. Area Skills (Burst/Line/Mass/Chain) acquire multiple targets first; every
 * other Skill resolves against the single primary target (unchanged). Energy is spent only
 * once targeting commits, so cancelling template placement / the Mass pick costs nothing.
 */
export async function rollSkill(actor, item) {
  const sys = item.system;
  // Exhausted prevents activating Skills (passive Skills are always-on, not activated).
  if (actor.statuses?.has?.("exhausted") && sys.actionType !== "passive") {
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.exhausted"));
  }

  const mods = sys.modifiers ?? [];
  // Devour (a Skill modifier): a dedicated flow — copy one Skill the 0-HP target knows. No attack.
  if (mods.includes("devour")) return resolveDevour(actor, item);

  // Charge (a Skill modifier): the first activation spends a turn focusing; the next activation
  // (or the card's Release button) resolves it at double power. A miss dissipates the charge.
  const isChargeSkill = mods.includes("charge");
  const releasingCharge = isChargeSkill && actor.getFlag("project-anime", "charge") === item.id;
  if (isChargeSkill && !releasingCharge) return startCharge(actor, item);

  const kind = aoeKind(item);
  const isStrike = sys.effect === "strike";

  // 1) Acquire targets (interactive for area Skills) BEFORE spending Energy / clearing the charge.
  let areaTokens = null;     // Token[] for burst/line/mass; null = single-target path
  let chainPrimary = null;   // primary Token for chain
  if (kind === "chain") {
    const first = [...(game.user?.targets ?? [])][0];
    if (!first?.actor) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
    if (!casterToken(actor)) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken"));
    chainPrimary = first;
  } else if (kind) {
    areaTokens = await acquireAreaTargets(actor, item, kind);
    if (areaTokens === null) return null;   // cancelled — no Energy spent / charge kept
  }

  // 2) Spend Energy (rank×2; Passive = free). A charge release already paid on the focus turn,
  // so releasing is free — but it consumes the charge whether the follow-up hits or misses.
  if (releasingCharge) await actor.unsetFlag("project-anime", "charge");
  else if (!(await spendSkillEnergy(actor, sys))) return null;

  // 3) Resolve (a charged release doubles damage/healing).
  if (chainPrimary) return resolveChain(actor, item, chainPrimary, { charged: releasingCharge });
  if (kind) {
    setUserTargets(areaTokens);
    return isStrike ? resolveAreaStrike(actor, item, areaTokens, { charged: releasingCharge })
                    : resolveAreaEffect(actor, item, areaTokens, { charged: releasingCharge });
  }
  return resolveSingleSkill(actor, item, { charged: releasingCharge });
}

/** Spend a Skill's Energy (rank×2; Passive = free). Warns + returns false if unaffordable. */
async function spendSkillEnergy(actor, sys) {
  const energyCost = sys.actionType === "passive" ? 0 : (Number(sys.energyCost) || 0);
  if (energyCost > 0) {
    const current = actor.system.energy?.value ?? 0;
    if (current < energyCost) { ui.notifications.warn(i18n("PROJECTANIME.Roll.noEnergy", { n: energyCost })); return false; }
    await actor.update({ "system.energy.value": current - energyCost });
  }
  return true;
}

/** Acquire target tokens for an area Skill. Returns Token[] (maybe empty) or null on cancel /
 *  when it can't proceed (warned). Burst/Line place a template; Mass picks from in-range. */
async function acquireAreaTargets(actor, item, kind) {
  const sys = item.system;
  const rangeTiles = sys.range?.tiles ?? PROJECTANIME.rangeTiles[sys.range?.scope] ?? 5;
  const ctoken = casterToken(actor);

  if (kind === "burst") {
    const res = await placeTemplate({
      t: "circle", distanceTiles: modifierValue(item, "burst"),
      origin: ctoken?.center ?? null, follow: "point",
      maxRangeTiles: ctoken ? rangeTiles : null,
      hint: i18n("PROJECTANIME.Roll.placeBurst")
    });
    return res ? res.tokens : null;
  }
  if (kind === "line") {
    if (!ctoken) { ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken")); return null; }
    const gs = canvas.grid.size;
    const res = await placeTemplate({
      t: "ray", distanceTiles: Math.max(1, rangeTiles), origin: ctoken.center,
      originHalfW: (ctoken.document.width || 1) * gs / 2,
      originHalfH: (ctoken.document.height || 1) * gs / 2,
      follow: "direction", hint: i18n("PROJECTANIME.Roll.placeLine")
    });
    return res ? res.tokens : null;
  }
  if (kind === "mass") {
    if (!ctoken) { ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken")); return null; }
    const inRange = tokensInRange(ctoken, rangeTiles);
    if (!inRange.length) { ui.notifications.warn(i18n("PROJECTANIME.Roll.massNone")); return null; }
    return pickTargetsDialog(inRange);   // null if cancelled, [] if none chosen
  }
  return null;
}

/** Single-target Skill resolution (the original behavior; Energy is already spent). */
async function resolveSingleSkill(actor, item, { charged = false } = {}) {
  const sys = item.system;
  const attrA = sys.attributes?.attrA ?? "might";
  const attrB = sys.attributes?.attrB ?? "spirit";
  const isStrike = sys.effect === "strike";
  const isMend = sys.effect === "mend";

  const targetActor = firstTargetActor();
  const evasion = targetActor?.system?.evasion?.value ?? null;

  const rmods = collectRollModifiers(actor, isStrike ? "attack" : "check", { target: targetActor });
  // "Sharpen Accuracy" advancement: a flat bonus baked into the Skill's Check.
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: isStrike });
  const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = isStrike && r1 === 1 && r2 === 1;
  const combo = isStrike && r1 === r2 && r1 >= 6;

  const badges = [];
  let hit = null;
  if (isStrike) {
    if (fumble) { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") }); hit = false; }
    else if (combo) { badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") }); hit = true; }
    else if (evasion != null) hit = roll.total >= evasion;
    if (hit === true && !combo) badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
    else if (hit === false && !fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });
  }

  const lines = [...stepNotes(reasons)];
  const skillModLine = rollModLine(rmods); if (skillModLine) lines.push(skillModLine);
  if (accBonus) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.sharpened", { n: accBonus })}</em>`);
  if (isStrike && evasion != null) lines.push(`${i18n("PROJECTANIME.Roll.vsEvasion")} <strong>${targetActor.name}</strong>: ${evasion}`);
  if (combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);
  // Charged release: note the double power on a hit, or that the charge dissipated on a miss.
  if (charged) lines.push(`<em class="muted">${i18n(isStrike && hit === false ? "PROJECTANIME.Roll.chargeDissipated" : "PROJECTANIME.Roll.charged")}</em>`);

  if ((isStrike ? hit === true : true) && targetActor) {
    for (const c of collectInflictedConditions(item, targetActor)) {
      await applyStatusEffect(targetActor, c.id);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: targetActor.name })}</em>`);
    }
    await inflictDecay(item, targetActor, lines);
  }

  // Non-Strike / non-Mend Skills (Bolster / Hinder / Affinity / Sustain / Move / Sense) grant
  // their own Active Effect(s) to the targeted tokens — or the caster if none are targeted.
  if (!isStrike && !isMend) lines.push(...(await applySkillEffects(actor, item)));

  const buttons = [];
  if (isStrike) buttons.push(luckButton({ d1: r1, d2: r2, mod: 0, evasion, kind: "skill", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" }));
  if ((isStrike && hit !== false) || isMend) {
    // Stamp the resolved target so the follow-up roll lands on who was targeted at cast time.
    const tgt = targetActor ? ` data-target-uuid="${targetActor.uuid}"` : "";
    const chg = charged ? ` data-charged="true"` : "";
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}${chg}`,
      label: `<i class="fas fa-${isMend ? "heart" : "burst"}"></i> ${i18n(isMend ? "PROJECTANIME.Roll.rollHealing" : "PROJECTANIME.Roll.rollDamage")}`
    });
  }

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(sys),
    badges,
    rollHTML: await roll.render(),
    description: await enrichDescription(item),
    lines,
    buttons
  }), roll, { combo });
  return roll;
}

/**
 * Area Strike (Burst / Line / Mass): roll the Accuracy Check ONCE, then compare that total
 * against each caught creature's own Evasion (Combo hits all, Fumble misses all). Hit targets
 * are inflicted with any on-hit conditions and flow into the "Roll Damage" button.
 */
async function resolveAreaStrike(actor, item, targetTokens, { charged = false } = {}) {
  const sys = item.system;
  const attrA = sys.attributes?.attrA ?? "might";
  const attrB = sys.attributes?.attrB ?? "spirit";
  const primary = targetTokens[0]?.actor ?? null;

  const rmods = collectRollModifiers(actor, "attack", { target: primary });
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;

  const badges = [];
  if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });

  const lines = [...stepNotes(reasons)];
  const modLine = rollModLine(rmods); if (modLine) lines.push(modLine);
  if (accBonus) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.sharpened", { n: accBonus })}</em>`);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetTokens.length })}</em>`);

  const hitUuids = [];
  const luckTargets = [];
  for (const tok of targetTokens) {
    const ta = tok.actor; if (!ta) continue;
    const ev = ta.system?.evasion?.value ?? null;
    const didHit = combo || (!fumble && (ev == null || roll.total >= ev));
    luckTargets.push({ uuid: ta.uuid, ev, name: ta.name });
    const evText = ev != null ? ` <span class="muted">(${i18n("PROJECTANIME.Stat.evasion")} ${ev})</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${ta.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evText}</span>`);
    if (didHit) {
      hitUuids.push(ta.uuid);
      for (const c of collectInflictedConditions(item, ta)) {
        await applyStatusEffect(ta, c.id);
        lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: ta.name })}</em>`);
      }
      await inflictDecay(item, ta, lines);
    }
  }
  if (!targetTokens.length) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeNoTargets")}</em>`);
  if (combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);
  // Charged release: note the double power on any hit, or that the charge dissipated on a clean miss.
  if (charged) lines.push(`<em class="muted">${i18n(hitUuids.length ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  const buttons = [];
  // Spend Luck re-evaluates the single Accuracy roll against every caught target's Evasion.
  if (luckTargets.length) buttons.push(aoeLuckButton({
    d1: r1, d2: r2, mod: rmods.flat + accBonus, targets: luckTargets, actorUuid: actor.uuid, itemId: item.id
  }));
  if (hitUuids.length) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}" data-target-uuids="${hitUuids.join(",")}"${charged ? ' data-charged="true"' : ''}`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
  });

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img, meta: skillMeta(sys),
    badges, rollHTML: await roll.render(),
    description: await enrichDescription(item), lines, buttons
  }), roll, { combo });
  return roll;
}

/**
 * Area non-Strike effect (e.g. Mass Mend): there is no Accuracy Check — the area "affects"
 * every target. Mend offers a "Roll Healing" button for all; on-hit conditions inflict on all.
 */
async function resolveAreaEffect(actor, item, targetTokens, { charged = false } = {}) {
  const sys = item.system;
  const isMend = sys.effect === "mend";
  const lines = [`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetTokens.length })}</em>`];

  const uuids = [];
  for (const tok of targetTokens) {
    const ta = tok.actor; if (!ta) continue;
    uuids.push(ta.uuid);
    lines.push(`<span class="card-target-row"><strong>${ta.name}</strong></span>`);
    for (const c of collectInflictedConditions(item, ta)) {
      await applyStatusEffect(ta, c.id);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: ta.name })}</em>`);
    }
    await inflictDecay(item, ta, lines);
  }
  if (!targetTokens.length) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeNoTargets")}</em>`);

  // Non-Mend area effects (Mass Bolster / Hinder / Affinity …) grant the Skill's Active Effect(s)
  // to every caught creature. (Mend's mechanic is the healing button below.)
  if (!isMend) lines.push(...(await applySkillEffects(actor, item, targetTokens.map((t) => t.actor).filter(Boolean))));

  if (isMend && charged) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.charged")}</em>`);

  const buttons = [];
  if (isMend && uuids.length) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}" data-target-uuids="${uuids.join(",")}"${charged ? ' data-charged="true"' : ''}`,
    label: `<i class="fas fa-heart"></i> ${i18n("PROJECTANIME.Roll.rollHealing")}`
  });

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img, meta: skillMeta(sys),
    description: await enrichDescription(item), lines, buttons
  }));
  return null;
}

/**
 * Chain: hit the primary target, then leap to the nearest unhit token within Near, each leap
 * dealing half the previous damage; the chain stops the moment a leap misses (rules: "must hit
 * each target before the leap can continue"). One combined attack+damage card.
 */
async function resolveChain(actor, item, primaryToken, { charged = false } = {}) {
  const sys = item.system;
  const attrA = sys.attributes?.attrA ?? "might";
  const attrB = sys.attributes?.attrB ?? "spirit";
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const nearTiles = PROJECTANIME.rangeTiles[PROJECTANIME.chainRangeScope] ?? 5;
  const maxTargets = modifierValue(item, "chain") + 1;   // primary + N leaps

  // One damage roll (doubled on a charged release); each successive hit deals half the previous.
  const dmg = await computeDamageRoll(actor, item, { target: primaryToken.actor, charged });

  const lines = [];
  const buttons = [];
  const applyList = [];
  const rolls = [dmg.roll];
  const hitSet = new Set();
  let current = primaryToken;
  let prevRaw = dmg.raw;
  let stoppedName = null;
  let drainTotal = 0;

  for (let i = 0; i < maxTargets && current; i++) {
    const ta = current.actor;
    if (!ta) break;
    hitSet.add(current);
    const rmods = collectRollModifiers(actor, "attack", { target: ta });
    const { dieA, dieB } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
    const aroll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus));
    await aroll.evaluate();
    rolls.push(aroll);
    const [r1, r2] = dieResults(aroll);
    const fum = r1 === 1 && r2 === 1;
    const com = r1 === r2 && r1 >= 6;
    const ev = ta.system?.evasion?.value ?? null;
    const didHit = com || (!fum && (ev == null || aroll.total >= ev));
    const raw = i === 0 ? prevRaw : Math.floor(prevRaw / 2);

    const leapTag = i === 0 ? "" : `${i18n("PROJECTANIME.Roll.chainLeap", { n: i })} · `;
    const evText = ev != null ? ` vs ${ev}` : "";
    lines.push(`<span class="card-target-row">${leapTag}<strong>${ta.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")} <span class="muted">(${aroll.total}${evText})</span></span>`);

    if (!didHit) { stoppedName = ta.name; break; }   // must hit before the leap continues

    const adj = adjustForTarget(raw, dmg.dtype, ta, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal });
    lines.push(`<span class="card-target-row"><span class="muted">${adj.line}</span></span>`);
    for (const c of collectInflictedConditions(item, ta)) {
      await applyStatusEffect(ta, c.id);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: ta.name })}</em>`);
    }
    await inflictDecay(item, ta, lines);
    if (adj.amount > 0 || adj.heal) {
      buttons.push(applyButton(ta, adj.amount, adj.heal, dmg.pool));
      applyList.push({ uuid: ta.uuid, amount: adj.amount, heal: adj.heal, pool: adj.heal ? "hp" : dmg.pool });
    }
    if (!adj.heal) drainTotal += adj.amount;
    prevRaw = raw;
    current = tokensInRange(current, nearTiles).find((t) => !hitSet.has(t)) ?? null;
  }

  if (stoppedName) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chainStopped", { name: stoppedName })}</em>`);
  lines.push(...damageNotes(dmg));
  if (applyList.length > 1) buttons.push(applyAllButton(applyList));
  // Drain HP/Energy: the caster recovers half the total damage dealt across the chain.
  await applyDrain(actor, item, drainTotal, lines);

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img, meta: skillMeta(sys),
    rollHTML: await dmg.roll.render(),
    description: await enrichDescription(item), lines, buttons
  }), rolls);
  return rolls;
}

/* -------------------------------------------- */
/*  Charge & Devour (Skill modifiers)           */
/* -------------------------------------------- */

/** Begin charging a Charge Skill: pay its Energy now (the focus turn's cost), flag the actor, and
 *  post a card with a Release button. Re-activating the Skill — or clicking Release — on a later
 *  turn resolves it at double power (rules p.13). One charge is held at a time per actor. */
async function startCharge(actor, item) {
  if (!(await spendSkillEnergy(actor, item.system))) return null;
  await actor.setFlag("project-anime", "charge", item.id);
  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.charge"),
    icon: item.img,
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.chargeReleases")}</em>`],
    buttons: [{
      data: `data-action="releaseCharge" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"`,
      label: `<i class="fas fa-bolt"></i> ${i18n("PROJECTANIME.Roll.release")}`
    }]
  }));
}

/** Devour (a Heavy Skill modifier): copy one Skill a creature reduced to 0 HP knows. Opens a picker
 *  of that target's Skills the caster doesn't already have; the chosen Skill is learned (copied onto
 *  the caster). Energy is spent only once a Skill is actually chosen, so cancelling costs nothing. */
async function resolveDevour(actor, item) {
  const target = firstTargetActor();
  if (!target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
  if ((target.system?.hp?.value ?? 0) > 0) return ui.notifications.warn(i18n("PROJECTANIME.Roll.devourNotDefeated"));

  const known = new Set((actor.items ?? []).filter((i) => i.type === "skill").map((i) => i.name));
  const skills = (target.items ?? []).filter((i) => i.type === "skill" && !known.has(i.name));
  if (!skills.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.devourNoSkills", { name: target.name }));

  const chosenId = await pickDevourSkill(target, skills);
  if (!chosenId) return null;   // cancelled — no Energy spent
  const chosen = skills.find((s) => s.id === chosenId);
  if (!chosen) return null;
  if (!(await spendSkillEnergy(actor, item.system))) return null;

  const data = chosen.toObject();
  delete data._id;
  await actor.createEmbeddedDocuments("Item", [data]);

  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.devoured", { skill: chosen.name, name: target.name })}</em>`]
  }));
}

/** Dialog: choose which Skill to copy from a Devoured creature. Returns the chosen Skill id, or null. */
async function pickDevourSkill(target, skills) {
  const opts = skills.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  const content = `
    <div class="project-anime roll-dialog devour-dialog">
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.devourPick", { name: target.name })}</label>
        <select name="skill">${opts}</select></div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Skill.modifier.devour") },
    content,
    buttons: [
      { action: "devour", label: i18n("PROJECTANIME.Roll.devour"), icon: "fas fa-utensils", default: true, callback: (e, b) => readForm(b.form) },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return result.skill;
}

/** Use a consumable: apply its HP/Energy restore (if any), spend one, post a card. */
export async function useConsumable(actor, item) {
  const sys = item.system;
  const qty = Number(sys.quantity ?? 0) || 0;
  if (qty < 1) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noneLeft"));

  const type = sys.restoreType ?? "none"; // "none" | "hp" | "energy"
  const amount = Number(sys.restoreAmount ?? 0) || 0;
  const lines = [];

  if ((type === "hp" || type === "energy") && amount > 0) {
    const pool = actor.system[type] ?? { value: 0, max: 0 };
    const next = Math.clamp(pool.value + amount, 0, pool.max);
    if (next !== pool.value) await actor.update({ [`system.${type}.value`]: next });
    lines.push(`<strong>+${next - pool.value}</strong> ${i18n(`PROJECTANIME.Stat.${type}`)}`);
  }

  await item.update({ "system.quantity": Math.max(0, qty - 1) });
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.remaining", { n: Math.max(0, qty - 1) })}</em>`);

  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.used"),
    icon: item.img,
    description: await enrichDescription(item),
    lines
  }));
}

/* -------------------------------------------- */
/*  Chat-card button wiring                     */
/* -------------------------------------------- */

/** Bind interactive buttons on rendered chat cards. Registered on renderChatMessageHTML. */
export function onRenderChatMessage(message, html) {
  // Assign via `.onclick` (not addEventListener) so re-rendering the same card
  // can't stack duplicate handlers — a stacked Apply button would apply twice.
  html.querySelectorAll("[data-action='rollDamage']").forEach((btn) => { btn.onclick = onRollDamageButton; });
  html.querySelectorAll("[data-action='applyDamage']").forEach((btn) => { btn.onclick = onApplyDamageButton; });
  html.querySelectorAll("[data-action='applyAll']").forEach((btn) => { btn.onclick = onApplyAllButton; });
  html.querySelectorAll("[data-action='releaseCharge']").forEach((btn) => { btn.onclick = onReleaseChargeButton; });
  html.querySelectorAll("[data-action='spendLuck']").forEach((btn) => { btn.onclick = onSpendLuckButton; });
  html.querySelectorAll("[data-action='spendLuckAoe']").forEach((btn) => { btn.onclick = onSpendLuckAoeButton; });
}

async function onRollDamageButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  const item = actor?.items.get(el.dataset.itemId);
  if (!item) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Roll.itemGone"));
  // An area Skill's button carries the hit targets (CSV `targetUuids`); a single-target attack/skill
  // carries the one resolved target (`targetUuid`) so damage can't drift to a re-target. Either
  // path resolves by UUID at click time — independent of who clicks or what they're targeting now.
  const targetUuids = el.dataset.targetUuids
    ? el.dataset.targetUuids.split(",").filter(Boolean)
    : (el.dataset.targetUuid ? [el.dataset.targetUuid] : null);
  return rollDamage(actor, item, { targetUuids, charged: el.dataset.charged === "true" });
}

/** "Release" a charged Skill: re-activate it — rollSkill sees the charge flag and resolves it. */
async function onReleaseChargeButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  if (!actor) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  const item = actor.items.get(el.dataset.itemId);
  if (!item) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  return rollSkill(actor, item);
}

/**
 * Apply HP damage (or healing) to a target actor, clamped to [0, max].
 * Runs on whichever client owns the target: the clicker if they own it,
 * otherwise the active GM via the socket relay in project-anime.mjs. Centralized
 * so both paths clamp identically. Exported for the socket handler.
 */
export async function applyDamageTo(targetUuid, amount, heal, pool = "hp") {
  const target = await fromUuid(targetUuid);
  if (!target) return;
  const key = pool === "energy" ? "energy" : "hp";
  const stat = target.system[key] ?? { value: 0, max: 0 };
  const next = Math.clamp(stat.value + (heal ? amount : -amount), 0, stat.max);
  await target.update({ [`system.${key}.value`]: next });
}

/**
 * Apply (or remove) a status condition on a target. Runs on whichever client owns
 * the target. Exported for the GM-side socket relay in project-anime.mjs.
 */
export async function applyStatusTo(targetUuid, statusId, active = true) {
  const target = await fromUuid(targetUuid);
  if (target?.toggleStatusEffect) await target.toggleStatusEffect(statusId, { active });
}

/** Inflict a status on a target from a roll: directly if owned, else via the GM relay. */
async function applyStatusEffect(targetActor, statusId) {
  if (!targetActor || !statusId) return;
  if (targetActor.isOwner) await applyStatusTo(targetActor.uuid, statusId, true);
  else if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyStatus", targetUuid: targetActor.uuid, statusId, active: true });
  }
}

/** A Skill carrying the Decay Modifier marks the creature it lands on with the `decay` status
 *  (1 damage at the end of each of their next 3 turns; the count-down + damage live in the
 *  combat turn-tick in project-anime.mjs). No-op for non-Skills / Skills without the modifier. */
async function inflictDecay(item, targetActor, lines) {
  if (item?.type !== "skill" || !targetActor || !(item.system.modifiers ?? []).includes("decay")) return;
  await applyStatusEffect(targetActor, "decay");
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: i18n("PROJECTANIME.Status.decay"), name: targetActor.name })}</em>`);
}

/** Drain (Skill modifiers): the caster recovers half the damage this Skill dealt — HP for
 *  Drain HP, Energy for Drain Energy (rules p.13). `total` is the post-Defense/affinity damage
 *  dealt across every target (overkill counts; immune/absorbed hits contribute 0). Recovery is
 *  clamped to the caster's max by applyDamageTo, and routed through the owner/GM relay so it
 *  lands no matter who clicks Roll Damage. No-op for non-Skills, Skills without a drain modifier,
 *  or a 0-damage roll. Mutates `lines` with a chat note per drained pool. */
async function applyDrain(actor, item, total, lines) {
  if (item?.type !== "skill" || !(total > 0)) return;
  const mods = item.system.modifiers ?? [];
  const half = Math.floor(total / 2);
  if (half <= 0) return;
  if (mods.includes("drainHP")) {
    await routeApply(actor, actor.uuid, half, true, "hp");
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.drainsHP", { n: half })}</em>`);
  }
  if (mods.includes("drainEnergy")) {
    await routeApply(actor, actor.uuid, half, true, "energy");
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.drainsEnergy", { n: half })}</em>`);
  }
}

/* -------------------------------------------- */
/*  On-use Skill effect application             */
/* -------------------------------------------- */

/** Create an effect copy on a target actor. Exported for the GM-side socket relay. */
export async function applyEffectTo(targetUuid, effectData) {
  const target = await fromUuid(targetUuid);
  if (target?.documentName === "Actor" && effectData) {
    await target.createEmbeddedDocuments("ActiveEffect", [effectData]);
  }
}

/** Route an effect copy to a target: create it directly if owned, else relay to the active GM. */
async function routeEffectApply(target, effectData) {
  if (target.isOwner) { await applyEffectTo(target.uuid, effectData); return true; }
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyEffect", targetUuid: target.uuid, effectData });
    return true;
  }
  return false;
}

/**
 * Apply a (non-Strike / non-Mend) Skill's own Active Effects to its recipients on use. The
 * Action-Type gate (effects.mjs) keeps these dormant on an Action/React Skill; USING the Skill
 * grants a COPY — with its authored duration — to the targeted tokens' actors, or to the caster
 * if nothing is targeted. On the copy the recipient is "self", so the effect's rules apply to
 * them. (Target-scope conditions stay the on-hit rider handled by collectInflictedConditions.)
 * Owned recipients are updated directly; others go through the GM relay.
 * @param {Actor[]|null} recipients  Explicit recipients (area Skills), or null → targeted-else-self.
 * @returns {Promise<string[]>} chat-card lines naming who received which effect(s).
 */
async function applySkillEffects(actor, item, recipients = null) {
  // Passive Skills apply their effect always-on (the effects.mjs gate) — never as an on-use
  // copy, so clicking a Passive in the quick panel can't double up the buff.
  if (item.system?.actionType === "passive") return [];
  const enabled = (item.effects ?? []).filter((e) => !e.disabled && effectRules(e).length);
  if (!enabled.length) return [];
  let targets = recipients;
  if (!targets) {
    const targeted = [...(game.user?.targets ?? [])].map((t) => t.actor).filter(Boolean);
    targets = targeted.length ? targeted : [actor];
  }
  const seen = new Set();
  const lines = [];
  for (const ta of targets) {
    if (!ta || seen.has(ta.id)) continue;
    seen.add(ta.id);
    const names = [];
    for (const effect of enabled) {
      if (await routeEffectApply(ta, effectCopyData(effect))) names.push(effect.name);
    }
    if (names.length) {
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.effectApplied", { effect: names.join(", "), name: ta.name })}</em>`);
    }
  }
  return lines;
}

/**
 * Apply one amount to a target — locally if the clicker owns it, else relayed to the active
 * GM (players can't update GM-owned actors directly). Returns false only if there's no GM.
 */
async function routeApply(target, targetUuid, amount, heal, pool) {
  if (target.isOwner) { await applyDamageTo(targetUuid, amount, heal, pool); return true; }
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyDamage", targetUuid, amount, heal, pool });
    return true;
  }
  return false;
}

async function onApplyDamageButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const targetUuid = el.dataset.targetUuid;
  const target = await fromUuid(targetUuid);
  if (!target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.targetGone"));
  const amount = Number(el.dataset.amount) || 0;
  const heal = el.dataset.heal === "true";
  const pool = el.dataset.pool || "hp";

  if (!(await routeApply(target, targetUuid, amount, heal, pool))) {
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
  }
  ui.notifications.info(i18n("PROJECTANIME.Roll.applied", {
    n: amount, name: target.name, what: i18n(heal ? "PROJECTANIME.Roll.healing" : "PROJECTANIME.Roll.damage")
  }));
}

/** "Apply to All": apply each entry of the encoded {uuid, amount, heal, pool} list. */
async function onApplyAllButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  let list = [];
  try { list = JSON.parse(decodeURIComponent(el.dataset.applyAll || "")); } catch (_e) { list = []; }
  if (!Array.isArray(list) || !list.length) return;

  let applied = 0;
  let noGM = false;
  for (const t of list) {
    const target = await fromUuid(t.uuid);
    if (!target) continue;
    if (await routeApply(target, t.uuid, Number(t.amount) || 0, !!t.heal, t.pool || "hp")) applied++;
    else { noGM = true; break; }
  }
  if (noGM) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
  if (applied) ui.notifications.info(i18n("PROJECTANIME.Roll.appliedAll", { n: applied }));
}

/* -------------------------------------------- */
/*  Luck Dice                                   */
/* -------------------------------------------- */

/** Dialog: pick which die to replace and which stored Luck number to spend. */
async function promptLuck({ d1, d2, pool }) {
  const dieRow = (idx, val, other) =>
    `<label class="luck-pick"><input type="radio" name="die" value="${idx}" ${val <= other ? "checked" : ""}/> ${i18n("PROJECTANIME.Roll.die")} ${idx + 1}: <strong>${val}</strong></label>`;
  const luckOpts = pool
    .map((v, i) => ({ v, i }))
    .sort((x, y) => y.v - x.v)
    .map(({ v, i }) => `<option value="${i}">${v}</option>`)
    .join("");
  const content = `
    <div class="project-anime roll-dialog luck-dialog">
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.luckReplace")}</label>
        <div class="luck-dice">${dieRow(0, d1, d2)}${dieRow(1, d2, d1)}</div></div>
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.luckWith")}</label>
        <select name="luck">${luckOpts}</select></div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Roll.spendLuck") },
    content,
    buttons: [
      { action: "spend", label: i18n("PROJECTANIME.Roll.spendLuck"), icon: "fas fa-clover", default: true, callback: (e, b) => readForm(b.form) },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return { dieIndex: Number(result.die) || 0, luckPos: Number(result.luck) || 0 };
}

/**
 * "Spend Luck" button. The clicking user spends one of THEIR assigned character's
 * stored Luck numbers to replace a die on this card (their own roll, an ally's, or
 * an enemy's), recomputes the outcome, and posts a follow-up result card.
 */
async function onSpendLuckButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = game.user.character;
  if (!actor) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckNoActor"));
  const pool = actor.system.luckDice ?? [];
  if (!pool.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckNone"));

  const d1 = Number(el.dataset.d1) || 0;
  const d2 = Number(el.dataset.d2) || 0;
  const mod = Number(el.dataset.mod) || 0;
  const ct = el.dataset.ct === "" ? null : Number(el.dataset.ct);
  const evasion = el.dataset.evasion === "" ? null : Number(el.dataset.evasion);
  const kind = el.dataset.kind || "check";

  const choice = await promptLuck({ d1, d2, pool });
  if (!choice) return;
  const luckValue = pool[choice.luckPos];
  if (luckValue == null) return;

  const a = choice.dieIndex === 0 ? luckValue : d1;
  const b = choice.dieIndex === 1 ? luckValue : d2;
  const res = evalPair(a, b, mod, { ct, evasion });

  // Spend the chosen number (remove that single entry from the pool).
  const nextPool = pool.slice();
  nextPool.splice(choice.luckPos, 1);
  await actor.update({ "system.luckDice": nextPool });

  const attackish = kind === "attack" || kind === "skill";
  const badges = [];
  if (res.fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (res.combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
  else if (res.success === true) badges.push({ cls: "success", text: i18n(attackish ? "PROJECTANIME.Roll.hit" : "PROJECTANIME.Roll.success") });
  else if (res.success === false) badges.push({ cls: "failure", text: i18n(attackish ? "PROJECTANIME.Roll.miss" : "PROJECTANIME.Roll.failure") });

  const lines = [
    i18n("PROJECTANIME.Roll.luckSpent", { die: choice.dieIndex + 1, v: luckValue }),
    `<strong>${i18n("PROJECTANIME.Roll.total")}: ${res.total}</strong>`
  ];
  if (res.combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [];
  if (attackish && res.success !== false && el.dataset.itemId && el.dataset.actorUuid) {
    const tgt = el.dataset.targetUuid ? ` data-target-uuid="${el.dataset.targetUuid}"` : "";
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${el.dataset.actorUuid}" data-item-id="${el.dataset.itemId}"${tgt}`,
      label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
    });
  }

  return postCard(actor, cardHTML({
    title: i18n("PROJECTANIME.Roll.spendLuck"),
    subtitle: actor.name,
    badges,
    lines,
    buttons
  }), null, { combo: res.combo });
}

/**
 * "Spend Luck" on an area Strike. Substitutes a stored Luck number for one Accuracy die, then
 * RE-EVALUATES the single roll against every caught target's Evasion (a substitution can flip
 * misses to hits and vice-versa), and posts a follow-up card with the new per-target results +
 * an updated "Roll Damage" button for the new hit set.
 */
async function onSpendLuckAoeButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = game.user.character;
  if (!actor) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckNoActor"));
  const pool = actor.system.luckDice ?? [];
  if (!pool.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckNone"));

  let data;
  try { data = JSON.parse(decodeURIComponent(el.dataset.aoeLuck || "")); } catch (_e) { return; }
  const { d1 = 0, d2 = 0, mod = 0, targets = [], actorUuid = "", itemId = "" } = data || {};

  const choice = await promptLuck({ d1, d2, pool });
  if (!choice) return;
  const luckValue = pool[choice.luckPos];
  if (luckValue == null) return;

  const a = choice.dieIndex === 0 ? luckValue : d1;
  const b = choice.dieIndex === 1 ? luckValue : d2;
  const res = evalPair(a, b, mod);

  const nextPool = pool.slice();
  nextPool.splice(choice.luckPos, 1);
  await actor.update({ "system.luckDice": nextPool });

  const badges = [];
  if (res.fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (res.combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });

  const lines = [
    i18n("PROJECTANIME.Roll.luckSpent", { die: choice.dieIndex + 1, v: luckValue }),
    `<strong>${i18n("PROJECTANIME.Roll.total")}: ${res.total}</strong>`
  ];
  const hitUuids = [];
  for (const t of targets) {
    const didHit = res.combo || (!res.fumble && (t.ev == null || res.total >= t.ev));
    const evText = t.ev != null ? ` <span class="muted">(${i18n("PROJECTANIME.Stat.evasion")} ${t.ev})</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${t.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evText}</span>`);
    if (didHit) hitUuids.push(t.uuid);
  }
  if (res.combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [];
  if (hitUuids.length && itemId && actorUuid) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actorUuid}" data-item-id="${itemId}" data-target-uuids="${hitUuids.join(",")}"`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
  });

  return postCard(actor, cardHTML({
    title: i18n("PROJECTANIME.Roll.spendLuck"),
    subtitle: actor.name,
    badges,
    lines,
    buttons
  }), null, { combo: res.combo });
}
