import { PROJECTANIME, modifierValue, skillEffectKeys, skillDieSpecs, skillNeedsAccuracy } from "./config.mjs";
import { skillRulesHTML } from "./skill-description.mjs";
import { elementLabel } from "./elements.mjs";
import { collectRollModifiers, collectInflictedConditions, effectRules, effectCopyData, bolsterHinderRules, hasAuthoredAttributeEffect } from "./effects.mjs";
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
    // A shield set to "Just for Shields" is carried for defense, not wielded as a weapon, so it
    // doesn't make you a dual-wielder — your main-hand weapon keeps its full Damage die.
    if (it.type === "shield" && it.system.use !== "dual") continue;
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

/** The first targeted token (the placeable, so callers can read its disposition), else null. */
function firstTargetToken() {
  return [...(game.user?.targets ?? [])][0] ?? null;
}

/** The first targeted token's actor, if any. */
function firstTargetActor() {
  return firstTargetToken()?.actor ?? null;
}

/** True if two tokens are on opposing sides (one Friendly, one Hostile) — i.e. enemies. Forced
 *  movement (Move / Push / Pull) makes an Accuracy Check only against an enemy: you shove a foe
 *  (who resists with Evasion) but reposition yourself or a willing ally for free. Unknown / neutral
 *  dispositions (and self-targeting) read as "not an enemy", so movement on them is free. */
