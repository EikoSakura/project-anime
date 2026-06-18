import { PROJECTANIME, modifierValue, skillEffectKeys, skillDieSpecs, skillNeedsAccuracy, skillTarget, skillEvasionAttr, skillEvasionKeys, skillEvasionLabel, skillDuration, auraAudience, cursedPools, isSelfCenteredArea } from "./config.mjs";
import { skillRulesHTML } from "./skill-description.mjs";
import { elementLabel } from "./elements.mjs";
import { collectRollModifiers, collectSkillModBonuses, collectWeaponModBonuses, collectInflictedConditions, effectRules, effectCopyData, bolsterHinderRules, hasAuthoredAttributeEffect, skillModifierRules, collectRetaliation } from "./effects.mjs";
import { resolveAnimate, resolveCompanion, confirmAndDismiss } from "./servants.mjs";
import {
  aoeKind, casterToken, placeTemplate, tokensInRange, pickTargetsDialog, setUserTargets, emanateBurst
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

/** Blinded Steps Down the dice of the bearer's Accuracy Checks (rules: Blinded). */
function accuracyStepDown(actor) {
  return !!actor?.statuses?.has?.("blinded");
}

/**
 * Step both Check dice for circumstances. Overload (carrying capacity exceeded) Steps Down on
 * EVERY Check; Blinded additionally Steps Down Accuracy Checks. A PRONE target Steps the
 * attacker's Accuracy dice UP (rules: "attacks and skills targeting you Step Up both dice") —
 * pass the struck creature as `target`. (Area attacks roll once against many creatures, so the
 * per-target Prone Step-Up can't apply there; single-target attacks and Chain leaps pass it.)
 * @returns {{dieA:number, dieB:number, reasons:string[]}}
 */
function steppedDice(actor, dieA, dieB, { accuracy = false, target = null } = {}) {
  const reasons = [];
  if (actor?.system?.carryingCapacity?.overloaded) reasons.push("overload");
  if (accuracy && accuracyStepDown(actor)) reasons.push("accuracy");
  for (let i = 0; i < reasons.length; i++) {
    dieA = stepDownValue(dieA);
    dieB = stepDownValue(dieB);
  }
  if (accuracy && target?.statuses?.has?.("prone")) {
    reasons.push("proneTarget");
    dieA = stepUpValue(dieA);
    dieB = stepUpValue(dieB);
  }
  return { dieA, dieB, reasons };
}

/** Build the localized "dice stepped" notes for a set of reasons. */
function stepNotes(reasons) {
  const notes = [];
  if (reasons.includes("overload")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedOverload")}</em>`);
  if (reasons.includes("accuracy")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedDown")}</em>`);
  if (reasons.includes("proneTarget")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedUpProne")}</em>`);
  return notes;
}

/** True when a recovery of `recoveryPool` ("hp" / "energy") is blocked by the target's Curse
 *  (rules v0.01: a Cursed creature cannot regain its cursed pool — chosen at Skill creation,
 *  or both pools for a hand-toggled Curse; see cursedPools). Omit `recoveryPool` to ask "does
 *  the Curse block ANY recovery". The single gate every recovery path checks. */
function curseBlocks(target, recoveryPool) {
  const blocked = cursedPools(target);
  if (!blocked.length) return false;
  return recoveryPool ? blocked.includes(recoveryPool) : true;
}

/** The Cursed "no recovery" chat note — names the blocked pool when known. */
function curseNote(name, pool) {
  const poolLabel = pool ? i18n(`PROJECTANIME.Stat.${pool}`) : "";
  return `<em class="muted">${i18n(pool ? "PROJECTANIME.Roll.cursedNoRecoveryPool" : "PROJECTANIME.Roll.cursedNoRecovery", { name, pool: poolLabel })}</em>`;
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
/*  Skill Target & Skill Evasion (rules v0.01)  */
/* -------------------------------------------- */

/** May this Skill affect the creature on `token`? Resolves the Skill's explicit Target: Foe needs
 *  an enemy, Ally anyone who ISN'T one — except the caster ("If an effect targets allies, you
 *  cannot use it on yourself"), Self only the caster, Any everyone (the open pre-v0.01 behavior).
 *  Area Skills filter their caught tokens through this; single-target use validates with it. */
function targetAllows(actor, item, token) {
  const target = skillTarget(item?.system);
  if (target === "any" || !token) return true;
  if (target === "self") return token.actor === actor;
  const enemy = tokensAreEnemies(casterToken(actor), token);
  if (target === "foe") return enemy;
  return !enemy && token.actor !== actor; // ally
}

/** Pre-flight for a single-target Skill use, BEFORE Energy is spent. An Ally Skill needs a
 *  targeted creature that isn't the caster and isn't an enemy; a Foe Skill aimed at a non-enemy
 *  doesn't fire (aimed at nothing it still rolls — the GM adjudicates, as Strikes always have).
 *  Self / Any always pass (their effects route through skillEffectTargets). Warns on failure. */
function validateSkillTarget(actor, item) {
  const target = skillTarget(item?.system);
  if (target === "self" || target === "any") return true;
  const ttoken = firstTargetToken();
  if (target === "ally") {
    if (!ttoken || ttoken.actor === actor) { ui.notifications.warn(i18n("PROJECTANIME.Roll.allyNotSelf")); return false; }
    if (tokensAreEnemies(casterToken(actor), ttoken)) { ui.notifications.warn(i18n("PROJECTANIME.Roll.allyNotFoe")); return false; }
    return true;
  }
  // foe
  if (ttoken && !tokensAreEnemies(casterToken(actor), ttoken)) { ui.notifications.warn(i18n("PROJECTANIME.Roll.foeOnly")); return false; }
  return true;
}

/** The Evasion this defender pits against this Skill's Accuracy Check (rules v0.01: Skill
 *  Evasion). A Skill may name an alternate Attribute (Mind / Charm / Spirit): the defender's
 *  Evasion is rebuilt around that Attribute's die — every other bonus and penalty (manual bonus,
 *  armor, shield: actor-models' evasion.gearMod) still applies, only Agility swaps out. The
 *  Banish / Nullify Modifiers let the target "use Spirit as their Skill Evasion": the defender
 *  takes whichever number is better. Returns the value plus the Attribute it stood on ("" =
 *  normal Evasion) for the card line. Weapons never define a Skill Evasion. */
function evasionVs(targetActor, item) {
  const sysT = targetActor?.system;
  if (!sysT) return { value: null, attr: "" };
  const gear = sysT.evasion?.gearMod ?? 0;
  const alt = (k) => Math.max(0, (sysT.attributes?.[k]?.value ?? 4) + gear);
  let value = sysT.evasion?.value ?? 0;
  let attr = "";
  const se = item?.type === "skill" ? skillEvasionAttr(item.system) : "";
  if (se) {
    // A PAIR ("Mind or Charm") resolves to the better of its two Attributes for THIS defender
    // (rules v0.01 — mirroring Banish/Nullify's better-of-Spirit below).
    value = Math.max(...skillEvasionKeys(se).map(alt));
    attr = se;
  }
  const mods = item?.type === "skill" ? (item.system?.modifiers ?? []) : [];
  if (mods.includes("banish") || mods.includes("nullify")) {
    const spirit = alt("spirit");
    if (spirit > value) { value = spirit; attr = "spirit"; }
  }
  return { value, attr };
}

/** Card label for what the defender used: "Evasion" or "Skill Evasion (Mind)" / "Skill Evasion
 *  (Mind or Charm)" when an alternate Attribute (or pair) stood in for Agility. `vsEvasionText`
 *  is the "vs …" sentence form of the same. */
function evasionLabel(attr) {
  return attr
    ? game.i18n.format("PROJECTANIME.Roll.skillEvasionWith", { attr: skillEvasionLabel(attr) })
    : i18n("PROJECTANIME.Stat.evasion");
}

function vsEvasionText(attr) {
  return attr
    ? game.i18n.format("PROJECTANIME.Roll.vsSkillEvasion", { attr: skillEvasionLabel(attr) })
    : i18n("PROJECTANIME.Roll.vsEvasion");
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

/** The rules' Challenge Threshold ladder (p.5): preset difficulties offered in the roll dialog. */
const CT_PRESETS = [
  ["easy", 7], ["normal", 10], ["hard", 13], ["daunting", 16], ["extreme", 19]
];

/**
 * Open the roll-configuration dialog.
 * @returns {Promise<object|null>} `{ attrA?, attrB?, mod, ct? }` or null if cancelled.
 */
async function promptRoll({ title, actor, attrA, attrB, showAttrs = true, showCT = true, infoHTML = "", ct = null }) {
  // No <form> wrapper: DialogV2 supplies the form, so a nested one would break
  // `button.form` field reading. The class lives on a plain <div> for styling.
  const ctOptions = CT_PRESETS
    .map(([key, value]) => `<option value="${value}">${i18n(`PROJECTANIME.Roll.ctPreset.${key}`)} (${value})</option>`)
    .join("");
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
        <select name="ctPreset"><option value="">—</option>${ctOptions}</select></div>
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.ctCustom")}</label>
        <input type="number" name="ct" value="${ct ?? ""}" placeholder="—" step="1" /></div>` : ""}
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
  // A typed custom CT wins; otherwise the chosen preset; otherwise no threshold.
  const custom = result.ct === "" || result.ct == null ? null : Number(result.ct);
  const preset = result.ctPreset === "" || result.ctPreset == null ? null : Number(result.ctPreset);
  return {
    attrA: result.attrA,
    attrB: result.attrB,
    mod: Number(result.mod) || 0,
    ct: custom ?? preset
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
export function cardHTML({ title, subtitle = "", icon = "", glyph = "", meta = [], badges = [], rollHTML = "", description = "", lines = [], buttons = [], rows = [] }) {
  // An image `icon` wins; otherwise a FontAwesome `glyph` fills the icon box (the .is-glyph variant).
  const iconHTML = icon
    ? `<img class="card-icon" src="${icon}" alt="" />`
    : (glyph ? `<span class="card-icon is-glyph"><i class="fas ${glyph}"></i></span>` : "");
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
export async function enrichDescription(item) {
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
export function skillMeta(sys) {
  const rank = PROJECTANIME.skillRanks[sys.rank] ?? {};
  const chips = [];
  if (rank.stars) chips.push(`<span class="meta-stars">${rank.stars}</span>`);
  // Effect(s): a Skill carrying the "Secondary Effect" Modifier shows both, joined with " + ".
  const effectLabel = skillEffectKeys(sys).map((k) => i18n(PROJECTANIME.skillEffects[k] ?? "")).filter(Boolean).join(" + ");
  if (effectLabel) chips.push(effectLabel);
  // Target + Duration (rules v0.01) read at a glance on the card; passives are always-on.
  chips.push(i18n(PROJECTANIME.skillTargets[skillTarget(sys)] ?? ""));
  if (sys.actionType !== "passive" && sys.effect !== "passive") {
    chips.push(i18n(PROJECTANIME.skillDurations[skillDuration(sys)] ?? ""));
  }
  if (sys.actionType !== "passive" && Number(sys.energyCost) > 0) {
    chips.push(`<i class="fas fa-bolt"></i> ${sys.energyCost}`);
  }
  return chips;
}

export async function postCard(actor, content, rolls, { combo = false, flags = null } = {}) {
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
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }

  // A Fumble or Combo is a locked result — Luck can't change it (for anyone, the roller included).
  // The roller rides along so a Luck-manufactured Combo can grant ITS extra turn (see onSpendLuckButton).
  const buttons = (fumble || combo) ? [] : [luckButton({ d1: r1, d2: r2, mod: modifier, ct, kind: "check", actorUuid: actor.uuid })];

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
  // Out of combat there's no one to tie with, so roll the clean Agility-die + Mind-die total —
  // the tracker's tiebreak fractions would only show here as stray decimals (see CONFIG.Combat.initiative).
  const roll = new Roll("1d@attributes.agility.value + 1d@attributes.mind.value", actor.getRollData());
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
  // Weapon Adjustments (`weaponMod`): a flat Attack (accuracy) bump scoped to any weapon, the
  // Unarmed strike, or this weapon's Type — surfaced on the card alongside the roll modifiers.
  const wmods = collectWeaponModBonuses(actor, item, { src: item, target: targetActor });
  if (wmods.attack) { mod += wmods.attack; rmods.sources.push(...wmods.attackSources); }
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true, target: targetActor });
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
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
  // Attacking reveals a Vanished attacker (rules v0.01) — the attempt itself, hit or miss.
  await revealVanished(actor, lines);

  if (hit === true && targetActor) {
    for (const c of collectInflictedConditions(item, targetActor)) {
      await applyConditionFromItem(actor, item, targetActor, c, lines);
    }
  }

  // A Fumble or Combo is a locked result — Luck can't change it (for anyone, the roller included).
  const buttons = (fumble || combo) ? [] : [luckButton({ d1: r1, d2: r2, mod, evasion, kind: "attack", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" })];
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
    // A Two-Handed-Only weapon (a bow) lists its two-handed profile as its base Damage — being
    // gripped in both hands is its nature, not a bonus, so it never gains the grip Step-Up.
    if (src.system.grip === "two" && !src.system.twoHandedOnly) {
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
  // Modifier-scoped Skill adjustments (a Bond/Trait/gear `skillMod` rule): a flat damage bump on Skills
  // carrying a chosen Modifier (Burst, …), any Skill/weapon attack, or the Unarmed strike — e.g. a
  // brawler bond raising the Natural Attack's penalty toward 0, or "Burst Skills deal +1". Surfaced
  // on the card via rmods.sources alongside the roll modifiers.
  const smods = collectSkillModBonuses(actor, item, { target });
  if (smods.damage) { mod += smods.damage; rmods.sources.push(...smods.sources); }
  // Weapon Adjustments (a Trait/Bond/gear `weaponMod` rule): a flat damage bump on any weapon
  // attack, the Unarmed strike, or a chosen weapon Type — e.g. "+1 damage with Swords". `src` is
  // the rolled weapon (borrowed for Weapon-range Skills), so type/unarmed scopes resolve correctly.
  const wmods = collectWeaponModBonuses(actor, item, { src, target });
  if (wmods.damage) { mod += wmods.damage; rmods.sources.push(...wmods.damageSources); }
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
 * absorb→heal) then −Defense. HP damage then floors at 1 (homebrew: a connecting hit always
 * does at least 1 HP) UNLESS the target's Defense soaked it to 0; Energy-pool damage keeps the
 * rules' minimum of 0. Returns the applied amount, whether it heals, the affinity badges, and a
 * chat line. Defense/affinity are skipped for healing.
 */
export function adjustForTarget(raw, dtype, targetActor, { ignoresDefense = false, heal = false, pool = "hp" } = {}) {
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
    const post = raw + adj - def;
    if (def) parts += ` − ${def} ${i18n("PROJECTANIME.Stat.defense")}`;
    // Homebrew floor (overrides PDF p.14, "damage minimum 0"): a connecting hit deals at least
    // 1 HP — EXCEPT when the target's Defense is what soaked it to 0 (armor can still fully
    // negate a hit). Energy-pool damage keeps the rules' minimum of 0; Pierce is HP damage with
    // def = 0, so it always floors at 1.
    const defenseSoaked = def > 0 && post < 1;
    if (pool === "hp" && !defenseSoaked) {
      amount = Math.max(1, post);
      if (post < 1) parts += ` · ${i18n("PROJECTANIME.Roll.min1")}`;
    } else {
      amount = Math.max(0, post);
    }
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
  const adj = adjustForTarget(dmg.raw, dmg.dtype, targetActor, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal, pool: dmg.pool });

  const badges = [...adj.badges];
  const notes = damageNotes(dmg);
  // Apply the damage/healing immediately and record an undo row carrying the calculation. With no
  // target (or a no-op hit) there's nothing to apply — fall back to showing the rolled figure.
  // A Cursed target regains nothing: healing (a Mend, or an Absorb conversion) is voided.
  const rows = [];
  const killed = [];
  let dealt = 0;
  if (targetActor && adj.heal && curseBlocks(targetActor, "hp")) {
    notes.push(curseNote(targetActor.name, "hp"));
  } else if (targetActor && (adj.amount > 0 || adj.heal)) {
    const pool = adj.heal ? "hp" : dmg.pool;
    // An active Barrier on that pool eats its share first (the row shows what got through).
    const bc = barrierCalc(targetActor, adj, pool);
    if (killsTarget(targetActor, { ...adj, amount: bc.amount }, pool)) killed.push(targetActor);
    await routeApply(targetActor, targetActor.uuid, adj.amount, adj.heal, pool);
    rows.push({ uuid: targetActor.uuid, name: targetActor.name, img: targetActor.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
    if (!adj.heal) dealt = bc.amount;
  }
  // Drain HP/Energy: the caster recovers half the damage actually dealt to the target —
  // what a Barrier absorbed never touched the creature, so it feeds no drain. A basic
  // attack (weapon/shield) additionally feeds any PASSIVE drain Skill the attacker carries.
  await applyDrain(actor, item, dealt, notes);
  await applyPassiveDrains(actor, item, dealt, notes);
  // Retaliation: a warded target punishes the attacker for the damage it just took.
  if (targetActor && dealt > 0) await applyRetaliation(actor, [{ actor: targetActor, amount: dealt }], notes);
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
  // Passive Devour: if this blow dropped the target to 0 HP, an actor with a passive Devour Skill
  // learns one of the victim's Skills (the picker follows the card just posted).
  await maybeDevourOnKill(actor, killed);
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
  const killed = [];
  const hits = [];
  let drainTotal = 0;
  for (const ta of targetActors) {
    const adj = adjustForTarget(dmg.raw, dmg.dtype, ta, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal, pool: dmg.pool });
    let through = 0;
    if (adj.heal && curseBlocks(ta, "hp")) {
      // A Cursed creature regains nothing to its cursed pool — the heal (or Absorb conversion) is voided.
      lines.push(curseNote(ta.name, "hp"));
    } else if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation. An active Barrier
      // on that pool eats its share first (the row shows what got through).
      const pool = adj.heal ? "hp" : dmg.pool;
      const bc = barrierCalc(ta, adj, pool);
      if (killsTarget(ta, { ...adj, amount: bc.amount }, pool)) killed.push(ta);
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
      through = bc.amount;
    } else {
      // Nothing dealt (e.g. immune) — note it, but there's nothing to apply or undo.
      lines.push(`<span class="card-target-row"><strong>${ta.name}</strong> <span class="muted">${adj.line}</span></span>`);
    }
    // Barrier-absorbed damage never touched the creature, so it feeds no drain.
    if (!adj.heal) drainTotal += through;
    if (!adj.heal && through > 0) hits.push({ actor: ta, amount: through });
  }
  lines.push(...damageNotes(dmg));
  // Drain HP/Energy: the caster recovers half the total damage the area Skill dealt.
  await applyDrain(actor, item, drainTotal, lines);
  // Retaliation: each warded target in the area punishes the attacker for its own hit.
  await applyRetaliation(actor, hits, lines);

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: dmg.heal ? i18n("PROJECTANIME.Roll.healing") : i18n("PROJECTANIME.Roll.damage"),
    icon: item.img,
    rollHTML: await dmg.roll.render(),
    rows,
    lines
  }), dmg.roll, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
  // Passive Devour: any target this area Skill dropped to 0 HP can be devoured (one picker each).
  await maybeDevourOnKill(actor, killed);
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

  // Aura (a Skill Modifier): the Effect is delivered by a continuous field (helpers/aura.mjs), not an
  // on-use attack/effect. A PASSIVE aura is always-on (just report it); an ACTIVE/React aura starts or
  // refreshes a duration marker here. Either way, skip the normal resolution.
  if (mods.includes("aura")) return resolveAura(actor, item);

  // Whole-subsystem Effects run their own flows: Animate raises a targeted corpse and Companion
  // bonds its creature (helpers/servants.mjs); Conjure materializes an item; Gate links two
  // tiles. None of them roll an attack; each handles its own targeting and Energy.
  if (sys.effect === "animate") return resolveAnimate(actor, item);
  if (sys.effect === "companion") return resolveCompanion(actor, item);
  if (sys.effect === "conjure") return resolveConjure(actor, item);
  if (sys.effect === "gate") return resolveGate(actor, item);

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
    // can't bounce back onto the user or an unintended bystander. The Skill's explicit Target
    // prunes the path further (a Foe chain only leaps between enemies).
    chainTokens = [...(game.user?.targets ?? [])].filter((t) => t?.actor && t !== ctoken && targetAllows(actor, item, t));
    if (!chainTokens.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
  } else if (kind) {
    areaTokens = await acquireAreaTargets(actor, item, kind);
    if (areaTokens === null) return null;   // cancelled — no Energy spent / charge kept
    // The template/pick may legally catch creatures the Skill can't affect — its explicit Target
    // filters them out (rules v0.01: area Modifiers affect "the type the Skill can already
    // affect"; an Ally area never includes the caster). Nothing affectable caught → no cast.
    areaTokens = areaTokens.filter((t) => targetAllows(actor, item, t));
    if (!areaTokens.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noneAffectable"));
  } else if (!validateSkillTarget(actor, item)) {
    return null;   // single-target pre-flight failed (warned) — no Energy spent
  }

  // 2) Spend Energy (rank×2; Passive = free). A charge release already paid on the focus turn,
  // so releasing is free — but it consumes the charge whether the follow-up hits or misses.
  if (releasingCharge) await actor.unsetFlag("project-anime", "charge");
  else if (!(await spendSkillEnergy(actor, sys, item))) return null;

  // 2b) Channeled (Duration Modifier): using the Skill opens its channel — the marker upkeeps
  // 1 EP at the start of the caster's turns and every effect copy applied below rides its key.
  if (sys.actionType !== "passive" && skillDuration(sys) === "channeled") await ensureChannelMarker(actor, item);

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

/**
 * Resolve an Aura Skill's activation. The aura's Effect is delivered by the field engine
 * (helpers/aura.mjs), so there's no attack/effect resolution here:
 *  • PASSIVE — always-on; post an informational card (no Energy, no marker; the field is maintained
 *    continuously, and the bearer keeps the Effect via the normal passive path).
 *  • ACTIVE/React — spend Energy and stamp (refresh) a duration marker on the caster; the reconcile
 *    projects the field (to the chosen group + the caster) while the marker lives, and drops it when
 *    the duration elapses (the marker expires via the usual effect-expiry / end-of-combat sweep).
 */
async function resolveAura(actor, item) {
  const sys = item.system;
  const passive = sys.actionType === "passive";
  if (!passive && !(await spendSkillEnergy(actor, sys, item))) return null;

  // The field's audience follows the Skill's Target (config.mjs auraAudience): Ally → you and
  // allies; Foe → enemies only (never the caster); Any → every creature in the field.
  const audience = auraAudience(sys);
  const lineKey = audience === "foe" ? "auraAffectsEnemy" : audience === "any" ? "auraAffectsAny" : "auraAffectsAlly";
  const lines = [`<em class="muted">${i18n(`PROJECTANIME.Roll.${lineKey}`, { n: modifierValue(item, "aura") })}</em>`];

  if (passive) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.auraAlwaysOn")}</em>`);
  } else {
    // Build the field's lifetime from the Skill's Duration: Standard → its turn count (default 2
    // rounds); anything else (Scene; the Builder blocks Channeled/Instant on an Aura) → "scene",
    // cleared at end of combat. Legacy auras with a blank count read as Scene, exactly as before.
    const scene = skillDuration(sys) !== "standard";
    const dur = sys.effectDuration ?? PROJECTANIME.standardDurationTurns;
    const duration = {};
    if (!scene) {
      duration.rounds = dur;
      duration.startTime = game.time?.worldTime ?? 0;
      if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
    }
    // Refresh: drop any existing marker for this aura, then stamp a fresh one on the caster. The
    // marker tells the reconcile the aura is running (and for how long); its create/expire nudges the
    // field engine via the createActiveEffect/deleteActiveEffect hooks.
    const old = actor.effects.filter((e) => e.flags?.["project-anime"]?.auraMarker === item.id).map((e) => e.id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: item.name,
      img: item.img,
      duration,
      flags: { "project-anime": { auraMarker: item.id, scene } }
    }]);
    lines.push(`<em class="muted">${scene ? i18n("PROJECTANIME.Roll.auraScene") : i18n("PROJECTANIME.Roll.auraDuration", { n: dur })}</em>`);
  }

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img, meta: skillMeta(sys),
    description: await enrichDescription(item), lines
  }));
  return null;
}