function tokensAreEnemies(aToken, bToken) {
  const D = CONST.TOKEN_DISPOSITIONS;
  const a = aToken?.document?.disposition;
  const b = bToken?.document?.disposition;
  if (a == null || b == null || aToken === bToken) return false;
  return (a === D.FRIENDLY && b === D.HOSTILE) || (a === D.HOSTILE && b === D.FRIENDLY);
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
function cardHTML({ title, subtitle = "", icon = "", meta = [], badges = [], rollHTML = "", description = "", lines = [], buttons = [], rows = [] }) {
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
  // Per-target damage rows (auto-applied, each with an undo arrow). Re-rendered from the message flag
  // on every draw — see onRenderChatMessage — so this initial fill is just the first paint / fallback.
  const rowsHTML = rows.length ? `<div class="dmg-rows">${damageRowsHTML(rows)}</div>` : "";
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
    ${rowsHTML}
    ${descHTML}
    ${lineHTML}
    ${btnHTML}
  </div>`;
}

/**
 * The card body for an item. Non-Skills → just the enriched flavor description (unchanged). Skills
 * → the player's rules OVERRIDE if set, else the auto-written colored rules summary, with the typed
 * flavor description shown beneath it. (Single chokepoint — every skill card site calls this.)
 */
async function enrichDescription(item) {
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  const enrich = (raw) => (raw && String(raw).trim())
    ? TE.enrichHTML(String(raw), { secrets: false, rollData: item.getRollData?.() ?? {} })
    : "";
  const flavor = await enrich(item?.system?.description);
  if (item?.type !== "skill") return flavor;
  const override = (item.system?.rulesOverride ?? "").trim();
  const rules = override ? await enrich(item.system.rulesOverride) : skillRulesHTML(item);
  if (!rules) return flavor;
  return flavor ? `${rules}<div class="skill-card-flavor">${flavor}</div>` : rules;
}

/** Compact stat chips for a Skill card: rank stars · effect type(s) · Energy cost. */
function skillMeta(sys) {
  const rank = PROJECTANIME.skillRanks[sys.rank] ?? {};
  const chips = [];
  if (rank.stars) chips.push(`<span class="meta-stars">${rank.stars}</span>`);
  // Effect(s): a Skill carrying the "Secondary Effect" Modifier shows both, joined with " + ".
  const effectLabel = skillEffectKeys(sys).map((k) => i18n(PROJECTANIME.skillEffects[k] ?? "")).filter(Boolean).join(" + ");
  if (effectLabel) chips.push(effectLabel);
  if (sys.actionType !== "passive" && Number(sys.energyCost) > 0) {
    chips.push(`<i class="fas fa-bolt"></i> ${sys.energyCost}`);
  }
  return chips;
}

async function postCard(actor, content, rolls, { combo = false, flags = null } = {}) {
  const arr = Array.isArray(rolls) ? rolls.filter(Boolean) : (rolls ? [rolls] : []);
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: arr,
    sound: arr.length ? CONFIG.sounds.dice : undefined
  };
  // Project-anime flags ride along on the (broadcast) card. A scored Combo → every client's
  // createChatMessage hook flashes the Combo Splash (carries the roller's name + portrait). A
  // damageCard → the per-target rows + undo state (see onRenderChatMessage / onUndoDamageButton).
  const pa = {};
  if (combo) pa.combo = { name: actor?.name ?? "", img: actor?.img ?? "" };
  if (flags?.["project-anime"]) Object.assign(pa, flags["project-anime"]);
  if (Object.keys(pa).length) data.flags = { "project-anime": pa };
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

/** A "Weapon"-range Skill borrows the equipped weapon's accuracy & damage. Returns that weapon
 *  (main-hand preferred, else any equipped weapon), or null when the Skill isn't Weapon-ranged or
 *  nothing is equipped (in which case it falls back to the Skill's own Attributes). */
function skillWeapon(actor, item) {
  if (item?.type !== "skill" || item.system?.range?.scope !== "weapon") return null;
  const weapons = (actor?.items ?? []).filter((i) => i.type === "weapon" && i.system?.equipped);
  return weapons.find((w) => w.system.hand === "main") ?? weapons[0] ?? null;
}

/** The accuracy Attributes + flat mod a Skill's Check uses: a Weapon-range Skill borrows the
 *  equipped weapon's accuracy; otherwise the Skill's own two Attributes (Skills carry no flat
 *  accuracy mod — their bonus comes from Sharpen). */
function skillAccuracy(actor, item) {
  const weapon = skillWeapon(actor, item);
  if (weapon) {
    const a = weapon.system.accuracy ?? {};
    return { attrA: a.attrA ?? "might", attrB: a.attrB ?? "agility", mod: Number(a.mod) || 0 };
  }
  const at = item.system?.attributes ?? {};
  return { attrA: at.attrA ?? "might", attrB: at.attrB ?? "spirit", mod: 0 };
}

/**
 * Roll the (target-independent) damage/heal amount for a weapon or skill once. Shared by
 * the single-target, area, and chain damage paths — they each apply this raw to their targets.
 * @returns {Promise<{roll, raw, dtype, dieAttr, isSkill, heal, pool, pierces, ignoresDefense, dmgReasons, rmods}>}
 */
async function computeDamageRoll(actor, item, { target = null, charged = false, spec = null } = {}) {
  const isSkill = item.type === "skill";
  // A secondary Effect's "Roll Damage/Healing" button carries its own slot spec (which Effect,
  // attribute die, pool, damage type); the primary button — and every weapon attack — passes
  // none and reads the item's base fields, so existing behaviour is unchanged.
  const effect = spec?.effect ?? item.system?.effect;
  const slotAttr = spec?.damageAttr ?? item.system?.damageAttr;
  const slotPool = spec?.damagePool ?? item.system?.damagePool;
  const slotType = spec?.damageType ?? item.system?.damageType;
  const heal = isSkill && effect === "mend";
  // A Weapon-range Skill borrows the equipped weapon's accuracy Attributes & damage (mod, type,
  // die, grip rules); the Skill's own pool / Pierce / charge still layer on below. `weapon` is
  // null for ordinary Skills (and for weapons themselves), so they keep their existing behavior.
  const weapon = skillWeapon(actor, item);
  const usesWeapon = !!weapon || !isSkill;   // compute damage the weapon way
  const src = weapon ?? item;

  let attrA, attrB, mod, dtype;
  if (usesWeapon) {
    attrA = src.system.accuracy?.attrA ?? "might";
    attrB = src.system.accuracy?.attrB ?? "agility";
    mod = Number(src.system.damage?.mod) || 0;
    dtype = src.system.damage?.type || "physical";
  } else {
    attrA = item.system.attributes?.attrA ?? "might";
    attrB = item.system.attributes?.attrB ?? "spirit";
    mod = 0;
    dtype = slotType || "physical";
  }

  // Weapons (and Weapon-range Skills) roll the larger of the two Attributes; other Skills roll the
  // designer-CHOSEN Attribute die (rules: "choose one of its two Attributes").
  const dieAttr = usesWeapon
    ? largerAttr(actor, attrA, attrB)
    : (item.system.attributes?.[slotAttr] ?? attrA);
  // Weapon/shield grip rules (p.9-10): a two-handed grip Steps the Damage die UP one size (or +1
  // damage if already d12); dual wielding Steps both dice DOWN one. A shield set to "Just for
  // Shields" isn't a committed weapon, so bashing with it Steps its OWN Damage die DOWN (and it
  // doesn't make you a dual-wielder — handled in isDualWielding). Applies to borrowed weapons too.
  let dieSize = attrValue(actor, dieAttr);
  const dmgReasons = [];
  if (usesWeapon && !heal) {
    const shieldOnly = src.type === "shield" && src.system.use !== "dual";
    if (src.system.grip === "two") {
      const up = stepUpValue(dieSize);
      if (up === dieSize) mod += 1; else dieSize = up;
      dmgReasons.push("twoHanded");
    } else if (shieldOnly) {
      dieSize = stepDownValue(dieSize);
      dmgReasons.push("shieldOnly");
    } else if (isDualWielding(actor)) {
      dieSize = stepDownValue(dieSize);
      dmgReasons.push("dualWield");
    }
  }

  // Pierce (a Skill modifier) and Energy damage both bypass Defense: per the rules,
  // Defense reduces only Hit Point damage, so damage dealt to the Energy pool ignores
  // it. ("Energy damage" = damage to the Energy stat — NOT an element/damage type.)
  const isStrike = isSkill && effect === "strike";
  const pool = (isStrike && slotPool === "energy") ? "energy" : "hp";
  const pierces = isSkill && (item.system.modifiers ?? []).includes("pierce");
  const ignoresDefense = pierces || pool === "energy";

  const rmods = collectRollModifiers(actor, "damage", { target });
  mod += rmods.flat;
  // "Sharpen Damage" / "Sharpen Healing" advancement: a flat bonus (0–3) baked into a Skill's
  // rolled output — Strike damage or Mend healing (the same field, named for the Effect).
  const sharpen = isSkill ? Math.max(0, Number(item.system.damageMod) || 0) : 0;
  mod += sharpen;
  let f = `1d${dieSize}`;
  if (mod) f += `${mod > 0 ? " + " : " - "}${Math.abs(mod)}`;
  const roll = new Roll(f);
  await roll.evaluate();
  // Charge (a Skill modifier): a charged release resolves at double damage/healing (rules p.13).
  const raw = Math.max(roll.total, 0) * (charged ? 2 : 1);

  return { roll, raw, dtype, dieAttr, isSkill, heal, pool, pierces, ignoresDefense, dmgReasons, rmods, charged, sharpen };
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

/* -------------------------------------------- */
/*  Damage card rows (auto-applied + undo)      */
/* -------------------------------------------- */

/** One creature's row on a damage card: portrait, name, a signed HP/EN amount, the calculation that
 *  produced it (so the maths is visible inline), and a small undo arrow that reverses just this
 *  creature's hit. Once reverted the row is struck through with an "undone" tag (no arrow to
 *  re-click). The arrow's `data-row` indexes back into the message's damageCard flag — the source of
 *  truth, re-rendered on every draw so the undone state is consistent for everyone. */
function damageAppliedRow(row, i) {
  const energy = row.pool === "energy";
  const unit = energy ? "EN" : "HP";
  const cls = row.heal ? "heal" : (energy ? "energy" : "dmg");
  const sign = row.heal ? "+" : "−";
  const portrait = row.img
    ? `<img class="dmg-portrait" src="${row.img}" alt="" />`
    : `<span class="dmg-portrait"><i class="fas fa-user"></i></span>`;
  const calc = row.calc ? `<div class="dmg-calc">${row.calc}</div>` : "";
  const action = row.undone
    ? `<span class="dmg-undone"><i class="fas fa-check"></i> ${i18n("PROJECTANIME.Roll.undone")}</span>`
    : `<button type="button" class="dmg-undo" data-action="undoDamage" data-row="${i}" data-tooltip="${i18n("PROJECTANIME.Roll.undo")}"><i class="fas fa-rotate-left"></i></button>`;
  return `<div class="dmg-row${row.undone ? " is-undone" : ""}">
    ${portrait}
    <div class="dmg-body">
      <div class="dmg-head"><span class="dmg-name">${row.name}</span><span class="dmg-amount ${cls}">${sign}${row.amount} ${unit}</span></div>
      ${calc}
    </div>
    ${action}
  </div>`;
}

/** Render the rows block of a damage card from its stored rows (used at post time and re-injected on
 *  every render so the undo state always reflects the flag). */
function damageRowsHTML(rows) {
  return rows.map((row, i) => damageAppliedRow(row, i)).join("");
}

/**
 * Roll a weapon's / skill's damage (or healing), reduced by the target's Defense.
 * With `targetUuids` (carried by an area Skill's "Roll Damage" button) it rolls once and
 * applies that raw to every listed target; otherwise it resolves the single primary target.
 */
export async function rollDamage(actor, item, { targetUuids = null, charged = false, spec = null } = {}) {
  let targets = [];
  if (targetUuids?.length) {
    targets = (await Promise.all(targetUuids.map((u) => fromUuid(u)))).filter(Boolean);
  } else {
    const t = firstTargetActor();
    if (t) targets = [t];
  }
  if (targets.length > 1) return postAoeDamageCard(actor, item, targets, { charged, spec });

  // Single-target (or no target).
  const targetActor = targets[0] ?? null;
  const dmg = await computeDamageRoll(actor, item, { target: targetActor, charged, spec });
  const adj = adjustForTarget(dmg.raw, dmg.dtype, targetActor, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal });

  const badges = [...adj.badges];
  const notes = damageNotes(dmg);
  // Apply the damage/healing immediately and record an undo row carrying the calculation. With no
  // target (or a no-op hit) there's nothing to apply — fall back to showing the rolled figure.
  const rows = [];
  if (targetActor && (adj.amount > 0 || adj.heal)) {
    const pool = adj.heal ? "hp" : dmg.pool;
    await routeApply(targetActor, targetActor.uuid, adj.amount, adj.heal, pool);
    rows.push({ uuid: targetActor.uuid, name: targetActor.name, img: targetActor.img, amount: adj.amount, heal: adj.heal, pool, calc: adj.line, undone: false });
  }
  // Drain HP/Energy: the caster recovers half the damage actually dealt to the target.
  await applyDrain(actor, item, targetActor && !adj.heal ? adj.amount : 0, notes);
  const lines = rows.length ? notes : [adj.line, ...notes];

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: dmg.heal ? i18n("PROJECTANIME.Roll.healing") : i18n("PROJECTANIME.Roll.damage"),
    icon: item.img,
    badges,
    rollHTML: await dmg.roll.render(),
    rows,
    lines
  }), dmg.roll, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
  return dmg.roll;
}

/** The shared "die used / two-handed / pierce / energy / effect-mods" damage notes. */
function damageNotes(dmg) {
  const lines = [];
  if (dmg.charged) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.charged")}</em>`);
  if (dmg.sharpen) lines.push(`<em class="muted">${i18n(dmg.heal ? "PROJECTANIME.Roll.sharpenedHealing" : "PROJECTANIME.Roll.sharpenedDamage", { n: dmg.sharpen })}</em>`);
  if (dmg.isSkill) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.dieUsed", { attr: i18n(PROJECTANIME.attributes[dmg.dieAttr] ?? dmg.dieAttr) })}</em>`);
  if (dmg.dmgReasons.includes("twoHanded")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.twoHanded")}</em>`);
  if (dmg.dmgReasons.includes("shieldOnly")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.shieldOnly")}</em>`);
  if (dmg.dmgReasons.includes("dualWield")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.dualWield")}</em>`);
  if (dmg.pierces) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.pierce")}</em>`);
  if (dmg.pool === "energy") lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.energyDamage")}</em>`);
  const modLine = rollModLine(dmg.rmods); if (modLine) lines.push(modLine);
  return lines;
}

/** Multi-target damage card: one roll, applied per target (each with its own affinity/Defense). */
async function postAoeDamageCard(actor, item, targetActors, { charged = false, spec = null } = {}) {
  const dmg = await computeDamageRoll(actor, item, { target: targetActors[0], charged, spec });
  const lines = [`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetActors.length })}</em>`];
  const rows = [];
  let drainTotal = 0;
  for (const ta of targetActors) {
    const adj = adjustForTarget(dmg.raw, dmg.dtype, ta, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal });
    if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation.
      const pool = adj.heal ? "hp" : dmg.pool;
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: adj.amount, heal: adj.heal, pool, calc: adj.line, undone: false });
    } else {
      // Nothing dealt (e.g. immune) — note it, but there's nothing to apply or undo.
      lines.push(`<span class="card-target-row"><strong>${ta.name}</strong> <span class="muted">${adj.line}</span></span>`);
    }
    if (!adj.heal) drainTotal += adj.amount;
  }
  lines.push(...damageNotes(dmg));
  // Drain HP/Energy: the caster recovers half the total damage the area Skill dealt.
  await applyDrain(actor, item, drainTotal, lines);

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: dmg.heal ? i18n("PROJECTANIME.Roll.healing") : i18n("PROJECTANIME.Roll.damage"),
    icon: item.img,
    rollHTML: await dmg.roll.render(),
    rows,
    lines
  }), dmg.roll, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
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

  // 1) Acquire targets (interactive for area Skills) BEFORE spending Energy / clearing the charge.
  let areaTokens = null;     // Token[] for burst/line/mass; null = single-target path
  let chainTokens = null;    // ordered player-chosen Tokens for chain (first = primary)
  if (kind === "chain") {
    const ctoken = casterToken(actor);
    if (!ctoken) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken"));
    // The chain only travels through the creatures the player TARGETED (never the caster), so it
    // can't bounce back onto the user or an unintended bystander.
    chainTokens = [...(game.user?.targets ?? [])].filter((t) => t?.actor && t !== ctoken);
    if (!chainTokens.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
  } else if (kind) {
    areaTokens = await acquireAreaTargets(actor, item, kind);
    if (areaTokens === null) return null;   // cancelled — no Energy spent / charge kept
  }

  // 2) Spend Energy (rank×2; Passive = free). A charge release already paid on the focus turn,
  // so releasing is free — but it consumes the charge whether the follow-up hits or misses.
  if (releasingCharge) await actor.unsetFlag("project-anime", "charge");
  else if (!(await spendSkillEnergy(actor, sys))) return null;

  // 3) Resolve (a charged release doubles damage/healing).
  if (chainTokens) return resolveChain(actor, item, chainTokens, { charged: releasingCharge });
  if (kind) {
    setUserTargets(areaTokens);
    // Route the area: an offensive area (Mass Strike / Hinder) — or forced movement (Move / Push /
    // Pull) that caught a hostile creature — rolls Accuracy per caught creature; a supportive area
    // (Mass Mend / Bolster) affects everyone with no roll.
    const ctok = casterToken(actor);
    const enemyInArea = areaTokens.some((t) => tokensAreEnemies(ctok, t));
    return skillNeedsAccuracy(sys, { enemyTarget: enemyInArea })
      ? resolveAreaStrike(actor, item, areaTokens, { charged: releasingCharge })
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
  const effects = skillEffectKeys(sys);
  const hasStrike = effects.includes("strike");
  const hasOther = effects.some((e) => e !== "strike" && e !== "mend");
  const targetToken = firstTargetToken();
  const targetActor = targetToken?.actor ?? null;
  const evasion = targetActor?.system?.evasion?.value ?? null;
  // An Accuracy Check (vs Evasion) is made ONLY when the Skill targets an enemy — a Strike or Hinder
  // (always), an inflict/decay Modifier (always), or forced movement (Move / Push / Pull) aimed at a
  // HOSTILE target. Self/ally Skills (Bolster, Mend, Sustain…) and friendly repositioning just take
  // effect — you can't "evade" a heal, a buff, or a willing shove. One shared Check covers every Effect.
  const needsAccuracy = skillNeedsAccuracy(sys, { enemyTarget: tokensAreEnemies(casterToken(actor), targetToken) });

  const lines = [];
  const badges = [];
  let roll = null, r1 = null, r2 = null, fumble = false, combo = false, hit = null;

  if (needsAccuracy) {
    const { attrA, attrB, mod: accMod } = skillAccuracy(actor, item);
    const rmods = collectRollModifiers(actor, hasStrike ? "attack" : "check", { target: targetActor });
    // "Sharpen Accuracy" advancement: a flat bonus baked into the Skill's Check.
    const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
    const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
    roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod));
    await roll.evaluate();
    [r1, r2] = dieResults(roll);
    fumble = r1 === 1 && r2 === 1;
    combo = r1 === r2 && r1 >= 6;
    if (fumble) { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") }); hit = false; }
    else if (combo) { badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") }); hit = true; }
    else if (evasion != null) hit = roll.total >= evasion;
    if (hit === true && !combo) badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
    else if (hit === false && !fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });

    lines.push(...stepNotes(reasons));
    const skillModLine = rollModLine(rmods); if (skillModLine) lines.push(skillModLine);
    if (accBonus) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.sharpened", { n: accBonus })}</em>`);
    if (evasion != null) lines.push(`${i18n("PROJECTANIME.Roll.vsEvasion")} <strong>${targetActor.name}</strong>: ${evasion}`);
    if (combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);
  }

  // The Skill "lands" if it makes no Accuracy Check, or its Check didn't explicitly miss.
  const landed = !needsAccuracy || hit !== false;
  // Charged release: note the double power when it lands, or that the charge dissipated on a miss.
  if (charged) lines.push(`<em class="muted">${i18n(landed ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  // On-hit (enemy) riders land only when the Skill landed: inflicted conditions + Decay.
  if (landed) await applyOnHitConditions(item, targetActor, lines);

  // A Skill applies its Active Effect(s) whenever it carries any non-die Effect (Bolster / Hinder /
  // Affinity / Sustain / Move / Sense) in EITHER slot — to the targeted tokens, or the caster if
  // none are targeted. Supportive effects always apply; an auto-Hinder lands only on a hit (`landed`).
  if (hasOther) lines.push(...(await applySkillEffects(actor, item, null, { landed })));
  // Reflect (Skill Modifier): ward the targeted creature(s) — or the caster if none targeted —
  // with the Reflect status. A removable marker; the next attack against a warded creature
  // rebounds on its attacker, then the Reflect shatters (GM-adjudicated). Applied on use.
  lines.push(...(await applyReflectMark(actor, item)));

  const buttons = [];
  // Spend Luck re-rolls the Accuracy Check — offered for ANY enemy-targeting Skill (Strike, Hinder,
  // forced movement), not just damage. The follow-up card re-evaluates the hit and applies what lands.
  if (needsAccuracy) buttons.push(luckButton({ d1: r1, d2: r2, mod: 0, evasion, kind: "skill", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" }));
  // Die-Effect follow-ups: a Strike offers Roll Damage (only on a landed hit — you missed, no
  // damage); a Mend offers Roll Healing regardless (self/ally healing isn't gated by an Accuracy
  // Check). The secondary slot stamps its own Effect/attr/pool/type so its roll uses that slot's
  // values; the primary slot needs no override (computeDamageRoll reads the Skill's base fields).
  const tgt = targetActor ? ` data-target-uuid="${targetActor.uuid}"` : "";
  const chg = charged ? ` data-charged="true"` : "";
  for (const ds of skillDieSpecs(sys)) {
    const heal = ds.effect === "mend";
    if (!heal && !landed) continue;
    const sp = ds.primary ? ""
      : ` data-effect="${ds.effect}" data-damage-attr="${ds.damageAttr}" data-damage-pool="${ds.damagePool ?? ""}" data-damage-type="${ds.damageType ?? ""}"`;
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}${chg}${sp}`,
      label: `<i class="fas fa-${heal ? "heart" : "burst"}"></i> ${i18n(heal ? "PROJECTANIME.Roll.rollHealing" : "PROJECTANIME.Roll.rollDamage")}`
    });
  }

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(sys),
    badges,
    rollHTML: roll ? await roll.render() : "",
    description: await enrichDescription(item),
    lines,
    buttons
  }), roll, { combo });
  return roll;
}