/** Spend a Skill's Energy (rank×2; Passive = free). Warns + returns false if unaffordable. */
export async function spendSkillEnergy(actor, sys, item = null) {
  let energyCost = sys.actionType === "passive" ? 0 : (Number(sys.energyCost) || 0);
  // A `skillMod` rule (Bond/Trait/gear) can discount the cost of Skills carrying its Modifier — e.g.
  // a Megumin bond making Burst Skills cost −1 Energy. `energy` is a signed delta (−1 = cheaper).
  if (energyCost > 0 && item) {
    energyCost = Math.max(0, energyCost + collectSkillModBonuses(actor, item).energy);
  }
  if (energyCost > 0) {
    const current = actor.system.energy?.value ?? 0;
    if (current < energyCost) { ui.notifications.warn(i18n("PROJECTANIME.Roll.noEnergy", { n: energyCost })); return false; }
    await actor.update({ "system.energy.value": current - energyCost });
  }
  return true;
}

/** Minimize the actor's open sheet (if any) so the canvas is clear to place an AOE template, and
 *  return a restore() that maximizes it again afterwards. No-op (and no restore) when the sheet
 *  isn't open, or the user had already minimized it themselves — so we only ever undo our OWN
 *  minimize, never pop a window the player deliberately tucked away. */
function minimizeSheetForPlacement(actor) {
  const sheet = actor?.sheet;
  if (!sheet?.rendered || sheet.minimized) return () => {};
  sheet.minimize();
  return () => { if (sheet.rendered) sheet.maximize().catch(() => {}); };
}

/** Acquire target tokens for an area Skill. Returns Token[] (maybe empty) or null on cancel /
 *  when it can't proceed (warned). Burst/Line place a template; Mass picks from in-range. */
async function acquireAreaTargets(actor, item, kind) {
  const sys = item.system;
  const rangeTiles = sys.range?.tiles ?? PROJECTANIME.rangeTiles[sys.range?.scope] ?? 5;
  const ctoken = casterToken(actor);

  if (kind === "burst") {
    // Self-centered (emanation): a Burst whose Range is Self explodes from the caster's token — no
    // placement, just catch everyone within the radius around you (the Target then filters who's hit).
    if (isSelfCenteredArea(sys)) {
      if (!ctoken) { ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken")); return null; }
      return emanateBurst(ctoken, modifierValue(item, "burst"));
    }
    // Tuck the sheet out of the way so the canvas is clear to place the template (restored after).
    const restore = minimizeSheetForPlacement(actor);
    try {
      const res = await placeTemplate({
        t: "circle", distanceTiles: modifierValue(item, "burst"),
        origin: ctoken?.center ?? null, follow: "point",
        maxRangeTiles: ctoken ? rangeTiles : null,
        hint: i18n("PROJECTANIME.Roll.placeBurst")
      });
      return res ? res.tokens : null;
    } finally {
      restore();
    }
  }
  if (kind === "line") {
    if (!ctoken) { ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken")); return null; }
    const gs = canvas.grid.size;
    const restore = minimizeSheetForPlacement(actor);
    try {
      const res = await placeTemplate({
        t: "ray", distanceTiles: Math.max(1, rangeTiles), origin: ctoken.center,
        originHalfW: (ctoken.document.width || 1) * gs / 2,
        originHalfH: (ctoken.document.height || 1) * gs / 2,
        follow: "direction", hint: i18n("PROJECTANIME.Roll.placeLine")
      });
      return res ? res.tokens : null;
    } finally {
      restore();
    }
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
  // Apply on-use effects when any non-die Effect is carried OR a Modifier grants auto rules
  // (Protection / Affinity Damage) — a pure Strike with Protection still wards its target.
  const hasOther = effects.some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length > 0;
  const targetToken = firstTargetToken();
  const targetActor = targetToken?.actor ?? null;

  // Sense vs Vanish (rules v0.01): aiming a Sense Skill at a Vanished creature becomes the
  // dedicated detection check (⟪Mind⟫ + ⟪Spirit⟫, one die Stepped Up, vs its Skill Evasion).
  if (effects.includes("sense") && targetActor?.statuses?.has?.("vanished")) {
    return resolveSenseDetect(actor, item, targetActor);
  }
  // The defender's number: normal Evasion, or this Skill's Skill Evasion (Mind/Charm/Spirit
  // swapped in for Agility — rules v0.01), or Spirit if a Banish/Nullify target prefers it.
  const { value: evasion, attr: evasionAttr } = evasionVs(targetActor, item);
  // An Accuracy Check (vs Evasion) is made ONLY when the Skill targets an enemy — its explicit
  // Target gates first (Foe always rolls, Self/Ally never), then for "Any": a Strike or Weaken
  // (always), an inflict/analyze/banish/nullify Modifier (always), or forced movement (Move /
  // Push / Pull) aimed at a HOSTILE target. Supportive Skills and friendly repositioning just
  // take effect — you can't "evade" a heal or a buff. One shared Check covers every Effect.
  const needsAccuracy = skillNeedsAccuracy(sys, { enemyTarget: tokensAreEnemies(casterToken(actor), targetToken) });

  const lines = [];
  const badges = [];
  let roll = null, r1 = null, r2 = null, fumble = false, combo = false, hit = null;

  if (needsAccuracy) {
    const { attrA, attrB, mod: accMod } = skillAccuracy(actor, item);
    const rmods = collectRollModifiers(actor, hasStrike ? "attack" : "check", { target: targetActor });
    // "Sharpen Accuracy" advancement: a flat bonus baked into the Skill's Check.
    const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
    // A Weapon-range Skill borrows a weapon, so Weapon Adjustments (`weaponMod`) scoped to it (any /
    // Unarmed / its Type) bump this Check's Attack too. Non-weapon Skills borrow nothing → no bump.
    const wsrc = skillWeapon(actor, item);
    const wmods = wsrc ? collectWeaponModBonuses(actor, item, { src: wsrc, target: targetActor }) : { attack: 0, attackSources: [] };
    if (wmods.attack) rmods.sources.push(...wmods.attackSources);
    const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true, target: targetActor });
    roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod + wmods.attack));
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
    if (evasion != null) lines.push(`${vsEvasionText(evasionAttr)} <strong>${targetActor.name}</strong>: ${evasion}`);
    if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
    // Attacking reveals a Vanished caster (rules v0.01) — the attempt itself, hit or miss.
    await revealVanished(actor, lines);
  }

  // The Skill "lands" if it makes no Accuracy Check, or its Check didn't explicitly miss.
  const landed = !needsAccuracy || hit !== false;
  // Charged release: note the double power when it lands, or that the charge dissipated on a miss.
  if (charged) lines.push(`<em class="muted">${i18n(landed ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  // On-hit (enemy) riders land only when the Skill landed: inflicted conditions + Decay.
  if (landed) await applyOnHitConditions(actor, item, targetActor, lines);

  // Vanish (rules v0.01): a landed cast shrouds the CASTER — "you cannot be seen".
  if (effects.includes("vanish") && landed) await applyVanish(actor, item, lines);

  // The ensnaring Effects (Disguise / Illusion / Telepathy) leave a tracked marker on the
  // affected creature — visible to the table, clearable by the Overcome action. A Disguise
  // additionally marks the CASTER (they're the one wearing the face).
  if (landed) {
    for (const eff of effects.filter((e) => ENSNARE_EFFECTS.includes(e))) {
      if (targetActor && targetActor !== actor) lines.push(...(await applyEnsnareMarker(actor, item, targetActor, eff)));
    }
    if (effects.includes("disguise")) lines.push(...(await applyEnsnareMarker(actor, item, actor, "disguise", { self: true })));
  }

  // A Skill applies its Active Effect(s) whenever it carries any non-die Effect (Bolster / Hinder /
  // Affinity / Sustain / Move / Sense) in EITHER slot — to the targeted tokens, or the caster if
  // none are targeted. Supportive effects always apply; an auto-Hinder lands only on a hit (`landed`).
  if (hasOther) lines.push(...(await applySkillEffects(actor, item, null, { landed })));

  const buttons = [];
  // Spend Luck re-rolls the Accuracy Check — offered for ANY enemy-targeting Skill (Strike, Hinder,
  // forced movement), not just damage; but NOT on a Fumble/Combo, a locked result Luck can't change.
  // The follow-up card re-evaluates the hit and applies what lands.
  if (needsAccuracy && !fumble && !combo) buttons.push(luckButton({ d1: r1, d2: r2, mod: 0, evasion, kind: "skill", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" }));
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
  // Steal (rules v0.01): a landed hit opens the loot — pick / contest / transfer from the card.
  if (effects.includes("steal") && landed && targetActor) {
    buttons.push({
      data: `data-action="stealItem" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}`,
      label: `<i class="fas fa-hand-sparkles"></i> ${i18n("PROJECTANIME.Roll.steal")}`
    });
  }
  // Vanish: the shroud's "Stay Hidden" contest vs whoever comes looking (target the seeker first).
  if (effects.includes("vanish") && landed) {
    buttons.push({
      data: `data-action="stayHidden" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"`,
      label: `<i class="fas fa-eye-slash"></i> ${i18n("PROJECTANIME.Roll.stayHidden")}`
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
  // A Weapon-range area Strike borrows a weapon, so Weapon Adjustments (`weaponMod`) bump its
  // Attack too — matching the single-target path. Non-weapon area Skills borrow nothing → no bump.
  const wsrc = skillWeapon(actor, item);
  const wmods = wsrc ? collectWeaponModBonuses(actor, item, { src: wsrc, target: primary }) : { attack: 0, attackSources: [] };
  if (wmods.attack) rmods.sources.push(...wmods.attackSources);
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod + wmods.attack));
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
    // Each caught creature defends with its own number — Skill Evasion swaps its Attribute in.
    const { value: ev, attr: evAttr } = evasionVs(ta, item);
    const didHit = combo || (!fumble && (ev == null || roll.total >= ev));
    luckTargets.push({ uuid: ta.uuid, ev, name: ta.name });
    const evText = ev != null ? ` <span class="muted">(${evasionLabel(evAttr)} ${ev})</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${ta.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evText}</span>`);
    if (didHit) {
      hitUuids.push(ta.uuid);
      hitActors.push(ta);
      for (const c of collectInflictedConditions(item, ta)) {
        await applyConditionFromItem(actor, item, ta, c, lines);
      }
      await inflictDecay(item, ta, lines);
      // An ensnaring Effect (Disguise / Illusion / Telepathy) marks every creature it catches.
      for (const eff of skillEffectKeys(sys).filter((e) => ENSNARE_EFFECTS.includes(e))) {
        if (ta !== actor) lines.push(...(await applyEnsnareMarker(actor, item, ta, eff)));
      }
    }
  }
  if (!targetTokens.length) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeNoTargets")}</em>`);
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
  // Attacking reveals a Vanished attacker (rules v0.01) — the attempt itself, hit or miss.
  await revealVanished(actor, lines);
  // Charged release: note the double power on any hit, or that the charge dissipated on a clean miss.
  if (charged) lines.push(`<em class="muted">${i18n(hitUuids.length ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  // A secondary non-die Effect (e.g. an area Strike that also Bolsters) — or a Modifier-granted
  // auto rule (Protection / Affinity Damage) — grants its Active Effect(s) to the creatures it
  // hit. (A secondary damage/heal ROLL on an area Skill resolves single-target only.)
  if ((skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length) && hitActors.length) {
    lines.push(...(await applySkillEffects(actor, item, hitActors)));
  }

  const buttons = [];
  // Spend Luck re-evaluates the single Accuracy roll against every caught target's Evasion — offered
  // for ANY area attack (Strike or Mass Hinder); the follow-up applies what newly landed and, for a
  // Strike, re-offers Roll Damage. A Fumble/Combo is locked, so no Luck is offered on one.
  if (luckTargets.length && !fumble && !combo) buttons.push(aoeLuckButton({
    d1: r1, d2: r2, mod: rmods.flat + accBonus + wmods.attack, targets: luckTargets, actorUuid: actor.uuid, itemId: item.id
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
      await applyConditionFromItem(actor, item, ta, c, lines);
    }
    await inflictDecay(item, ta, lines);
    // An ensnaring Effect (Disguise / Illusion / Telepathy) marks every creature it affects.
    for (const eff of skillEffectKeys(sys).filter((e) => ENSNARE_EFFECTS.includes(e))) {
      if (ta !== actor) lines.push(...(await applyEnsnareMarker(actor, item, ta, eff)));
    }
  }
  if (!targetTokens.length) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeNoTargets")}</em>`);

  // Any non-die Effect (Mass Bolster / Hinder / Affinity …) — including a secondary one riding a
  // Mass Mend — or a Modifier-granted auto rule (Protection / Affinity Damage) grants the Skill's
  // Active Effect(s) to every caught creature. (Mend's own mechanic is the healing button below.)
  if (skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length) {
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
 * 3 tiles that the player ALSO targeted — so the chain only travels through chosen creatures, never
 * the caster. Each leap deals half the previous damage; the chain stops the moment a leap misses
 * (rules: "must hit each target before the leap can continue"). One combined attack+damage card.
 */
async function resolveChain(actor, item, chainTokens, { charged = false } = {}) {
  const sys = item.system;
  const { attrA, attrB, mod: accMod } = skillAccuracy(actor, item);
  const accBonus = Math.max(0, Number(sys.accuracyMod) || 0);
  const nearTiles = PROJECTANIME.chainTiles ?? 3;        // rules: leaps within 3 tiles
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
  const killed = [];
  const hits = [];

  for (let i = 0; i < maxTargets && current; i++) {
    const ta = current.actor;
    if (!ta) break;
    hitSet.add(current);
    const rmods = collectRollModifiers(actor, "attack", { target: ta });
    const { dieA, dieB } = steppedDice(actor, attrValue(actor, attrA), attrValue(actor, attrB), { accuracy: true, target: ta });
    const aroll = new Roll(checkFormula(dieA, dieB, rmods.flat + accBonus + accMod));
    await aroll.evaluate();
    rolls.push(aroll);
    const [r1, r2] = dieResults(aroll);
    const fum = r1 === 1 && r2 === 1;
    const com = r1 === r2 && r1 >= 6;
    // Each leap's defender uses its own number — Skill Evasion swaps its Attribute in.
    const { value: ev } = evasionVs(ta, item);
    const didHit = com || (!fum && (ev == null || aroll.total >= ev));
    const raw = i === 0 ? prevRaw : Math.floor(prevRaw / 2);

    const leapTag = i === 0 ? "" : `${i18n("PROJECTANIME.Roll.chainLeap", { n: i })} · `;
    const evText = ev != null ? ` vs ${ev}` : "";
    lines.push(`<span class="card-target-row">${leapTag}<strong>${ta.name}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")} <span class="muted">(${aroll.total}${evText})</span></span>`);

    if (!didHit) { stoppedName = ta.name; break; }   // must hit before the leap continues

    const adj = adjustForTarget(raw, dmg.dtype, ta, { ignoresDefense: dmg.ignoresDefense, heal: dmg.heal, pool: dmg.pool });
    for (const c of collectInflictedConditions(item, ta)) {
      await applyConditionFromItem(actor, item, ta, c, lines);
    }
    await inflictDecay(item, ta, lines);
    let through = 0;
    if (adj.heal && curseBlocks(ta, "hp")) {
      // A Cursed creature regains nothing to its cursed pool — the heal (or Absorb conversion) is voided.
      lines.push(curseNote(ta.name, "hp"));
    } else if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation. An active Barrier
      // on that pool eats its share first (the row shows what got through).
      const pool = adj.heal ? "hp" : dmg.pool;
      const bc = barrierCalc(ta, adj, pool);
      if (killsTarget(ta, { ...adj, amount: bc.amount }, pool)) killed.push(ta);
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
      through = bc.amount;
    } else {
      lines.push(`<span class="card-target-row"><span class="muted">${adj.line}</span></span>`);
    }
    // Barrier-absorbed damage never touched the creature, so it feeds no drain.
    if (!adj.heal) drainTotal += through;
    if (!adj.heal && through > 0) hits.push({ actor: ta, amount: through });
    prevRaw = raw;
    current = tokensInRange(current, nearTiles).find((t) => chosen.has(t) && !hitSet.has(t)) ?? null;
  }

  if (stoppedName) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chainStopped", { name: stoppedName })}</em>`);
  // Attacking reveals a Vanished attacker (rules v0.01) — the chain's first roll already did.
  await revealVanished(actor, lines);
  lines.push(...damageNotes(dmg));
  // Drain HP/Energy: the caster recovers half the total damage dealt across the chain.
  await applyDrain(actor, item, drainTotal, lines);
  // Retaliation: each warded creature the chain hit punishes the attacker for its own hit.
  await applyRetaliation(actor, hits, lines);

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img, meta: skillMeta(sys),
    rollHTML: await dmg.roll.render(),
    description: await enrichDescription(item), rows, lines
  }), rolls, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
  // Passive Devour: a chain that drops creatures to 0 HP lets a passive Devour Skill learn from each.
  await maybeDevourOnKill(actor, killed);
  return rolls;
}