/**
 * Area attack (Burst / Line / Mass) — any area Skill that targets enemies (a Strike, or a Hinder /
 * debuff): roll the Accuracy Check ONCE, then compare that total against each caught creature's own
 * Evasion (Combo hits all, Fumble misses all). Hit targets are inflicted with any on-hit conditions,
 * receive the Skill's Active Effect(s), and — for a Strike — flow into the "Roll Damage" button.
 */
async function resolveAreaStrike(actor, item, targetTokens, { charged = false } = {}) {
  const sys = item.system;
  const { attrA, attrB, mod: accMod } = skillAccuracy(actor, item);
  // A Strike rolls damage; a non-Strike area attack (e.g. Mass Hinder) lands its Effect on the
  // creatures it hit but offers no damage roll.
  const hasStrike = skillEffectKeys(sys).includes("strike");
  const primary = targetTokens[0]?.actor ?? null;

  const rmods = collectRollModifiers(actor, "attack", { target: primary });
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod));
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
  const hitActors = [];
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
      hitActors.push(ta);
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

  // A secondary non-die Effect (e.g. an area Strike that also Bolsters) grants its Active Effect(s)
  // to the creatures it hit. (A secondary damage/heal ROLL on an area Skill resolves single-target only.)
  if (skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend") && hitActors.length) {
    lines.push(...(await applySkillEffects(actor, item, hitActors)));
  }

  const buttons = [];
  // Spend Luck re-evaluates the single Accuracy roll against every caught target's Evasion — offered
  // for ANY area attack (Strike or Mass Hinder); the follow-up applies what newly landed and, for a
  // Strike, re-offers Roll Damage.
  if (luckTargets.length) buttons.push(aoeLuckButton({
    d1: r1, d2: r2, mod: rmods.flat + accBonus, targets: luckTargets, actorUuid: actor.uuid, itemId: item.id
  }));
  if (hasStrike && hitUuids.length) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}" data-target-uuids="${hitUuids.join(",")}"${charged ? ' data-charged="true"' : ''}`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
  });

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n(hasStrike ? "PROJECTANIME.Roll.attack" : "PROJECTANIME.Roll.skill"),
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

  // Any non-die Effect (Mass Bolster / Hinder / Affinity …) — including a secondary one riding a
  // Mass Mend — grants the Skill's Active Effect(s) to every caught creature. (Mend's own mechanic
  // is the healing button below.)
  if (skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend")) {
    lines.push(...(await applySkillEffects(actor, item, targetTokens.map((t) => t.actor).filter(Boolean))));
  }

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
 * Chain: hit the primary (the player's first target), then leap to the nearest unhit token within
 * Near that the player ALSO targeted — so the chain only travels through chosen creatures, never
 * the caster. Each leap deals half the previous damage; the chain stops the moment a leap misses
 * (rules: "must hit each target before the leap can continue"). One combined attack+damage card.
 */
async function resolveChain(actor, item, chainTokens, { charged = false } = {}) {
  const sys = item.system;
  const { attrA, attrB, mod: accMod } = skillAccuracy(actor, item);
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const nearTiles = PROJECTANIME.rangeTiles[PROJECTANIME.chainRangeScope] ?? 5;
  const maxTargets = modifierValue(item, "chain") + 1;   // primary + N leaps
  const chosen = new Set(chainTokens);   // the chain may only travel through targeted creatures
  const primaryToken = chainTokens[0];

  // One damage roll (doubled on a charged release); each successive hit deals half the previous.
  const dmg = await computeDamageRoll(actor, item, { target: primaryToken.actor, charged });

  const lines = [];
  const rows = [];
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
    const aroll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod));
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
    for (const c of collectInflictedConditions(item, ta)) {
      await applyStatusEffect(ta, c.id);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: ta.name })}</em>`);
    }
    await inflictDecay(item, ta, lines);
    if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation.
      const pool = adj.heal ? "hp" : dmg.pool;
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: adj.amount, heal: adj.heal, pool, calc: adj.line, undone: false });
    } else {
      lines.push(`<span class="card-target-row"><span class="muted">${adj.line}</span></span>`);
    }
    if (!adj.heal) drainTotal += adj.amount;
    prevRaw = raw;
    current = tokensInRange(current, nearTiles).find((t) => chosen.has(t) && !hitSet.has(t)) ?? null;
  }

  if (stoppedName) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chainStopped", { name: stoppedName })}</em>`);
  lines.push(...damageNotes(dmg));
  // Drain HP/Energy: the caster recovers half the total damage dealt across the chain.
  await applyDrain(actor, item, drainTotal, lines);

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img, meta: skillMeta(sys),
    rollHTML: await dmg.roll.render(),
    description: await enrichDescription(item), rows, lines
  }), rolls, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
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