/* -------------------------------------------- */
/*  Charge & Devour (Skill modifiers)           */
/* -------------------------------------------- */

/** Begin charging a Charge Skill: pay its Energy now (the focus turn's cost), flag the actor, and
 *  post a card with a Release button. Re-activating the Skill — or clicking Release — on a later
 *  turn resolves it at double power (rules p.13). One charge is held at a time per actor. */
async function startCharge(actor, item) {
  if (!(await spendSkillEnergy(actor, item.system, item))) return null;
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

/** Devour (a Heavy Skill modifier) on an Action/React Skill: manually copy one Skill from a creature
 *  the caster has targeted AND already reduced to 0 HP. Energy is spent only once a Skill is actually
 *  chosen, so cancelling costs nothing. (A PASSIVE Devour Skill instead auto-fires on the killing
 *  blow — see maybeDevourOnKill.) */
async function resolveDevour(actor, item) {
  // A PASSIVE Devour Skill is always-on — it auto-fires on the bearer's kills (maybeDevourOnKill),
  // so "activating" it just reports that, with no manual targeting or Energy.
  if (item.system?.actionType === "passive") {
    return postCard(actor, cardHTML({
      title: item.name,
      subtitle: i18n("PROJECTANIME.Roll.skill"),
      icon: item.img,
      description: await enrichDescription(item),
      lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.devourAlwaysOn")}</em>`]
    }));
  }
  const target = firstTargetActor();
  if (!target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
  if ((target.system?.hp?.value ?? 0) > 0) return ui.notifications.warn(i18n("PROJECTANIME.Roll.devourNotDefeated"));
  return devourFromTarget(actor, item, target, { spendEnergy: true });
}

/** Did this damage application deal the killing blow — drop a still-living creature to exactly 0 (or
 *  below) HP? True only for an HP hit (not healing, not Energy damage) on a target that was above 0.
 *  Read BEFORE the damage is applied (the HP value here is the pre-hit total). */
function killsTarget(target, adj, pool) {
  if (adj.heal || pool !== "hp") return false;
  const hp = target?.system?.hp?.value ?? 0;
  return hp > 0 && hp - adj.amount <= 0;
}

/** Passive Devour: when `actor` reduces a creature to 0 HP, a PASSIVE Skill carrying the Devour
 *  modifier auto-fires the Devour flow on each fallen creature — learning one of its Skills for free
 *  (no Energy; it's a passive proc, not an activation). A quiet no-op when the actor has no passive
 *  Devour Skill, or a victim has nothing new to teach. Called from the damage chokepoints (which know
 *  both attacker and victims) after their card posts, so the picker follows the damage card. */
async function maybeDevourOnKill(actor, killed) {
  if (!actor || !killed?.length) return;
  const devour = actor.items?.find?.((i) =>
    i.type === "skill" && i.system?.actionType === "passive" && (i.system?.modifiers ?? []).includes("devour"));
  if (!devour) return;
  for (const target of killed) await devourFromTarget(actor, devour, target, { spendEnergy: false, silent: true });
}

/** Shared Devour resolution: pick one Skill the `target` knows that `actor` lacks, then learn it (a
 *  copy onto the actor) and post a card. `spendEnergy` charges the Skill's Energy (the manual modifier
 *  path); `silent` suppresses the "nothing to devour" notice (the passive proc, so a kill on a
 *  Skill-less creature stays quiet). Returns the posted card, or null if it bailed/was cancelled. */
async function devourFromTarget(actor, item, target, { spendEnergy = true, silent = false } = {}) {
  if (!target) return null;
  const known = new Set((actor.items ?? []).filter((i) => i.type === "skill").map((i) => i.name));
  const skills = (target.items ?? []).filter((i) => i.type === "skill" && !known.has(i.name));
  if (!skills.length) {
    if (!silent) ui.notifications.warn(i18n("PROJECTANIME.Roll.devourNoSkills", { name: target.name }));
    return null;
  }

  const chosenId = await pickDevourSkill(target, skills);
  if (!chosenId) return null;   // cancelled — no Energy spent
  const chosen = skills.find((s) => s.id === chosenId);
  if (!chosen) return null;
  if (spendEnergy && !(await spendSkillEnergy(actor, item.system, item))) return null;

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

/* -------------------------------------------- */
/*  Contested Checks (rules p.5)                */
/* -------------------------------------------- */

/**
 * A Contested Check: both sides roll two Attribute dice + modifiers, the higher total wins; a
 * tie ignores the results and both roll again (bounded at 10 rounds). One card shows every
 * round's pair and the winner. Both sides take their circumstance steps (Overload etc.).
 * @returns {Promise<{won: boolean, total: number, defTotal: number}>}
 */
export async function contestedRoll({ actor, attrs, mod = 0, defender, defAttrs, defMod = 0, title, subtitle = "", icon = "" }) {
  const lines = [
    `<strong>${actor.name}</strong>: ${i18n(PROJECTANIME.attributes[attrs[0]])} + ${i18n(PROJECTANIME.attributes[attrs[1]])}`,
    `<strong>${defender.name}</strong>: ${i18n(PROJECTANIME.attributes[defAttrs[0]])} + ${i18n(PROJECTANIME.attributes[defAttrs[1]])}`
  ];
  const rolls = [];
  let total = 0, defTotal = 0;
  for (let round = 1; round <= 10; round++) {
    const a = steppedDice(actor, attrValue(actor, attrs[0]), attrValue(actor, attrs[1]));
    const aRoll = new Roll(checkFormula(a.dieA, a.dieB, mod));
    await aRoll.evaluate();
    const d = steppedDice(defender, attrValue(defender, defAttrs[0]), attrValue(defender, defAttrs[1]));
    const dRoll = new Roll(checkFormula(d.dieA, d.dieB, defMod));
    await dRoll.evaluate();
    rolls.push(aRoll, dRoll);
    total = aRoll.total;
    defTotal = dRoll.total;
    lines.push(`<span class="card-target-row"><strong>${actor.name}</strong> ${total} · <strong>${defender.name}</strong> ${defTotal}${total === defTotal ? ` — ${i18n("PROJECTANIME.Roll.contestedTie")}` : ""}</span>`);
    if (total !== defTotal) break;
  }
  const won = total > defTotal;
  await postCard(actor, cardHTML({
    title, subtitle: subtitle || i18n("PROJECTANIME.Roll.contested"), icon,
    badges: [won
      ? { cls: "success", text: i18n("PROJECTANIME.Roll.contestedWon") }
      : { cls: "failure", text: i18n("PROJECTANIME.Roll.contestedLost") }],
    lines
  }), rolls);
  return { won, total, defTotal };
}

/* -------------------------------------------- */
/*  Steal (Effect)                              */
/* -------------------------------------------- */

/** Item types Steal can lift (never Skills; the innate Natural Attack and package-granted
 *  items aren't loose possessions). */
const STEALABLE_TYPES = ["weapon", "shield", "armor", "accessory", "consumable", "gear", "container"];

/** Dialog: choose what to steal — the target's loose items, plus (at rank ⭐⭐⭐+) what it has
 *  equipped. Returns the chosen item id, or null. */
async function pickStealDialog(target, loose, equipped) {
  const opt = (i) => `<option value="${i.id}">${foundry.utils.escapeHTML(i.name)}</option>`;
  const groups = [];
  if (loose.length) groups.push(`<optgroup label="${i18n("PROJECTANIME.Roll.stealLoose")}">${loose.map(opt).join("")}</optgroup>`);
  if (equipped.length) groups.push(`<optgroup label="${i18n("PROJECTANIME.Roll.stealEquipped")}">${equipped.map(opt).join("")}</optgroup>`);
  const content = `
    <div class="project-anime roll-dialog steal-dialog">
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.stealPick", { name: target.name })}</label>
        <select name="item">${groups.join("")}</select></div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Skill.effect.steal") },
    content,
    buttons: [
      { action: "steal", label: i18n("PROJECTANIME.Roll.steal"), icon: "fas fa-hand-sparkles", default: true, callback: (e, b) => readForm(b.form) },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return result.item;
}

/**
 * The Steal flow, run from the hit card's button: pick from the target's possessions — loose
 * items always; equipped items only at rank ⭐⭐⭐+ (rules v0.01), and lifting an EQUIPPED item
 * first wins a Contested Check (this Skill's Accuracy vs the target's better of Might+Agility /
 * Might+Spirit). The transfer routes through the owner/GM relay.
 */
async function resolveSteal(actor, item, target) {
  const lootable = (target.items ?? []).filter((i) =>
    STEALABLE_TYPES.includes(i.type)
    && !i.getFlag("project-anime", "natural")
    && !i.getFlag("project-anime", "granted"));
  const loose = lootable.filter((i) => !i.system?.equipped);
  const equipped = (Number(item.system?.rank) || 1) >= 3 ? lootable.filter((i) => i.system?.equipped) : [];
  if (!loose.length && !equipped.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.stealNothing", { name: target.name }));

  const pickedId = await pickStealDialog(target, loose, equipped);
  const picked = pickedId ? target.items.get(pickedId) : null;
  if (!picked) return null;

  if (picked.system?.equipped) {
    // The equipped-item Contested Check: the defender uses the better of its two pairs (by die size).
    const acc = skillAccuracy(actor, item);
    const accBonus = Math.max(0, Number(item.system.accuracyMod) || 0);
    const pairSum = (a, b) => attrValue(target, a) + attrValue(target, b);
    const defAttrs = pairSum("might", "agility") >= pairSum("might", "spirit") ? ["might", "agility"] : ["might", "spirit"];
    const res = await contestedRoll({
      actor, attrs: [acc.attrA, acc.attrB], mod: acc.mod + accBonus,
      defender: target, defAttrs,
      title: item.name, icon: item.img
    });
    if (!res.won) return null;
  }
  return transferStolenItem(actor, target, picked);
}

/** Route the stolen item's transfer: directly when this client may edit both sides, else via
 *  the active GM. */
async function transferStolenItem(actor, target, picked) {
  if (actor.isOwner && target.isOwner) return stealItemTo(actor.uuid, target.uuid, picked.id);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "stealItem", stealerUuid: actor.uuid, targetUuid: target.uuid, itemId: picked.id });
    return true;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/** Move one item from `targetUuid` to `stealerUuid` (one unit off a stack), stripped of the
 *  flags and equip state that belong to its old owner. Exported for the GM-side socket relay. */
export async function stealItemTo(stealerUuid, targetUuid, itemId) {
  const stealer = await fromUuid(stealerUuid);
  const target = await fromUuid(targetUuid);
  const picked = target?.items?.get(itemId);
  if (!stealer || !picked) return;

  const data = picked.toObject();
  delete data._id;
  delete data.folder;
  data.sort = 0;
  if (data.system && "equipped" in data.system) data.system.equipped = false;
  if (data.system && "container" in data.system) data.system.container = "";
  for (const k of ["natural", "granted", "grantedBy", "grantSource", "readied"]) {
    if (data.flags?.["project-anime"]?.[k] !== undefined) delete data.flags["project-anime"][k];
  }

  const qty = Number(picked.system?.quantity);
  if (Number.isFinite(qty) && qty > 1) {
    foundry.utils.setProperty(data, "system.quantity", 1);
    await picked.update({ "system.quantity": qty - 1 });
  } else {
    await picked.delete();
  }
  await stealer.createEmbeddedDocuments("Item", [data]);
  return postCard(stealer, cardHTML({
    title: data.name,
    subtitle: i18n("PROJECTANIME.Skill.effect.steal"),
    icon: data.img,
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.stole", { thief: stealer.name, item: data.name, name: target.name })}</em>`]
  }));
}

/** "Steal Item" chat-card button → the pick / contest / transfer flow. */
async function onStealItemButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  const item = actor?.items.get(el.dataset.itemId);
  const target = el.dataset.targetUuid ? await fromUuid(el.dataset.targetUuid) : null;
  if (!item || !target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  return resolveSteal(actor, item, target);
}

/* -------------------------------------------- */
/*  Conjure (Effect)                            */
/* -------------------------------------------- */

/** Dialog: what to conjure — an entry from the gear compendiums (Weapons / Armor / Shields), or
 *  a free-text object (typed text wins). Returns { uuid } | { name } | null. */
async function pickConjureDialog() {
  const groups = [];
  for (const name of ["weapons", "armor", "shields"]) {
    const pack = game.packs.get(`project-anime.${name}`);
    if (!pack) continue;
    const index = await pack.getIndex();
    const opts = index.contents
      .map((e) => ({ uuid: e.uuid, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `<option value="${e.uuid}">${foundry.utils.escapeHTML(e.name)}</option>`)
      .join("");
    if (opts) groups.push(`<optgroup label="${foundry.utils.escapeHTML(pack.metadata.label)}">${opts}</optgroup>`);
  }
  const content = `
    <div class="project-anime roll-dialog conjure-dialog">
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.conjureGear")}</label>
        <select name="uuid"><option value=""></option>${groups.join("")}</select></div>
      <div class="form-group"><label>${i18n("PROJECTANIME.Roll.conjureObject")}</label>
        <input type="text" name="name" value="" /></div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Skill.effect.conjure") },
    content,
    buttons: [
      { action: "conjure", label: i18n("PROJECTANIME.Roll.conjure"), icon: "fas fa-wand-sparkles", default: true, callback: (e, b) => readForm(b.form) },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  const name = (result.name ?? "").trim();
  if (name) return { name };
  if (result.uuid) return { uuid: result.uuid };
  return null;
}

/** Create item documents on a target actor. Exported for the GM-side socket relay. An item
 *  flagged `conjureEquip` equips AFTER creation, so the equip-exclusivity hook (which watches
 *  updates, not creates) can displace whatever held its slot. */
export async function createItemsOn(targetUuid, items) {
  const target = await fromUuid(targetUuid);
  if (target?.documentName !== "Actor" || !items?.length) return;
  const created = await target.createEmbeddedDocuments("Item", items);
  for (const doc of created ?? []) {
    if (doc.getFlag("project-anime", "conjureEquip")) {
      await doc.update({ "system.equipped": true, "flags.project-anime.-=conjureEquip": null });
    }
  }
}

/**
 * Conjure (rules v0.01): materialize a mundane weapon, armor, or object out of nothing. The
 * pick happens BEFORE Energy is spent (cancelling costs nothing). The conjured item lands on
 * the Skill's recipient (Self by default; a targeted ally for an Ally/Any conjure), flagged and
 * auto-equipped to its slot; a lifetime marker on the caster carries the Skill's Duration —
 * when the marker goes (expiry, dismissal, the scene sweep, or its channel ending), every item
 * carrying its key evaporates (the deleteActiveEffect hook in project-anime.mjs).
 */
async function resolveConjure(actor, item) {
  const sys = item.system;
  // Resolve the recipient BEFORE anything is spent: an Ally-target Conjure must land on a
  // targeted ally — never the caster (rules v0.01) — so with no valid recipient it doesn't fire.
  const recipient = skillEffectTargets(actor, item, null)[0]
    ?? (skillTarget(sys) === "ally" ? null : actor);
  if (!recipient) return ui.notifications.warn(i18n("PROJECTANIME.Roll.allyNotSelf"));
  const choice = await pickConjureDialog();
  if (!choice) return null;
  if (!(await spendSkillEnergy(actor, sys, item))) return null;
  if (sys.actionType !== "passive" && skillDuration(sys) === "channeled") await ensureChannelMarker(actor, item);

  let data;
  if (choice.uuid) {
    const src = await fromUuid(choice.uuid);
    if (!src || src.documentName !== "Item") return null;
    data = src.toObject();
    delete data._id;
    delete data.folder;
  } else {
    data = { name: choice.name, type: "gear", img: item.img };
  }
  const conjureKey = `${item.id}:${foundry.utils.randomID(8)}`;
  foundry.utils.setProperty(data, "flags.project-anime.conjured", conjureKey);
  if (data.system && "equipped" in data.system) {
    data.system.equipped = false;
    foundry.utils.setProperty(data, "flags.project-anime.conjureEquip", true);
  }

  if (recipient.isOwner) await createItemsOn(recipient.uuid, [data]);
  else if (game.users.activeGM) game.socket.emit("system.project-anime", { type: "createItems", targetUuid: recipient.uuid, items: [data] });
  else return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));

  // The lifetime marker: Standard → its turn count in rounds (Instant → this round); Scene /
  // Channeled → the scene flag (combat-end sweep), a channeled cast also riding its channel key
  // so the channel's end deletes the marker (whose own deletion evaporates the item).
  const mode = skillDuration(sys);
  const scene = mode === "scene" || mode === "channeled";
  const duration = {};
  if (!scene) {
    duration.rounds = mode === "instant" ? 1 : (sys.effectDuration ?? PROJECTANIME.standardDurationTurns);
    duration.startTime = game.time?.worldTime ?? 0;
    if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
  }
  const markerFlags = { conjureMarker: conjureKey, scene };
  const channelKey = activeChannelKey(actor, item);
  if (mode === "channeled" && channelKey) markerFlags.channelKey = channelKey;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("PROJECTANIME.Roll.conjureMarker", { name: data.name }),
    img: data.img || item.img,
    duration,
    flags: { "project-anime": markerFlags }
  }]);

  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(sys),
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.conjured", { name: recipient.name, item: data.name })}</em>`]
  }));
}

/* -------------------------------------------- */
/*  Gate (Effect)                               */
/* -------------------------------------------- */

/**
 * Gate (rules v0.01): link two open tiles within range. Both points are picked BEFORE Energy is
 * spent; each becomes a portal Tile (GM-relayed — players can't create tiles), and a lifetime
 * marker on the caster carries the Skill's Duration. Deleting the marker (expiry, dismissal,
 * the scene sweep, or its channel ending) removes both gate tiles. Stepping through is the
 * table's move — the gates mark the link, they don't teleport.
 */
async function resolveGate(actor, item) {
  if (!canvas?.ready) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needToken"));
  const sys = item.system;
  const ctoken = casterToken(actor);
  const rangeTiles = sys.range?.tiles ?? PROJECTANIME.rangeTiles[sys.range?.scope] ?? 5;
  const restore = minimizeSheetForPlacement(actor);
  let a = null, b = null;
  try {
    a = await placeTemplate({
      t: "circle", distanceTiles: 0.5, origin: ctoken?.center ?? null, follow: "point",
      maxRangeTiles: ctoken ? rangeTiles : null, hint: i18n("PROJECTANIME.Roll.placeGateA")
    });
    if (a) {
      b = await placeTemplate({
        t: "circle", distanceTiles: 0.5, origin: ctoken?.center ?? null, follow: "point",
        maxRangeTiles: ctoken ? rangeTiles : null, hint: i18n("PROJECTANIME.Roll.placeGateB")
      });
    }
  } finally {
    restore();
  }
  // The targeting templates were only pickers — clean them up regardless of outcome.
  for (const res of [a, b]) { if (res?.doc) await res.doc.delete().catch(() => {}); }
  if (!a || !b) return null;
  if (!(await spendSkillEnergy(actor, sys, item))) return null;
  if (sys.actionType !== "passive" && skillDuration(sys) === "channeled") await ensureChannelMarker(actor, item);

  const gateKey = `${item.id}:${foundry.utils.randomID(8)}`;
  const gs = canvas.dimensions.size;
  const snap = (p) => canvas.grid.getTopLeftPoint ? canvas.grid.getTopLeftPoint(p) : { x: p.x - gs / 2, y: p.y - gs / 2 };
  const tiles = [a.point, b.point].map((p) => {
    const tl = snap(p);
    return {
      texture: { src: "icons/svg/portal.svg" },
      x: tl.x, y: tl.y, width: gs, height: gs,
      flags: { "project-anime": { gateKey } }
    };
  });
  if (game.user.isGM) await canvas.scene.createEmbeddedDocuments("Tile", tiles);
  else if (game.users.activeGM) game.socket.emit("system.project-anime", { type: "placeGates", sceneId: canvas.scene.id, tiles });
  else return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));

  const mode = skillDuration(sys);
  const scene = mode === "scene" || mode === "channeled";
  const duration = {};
  if (!scene) {
    duration.rounds = mode === "instant" ? 1 : (sys.effectDuration ?? PROJECTANIME.standardDurationTurns);
    duration.startTime = game.time?.worldTime ?? 0;
    if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
  }
  const markerFlags = { gateMarker: gateKey, scene };
  const channelKey = activeChannelKey(actor, item);
  if (mode === "channeled" && channelKey) markerFlags.channelKey = channelKey;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("PROJECTANIME.Roll.gateMarker", { name: item.name }),
    img: "icons/svg/portal.svg",
    duration,
    flags: { "project-anime": markerFlags }
  }]);

  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(sys),
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.gateOpened")}</em>`]
  }));
}

/* -------------------------------------------- */
/*  Vanish (Effect) & Sense detection           */
/* -------------------------------------------- */

/** Cast Vanish: the caster gains the Vanished status for the Skill's Duration — Standard runs
 *  the normal condition timer; Scene lasts until the combat-end sweep; Channeled rides the open
 *  channel (its key on the status copy, swept when the channel ends). */
async function applyVanish(actor, item, lines) {
  const mode = skillDuration(item.system);
  await applyStatusEffect(actor, "vanished", skillStatusDuration(item));
  if (mode === "scene" || mode === "channeled") {
    // A scene/channel lifetime replaces the turn countdown: drop the timer, stamp the flags.
    if ("vanished" in (actor.getFlag("project-anime", "statusTimers") ?? {})) {
      await actor.update({ "flags.project-anime.statusTimers.-=vanished": null });
    }
    const ae = (actor.effects ?? []).find((e) => e.statuses?.has?.("vanished"));
    if (ae) {
      const update = { "flags.project-anime.scene": true };
      const channelKey = activeChannelKey(actor, item);
      if (mode === "channeled" && channelKey) update["flags.project-anime.channelKey"] = channelKey;
      await ae.update(update);
    }
  }
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.vanished", { name: actor.name })}</em>`);
}