/**
 * Use a consumable: apply its HP/Energy restore (if any), spend one, and post a "Used" card.
 * A used-up consumable just leaves the inventory — when the last one is spent the item is
 * deleted outright, so no quantity-0 ghost lingers in the bags.
 */
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

  const remaining = Math.max(0, qty - 1);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.remaining", { n: remaining })}</em>`);

  // Capture the card bits before the item may be deleted (its in-memory data survives a delete,
  // but enrich the description while the document is unquestionably live).
  const card = {
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.used"),
    icon: item.img,
    description: await enrichDescription(item),
    lines
  };

  // Spend one; when the stack runs out the consumable just leaves the inventory.
  if (remaining > 0) await item.update({ "system.quantity": remaining });
  else await item.delete();

  return postCard(actor, cardHTML(card));
}

/**
 * Post a consumable to chat as an actionable card — its identity + description and a preview of
 * what it restores — carrying a ▶ Use button that consumes it (see useConsumable). Posting never
 * consumes: this is what a consumable's roll() / "Post to Chat" does, so the player decides when to
 * actually drink it from the card (or one-click via the sheet's context-menu "Use").
 */
export async function postConsumableCard(actor, item) {
  const sys = item.system ?? {};
  const qty = Number(sys.quantity ?? 0) || 0;
  const type = sys.restoreType ?? "none";
  const amount = Number(sys.restoreAmount ?? 0) || 0;
  const lines = [];
  if ((type === "hp" || type === "energy") && amount > 0) {
    lines.push(`<strong>+${amount}</strong> ${i18n(`PROJECTANIME.Stat.${type}`)}`);
  }
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.remaining", { n: qty })}</em>`);

  // Out of stock → no button (nothing to use); the card still posts as a record.
  const buttons = qty > 0 ? [{
    data: `data-action="useConsumable" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"`,
    label: `<i class="fas fa-play"></i> ${i18n("PROJECTANIME.Action.use")}`
  }] : [];

  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("TYPES.Item.consumable"),
    icon: item.img,
    description: await enrichDescription(item),
    lines,
    buttons
  }));
}