/** Attacking reveals a Vanished creature (rules v0.01) — called after any Accuracy roll the
 *  bearer makes against a creature. Ends the status; a Channeled Vanish's channel ends with it
 *  (no point paying upkeep on a broken shroud). */
async function revealVanished(actor, lines) {
  if (!actor?.statuses?.has?.("vanished")) return;
  await applyStatusTo(actor.uuid, "vanished", false);
  const markers = (actor.effects ?? []).filter((e) => {
    const f = e.flags?.["project-anime"];
    if (!f?.channelSource) return false;
    const src = actor.items.get(f.channelSource);
    return src?.type === "skill" && skillEffectKeys(src.system).includes("vanish");
  }).map((e) => e.id);
  if (markers.length) await actor.deleteEmbeddedDocuments("ActiveEffect", markers);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.vanishRevealed", { name: actor.name })}</em>`);
}

/** The Vanish skill's "Stay Hidden" roll (rules v0.01: a creature actively looking for you —
 *  the VANISHER rolls their Accuracy against the seeker's Skill Evasion; the doc leaves the
 *  seeker's Skill Evasion unstated, so it uses the better of Mind / Spirit). */
async function onStayHiddenButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  const item = actor?.items.get(el.dataset.itemId);
  if (!item) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  const seeker = firstTargetActor();
  if (!seeker) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));

  const gear = seeker.system?.evasion?.gearMod ?? 0;
  const ev = Math.max(...skillEvasionKeys("mindSpirit").map((k) => Math.max(0, attrValue(seeker, k) + gear)));
  const acc = skillAccuracy(actor, item);
  const accBonus = Math.max(0, Number(item.system.accuracyMod) || 0);
  const { dieA, dieB } = steppedDice(actor, attrValue(actor, acc.attrA), attrValue(actor, acc.attrB));
  const roll = new Roll(checkFormula(dieA, dieB, acc.mod + accBonus));
  await roll.evaluate();
  const hidden = roll.total >= ev;
  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.stayHidden"),
    icon: item.img,
    badges: [hidden
      ? { cls: "success", text: i18n("PROJECTANIME.Roll.staysHidden") }
      : { cls: "failure", text: i18n("PROJECTANIME.Roll.detected") }],
    rollHTML: await roll.render(),
    lines: [`${vsEvasionText("mindSpirit")} <strong>${seeker.name}</strong>: ${ev}`]
  }), roll);
}

/** Sense vs Vanish (rules v0.01): a Sense Skill aimed at a Vanished creature rolls ⟪Mind⟫ +
 *  ⟪Spirit⟫ — one die Stepped Up — against the vanisher's Skill Evasion (its Vanish Skill's
 *  pair; the better of the two for the defender). Reports detection; the table adjudicates. */
async function resolveSenseDetect(actor, item, targetActor) {
  let dieA = attrValue(actor, "mind");
  let dieB = attrValue(actor, "spirit");
  // "Step Up one of your dice": step the larger (the smaller when the larger is already d12).
  if (dieA >= dieB && dieA < 12) dieA = stepUpValue(dieA);
  else dieB = stepUpValue(dieB);

  const vanishSkill = (targetActor.items ?? []).find((i) => i.type === "skill" && skillEffectKeys(i.system).includes("vanish"));
  const seKey = (vanishSkill && skillEvasionAttr(vanishSkill.system)) || "mindSpirit";
  const gear = targetActor.system?.evasion?.gearMod ?? 0;
  const ev = Math.max(...skillEvasionKeys(seKey).map((k) => Math.max(0, attrValue(targetActor, k) + gear)));

  const roll = new Roll(checkFormula(dieA, dieB, 0));
  await roll.evaluate();
  const detected = roll.total >= ev;
  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.senseDetect"),
    icon: item.img,
    meta: skillMeta(item.system),
    badges: [detected
      ? { cls: "success", text: i18n("PROJECTANIME.Roll.detected") }
      : { cls: "failure", text: i18n("PROJECTANIME.Roll.notDetected") }],
    rollHTML: await roll.render(),
    description: await enrichDescription(item),
    lines: [
      `<em class="muted">${i18n("PROJECTANIME.Roll.senseSteppedUp")}</em>`,
      `${vsEvasionText(seKey)} <strong>${targetActor.name}</strong>: ${ev}`
    ]
  }), roll);
}

/* -------------------------------------------- */
/*  Ensnare markers (Disguise/Illusion/Telepathy)*/
/* -------------------------------------------- */

/** The Effects whose landing ENSNARES the target — each leaves a tracked marker the table can
 *  see and the Overcome action can clear. */
const ENSNARE_EFFECTS = ["disguise", "illusion", "telepathy"];

/**
 * Stamp an ensnare marker on the affected creature: the Skill's name + icon, its Duration as
 * the lifetime (Scene/Channeled ride the usual flags), the Skill-Die size as the Overcome CT,
 * and an autoKey so a re-cast refreshes rather than stacks. `self` marks the caster's own
 * Disguise shroud. Skipped while the target is Overcome-immune to this Skill.
 */
async function applyEnsnareMarker(actor, item, targetActor, effectKey, { self = false } = {}) {
  if (!targetActor) return [];
  if (!self && overcomeImmune(targetActor, item.uuid)) {
    return [`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeImmune", { name: targetActor.name, condition: item.name })}</em>`];
  }
  const mode = skillDuration(item.system);
  const scene = mode === "scene" || mode === "channeled";
  const duration = {};
  if (!scene) {
    duration.rounds = mode === "instant" ? 1 : (item.system?.effectDuration ?? PROJECTANIME.standardDurationTurns);
    duration.startTime = game.time?.worldTime ?? 0;
    if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
  }
  const flags = {
    ensnare: effectKey,
    ensnareSource: item.uuid,
    autoKey: `${item.id}:${effectKey}:${targetActor.id}`,
    overcomeCT: attrValue(actor, skillDieAttr(item)),
    scene
  };
  const channelKey = activeChannelKey(actor, item);
  if (mode === "channeled" && channelKey) flags.channelKey = channelKey;
  const data = {
    name: item.name,
    img: item.img,
    duration,
    flags: { "project-anime": flags }
  };
  if (await routeEffectApply(targetActor, data)) {
    const key = self ? "ensnareSelf" : "ensnared";
    return [`<em class="muted">${i18n(`PROJECTANIME.Roll.${key}`, { name: targetActor.name, skill: item.name })}</em>`];
  }
  return [];
}

/* -------------------------------------------- */
/*  Combo extra turn (rules p.13)               */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Overcome (rules v0.01)                      */
/* -------------------------------------------- */

/**
 * The Overcome action: shrug off a Status Effect or an ensnaring Skill (Disguise / Illusion /
 * Telepathy). The bearer describes the attempt and rolls a Check of their chosen two Attributes
 * against a Challenge Threshold — prefilled with the inflicting Skill's die size when one was
 * stamped ("the Difficulty is set by the Skill die"), otherwise the table sets it. Success ends
 * the effect and grants immunity to re-application from the same source for the next 2 turns.
 * Opened from the Effects Panel's right-click. Returns the roll, or null if cancelled/invalid.
 */
export async function performOvercome(actor, effect) {
  const flags = effect?.flags?.["project-anime"] ?? {};
  const statusId = [...(effect?.statuses ?? [])].find((s) => (PROJECTANIME.conditionKeys ?? []).includes(s)) ?? null;
  const ensnare = flags.ensnare ?? null;
  if (!actor || (!statusId && !ensnare)) return null;

  const storedCT = statusId
    ? Number(actor.getFlag("project-anime", "overcomeCT")?.[statusId]) || null
    : Number(flags.overcomeCT) || null;
  const choice = await promptRoll({
    title: `${i18n("PROJECTANIME.Roll.overcome")} — ${effect.name}`,
    actor, attrA: "might", attrB: "spirit", ct: storedCT
  });
  if (!choice) return null;
  const ct = choice.ct ?? storedCT ?? 10;

  const rmods = collectRollModifiers(actor, "check");
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, choice.attrA), attrValue(actor, choice.attrB));
  const roll = new Roll(checkFormula(dieA, dieB, choice.mod + rmods.flat));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;
  const success = combo || (!fumble && roll.total >= ct);

  const lines = [
    `<strong>${i18n(PROJECTANIME.attributes[choice.attrA])} + ${i18n(PROJECTANIME.attributes[choice.attrB])}</strong>`,
    ...stepNotes(reasons),
    `${i18n("PROJECTANIME.Roll.ct")}: ${ct}`
  ];
  const modLine = rollModLine(rmods); if (modLine) lines.push(modLine);
  const badges = [];
  if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
  badges.push(success
    ? { cls: "success", text: i18n("PROJECTANIME.Roll.overcame") }
    : { cls: "failure", text: i18n("PROJECTANIME.Roll.failure") });

  if (success) {
    // End the effect: a status routes through applyStatusTo so its timers and valued flags clear
    // with it; an ensnare marker just deletes. Then ward against the same source for 2 turns.
    const immunityKey = ensnare ? (flags.ensnareSource || effect.uuid) : `status:${statusId}`;
    if (statusId) await applyStatusTo(actor.uuid, statusId, false);
    else await effect.delete();
    const duration = { rounds: 2, startTime: game.time?.worldTime ?? 0 };
    if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.format("PROJECTANIME.Roll.overcomeMarker", { name: effect.name }),
      img: "icons/svg/angel.svg",
      duration,
      flags: { "project-anime": { overcomeImmunity: immunityKey } }
    }]);
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeEnds", { name: actor.name, effect: effect.name })}</em>`);
  }
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }

  await postCard(actor, cardHTML({
    title: i18n("PROJECTANIME.Roll.overcome"),
    subtitle: effect.name,
    icon: effect.img,
    badges,
    rollHTML: await roll.render(),
    lines
  }), roll, { combo });
  return roll;
}

/**
 * A Combo grants an extra turn — but only on your OWN combat turn, and a combo-granted turn
 * can't produce another (rules p.13). Flags the active combat so the next turn-advance stays on
 * this combatant (the Combat#nextTurn patch in project-anime.mjs consumes it). Routed via the
 * GM for players. Quietly does nothing out of combat or on someone else's turn (a React combo).
 */
function maybeGrantComboTurn(actor) {
  const combat = game.combat;
  if (!actor || !combat?.started) return;
  const cur = combat.combatant;
  if (!cur || cur.actor !== actor) return;
  const key = `${cur.id}:${combat.round}`;   // round-stamped, so a stale grant can't resurface
  const flags = combat.flags?.["project-anime"] ?? {};
  if (flags.comboGranted === key) return;    // no combo chains
  if (flags.comboTurn === key) return;       // already pending
  if (game.user.isGM) combat.setFlag("project-anime", "comboTurn", key);
  else if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "comboTurn", combatId: combat.id, combatantId: cur.id, actorUuid: actor.uuid });
  }
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
  // A Cursed drinker regains nothing to the cursed pool — block the use outright when this
  // consumable restores that pool (nothing is consumed or wasted); a pool it doesn't curse is fine.
  if ((type === "hp" || type === "energy") && amount > 0 && curseBlocks(actor, type)) {
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.cursedNoRecoveryPool", { name: actor.name, pool: i18n(`PROJECTANIME.Stat.${type}`) }));
  }
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
  html.querySelectorAll("[data-action='stealItem']").forEach((btn) => { btn.onclick = onStealItemButton; });
  html.querySelectorAll("[data-action='stayHidden']").forEach((btn) => { btn.onclick = onStayHiddenButton; });
  html.querySelectorAll("[data-action='dismissServant']").forEach((btn) => { btn.onclick = onDismissServantButton; });
}

/** "Dismiss" on a servant's raise card → release (delete) the servant; the deleteActor hook in
 *  project-anime.mjs prunes the master's ledger and restores the locked Energy. */
async function onDismissServantButton(event) {
  event.preventDefault();
  const servant = await fromUuid(event.currentTarget.dataset.servantUuid);
  if (!servant) return ui.notifications.warn(i18n("PROJECTANIME.Roll.targetGone"));
  return confirmAndDismiss(servant);
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

/** How much of a damage hit the target's Barrier absorbs (rules v0.01: while Barrier is active,
 *  damage to HP or Energy is dealt to the Barrier first; HP and Energy barriers are separate
 *  pools). PURE read — `{ through, absorbed }`; the decrement happens in applyDamageTo, the
 *  single enforcement point, while the damage-card rows use this same split for display. */
export function barrierSplit(target, amount, pool = "hp") {
  if (!(amount > 0) || !target?.statuses?.has?.("barrier")) return { through: amount, absorbed: 0 };
  const key = pool === "energy" ? "energy" : "hp";
  const value = Math.max(0, Math.round(Number(target.getFlag?.("project-anime", "barrier")?.[key]) || 0));
  const absorbed = Math.min(value, amount);
  return { through: amount - absorbed, absorbed };
}

/** The damage-card calc suffix + row amount for one application, barrier-aware. */
function barrierCalc(target, adj, pool) {
  if (adj.heal || !(adj.amount > 0)) return { amount: adj.amount, calc: adj.line };
  const { through, absorbed } = barrierSplit(target, adj.amount, pool);
  if (!absorbed) return { amount: adj.amount, calc: adj.line };
  return { amount: through, calc: `${adj.line} · ${i18n("PROJECTANIME.Roll.barrierAbsorbed", { n: absorbed })}` };
}

/**
 * Apply HP damage (or healing) to a target actor, clamped to [0, max].
 * Runs on whichever client owns the target: the clicker if they own it,
 * otherwise the active GM via the socket relay in project-anime.mjs. Centralized
 * so both paths clamp identically. Exported for the socket handler.
 * Damage is dealt to an active Barrier on that pool first (rules v0.01): the Barrier's value
 * absorbs what it can and only the remainder reaches the stat; a drained Barrier (both pools
 * empty) drops its status. Healing and Barrier never interact. `ignoreBarrier` is the undo
 * path's escape hatch — reversing an applied heal is bookkeeping, not an attack to absorb.
 */
export async function applyDamageTo(targetUuid, amount, heal, pool = "hp", { ignoreBarrier = false } = {}) {
  const target = await fromUuid(targetUuid);
  if (!target) return;
  const key = pool === "energy" ? "energy" : "hp";
  let applied = amount;
  if (!heal && !ignoreBarrier) {
    const { through, absorbed } = barrierSplit(target, amount, key);
    if (absorbed > 0) {
      applied = through;
      const flag = foundry.utils.deepClone(target.getFlag("project-anime", "barrier") ?? {});
      flag[key] = Math.max(0, (Number(flag[key]) || 0) - absorbed);
      await target.setFlag("project-anime", "barrier", flag);
      if (!(flag.hp > 0) && !(flag.energy > 0)) await applyStatusTo(target.uuid, "barrier", false);
    }
  }
  if (!(applied > 0) && !heal) return;
  const stat = target.system[key] ?? { value: 0, max: 0 };
  const next = Math.clamp(stat.value + (heal ? applied : -applied), 0, stat.max);
  await target.update({ [`system.${key}.value`]: next });
}

/** A status condition that auto-expires by counting down the target's own turns (rules: default
 *  2 turns, set by its source). Excludes `stunned` (skip-based — handled by the combat turn-tick).
 *  Lingering (`decay`) runs on this standard timer like every other condition — its 1 damage
 *  ticks each of the bearer's turns while it lasts. The countdown itself lives in
 *  project-anime.mjs (tickStatusDurations). */
function isTimedStatus(statusId) {
  return (PROJECTANIME.conditionKeys ?? []).includes(statusId) && statusId !== "stunned";
}

/** How many of the target's own turns a status inflicted by this item lasts: the Skill's authored
 *  Duration if it set one ("said otherwise by the skill"), else the rules default of 2. Weapons have
 *  no Duration field, so weapon-inflicted statuses always use the default. */
function skillStatusDuration(item) {
  const d = item?.system?.effectDuration;
  return Number.isInteger(d) && d >= 1 ? d : 2;
}

/**
 * Apply (or remove) a status condition on a target. Runs on whichever client owns the target.
 * Exported for the GM-side socket relay in project-anime.mjs. For a timed condition (see
 * isTimedStatus) a per-target turn counter is stamped under flags.project-anime.statusTimers so the
 * combat turn-tick can count it down at the end of the target's turn and remove it at 0 — re-applying
 * the same status REFRESHES it to the longer remaining duration rather than stacking (rules p.13).
 * Removing a status clears its counter. `duration` defaults to the rules' 2 turns.
 */
export async function applyStatusTo(targetUuid, statusId, active = true, duration = 2, { decayType = "", value = 0, pool = "hp", overcomeCT = 0 } = {}) {
  const target = await fromUuid(targetUuid);
  if (!target?.toggleStatusEffect) return;
  await target.toggleStatusEffect(statusId, { active });
  // Lingering (`decay`) carries an optional Element (its damage type) so the end-of-turn tick can
  // affinity-adjust the 1 HP it deals. Stash it on apply (or clear a stale one when applied
  // untyped), wipe on removal — then fall through to the standard timer stamping below.
  if (statusId === "decay") {
    if (active && decayType) await target.setFlag("project-anime", "decayType", decayType);
    else if (target.getFlag("project-anime", "decayType")) await target.update({ "flags.project-anime.-=decayType": null });
  }
  // A VALUED status (Barrier / Regen) carries its value on the chosen pool (rules v0.01):
  // flags.project-anime.<status> = { hp, energy }. Conditions never stack — re-application
  // REFRESHES to the higher value (like the timers below). Removal clears the whole flag.
  if ((PROJECTANIME.valuedStatuses ?? []).includes(statusId)) {
    if (active && value > 0) {
      const key = pool === "energy" ? "energy" : "hp";
      const flag = foundry.utils.deepClone(target.getFlag("project-anime", statusId) ?? {});
      flag[key] = Math.max(Number(flag[key]) || 0, Math.round(value));
      await target.setFlag("project-anime", statusId, flag);
    } else if (!active && target.getFlag("project-anime", statusId)) {
      await target.update({ [`flags.project-anime.-=${statusId}`]: null });
    }
  }
  // Curse carries the single pool whose recovery it blocks (rules v0.01: the HP/Energy choice is
  // made at Skill creation). flags.project-anime.curse = { pool }; cleared on removal. A Curse
  // applied with no pool (a hand-toggle bypasses this path) leaves no flag and blocks both pools.
  if (statusId === "curse") {
    if (active && (pool === "hp" || pool === "energy")) await target.setFlag("project-anime", "curse", { pool });
    else if (!active && target.getFlag("project-anime", "curse")) await target.update({ "flags.project-anime.-=curse": null });
  }
  // The Overcome action's Difficulty "is set by the Skill die" (rules v0.01) — a Skill-inflicted
  // status stamps its die size so the Overcome dialog can prefill the CT. Cleared with the status.
  if (active && overcomeCT > 0) await target.setFlag("project-anime", "overcomeCT", { [statusId]: Math.round(overcomeCT) });
  else if (!active && statusId in (target.getFlag("project-anime", "overcomeCT") ?? {})) {
    await target.update({ [`flags.project-anime.overcomeCT.-=${statusId}`]: null });
  }
  if (!isTimedStatus(statusId)) return;
  if (active) {
    const turns = Number.isInteger(duration) && duration >= 1 ? duration : 2;
    const prev = Number(target.getFlag("project-anime", "statusTimers")?.[statusId]) || 0;
    await target.setFlag("project-anime", "statusTimers", { [statusId]: Math.max(prev, turns) });
  } else if (statusId in (target.getFlag("project-anime", "statusTimers") ?? {})) {
    await target.update({ [`flags.project-anime.statusTimers.-=${statusId}`]: null });
  }
}

/** Inflict a status on a target from a roll: directly if owned, else via the GM relay. The status
 *  lifetime is the Skill's Duration or the rules default of 2 (see skillStatusDuration). */
async function applyStatusEffect(targetActor, statusId, duration = 2, { decayType = "", value = 0, pool = "hp", overcomeCT = 0 } = {}) {
  if (!targetActor || !statusId) return;
  if (targetActor.isOwner) await applyStatusTo(targetActor.uuid, statusId, true, duration, { decayType, value, pool, overcomeCT });
  else if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyStatus", targetUuid: targetActor.uuid, statusId, active: true, duration, decayType, value, pool, overcomeCT });
  }
}

/** Overcome immunity (rules v0.01: succeeding on Overcome makes you immune to that Skill's
 *  effects for the next 2 turns): true while the target carries an immunity marker keyed to this
 *  source — the inflicting Skill's uuid, or `status:<id>` for a plain overcome status. */
function overcomeImmune(target, sourceKey) {
  if (!target || !sourceKey) return false;
  return (target.effects ?? []).some((e) => e.flags?.["project-anime"]?.overcomeImmunity === sourceKey);
}

/** The Skill-Die Attribute key a Skill's valued/contested numbers read (the designer's chosen
 *  die — damageAttr resolves "attrA"/"attrB" to the real Attribute). */
function skillDieAttr(item) {
  const at = item?.system?.attributes ?? {};
  return at[item?.system?.damageAttr] ?? at.attrA ?? "might";
}

/**
 * Apply ONE inflicted condition from a used item to a struck/affected target, with its chat line.
 * The shared rider used by every hit path (single, area, chain, weapon). A VALUED status
 * (Barrier / Regen) rolls the caster's Skill Die for its value and carries the Skill's chosen
 * pool (rules v0.01 Inflict: the HP/Energy choice is made at Skill creation; the value itself is
 * unspecified in the doc — the system uses the Skill's own die, matching Strike/Heal). A target
 * still immune from a successful Overcome shrugs the application off.
 */