/* -------------------------------------------- */
/*  Chat-card button wiring                     */
/* -------------------------------------------- */

/** Bind interactive buttons on rendered chat cards. Registered on renderChatMessageHTML. */
export function onRenderChatMessage(message, html) {
  // A damage card draws its per-target rows from its stored flag (the source of truth for the undo
  // state), so re-render them here on every draw — this keeps the struck-through "undone" state
  // consistent for everyone and after a reload, regardless of the baked-in initial content.
  const card = message?.flags?.["project-anime"]?.damageCard;
  if (card?.rows?.length) {
    const container = html.querySelector(".dmg-rows");
    if (container) container.innerHTML = damageRowsHTML(card.rows);
  }
  // Assign via `.onclick` (not addEventListener) so re-rendering the same card
  // can't stack duplicate handlers — a stacked button would fire twice.
  html.querySelectorAll("[data-action='rollDamage']").forEach((btn) => { btn.onclick = onRollDamageButton; });
  // Undo arrows need the message (to read the stored rows + persist the undone state), so close over it.
  html.querySelectorAll("[data-action='undoDamage']").forEach((btn) => { btn.onclick = (e) => onUndoDamageButton(e, message); });
  html.querySelectorAll("[data-action='releaseCharge']").forEach((btn) => { btn.onclick = onReleaseChargeButton; });
  html.querySelectorAll("[data-action='useConsumable']").forEach((btn) => { btn.onclick = onUseConsumableButton; });
  html.querySelectorAll("[data-action='spendLuck']").forEach((btn) => { btn.onclick = onSpendLuckButton; });
  html.querySelectorAll("[data-action='spendLuckAoe']").forEach((btn) => { btn.onclick = onSpendLuckAoeButton; });
}

/* -------------------------------------------- */
/*  Ad-hoc effect from a chat card              */
/* -------------------------------------------- */

/** Pull the display bits out of a Project: Anime chat card's rendered content — the title, icon,
 *  and description shown on the card. Returns null for any non-card message, so the context-menu
 *  option only appears on our cards. */
function parseCardData(message) {
  if (!message?.content) return null;
  const div = document.createElement("div");
  div.innerHTML = message.content;
  const card = div.querySelector(".project-anime.chat-card");
  if (!card) return null;
  const name = card.querySelector(".card-title")?.textContent?.trim()
    || message.alias || i18n("PROJECTANIME.Effect.newEffect");
  const img = card.querySelector(".card-icon")?.getAttribute("src") || "icons/svg/aura.svg";
  const description = card.querySelector(".card-desc")?.innerHTML?.trim() || "";
  return { name, img, description };
}

/** Turn a chat card into a tracked ad-hoc Active Effect — its icon + description — on the selected
 *  creature(s): a manual reminder for things the rules engine can't fully automate (PF2e-style). It
 *  carries no rules; it just shows up (icon + description) in the Effects panel / sheet so you
 *  remember it's applied. Targets the controlled token(s), else the assigned character; unowned
 *  targets route through the GM relay. */
async function applyEffectFromCard(message) {
  const data = parseCardData(message);
  if (!data) return;
  const actors = (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);
  if (!actors.length && game.user?.character) actors.push(game.user.character);
  if (!actors.length) return ui.notifications.warn(i18n("PROJECTANIME.Effect.applyNoTarget"));

  const effectData = {
    name: data.name,
    img: data.img,
    description: data.description,
    flags: { "project-anime": { adhoc: true, fromCard: message.uuid } }
  };
  let applied = 0;
  const seen = new Set();
  for (const actor of actors) {
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    if (await routeEffectApply(actor, effectData)) applied++;
  }
  if (applied) ui.notifications.info(i18n("PROJECTANIME.Effect.appliedFromCard", { name: data.name, n: applied }));
}

/** Chat context-menu entry (V13 `getChatMessageContextOptions`): "Apply as Effect", shown only on
 *  Project: Anime cards. `li` is the message's DOM element (`li.dataset.messageId`). */
export function cardEffectMenuOption() {
  return {
    name: "PROJECTANIME.Effect.applyFromCard",
    icon: '<i class="fas fa-wand-magic-sparkles"></i>',
    condition: (li) => !!parseCardData(game.messages.get(li?.dataset?.messageId)),
    callback: (li) => applyEffectFromCard(game.messages.get(li?.dataset?.messageId))
  };
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
  // A secondary-Effect button carries its slot's Effect/attr/pool/type; the primary button doesn't.
  const spec = el.dataset.effect
    ? { effect: el.dataset.effect, damageAttr: el.dataset.damageAttr, damagePool: el.dataset.damagePool, damageType: el.dataset.damageType }
    : null;
  return rollDamage(actor, item, { targetUuids, charged: el.dataset.charged === "true", spec });
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

/** ▶ Use button on a consumable's chat card — consume one (restore + leave inventory). */
async function onUseConsumableButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  const item = actor?.items.get(el.dataset.itemId);
  if (!item) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  return useConsumable(actor, item);
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

/** Apply a Skill's on-hit conditions (target-scope) + Decay to a struck target. Mutates `lines`.
 *  No-op without a target. Idempotent (status toggles), so safe to re-run on a Luck flip-to-hit. */
async function applyOnHitConditions(item, targetActor, lines) {
  if (!targetActor) return;
  for (const c of collectInflictedConditions(item, targetActor)) {
    await applyStatusEffect(targetActor, c.id);
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: c.label, name: targetActor.name })}</em>`);
  }
  await inflictDecay(item, targetActor, lines);
}

/** The full on-hit (enemy) payload of a Skill landing on one target: inflicted conditions, Decay,
 *  and the Skill's Active Effect(s) (auto-Hinder + authored / Bolster). Idempotent — auto-effects
 *  refresh by `autoKey` and status toggles no-op if already set — so Spend Luck can call it when a
 *  re-roll turns a miss into a hit without double-applying. Returns chat-card lines. */
async function applySkillOnHit(actor, item, targetActor) {
  const lines = [];
  await applyOnHitConditions(item, targetActor, lines);
  if (skillEffectKeys(item.system).some((e) => e !== "strike" && e !== "mend")) {
    lines.push(...(await applySkillEffects(actor, item, targetActor ? [targetActor] : null, { landed: true })));
  }
  return lines;
}

/** A Skill carrying the Reflect Modifier wards its recipients (the targeted tokens, else the
 *  caster) with the `reflect` status — a removable marker meaning the next attack against that
 *  creature rebounds on its attacker (the Reflect then shatters; GM-adjudicated). Mirrors
 *  applySkillEffects' targeted-else-self recipients. No-op for non-Skills / Skills without it.
 *  @returns {Promise<string[]>} chat-card lines naming who was warded. */
async function applyReflectMark(actor, item, recipients = null) {
  if (item?.type !== "skill" || !(item.system.modifiers ?? []).includes("reflect")) return [];
  const targets = skillEffectTargets(actor, item, recipients);
  const lines = [];
  const seen = new Set();
  for (const ta of targets) {
    if (!ta || seen.has(ta.id)) continue;
    seen.add(ta.id);
    await applyStatusEffect(ta, "reflect");
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.reflectWard", { name: ta.name })}</em>`);
  }
  return lines;
}