async function applyConditionFromItem(actor, item, targetActor, c, lines) {
  if (!targetActor) return;
  if (overcomeImmune(targetActor, item?.uuid) || overcomeImmune(targetActor, `status:${c.id}`)) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeImmune", { name: targetActor.name, condition: c.label })}</em>`);
    return;
  }
  const opts = {};
  let label = c.label;
  if (item?.type === "skill") {
    opts.overcomeCT = attrValue(actor, skillDieAttr(item));
    if ((PROJECTANIME.valuedStatuses ?? []).includes(c.id)) {
      const roll = new Roll(`1d${attrValue(actor, skillDieAttr(item))}`);
      await roll.evaluate();
      opts.value = roll.total;
      opts.pool = item.system?.inflictPool === "energy" ? "energy" : "hp";
      label = `${c.label} ${opts.value} (${i18n(`PROJECTANIME.Stat.${opts.pool}`)})`;
    } else if (c.id === "curse") {
      // Curse carries the single pool whose recovery it blocks (chosen at Skill creation).
      opts.pool = item.system?.inflictPool === "energy" ? "energy" : "hp";
      label = `${c.label} (${i18n(`PROJECTANIME.Stat.${opts.pool}`)})`;
    }
  }
  await applyStatusEffect(targetActor, c.id, skillStatusDuration(item), opts);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: label, name: targetActor.name })}</em>`);
}

/** A Skill whose Inflict Modifier chose LINGERING marks the creature it lands on with the
 *  Lingering status (1 damage at the end of each of their turns, on the standard condition timer —
 *  the damage + count-down live in the combat turn-tick in project-anime.mjs). Lingering routes
 *  through here (not collectInflictedConditions) so its chosen element rides along. The Skill's
 *  Duration overrides the default 2 turns. No-op for non-Skills / other Inflict choices. */
async function inflictDecay(item, targetActor, lines) {
  if (item?.type !== "skill" || !targetActor) return;
  if (!(item.system.modifiers ?? []).includes("inflict") || item.system.inflictStatus !== "decay") return;
  const element = item.system.decayType || "";
  const condition = element
    ? `${elementLabel(element)} ${i18n("PROJECTANIME.Status.decay")}`
    : i18n("PROJECTANIME.Status.decay");
  // A target still immune from a successful Overcome shrugs the Lingering off like any condition.
  if (overcomeImmune(targetActor, item.uuid) || overcomeImmune(targetActor, "status:decay")) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeImmune", { name: targetActor.name, condition })}</em>`);
    return;
  }
  const overcomeCT = item.actor ? attrValue(item.actor, skillDieAttr(item)) : 0;
  await applyStatusEffect(targetActor, "decay", skillStatusDuration(item), { decayType: element, overcomeCT });
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition, name: targetActor.name })}</em>`);
}

/** Apply a Skill's on-hit conditions (target-scope) + Decay to a struck target. Mutates `lines`.
 *  No-op without a target. Idempotent (status toggles), so safe to re-run on a Luck flip-to-hit. */
async function applyOnHitConditions(actor, item, targetActor, lines) {
  if (!targetActor) return;
  for (const c of collectInflictedConditions(item, targetActor)) {
    await applyConditionFromItem(actor, item, targetActor, c, lines);
  }
  await inflictDecay(item, targetActor, lines);
}

/** The full on-hit (enemy) payload of a Skill landing on one target: inflicted conditions, Decay,
 *  and the Skill's Active Effect(s) (auto-Hinder + authored / Bolster). Idempotent — auto-effects
 *  refresh by `autoKey` and status toggles no-op if already set — so Spend Luck can call it when a
 *  re-roll turns a miss into a hit without double-applying. Returns chat-card lines. */
async function applySkillOnHit(actor, item, targetActor) {
  const lines = [];
  await applyOnHitConditions(actor, item, targetActor, lines);
  // An ensnaring Effect's marker lands with the flip-to-hit too (autoKey keeps it idempotent).
  for (const eff of skillEffectKeys(item.system).filter((e) => ENSNARE_EFFECTS.includes(e))) {
    if (targetActor && targetActor !== actor) lines.push(...(await applyEnsnareMarker(actor, item, targetActor, eff)));
  }
  if (skillEffectKeys(item.system).some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length) {
    lines.push(...(await applySkillEffects(actor, item, targetActor ? [targetActor] : null, { landed: true })));
  }
  return lines;
}

/** The actors a Skill's on-use effects land on: an explicit list (area Skills), else — for a
 *  Self-Target or Self-range Skill — always the caster (even if a creature is targeted), else the
 *  targeted creatures, else the caster. An Ally Skill never lands on the caster (rules v0.01:
 *  "If an effect targets allies, you cannot use it on yourself") — with nothing else targeted it
 *  lands on no one (the pre-flight in rollSkill warns before it gets this far). */
function skillEffectTargets(actor, item, recipients = null) {
  if (recipients) return recipients;
  const target = skillTarget(item?.system);
  if (target === "self" || item?.system?.range?.scope === "self") return [actor];
  const targeted = [...(game.user?.targets ?? [])].map((t) => t.actor).filter(Boolean);
  if (target === "ally") return targeted.filter((a) => a !== actor);
  return targeted.length ? targeted : [actor];
}

/** Auto-built effects for a Skill's on-use application — one ActiveEffect per Empower/Weaken/
 *  Transform Effect it carries (primary AND the Secondary-Effect slot), plus one bundling its
 *  auto Modifier rules (Protection / Affinity Damage — effects.mjs skillModifierRules), so the
 *  designer needn't author any of them. The Skill's Duration shapes the copy's lifetime
 *  (rules v0.01): Standard → its turn count (default 2 rounds); Instant → this round only;
 *  Scene → no timer, cleared when combat ends; Channeled → no timer, swept when the channel ends
 *  (every copy carries the cast's channel key — see ensureChannelMarker / tickChanneled).
 *  Passive Skills are handled in-memory by the effects engine, not here. Each carries `autoKey`
 *  (`<skillId>:<mode>`) so re-casting REFRESHES rather than stacks. */
function autoBolsterHinderEffects(item, { channelKey = null } = {}) {
  if (item?.type !== "skill" || item.system?.actionType === "passive") return [];
  const mode = skillDuration(item.system);
  const scene = mode === "scene" || mode === "channeled";
  const rounds = mode === "instant" ? 1 : (item.system?.effectDuration ?? PROJECTANIME.standardDurationTurns);
  const buildDuration = () => {
    const duration = {};
    if (!scene) {
      duration.rounds = rounds;
      duration.startTime = game.time?.worldTime ?? 0;
      if (game.combat) { duration.startRound = game.combat.round ?? 0; duration.startTurn = game.combat.turn ?? 0; }
    }
    return duration;
  };
  const baseFlags = () => (channelKey ? { scene, channelKey } : { scene });
  const out = [];
  if (!hasAuthoredAttributeEffect(item)) {
    for (const eff of skillEffectKeys(item.system)) {
      const list = bolsterHinderRules(item, eff);
      if (!list.length) continue;
      out.push({
        name: item.name,
        img: item.img,
        duration: buildDuration(),
        flags: { "project-anime": { rules: { version: 1, list }, autoEffect: eff, autoKey: `${item.id}:${eff}`, ...baseFlags() } }
      });
    }
  }
  // Modifier-granted rules (Protection / Affinity Damage) ride one bundled effect of their own.
  const modRules = skillModifierRules(item);
  if (modRules.length) {
    out.push({
      name: item.name,
      img: item.img,
      duration: buildDuration(),
      flags: { "project-anime": { rules: { version: 1, list: modRules }, autoEffect: "mods", autoKey: `${item.id}:mods`, ...baseFlags() } }
    });
  }
  return out;
}

/** Drain on a PASSIVE Skill (rules: "If this Skill is Passive, your basic attacks gain this
 *  effect" — mirroring Devour's maybeDevourOnKill): a weapon or shield attack feeds every
 *  passive drain Skill the attacker carries. Skill casts ride their own applyDrain; this covers
 *  the basic-attack special only. */
async function applyPassiveDrains(actor, item, total, lines) {
  if (item?.type !== "weapon" && item?.type !== "shield") return;
  for (const skill of actor?.items ?? []) {
    if (skill.type !== "skill" || skill.system?.actionType !== "passive") continue;
    const mods = skill.system?.modifiers ?? [];
    if (!mods.includes("drainHP") && !mods.includes("drainEnergy")) continue;
    await applyDrain(actor, skill, total, lines);
  }
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
  // A Cursed caster regains nothing to a cursed pool — that drain is voided (the damage already
  // landed). HP-drain feeds HP, Energy-drain feeds Energy, so an HP-only Curse still lets an
  // Energy drain through (and vice versa); both pools cursed voids both.
  if (mods.includes("drainHP")) {
    if (curseBlocks(actor, "hp")) lines.push(curseNote(actor.name, "hp"));
    else {
      await routeApply(actor, actor.uuid, half, true, "hp");
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.drainsHP", { n: half })}</em>`);
    }
  }
  if (mods.includes("drainEnergy")) {
    if (curseBlocks(actor, "energy")) lines.push(curseNote(actor.name, "energy"));
    else {
      await routeApply(actor, actor.uuid, half, true, "energy");
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.drainsEnergy", { n: half })}</em>`);
    }
  }
}

/** Retaliation (Skill modifier): a creature warded by a live Retaliation effect punishes a FOE
 *  that damages it — the attacker takes the warded value of a chosen Damage Type (affinity-adjusted
 *  against the attacker, Defense ignored, like the Lingering tick). Fired from every damage path
 *  after the hit lands, mirroring applyDrain but keyed off the TARGET's ward, not the attacker's
 *  Skill — so a basic weapon blow triggers it too. Only enemies retaliate (tokensAreEnemies), so a
 *  creature hurting itself or an ally never sets it off; multiple wards on one target stack. The
 *  bounce routes through the owner/GM relay and is clamped to the attacker's max (an Absorb affinity
 *  on the attacker heals them instead). `hits` = [{actor, amount}] of the creatures this attack
 *  actually damaged (amount > 0; non-healing only). Mutates `lines` with a chat note per ward fired. */
async function applyRetaliation(attacker, hits, lines) {
  if (!attacker || !hits?.length) return;
  const aToken = casterToken(attacker);
  for (const { actor: warded, amount } of hits) {
    if (!warded || !(amount > 0) || warded === attacker) continue;
    const wards = collectRetaliation(warded);
    if (!wards.length) continue;
    if (!tokensAreEnemies(aToken, casterToken(warded))) continue;   // only FOES are punished
    for (const w of wards) {
      const adj = adjustForTarget(w.value, w.element, attacker, { ignoresDefense: true });
      if (adj.heal) await routeApply(attacker, attacker.uuid, adj.amount, true, "hp");
      else if (adj.amount > 0) await routeApply(attacker, attacker.uuid, adj.amount, false, "hp");
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.retaliation", { name: warded.name })}: ${adj.line}</em>`);
    }
  }
}

/* -------------------------------------------- */
/*  On-use Skill effect application             */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Channeled Skills (Duration Modifier)        */
/* -------------------------------------------- */

/** The key of the caster's OPEN channel for this Skill (null when the Skill isn't Channeled or no
 *  channel is running). Effect copies applied while it's open carry this key, so ending the
 *  channel can sweep exactly its own copies — each cast mints a fresh key (see ensureChannelMarker),
 *  so a re-cast's sweep of the old channel can never catch the new one's copies. */
function activeChannelKey(actor, item) {
  if (item?.type !== "skill" || skillDuration(item.system) !== "channeled") return null;
  const m = (actor?.effects ?? []).find((e) => e.flags?.["project-anime"]?.channelSource === item.id);
  return m?.flags?.["project-anime"]?.channelKey ?? null;
}

/** Open (or refresh) the channel for a Channeled Skill's cast: a marker ActiveEffect on the
 *  caster. While it lives, the caster pays 1 EP at the start of each of their turns
 *  (project-anime.mjs tickChanneled); deleting it — the player dismissing the Skill (rules
 *  v0.01: you may dismiss an ongoing Skill on your turn for free), the EP running dry, or the
 *  end-of-combat scene sweep — removes every effect copy carrying the channel's key (the
 *  deleteActiveEffect hook). Re-casting replaces the old channel (its copies sweep) with a
 *  fresh-keyed one. */
async function ensureChannelMarker(actor, item) {
  const old = (actor.effects ?? []).filter((e) => e.flags?.["project-anime"]?.channelSource === item.id).map((e) => e.id);
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const key = `${item.id}:${foundry.utils.randomID(8)}`;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("PROJECTANIME.Roll.channelingName", { name: item.name }),
    img: item.img,
    flags: { "project-anime": { channelSource: item.id, channelKey: key, scene: true } }
  }]);
  return key;
}

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
  // A Channeled Skill's copies belong to the cast's open channel: each carries its key so they
  // sweep together when the channel ends (the marker was stamped in rollSkill before resolution;
  // a Luck flip-to-hit re-applies under the same still-open channel).
  const channelKey = activeChannelKey(actor, item);
  // Empower/Weaken/Transform Skills auto-build their attribute effect(s), so the designer needn't
  // author one. A Weaken is offensive — it lands only when the Accuracy Check hit; supportive
  // effects (Empower / Transform) always apply.
  const autoEffects = autoBolsterHinderEffects(item, { channelKey })
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
      const data = effectCopyData(effect, sourceImg);
      if (channelKey) {
        // Channeled overrides an authored lifetime: the copy lives exactly as long as the channel.
        data.duration = {};
        foundry.utils.setProperty(data, "flags.project-anime.channelKey", channelKey);
        foundry.utils.setProperty(data, "flags.project-anime.scene", true);
      }
      if (await routeEffectApply(ta, data)) names.push(effect.name);
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
async function routeApply(target, targetUuid, amount, heal, pool, { ignoreBarrier = false } = {}) {
  if (target.isOwner) { await applyDamageTo(targetUuid, amount, heal, pool, { ignoreBarrier }); return true; }
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyDamage", targetUuid, amount, heal, pool, ignoreBarrier });
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

  // Reverse: undo damage → heal the amount back; undo healing → remove it. Same pool. The
  // reversal is bookkeeping, not an attack — a Barrier on the target must not absorb it.
  if (!(await routeApply(target, row.uuid, row.amount, !row.heal, row.pool, { ignoreBarrier: true }))) {
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
  // A Fumble (1-1) or Combo (matching ≥6) is a locked result — Luck can't change it, even your own.
  // (Cards omit the button on these; this guards the handler against stale/legacy cards in the log.)
  if ((d1 === 1 && d2 === 1) || (d1 === d2 && d1 >= 6)) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckLocked"));

  const choice = await promptLuck({ d1, d2, pool });
  if (!choice) return;
  const spend = applyLuckChoice({ ...choice, d1, d2, pool });
  if (!spend) return;
  const res = evalPair(spend.a, spend.b, mod, { ct, evasion });
  await actor.update({ "system.luckDice": spend.nextPool });

  // A Luck-manufactured Combo grants the extra turn to the ORIGINAL roller (their roll comboed) —
  // for checks and attacks alike; the card carries the roller's uuid.
  if (res.combo && el.dataset.actorUuid) {
    const grantee = await fromUuid(el.dataset.actorUuid);
    if (grantee) maybeGrantComboTurn(grantee);
  }

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
    // A flipped-to-hit Steal opens the loot like the original hit card would have.
    if (item?.type === "skill" && skillEffectKeys(item.system).includes("steal") && el.dataset.targetUuid) {
      buttons.push({
        data: `data-action="stealItem" data-actor-uuid="${el.dataset.actorUuid}" data-item-id="${el.dataset.itemId}" data-target-uuid="${el.dataset.targetUuid}"`,
        label: `<i class="fas fa-hand-sparkles"></i> ${i18n("PROJECTANIME.Roll.steal")}`
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
  // A locked Fumble/Combo can't be Luck-changed — guard against stale/legacy cards (see single-target).
  if ((d1 === 1 && d2 === 1) || (d1 === d2 && d1 >= 6)) return ui.notifications.warn(i18n("PROJECTANIME.Roll.luckLocked"));

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
  // A Luck-manufactured Combo grants the extra turn to the ORIGINAL roller (their roll comboed).
  if (res.combo && srcActor) maybeGrantComboTurn(srcActor);

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