/** The actors a Skill's on-use effects land on: an explicit list (area Skills), else — for a
 *  Self-range Skill — always the caster (even if a creature is targeted), else the targeted
 *  creatures, else the caster. */
function skillEffectTargets(actor, item, recipients = null) {
  if (recipients) return recipients;
  if (item?.system?.range?.scope === "self") return [actor];
  const targeted = [...(game.user?.targets ?? [])].map((t) => t.actor).filter(Boolean);
  return targeted.length ? targeted : [actor];
}

/** Auto-built Bolster/Hinder effects for a Skill — one ActiveEffect per Bolster/Hinder Effect it
 *  carries (primary AND the Secondary-Effect slot), so the designer needn't author one. Each raises
 *  (Bolster) / lowers (Hinder) the Skill's Attributes by Rank (see bolsterHinderRules). ACTIVE Skills
 *  get a duration — a number of combat rounds, or "scene" (no timer; cleared when combat ends) when
 *  `effectDuration` is blank. Passive Skills are handled in-memory by the effects engine, not here.
 *  Returns [] when none apply, the Skill is Passive, or the designer authored their own attr effect.
 *  Each carries `autoKey` (`<skillId>:<mode>`) so re-casting REFRESHES rather than stacks. */
function autoBolsterHinderEffects(item) {
  if (item?.type !== "skill" || item.system?.actionType === "passive") return [];
  if (hasAuthoredAttributeEffect(item)) return [];
  const dur = item.system?.effectDuration;
  const scene = dur == null;                       // blank → lasts the scene (cleared at combat end)
  const out = [];
  for (const mode of skillEffectKeys(item.system)) {
    const list = bolsterHinderRules(item, mode);
    if (!list.length) continue;
    const duration = {};
    if (!scene) {
      duration.rounds = dur;
      duration.startTime = game.time?.worldTime ?? 0;
      if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
    }
    out.push({
      name: item.name,
      img: item.img,
      duration,
      flags: { "project-anime": { rules: { version: 1, list }, autoEffect: mode, autoKey: `${item.id}:${mode}`, scene } }
    });
  }
  return out;
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
  if (target?.documentName !== "Actor" || !effectData) return;
  // Refresh, don't stack: an auto Bolster/Hinder from a given Skill+Effect (its `autoKey`) replaces
  // any prior copy of itself on the target, so re-casting re-applies rather than piling up.
  const key = effectData.flags?.["project-anime"]?.autoKey;
  if (key) {
    const dupes = target.effects.filter((e) => e.flags?.["project-anime"]?.autoKey === key).map((e) => e.id);
    if (dupes.length) await target.deleteEmbeddedDocuments("ActiveEffect", dupes);
  }
  await target.createEmbeddedDocuments("ActiveEffect", [effectData]);
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
 * @param {object}  [opts]
 * @param {boolean} [opts.landed=true]  Did the Skill's Accuracy Check land? An auto-Hinder is
 *   offensive and only applies on a hit; supportive auto/authored effects apply regardless.
 * @returns {Promise<string[]>} chat-card lines naming who received which effect(s).
 */
async function applySkillEffects(actor, item, recipients = null, { landed = true } = {}) {
  // Passive Skills apply their effect always-on (the effects.mjs gate) — never as an on-use
  // copy, so clicking a Passive in the quick panel can't double up the buff.
  if (item.system?.actionType === "passive") return [];
  const enabled = (item.effects ?? []).filter((e) => !e.disabled && effectRules(e).length);
  // Bolster/Hinder Skills auto-build their attribute effect(s), so the designer needn't author one.
  // A Hinder is offensive — it lands only when the Accuracy Check hit; a Bolster (self/ally) always applies.
  const autoEffects = autoBolsterHinderEffects(item)
    .filter((a) => landed || a.flags?.["project-anime"]?.autoEffect !== "hinder");
  if (!enabled.length && !autoEffects.length) return [];
  // Applied effects wear the icon of "what was used": the borrowed weapon for a Weapon-range Skill,
  // else the Skill itself. effectCopyData only swaps it in when the effect has no custom icon.
  const sourceImg = skillWeapon(actor, item)?.img || item.img;
  const targets = skillEffectTargets(actor, item, recipients);
  const seen = new Set();
  const lines = [];
  for (const ta of targets) {
    if (!ta || seen.has(ta.id)) continue;
    seen.add(ta.id);
    const names = [];
    for (const effect of enabled) {
      if (await routeEffectApply(ta, effectCopyData(effect, sourceImg))) names.push(effect.name);
    }
    for (const auto of autoEffects) {
      if (await routeEffectApply(ta, foundry.utils.deepClone(auto))) names.push(auto.name);
    }
    if (names.length) {
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.effectApplied", { effect: [...new Set(names)].join(", "), name: ta.name })}</em>`);
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

/** Undo one row of a damage card: reverse that creature's HP/EN change, then strike the row through.
 *  The reversal routes through the same owner/GM relay as the auto-apply and is clamped to max by
 *  applyDamageTo. The undone state is persisted on the message flag (its author — whoever rolled — or
 *  a GM can update it), and the render hook redraws the rows from that flag, so the strike-through
 *  shows for everyone and survives a reload. If the clicker can't update the message, the HP is still
 *  reverted and the row is greyed out locally. */
async function onUndoDamageButton(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  if (el.disabled) return;
  const card = message?.flags?.["project-anime"]?.damageCard;
  const i = Number(el.dataset.row);
  const row = card?.rows?.[i];
  if (!row || row.undone) return;
  el.disabled = true;   // guard against a double-click landing twice during the async reversal
  const target = await fromUuid(row.uuid);
  if (!target) { el.disabled = false; return ui.notifications.warn(i18n("PROJECTANIME.Roll.targetGone")); }

  // Reverse: undo damage → heal the amount back; undo healing → remove it. Same pool.
  if (!(await routeApply(target, row.uuid, row.amount, !row.heal, row.pool))) {
    el.disabled = false;
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
  }

  const rows = card.rows.map((r, idx) => (idx === i ? { ...r, undone: true } : r));
  if (message.canUserModify(game.user, "update")) {
    await message.update({ "flags.project-anime.damageCard.rows": rows });   // render hook redraws the rows
  } else {
    const rowEl = el.closest(".dmg-row");
    if (rowEl) {
      rowEl.classList.add("is-undone");
      el.outerHTML = `<span class="dmg-undone"><i class="fas fa-check"></i> ${i18n("PROJECTANIME.Roll.undone")}</span>`;
    }
  }
  ui.notifications.info(i18n("PROJECTANIME.Roll.reverted", {
    n: row.amount, unit: row.pool === "energy" ? "EN" : "HP", name: target.name
  }));
}

/* -------------------------------------------- */
/*  Luck Dice                                   */
/* -------------------------------------------- */

/** Dialog: replace either die, both, or neither with stored Luck numbers — all in one step (up to
 *  two Luck dice per roll). Each die gets its own picker (Keep / a stored Luck value, by pool
 *  index). Returns `{ die0, die1 }`, each the chosen pool index or null (= keep that die's roll). */
async function promptLuck({ d1, d2, pool }) {
  const luckOpts = pool
    .map((v, i) => ({ v, i }))
    .sort((x, y) => y.v - x.v)
    .map(({ v, i }) => `<option value="${i}">${v}</option>`)
    .join("");
  const dieRow = (idx, val) => `
    <div class="form-group">
      <label>${i18n("PROJECTANIME.Roll.die")} ${idx + 1} <span class="muted">(${val})</span></label>
      <select name="die${idx}"><option value="" selected>${i18n("PROJECTANIME.Roll.luckKeep")}</option>${luckOpts}</select>
    </div>`;
  const content = `
    <div class="project-anime roll-dialog luck-dialog">
      ${dieRow(0, d1)}${dieRow(1, d2)}
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
  return { die0: result.die0 ? Number(result.die0) : null, die1: result.die1 ? Number(result.die1) : null };
}

/** Resolve a one-shot Luck choice against a roll: validates the two picks are distinct dice,
 *  computes the new (a, b) pair, and returns the pool with the spent entries removed. Returns
 *  null when nothing was chosen or the same stored die was picked for both (warns). */
function applyLuckChoice({ die0, die1, d1, d2, pool }) {
  if (die0 == null && die1 == null) return null;
  if (die0 != null && die0 === die1) { ui.notifications.warn(i18n("PROJECTANIME.Roll.luckSameDie")); return null; }
  const spent = new Set([die0, die1].filter((x) => x != null));
  return {
    a: die0 != null ? pool[die0] : d1,
    b: die1 != null ? pool[die1] : d2,
    nextPool: pool.filter((_, i) => !spent.has(i)),
    lines: [die0, die1]
      .map((p, i) => p == null ? null : i18n("PROJECTANIME.Roll.luckSpent", { die: i + 1, v: pool[p] }))
      .filter(Boolean)
  };
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
  const spend = applyLuckChoice({ ...choice, d1, d2, pool });
  if (!spend) return;
  const res = evalPair(spend.a, spend.b, mod, { ct, evasion });
  await actor.update({ "system.luckDice": spend.nextPool });

  const attackish = kind === "attack" || kind === "skill";
  const badges = [];
  if (res.fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (res.combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
  else if (res.success === true) badges.push({ cls: "success", text: i18n(attackish ? "PROJECTANIME.Roll.hit" : "PROJECTANIME.Roll.success") });
  else if (res.success === false) badges.push({ cls: "failure", text: i18n(attackish ? "PROJECTANIME.Roll.miss" : "PROJECTANIME.Roll.failure") });

  const lines = [...spend.lines, `<strong>${i18n("PROJECTANIME.Roll.total")}: ${res.total}</strong>`];
  if (res.combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [];
  if (attackish && res.success !== false && el.dataset.itemId && el.dataset.actorUuid) {
    // Resolve the original caster + item so a flip-to-hit applies what newly landed and offers a
    // damage roll only when there's damage. (For an enemy Skill, the source actor owns the item.)
    const srcActor = await fromUuid(el.dataset.actorUuid);
    const item = srcActor?.items?.get?.(el.dataset.itemId) ?? null;
    const targetActor = el.dataset.targetUuid ? await fromUuid(el.dataset.targetUuid) : null;
    // A Skill's on-hit payload (conditions / Decay / Hinder) lands now that the re-roll hit.
    if (item?.type === "skill") lines.push(...(await applySkillOnHit(srcActor, item, targetActor)));
    // Roll Damage: weapon attacks always deal damage; a Skill only if it Strikes.
    const dealsDamage = kind === "attack" || (item?.type === "skill" && skillEffectKeys(item.system).includes("strike"));
    if (dealsDamage) {
      const tgt = el.dataset.targetUuid ? ` data-target-uuid="${el.dataset.targetUuid}"` : "";
      buttons.push({
        data: `data-action="rollDamage" data-actor-uuid="${el.dataset.actorUuid}" data-item-id="${el.dataset.itemId}"${tgt}`,
        label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`
      });
    }
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
  const spend = applyLuckChoice({ ...choice, d1, d2, pool });
  if (!spend) return;
  const res = evalPair(spend.a, spend.b, mod);
  await actor.update({ "system.luckDice": spend.nextPool });

  const badges = [];
  if (res.fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (res.combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });

  // Resolve the original caster + item so a flip can apply newly-landed effects and gate Roll Damage.
  const srcActor = actorUuid ? await fromUuid(actorUuid) : null;
  const item = srcActor?.items?.get?.(itemId) ?? null;
  const hasStrike = item?.type === "skill" && skillEffectKeys(item.system).includes("strike");

  const lines = [...spend.lines, `<strong>${i18n("PROJECTANIME.Roll.total")}: ${res.total}</strong>`];
  const hitUuids = [];
  for (const t of targets) {
    const didHit = res.combo || (!res.fumble && (t.ev == null || res.total >= t.ev));
    const evText = t.ev != null ? ` <span class="muted">(${i18n("PROJECTANIME.Stat.evasion")} ${t.ev})</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${t.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evText}</span>`);
    if (!didHit) continue;
    hitUuids.push(t.uuid);
    // Apply the Skill's on-hit payload (conditions / Decay / Hinder) to each creature the re-roll hits.
    if (item?.type === "skill") {
      const ta = await fromUuid(t.uuid);
      if (ta) lines.push(...(await applySkillOnHit(srcActor, item, ta)));
    }
  }
  if (res.combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [];
  // Roll Damage only when the Skill actually Strikes (a Mass Hinder already applied its Effect above).
  if (hasStrike && hitUuids.length && itemId && actorUuid) buttons.push({
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
