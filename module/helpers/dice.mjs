import { PROJECTANIME, modifierValue, modifierTakes, techniqueDie, contestTarget, getTalent, actorTalents, skillEffectKeys, skillDieSpecs, skillNeedsAccuracy, skillTarget, skillDuration, auraAudience, cursedPools, isSelfCenteredArea, valuedStatusValue, actorSide } from "./config.mjs";
import { renderDescriptionHTML } from "./prose.mjs";
import { collectRollModifiers, collectNonCombatCheckMods, collectSkillModBonuses, collectWeaponModBonuses, collectInflictedConditions, statusImmunities, statusResists, effectRules, effectCopyData, bolsterHinderRules, hasAuthoredAttributeEffect, skillModifierRules, collectRetaliation, collectToggles, effectAffectsRoll, collectLuckTunes, makeRoundsDuration } from "./effects.mjs";
import { resolveCompanion } from "./servants.mjs";
import {
  aoeKind, casterToken, placeTemplate, tokensInRange, pickTargetsDialog, setUserTargets, emanateBurst
} from "./templates.mjs";
import { stampCompendiumSource } from "./gear.mjs";

/**
 * Project: Anime dice engine — Checks/Tests, attacks, damage and skill rolls,
 * plus the chat-card button wiring. A Check is always two attribute dice.
 */

const i18n = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

/** Current value (= die size) of an actor attribute. */
function attrValue(actor, key) {
  return actor?.system?.attributes?.[key]?.value ?? 4;
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

/** Step a die size `n` rungs along the d4–d12 ladder: up for positive `n`, down for negative. */
function stepDie(value, n) {
  let v = value;
  const k = Math.round(Number(n) || 0);
  for (let i = 0; i < Math.abs(k); i++) v = k > 0 ? stepUpValue(v) : stepDownValue(v);
  return v;
}

/** Blinded Steps Down the dice of the bearer's attack rolls (rules: Blinded — "Step Down both
 *  dice on attack rolls"). */
function accuracyStepDown(actor) {
  return !!actor?.statuses?.has?.("blinded");
}

/**
 * Step both Check dice for circumstances: Blinded Steps Down both dice on attack rolls.
 * @returns {{dieA:number, dieB:number, reasons:string[]}}
 */
function steppedDice(actor, dieA, dieB, { accuracy = false } = {}) {
  const reasons = [];
  if (accuracy && accuracyStepDown(actor)) reasons.push("accuracy");
  for (let i = 0; i < reasons.length; i++) {
    dieA = stepDownValue(dieA);
    dieB = stepDownValue(dieB);
  }
  return { dieA, dieB, reasons };
}

/** Build the localized "dice stepped" notes for a set of reasons. */
function stepNotes(reasons) {
  const notes = [];
  if (reasons.includes("accuracy")) notes.push(`<em>${i18n("PROJECTANIME.Roll.steppedDown")}</em>`);
  return notes;
}

/* -------------------------------------------- */
/*  Talent-paired rolls & Guard (V2)            */
/* -------------------------------------------- */

/**
 * The two dice a weapon's / Technique's roll uses (rules: The Roll). When a relevant Talent is
 * linked (`system.talentId` resolves on the owner's `system.talents`), the roll is the Talent's
 * Primary Attribute die + the Talent die, +1 Trained Edge; otherwise the item's two Attributes
 * with no bonus.
 * @returns {{dieA:number, dieB:number, edge:number, labelA:string, labelB:string, talent:object|null}}
 */
function rollSpec(actor, item) {
  const sys = item?.system ?? {};
  const talent = getTalent(actor, sys.talentId);
  if (talent) {
    return {
      dieA: attrValue(actor, talent.attribute),
      dieB: talent.die,
      edge: PROJECTANIME.trainedEdge,
      labelA: i18n(PROJECTANIME.attributes[talent.attribute]),
      labelB: talent.name,
      talent
    };
  }
  const acc = sys.accuracy ?? sys.attributes ?? {};
  const attrA = acc.attrA ?? "might";
  const attrB = acc.attrB ?? "agility";
  return {
    dieA: attrValue(actor, attrA),
    dieB: attrValue(actor, attrB),
    edge: 0,
    labelA: i18n(PROJECTANIME.attributes[attrA]),
    labelB: i18n(PROJECTANIME.attributes[attrB]),
    talent: null
  };
}

/** The Guard a defender pits against an attack (Exposed already folded in by the data model). */
function guardOf(targetActor) {
  return targetActor?.system?.guard?.value ?? null;
}

/**
 * The effective Threshold of an attack with `item` against `targetActor` (rules: Threshold;
 * Weakened "your attacks increase their Threshold by 2"; Prone "attacks against you reduce
 * their Threshold by 2"). Null when the item carries no Threshold (non-weapon Techniques).
 */
function thresholdVs(actor, item, targetActor) {
  const base = Number(item?.system?.threshold);
  if (!Number.isFinite(base) || base <= 0) return null;
  let t = base;
  if (actor?.statuses?.has?.("weakened")) t += PROJECTANIME.weakenedThresholdMod;
  if (targetActor?.statuses?.has?.("prone")) t -= PROJECTANIME.proneThresholdMod;
  return Math.max(1, t);
}

/**
 * The Contest Target an attacker rolls against for an Opposing-Techniques contest (rules:
 * Contest Target = 6 + defender's die/2, +1 Trained Edge when the defense is Talent-built).
 * With no specific defending Technique the defender's best Attribute die stands in ("the
 * relevant Attribute die" — the GM adjusts via the situational modifier when needed).
 */
function contestTargetFor(defender, defendingItem = null) {
  if (!defender) return null;
  if (defendingItem?.type === "skill") {
    const { die, hasTalent } = techniqueDie(defendingItem);
    return contestTarget(die, hasTalent);
  }
  const best = Math.max(...PROJECTANIME.attributeKeys.map((k) => attrValue(defender, k)));
  return contestTarget(best, false);
}

/** True when this Technique resolves as a CONTEST (vs the defender's Contest Target) instead of
 *  an attack vs Guard: the Weaken Effect on a non-willing creature, or a Disarm / Nullify
 *  Modifier (rules: Opposing Techniques). */
function isContestPiece(item) {
  if (item?.type !== "skill") return false;
  const sys = item.system ?? {};
  if (skillEffectKeys(sys).some((e) => PROJECTANIME.contestEffects.includes(e))) return true;
  return (sys.modifiers ?? []).some((m) => PROJECTANIME.contestModifiers.includes(m));
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

/** The number this defender pits against this item's roll: its GUARD for an attack, or the
 *  CONTEST TARGET (6 + die/2) for an Opposing-Techniques contest piece (Weaken / Disarm /
 *  Nullify). Returns the value plus whether it was a contest (for the card line). */
function evasionVs(targetActor, item) {
  if (!targetActor?.system) return { value: null, contest: false };
  if (isContestPiece(item)) return { value: contestTargetFor(targetActor), contest: true };
  return { value: guardOf(targetActor), contest: false };
}

/** Card label for what the defender used: "Guard" or "Contest Target". `vsEvasionText` is the
 *  "vs …" sentence form of the same. */
function evasionLabel(contest) {
  return i18n(contest ? "PROJECTANIME.Roll.contestTarget" : "PROJECTANIME.Stat.guard");
}

function vsEvasionText(contest) {
  return i18n(contest ? "PROJECTANIME.Roll.vsContest" : "PROJECTANIME.Roll.vsGuard");
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

/** The Challenge Threshold ladder (rules: Tests) — preset difficulties offered in the roll dialog. */
const CT_PRESETS = [
  ["easy", 7], ["moderate", 9], ["hard", 11], ["daunting", 13], ["extreme", 15]
];

/**
 * Open the roll-configuration dialog.
 * @returns {Promise<object|null>} `{ attrA?, attrB?, mod, ct? }` or null if cancelled.
 */
async function promptRoll({ title, actor, attrA, attrB, selector = "check", showAttrs = true, showCT = true, showCover = false, infoHTML = "", ct = null }) {
  // No <form> wrapper: DialogV2 supplies the form, so a nested one would break
  // `button.form` field reading. The class lives on a plain <div> for styling.
  const uid = foundry.utils.randomID();
  const ctOptions = CT_PRESETS
    .map(([key, value]) => `<option value="${value}">${i18n(`PROJECTANIME.Roll.ctPreset.${key}`)} (${value})</option>`)
    .join("");
  // Player toggles (PF2e-style): the actor's flippable Active Effects, switched on/off for this roll
  // right in the dialog. Each starts at its current state; a change persists on the actor (the roll
  // collectors gate on it via effectGateOpen), so it carries to later rolls and the Effects tab. Only
  // toggles RELEVANT to this roll show (effectAffectsRoll) — the rest would do nothing here, so they
  // stay hidden; the list re-filters live as the Attributes change (see the render hook below).
  const toggles = collectToggles(actor);
  const relevant = (t, a, b) => effectAffectsRoll(t.effect, { selector, attrA: a, attrB: b });
  const anyRelevant = toggles.some((t) => relevant(t, attrA, attrB));
  const togglesHTML = toggles.length ? `
    <div class="roll-toggles${anyRelevant ? "" : " hidden"}">
      <div class="roll-toggles-label">${i18n("PROJECTANIME.Roll.toggles")}</div>
      ${toggles.map((t) => `
        <label class="roll-toggle${relevant(t, attrA, attrB) ? "" : " hidden"}${t.on ? " on" : ""}" data-effect-id="${t.id}">
          <input type="checkbox" name="toggle.${t.id}"${t.on ? " checked" : ""} />
          ${t.img ? `<img src="${t.img}" alt="" />` : ""}<span>${t.label}</span>
        </label>`).join("")}
    </div>` : "";
  // Talent chips (Daggerheart-style): a Check may swap its SECOND die for a Talent
  // (+1 Trained Edge — rules: The Roll). One chip may be active at a time; picking one parks
  // the Second Attribute select, and clicking it again releases it.
  const talentList = showAttrs && selector === "check" ? actorTalents(actor) : [];
  const preTalent = typeof attrB === "string" && attrB.startsWith("talent:")
    && talentList.some((t) => `talent:${t.id}` === attrB) ? attrB.slice(7) : "";
  const attrBKey = preTalent || (typeof attrB === "string" && attrB.startsWith("talent:")) ? attrA : attrB;
  const talentsHTML = talentList.length ? `
    <fieldset class="roll-talents">
      <legend>${i18n("PROJECTANIME.Item.talents")}</legend>
      <input type="hidden" name="talent" value="${preTalent}" />
      <div class="roll-talent-cols">
      ${talentList.map((t) => `
      <button type="button" class="roll-talent-chip${t.id === preTalent ? " selected" : ""}" data-talent-id="${t.id}">
        <i class="fa-${t.id === preTalent ? "solid" : "regular"} fa-circle"></i>
        <span>${foundry.utils.escapeHTML(t.name)} (d${t.die} +1)</span>
      </button>`).join("")}
      </div>
    </fieldset>` : "";
  // Two-column grid (PF2e-style): paired Attribute selects and CT fields sit side by side so the
  // dialog reads wide rather than as a tall stack; the Modifier and the toggles span the full width.
  const content = `
    <div class="project-anime roll-dialog" data-roll-uid="${uid}">
      ${infoHTML}
      <div class="roll-grid">
        ${showAttrs ? `
        <div class="form-group"><label>${i18n("PROJECTANIME.Roll.attrA")}</label>${attrSelect("attrA", actor, attrA)}</div>
        <div class="form-group"><label>${i18n("PROJECTANIME.Roll.attrB")}</label>${attrSelect("attrB", actor, attrBKey)}</div>` : ""}
        ${showCover ? `
        <div class="form-group span2"><label>${i18n("PROJECTANIME.Roll.cover")}</label>
          <select name="cover"><option value="0">—</option><option value="1">+1</option><option value="2">+2</option></select></div>` : ""}
        ${showCT ? `
        <div class="form-group"><label>${i18n("PROJECTANIME.Roll.ct")}</label>
          <select name="ctPreset"><option value="">—</option>${ctOptions}</select></div>
        <div class="form-group"><label>${i18n("PROJECTANIME.Roll.ctCustom")}</label>
          <input type="number" name="ct" value="${ct ?? ""}" placeholder="—" step="1" /></div>` : ""}
      </div>
      ${talentsHTML}
      ${togglesHTML}
    </div>`;

  // Live wiring: the Talent chips (pick/release swaps the second die) and the toggle re-filter
  // as the Attribute picks change. The hook self-targets by this dialog's uid, then removes
  // itself so it fires for this dialog only.
  let dialogHookId = null;
  const wantToggles = toggles.length && showAttrs;
  if (wantToggles || talentList.length) {
    dialogHookId = Hooks.on("renderDialogV2", (app) => {
      const root = app?.element;
      if (!root?.querySelector?.(`[data-roll-uid="${uid}"]`)) return;
      Hooks.off("renderDialogV2", dialogHookId);
      const aEl = root.querySelector('select[name="attrA"]');
      const bEl = root.querySelector('select[name="attrB"]');
      const talentEl = root.querySelector('input[name="talent"]');
      const refreshToggles = () => {
        if (!wantToggles) return;
        const a = aEl?.value ?? attrA;
        // An active Talent takes the second die; its non-combat boosts ride the FIRST
        // Attribute (see performCheck), so toggle relevance mirrors that.
        const b = talentEl?.value ? a : (bEl?.value ?? attrB);
        let anyShown = false;
        for (const t of toggles) {
          const row = root.querySelector(`.roll-toggle[data-effect-id="${t.id}"]`);
          if (!row) continue;
          const show = relevant(t, a, b);
          row.classList.toggle("hidden", !show);
          if (show) anyShown = true;
        }
        root.querySelector(".roll-toggles")?.classList.toggle("hidden", !anyShown);
      };
      aEl?.addEventListener("change", refreshToggles);
      bEl?.addEventListener("change", refreshToggles);
      if (talentEl) {
        const chips = Array.from(root.querySelectorAll(".roll-talent-chip"));
        const paint = () => {
          for (const chip of chips) {
            const on = chip.dataset.talentId === talentEl.value;
            chip.classList.toggle("selected", on);
            const icon = chip.querySelector("i");
            if (icon) icon.className = `fa-${on ? "solid" : "regular"} fa-circle`;
          }
          if (bEl) bEl.disabled = !!talentEl.value;
        };
        for (const chip of chips) {
          chip.addEventListener("click", () => {
            talentEl.value = talentEl.value === chip.dataset.talentId ? "" : chip.dataset.talentId;
            paint();
            refreshToggles();
          });
        }
        paint();
      }
      refreshToggles();
    });
  }

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    position: { width: 480 },
    content,
    buttons: [
      {
        action: "roll",
        label: i18n("PROJECTANIME.Roll.roll"),
        icon: "fas fa-dice",
        default: true,
        callback: (event, button) => {
          const data = readForm(button.form);
          // Read each toggle's checkbox straight off the form (robust regardless of how
          // FormDataExtended folds the dotted names) — keyed by effect id.
          data._toggles = Object.fromEntries(toggles.map((t) => {
            const el = button.form.elements[`toggle.${t.id}`];
            return [t.id, el ? el.checked : t.on];
          }));
          return data;
        }
      },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (dialogHookId != null) Hooks.off("renderDialogV2", dialogHookId);   // no-op if it already self-removed

  if (!result || result === "cancel") return null;
  // Persist any flipped toggles before the caller reads the modifiers (they gate on this state).
  if (toggles.length && result._toggles) {
    const updates = {};
    for (const t of toggles) {
      const next = !!result._toggles[t.id];
      if (next !== t.on) updates[`flags.project-anime.toggles.${t.id}`] = next;
    }
    if (Object.keys(updates).length) await actor.update(updates);
  }
  // A typed custom CT wins; otherwise the chosen preset; otherwise no threshold.
  const custom = result.ct === "" || result.ct == null ? null : Number(result.ct);
  const preset = result.ctPreset === "" || result.ctPreset == null ? null : Number(result.ctPreset);
  // An active Talent chip takes the second slot (the parked attrB select doesn't submit).
  const talentPick = typeof result.talent === "string" && result.talent ? `talent:${result.talent}` : null;
  return {
    attrA: result.attrA,
    attrB: talentPick ?? result.attrB,
    mod: Number(result.mod) || 0,
    ct: custom ?? preset
  };
}

/* -------------------------------------------- */
/*  Chat card helpers                           */
/* -------------------------------------------- */

/** HTML-escape a text value interpolated into card markup (actor/item names can carry anything). */
function escHTML(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A CSS color safe to inline as the card's `--acc` (hex from the accent flag, or an internal var()). */
function safeAccent(css) {
  const s = String(css ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^var\(--[\w-]+\)$/.test(s) ? s : "";
}

/**
 * The per-card accent — Log Horizon rule: a card wears its OWNER's color. Characters use their
 * owning player's accent (mirrored to a user flag — see syncPlayerAccentFlag); hostile NPCs wear
 * crimson; everything else stays the neutral brand purple (the CSS default, returned as "").
 */
export function cardAccent(actor) {
  if (!actor) return "";
  try {
    if (actor.type === "character") {
      const owner = game.users?.find?.((u) => !u.isGM && u.character?.id === actor.id)
        ?? game.users?.find?.((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
      return safeAccent(owner?.getFlag?.("project-anime", "accent"));
    }
    if (actor.type === "npc") {
      const disp = actor.token?.disposition ?? actor.prototypeToken?.disposition;
      if (disp === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "var(--pac-hostile)";
    }
  } catch (_) { /* neutral */ }
  return "";
}

/** A slim one-line chat notice (effect expiry, turn ticks, boss beats, Luck tunes) — the ticker
 *  strip, deliberately NOT a full card. Variants: "boss" (crimson), "gold" (Luck / reward). */
export function tickerHTML(text, { variant = "", icon = "", sub = "" } = {}) {
  const ic = icon ? `<i class="fas ${icon}"></i> ` : "";
  // Ticker text is plain localized prose (often carrying actor/skill names) — escaped here.
  const subHTML = sub ? `<span class="pa-tick-sub">${escHTML(sub)}</span>` : "";
  return `<div class="project-anime pa-tick${variant ? ` is-${variant}` : ""}"><span class="pa-tick-dm"></span><span class="pa-tick-text">${ic}${escHTML(text)}${subHTML}</span></div>`;
}

/**
 * Build a Project: Anime chat card — self-contained dark glass, one fixed anatomy:
 * identity → ribbon → chips → outcome → dice → rows → description → lines → buttons.
 * @param {object}   o
 * @param {string}   o.title         Card heading (item / actor name) — escaped here.
 * @param {string}   [o.subtitle]    Small uppercase kicker (ATTACK / SKILL / …) — escaped here.
 * @param {string}   [o.icon]        Image path for the identity icon (item.img); omitted if blank.
 * @param {string}   [o.accent]      Per-card accent color for `--acc` (see cardAccent); "" = brand.
 * @param {string[]} [o.meta]        Compact stat-chip HTML fragments (effect / energy / …).
 * @param {object[]} [o.badges]      Outcomes `{cls, text}` — combo becomes the gold RIBBON, the
 *                                   rest render as colored outcome words on the versus row.
 * @param {string}   [o.vs]          Left side of the outcome row ("vs Guard <b>14</b>", HTML).
 * @param {string}   [o.rollHTML]    Rendered dice roll.
 * @param {string}   [o.description] Enriched prose (the item's own description) — long prose
 *                                   collapses behind a fade (click the block to expand).
 * @param {Array}    [o.lines]       Breakdown lines: strings render as-is; `{k, v, cls}` objects
 *                                   render as dotted-leader stat rows.
 * @param {object[]} [o.buttons]     Action buttons `{data, label, primary}` — a primary button is
 *                                   filled in the accent and wears the gold cue diamond.
 */
export function cardHTML({ title, subtitle = "", icon = "", glyph = "", accent = "", meta = [], badges = [], vs = "", rollHTML = "", description = "", lines = [], buttons = [], rows = [] }) {
  // An image `icon` wins; otherwise a FontAwesome `glyph` fills the icon box (the .is-glyph variant).
  const iconHTML = icon
    ? `<img class="card-icon" src="${escHTML(icon)}" alt="" />`
    : (glyph ? `<span class="card-icon is-glyph"><i class="fas ${glyph}"></i></span>` : "");
  const metaHTML = meta.length
    ? `<div class="card-meta">${meta.map((m) => `<span class="meta-chip">${m}</span>`).join("")}</div>`
    : "";
  // A Combo outcome is the anime moment — it leaves the badge row and becomes the gold ribbon.
  const ribbonHTML = badges.filter((b) => b.cls === "combo")
    .map((b) => `<div class="card-ribbon">${b.text}</div>`).join("");
  const words = badges.filter((b) => b.cls !== "combo")
    .map((b) => `<span class="badge ${b.cls}">${b.text}</span>`).join("");
  // The versus/outcome row: defense number left, outcome word(s) right. Either half may be empty.
  const vsHTML = (vs || words)
    ? `<div class="card-vs"><span class="vs-label">${vs}</span><div class="card-badges">${words}</div></div>`
    : "";
  // Long prose collapses behind a gradient fade (length heuristic — no layout measuring races).
  const clp = description && description.replace(/<[^>]+>/g, "").length > 300 ? " is-clp" : "";
  const descHTML = description ? `<div class="card-desc${clp}">${description}</div>` : "";
  const lineHTML = lines.length
    ? `<div class="card-lines">${lines.map((l) => (l && typeof l === "object")
        ? `<div class="card-kv"><span class="kv-k">${l.icon ? `<i class="fa-solid ${l.icon}"></i> ` : ""}${escHTML(l.k)}</span><span class="kv-lead"></span><span class="kv-v${l.cls ? ` ${l.cls}` : ""}">${escHTML(l.v)}</span></div>`
        : `<div class="card-line">${l}</div>`).join("")}</div>`
    : "";
  const btnHTML = buttons.length
    ? `<div class="card-buttons">${buttons.map((b) =>
        `<button type="button" class="card-btn${b.primary ? " is-primary" : ""}" ${b.data}>${b.label}${b.primary ? '<span class="card-cue"></span>' : ""}</button>`).join("")}</div>`
    : "";
  // Per-target damage rows (auto-applied, each with an undo arrow). Re-rendered from the message flag
  // on every draw — see onRenderChatMessage — so this initial fill is just the first paint / fallback.
  const rowsHTML = rows.length ? `<div class="dmg-rows">${damageRowsHTML(rows)}</div>` : "";
  const acc = safeAccent(accent);
  return `<div class="project-anime chat-card"${acc ? ` style="--acc:${acc}"` : ""}>
    <header class="card-header">
      ${iconHTML}
      <div class="card-titles">
        <h3 class="card-title">${escHTML(title)}</h3>
        ${subtitle ? `<span class="card-type">${escHTML(subtitle)}</span>` : ""}
      </div>
    </header>
    ${ribbonHTML}
    ${metaHTML}
    ${vsHTML}
    ${rollHTML}
    ${rowsHTML}
    ${descHTML}
    ${lineHTML}
    ${btnHTML}
  </div>`;
}

/**
 * The card body for an item: the hand-authored Codex-prose description, rendered rich (legacy
 * ProseMirror HTML still renders as-is). (Single chokepoint — every card site calls this.)
 */
export async function enrichDescription(item) {
  return renderDescriptionHTML(item);
}

/** Compact stat chips for a Technique card: effect type(s) · target · duration · Energy cost
 *  (a Passive shows the boxes it locks instead). */
export function skillMeta(sys) {
  const chips = [];
  // Effect(s): a Technique carrying the "Secondary Effect" Modifier shows both, joined with " + ".
  const effectLabel = skillEffectKeys(sys).map((k) => i18n(PROJECTANIME.skillEffects[k] ?? "")).filter(Boolean).join(" + ");
  if (effectLabel) chips.push(effectLabel);
  chips.push(i18n(PROJECTANIME.skillTargets[skillTarget(sys)] ?? ""));
  if (sys.actionType !== "passive") {
    const dur = skillDuration(sys);
    chips.push(dur === "standard"
      ? `${sys.effectDuration ?? PROJECTANIME.standardDurationTurns} ${i18n("PROJECTANIME.Skill.turns")}`
      : i18n(PROJECTANIME.skillDurations[dur] ?? ""));
  }
  if (sys.actionType === "passive" || sys.effect === "companion") {
    if (Number(sys.passiveEnergyTax) > 0) chips.push(`<i class="fas fa-lock"></i> ${sys.passiveEnergyTax}`);
  } else if (Number(sys.energyCost) > 0) {
    chips.push(`<i class="fas fa-bolt"></i> ${sys.energyCost}`);
  }
  return chips;
}

export async function postCard(actor, content, rolls, { combo = false, flags = null } = {}) {
  const arr = Array.isArray(rolls) ? rolls.filter(Boolean) : (rolls ? [rolls] : []);
  // Stamp the speaker's accent onto the card (owner color / hostile crimson) unless the builder
  // already set one — the one chokepoint, so every posted card wears its color automatically.
  if (actor && typeof content === "string" && !content.includes("--acc:")) {
    const acc = cardAccent(actor);
    if (acc) content = content.replace('<div class="project-anime chat-card"', `<div class="project-anime chat-card" style="--acc:${acc}"`);
  }
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
 *  stamp the SAME validated target on its follow-up "Roll Damage" button; `threshold` (weapon
 *  attacks) lets the replacement recompute the +1-box Threshold bonus. */
function luckButtonData({ d1, d2, mod = 0, ct = null, evasion = null, threshold = null, kind, actorUuid = "", itemId = "", targetUuid = "" }) {
  return [
    `data-action="spendLuck"`,
    `data-d1="${d1}"`, `data-d2="${d2}"`, `data-mod="${mod}"`,
    `data-ct="${ct ?? ""}"`, `data-evasion="${evasion ?? ""}"`, `data-threshold="${threshold ?? ""}"`,
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

/** Recompute a two-die Check outcome — used after a Luck substitution. Fumble and Combo read
 *  the dice AS THEY STAND after replacement (rules: Luck Dice — replacement can make or unmake
 *  either). `threshold` is the weapon's Threshold: met → +1 box on the damage step. */
function evalPair(a, b, mod, { ct = null, evasion = null, threshold = null } = {}) {
  const total = a + b + mod;
  const fumble = a === 1 && b === 1;
  const combo = a === b && a >= 6;
  const targetNum = ct != null ? ct : evasion;
  let success = null;
  if (combo) success = true;
  else if (fumble) success = false;
  else if (targetNum != null) success = total >= targetNum;
  const thresholdMet = threshold != null ? total >= threshold : null;
  return { total, fumble, combo, success, thresholdMet };
}

/* -------------------------------------------- */
/*  Public roll functions                       */
/* -------------------------------------------- */

/** A general Check / Test (two attribute dice vs an optional Challenge Threshold). With a
 *  targeted token, the dialog offers a CONTESTED Check instead (both sides roll, higher total
 *  wins, ties re-roll — v0.03); the defender rolls the same Attribute pair by default. */
export async function rollCheck(actor, { attrA = "might", attrB = "might", mod = 0, ct = null } = {}) {
  const targetActor = firstTargetActor();
  const contestable = !!targetActor && targetActor !== actor;
  const info = contestable
    ? `<label class="roll-contested"><input type="checkbox" name="contested" /> <span>${game.i18n.format("PROJECTANIME.Roll.contestedVs", { name: targetActor.name })}</span></label>`
    : "";
  const choice = await promptRoll({
    title: i18n("PROJECTANIME.Roll.checkTitle"),
    actor, attrA, attrB, infoHTML: info
  });
  if (!choice) return null;
  if (contestable && choice.contested) {
    // A Talent in the second slot: the attacker rolls Attribute + Talent (+1) — the defender
    // mirrors the ATTRIBUTE pair (it has no stake in the attacker's Talent).
    let atkB = choice.attrB, mod = choice.mod;
    if (typeof atkB === "string" && atkB.startsWith("talent:")) {
      const talent = getTalent(actor, atkB.slice(7));
      atkB = choice.attrA;
      if (talent) mod += PROJECTANIME.trainedEdge;
    }
    return contestedRoll({
      actor, attrs: [choice.attrA, atkB], mod,
      defender: targetActor, defAttrs: [choice.attrA, atkB],
      title: i18n("PROJECTANIME.Roll.contested")
    });
  }
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
  // A "talent:<id>" second slot rolls Attribute + Talent (+1 Trained Edge — rules: The Roll).
  let talent = null;
  if (typeof attrB === "string" && attrB.startsWith("talent:")) {
    talent = getTalent(actor, attrB.slice(7));
  }
  // Non-combat-only Attribute boosts (ncCheck effects): Step the matching die(s) and/or add a flat
  // bonus to the total. Applied to Checks/Tests only — attacks & skills never read this.
  const ncc = collectNonCombatCheckMods(actor, attrA, talent ? attrA : attrB);
  modifier += ncc.flat;
  if (talent) modifier += PROJECTANIME.trainedEdge;
  const rawB = talent ? talent.die : attrValue(actor, attrB);
  let { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, attrA), rawB);
  dieA = stepDie(dieA, ncc.stepsA);
  dieB = stepDie(dieB, ncc.stepsB);
  const roll = new Roll(checkFormula(dieA, dieB, modifier));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;

  const labelA = i18n(PROJECTANIME.attributes[attrA]);
  const labelB = talent ? talent.name : i18n(PROJECTANIME.attributes[attrB]);
  const badges = [];
  if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
  const lines = [`<strong>${escHTML(labelA)} + ${escHTML(labelB)}</strong>`, ...stepNotes(reasons)];
  const checkModLine = rollModLine(rmods); if (checkModLine) lines.push(checkModLine);
  if (ncc.sources.length) lines.push(`<em class="muted">${ncc.sources.map((s) => `${s.name}: ${s.label}`).join(", ")}</em>`);
  let vs = "";
  if (ct != null) {
    // Fumble and Combo already decide (and announce) the outcome — matching evalPair, a Combo is an
    // auto-success and a Fumble an auto-failure, so only a plain roll adds the Success/Failure word.
    if (!fumble && !combo) {
      const success = roll.total >= ct;
      badges.push({ cls: success ? "success" : "failure", text: success ? i18n("PROJECTANIME.Roll.success") : i18n("PROJECTANIME.Roll.failure") });
    }
    vs = `${i18n("PROJECTANIME.Roll.ct")} <b>${ct}</b>`;
  }
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }

  // Luck may replace either die AFTER the roll (rules: Luck Dice) — Fumble and Combo read the
  // dice as they stand after replacement, so even those results stay editable.
  const buttons = [luckButton({ d1: r1, d2: r2, mod: modifier, ct, kind: "check", actorUuid: actor.uuid })];

  await postCard(actor, cardHTML({
    title: ct != null ? i18n("PROJECTANIME.Roll.test") : i18n("PROJECTANIME.Roll.check"),
    subtitle: `${labelA} + ${labelB}`,
    badges,
    vs,
    rollHTML: await roll.render(),
    lines,
    buttons
  }), roll, { combo });
  return roll;
}

/**
 * Roll a flavor Agility-die + Mind-die "initiative" total to chat. Under SIDE INITIATIVE turn order is
 * assigned by side (not rolled), so IN combat there is nothing to roll — this is only the out-of-combat
 * card (the sheet's Initiative button is removed; kept for any macro use).
 */
export async function rollInitiative(actor) {
  const inCombat = game.combat?.combatants?.some((c) => c.actorId === actor.id);
  if (inCombat) return;   // side-bucketed turn order — no per-actor roll (see project-anime assignSideInitiative)
  const roll = new Roll("1d@attributes.agility.value + 1d@attributes.mind.value", actor.getRollData());
  await roll.evaluate();
  await postRollCard(actor, {
    title: i18n("PROJECTANIME.Roll.initiative"),
    subtitle: `${i18n(PROJECTANIME.attributes.agility)} + ${i18n(PROJECTANIME.attributes.mind)}`,
    roll
  });
  return roll;
}

/** A weapon/shield attack: roll two dice (Paired Attribute + Talent +1, or two Attributes) vs
 *  the target's GUARD, with Fumble & Combo. Meeting the weapon's THRESHOLD marks 1 additional
 *  box at the damage step (rules: Making an Attack). */
export async function rollAttack(actor, item, { event, target = null } = {}) {
  const spec = rollSpec(actor, item);
  let mod = (Number(item.system.accuracy?.mod) || 0) + spec.edge;

  const targetActor = target ?? firstTargetActor();
  let guard = guardOf(targetActor);
  let cover = 0;

  // Shift-click skips the situational-modifier dialog.
  if (!event?.shiftKey) {
    const info = guard != null
      ? `<p class="hint">${i18n("PROJECTANIME.Roll.vsGuard")} <strong>${targetActor.name}</strong>: ${guard}</p>`
      : `<p class="hint">${i18n("PROJECTANIME.Roll.noTarget")}</p>`;
    // NPC attacks skip the Cover row — the GM already adjudicates their targets' cover directly.
    const choice = await promptRoll({ title: i18n("PROJECTANIME.Roll.attack"), actor, selector: "attack", showAttrs: false, showCT: false, showCover: guard != null && actor.type !== "npc", infoHTML: info });
    if (!choice) return null;
    mod += choice.mod;
    // Cover raises the target's Guard by 1 or 2 while the obstacle holds (table adjudication).
    cover = Number(choice.cover) || 0;
    if (guard != null) guard += cover;
  }

  const rmods = collectRollModifiers(actor, "attack", { target: targetActor });
  mod += rmods.flat;
  // Weapon Adjustments (`weaponMod`): a flat attack bump scoped to any weapon, the Unarmed
  // strike, or this weapon's Type — surfaced on the card alongside the roll modifiers.
  const wmods = collectWeaponModBonuses(actor, item, { src: item, target: targetActor });
  if (wmods.attack) { mod += wmods.attack; rmods.sources.push(...wmods.attackSources); }
  const { dieA, dieB, reasons } = steppedDice(actor, spec.dieA, spec.dieB, { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, mod));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;

  const badges = [];
  let hit = null;
  if (fumble) { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") }); hit = false; }
  else if (combo) { badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") }); hit = true; }
  else if (guard != null) { hit = roll.total >= guard; }

  if (hit === true && !combo) badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
  else if (hit === false && !fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });

  // Threshold (rules: meet or exceed the weapon's Threshold → 1 additional box). Weakened
  // raises the attacker's Threshold by 2; a Prone target lowers it by 2.
  const threshold = thresholdVs(actor, item, targetActor);
  const thresholdMet = threshold != null && !fumble && roll.total >= threshold;

  const lines = [`<strong>${escHTML(spec.labelA)} + ${escHTML(spec.labelB)}</strong>${spec.edge ? ` <em class="muted">(+${spec.edge} ${i18n("PROJECTANIME.Roll.trainedEdge")})</em>` : ""}`, ...stepNotes(reasons)];
  const atkModLine = rollModLine(rmods); if (atkModLine) lines.push(atkModLine);
  // The defense sits on the outcome row: "vs Guard Name 14 — HIT".
  const vs = guard != null
    ? `${i18n("PROJECTANIME.Roll.vsGuard")} <strong>${escHTML(targetActor.name)}</strong> <b>${guard}</b>${cover ? ` <em class="muted">(${i18n("PROJECTANIME.Roll.coverBonus", { n: cover })})</em>` : ""}`
    : `<em class="muted">${i18n("PROJECTANIME.Roll.noTarget")}</em>`;
  if (threshold != null && hit !== false) {
    lines.push(`<em class="muted">${i18n(thresholdMet ? "PROJECTANIME.Roll.thresholdMet" : "PROJECTANIME.Roll.thresholdMissed", { n: threshold })}</em>`);
  }
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
  // Attacking reveals a Vanished attacker — the attempt itself, hit or miss.
  await revealVanished(actor, lines);

  // A weapon's on-hit conditions ride the Roll Damage step and land only if the blow dealt >0
  // net damage (house rule: a fully mitigated hit inflicts nothing).
  const buttons = [luckButton({ d1: r1, d2: r2, mod, evasion: guard, threshold, kind: "attack", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" })];
  if (hit !== false) {
    // Stamp the resolved target so "Roll Damage" can't drift to a re-target — the hit was
    // validated against THIS target's Guard. The Threshold outcome rides along.
    const tgt = targetActor ? ` data-target-uuid="${targetActor.uuid}"` : "";
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}${thresholdMet ? ' data-threshold-met="true"' : ""}`,
      label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`,
      primary: true
    });
  }

  await postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img,
    badges,
    vs,
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

/** The roll spec a Technique's to-hit uses: a Weapon-range Technique borrows the equipped
 *  weapon's spec (its Paired Attribute + Talent, or Attribute pair); otherwise the Technique's
 *  own Talent / Attribute pair (rules: Range — Weapon "uses your weapon's Damage and
 *  Threshold"; Building a Technique — "Name a Talent or Attributes"). */
function skillRollSpec(actor, item) {
  const weapon = skillWeapon(actor, item);
  if (weapon) return { ...rollSpec(actor, weapon), mod: Number(weapon.system.accuracy?.mod) || 0, weapon };
  return { ...rollSpec(actor, item), mod: 0, weapon: null };
}

/**
 * Compute the (target-independent) fixed damage/heal amount for a weapon or Technique. Shared
 * by the single-target, area, and chain damage paths.
 *
 * V2: damage is FIXED, never rolled.
 *  - Weapon attacks (and Weapon-range Strikes): the weapon's printed Damage; the roll meeting
 *    the weapon's Threshold marks 1 additional box (`thresholdMet`, resolved at the attack).
 *  - Non-weapon-range Strikes (Touch / Range X / Self): 1 hit box, no Threshold.
 *  - Heal: clear 1 box of the chosen pool.
 *  - Potent: +1 box marked or cleared per take (up to two takes).
 *  - Charge: the release marks or clears DOUBLE the boxes.
 */
async function computeDamageRoll(actor, item, { target = null, charged = false, spec = null, thresholdMet = false } = {}) {
  const isSkill = item.type === "skill";
  const effect = spec?.effect ?? item.system?.effect;
  const heal = isSkill && effect === "mend";
  const weapon = skillWeapon(actor, item);
  const usesWeapon = !!weapon || !isSkill;
  const src = weapon ?? item;

  let flat;
  const dmgReasons = [];
  if (heal) {
    flat = 1;
  } else if (usesWeapon) {
    flat = Math.max(0, Number(src.system.damage?.value) || 0);
    if (thresholdMet) { flat += 1; dmgReasons.push("threshold"); }
  } else {
    flat = 1;
  }

  // Potent (+1 box marked or cleared per take, up to two).
  let potent = 0;
  if (isSkill && (item.system.modifiers ?? []).includes("potent")) {
    potent = PROJECTANIME.potentBonus * modifierTakes("potent", item.system);
    flat += potent;
  }

  // A Heal restores its chosen pool; a Strike marks hit boxes.
  const slotPool = spec?.damagePool ?? item.system?.damagePool;
  const pool = heal && slotPool === "energy" ? "energy" : "hp";

  // Flat modifiers from effects / weapon adjustments (GM-authored bonuses).
  let mod = 0;
  const rmods = collectRollModifiers(actor, "damage", { target });
  mod += rmods.flat;
  const smods = collectSkillModBonuses(actor, item, { target });
  if (smods.damage) { mod += smods.damage; rmods.sources.push(...smods.sources); }
  const wmods = collectWeaponModBonuses(actor, item, { src, target });
  if (wmods.damage) { mod += wmods.damage; rmods.sources.push(...wmods.damageSources); }
  flat += mod;

  // Charge doubles the total.
  const raw = Math.max(flat, 0) * (charged ? 2 : 1);

  // Create a deterministic Roll for Foundry chat compatibility.
  const roll = new Roll(String(raw));
  await roll.evaluate();

  return { roll, raw, isSkill, heal, pool, dmgReasons, rmods, charged, potent, thresholdMet };
}

/**
 * Shape one target's damage/heal application. V2 has no defense soak — the fixed amount lands
 * as-is (an active Barrier still absorbs its share at the apply step). Kept as the shared
 * chokepoint so every path formats its card line identically.
 */
export function adjustForTarget(raw, targetActor, { heal = false } = {}) {
  const badges = [];
  if (heal) return { amount: raw, heal: true, badges, line: i18n("PROJECTANIME.Roll.healsFor", { n: raw }) };
  return { amount: Math.max(0, raw), heal: false, badges, line: `<strong>${raw}</strong>` };
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
  // The portrait sits inside a diamond-clipped gold ring (the wrapper carries the ring gradient;
  // the inner img is clipped to a slightly smaller diamond).
  const portrait = row.img
    ? `<span class="dmg-portrait"><img src="${escHTML(row.img)}" alt="" /></span>`
    : `<span class="dmg-portrait"><i class="fas fa-user"></i></span>`;
  const calc = row.calc ? `<div class="dmg-calc">${row.calc}</div>` : "";
  // Cover (the Skill Modifier): redirect a damage row to whoever throws themselves in front of it.
  // Offered on live damage rows only — covering a heal or an already-undone hit is meaningless.
  const cover = (row.undone || row.heal)
    ? ""
    : `<button type="button" class="dmg-cover" data-action="coverDamage" data-row="${i}" data-tooltip="${i18n("PROJECTANIME.Roll.cover")}"><i class="fas fa-bullseye"></i></button>`;
  const undo = row.undone
    ? `<span class="dmg-undone"><i class="fas fa-check"></i> ${i18n("PROJECTANIME.Roll.undone")}</span>`
    : `<button type="button" class="dmg-undo" data-action="undoDamage" data-row="${i}" data-tooltip="${i18n("PROJECTANIME.Roll.undo")}"><i class="fas fa-rotate-left"></i></button>`;
  const action = `<span class="dmg-actions">${cover}${undo}</span>`;
  return `<div class="dmg-row${row.undone ? " is-undone" : ""}">
    ${portrait}
    <div class="dmg-body">
      <div class="dmg-head"><span class="dmg-name">${escHTML(row.name)}</span><span class="dmg-amount ${cls}">${sign}${row.amount} ${unit}</span></div>
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
export async function rollDamage(actor, item, { targetUuids = null, charged = false, spec = null, sourceMessageId = null, thresholdMet = false } = {}) {
  let targets = [];
  if (targetUuids?.length) {
    targets = (await Promise.all(targetUuids.map((u) => fromUuid(u)))).filter(Boolean);
  } else {
    const t = firstTargetActor();
    if (t) targets = [t];
  }
  if (targets.length > 1) return postAoeDamageCard(actor, item, targets, { charged, spec, sourceMessageId, thresholdMet });

  // Single-target (or no target).
  const targetActor = targets[0] ?? null;
  const dmg = await computeDamageRoll(actor, item, { target: targetActor, charged, spec, thresholdMet });

  const adj = adjustForTarget(dmg.raw, targetActor, { heal: dmg.heal });

  const badges = [...adj.badges];
  const notes = damageNotes(dmg);
  // Apply the damage/healing immediately and record an undo row carrying the calculation. With no
  // target (or a no-op hit) there's nothing to apply — fall back to showing the figure.
  // A Cursed target clears nothing: healing is voided.
  const rows = [];
  const killed = [];
  let dealt = 0;
  // A Heal clears its CHOSEN pool (hit boxes or energy boxes).
  const healPool = dmg.heal ? dmg.pool : "hp";
  if (targetActor && adj.heal && curseBlocks(targetActor, healPool)) {
    notes.push(curseNote(targetActor.name, healPool));
  } else if (targetActor && (adj.amount > 0 || adj.heal)) {
    const pool = adj.heal ? healPool : dmg.pool;
    // An active Barrier (temporary hit boxes) eats its share first (the row shows what got through).
    const bc = barrierCalc(targetActor, adj, pool);
    if (killsTarget(targetActor, { ...adj, amount: bc.amount }, pool)) killed.push(targetActor);
    await routeApply(targetActor, targetActor.uuid, adj.amount, adj.heal, pool);
    rows.push({ uuid: targetActor.uuid, name: targetActor.name, img: targetActor.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
    if (!adj.heal) dealt = bc.amount;
  }
  // House rule: a damaging attack/skill visits its on-hit riders (conditions / Decay / applied
  // effects) on the target ONLY when the blow dealt >0 net damage — a fully mitigated hit (immune,
  // armour-soaked, Barrier-absorbed, or absorbed as healing → dealt 0) inflicts nothing. Riders ride
  // the PRIMARY Strike, so a secondary damage die (spec) never re-applies them.
  if (targetActor && dealt > 0 && !spec && isDamagingStrike(item) && !ridersAlreadyDone(sourceMessageId)) {
    notes.push(...(await applySkillOnHit(actor, item, targetActor)));
    await markRidersDone(sourceMessageId);
  }
  // Drain: a hit that dealt >0 damage clears 1 box on the caster (per creature damaged — a
  // single target is 1; what a Barrier absorbed never touched the creature, so it feeds no
  // drain). A basic attack (weapon/shield) additionally feeds any PASSIVE drain Skill.
  await applyDrain(actor, item, dealt > 0 ? 1 : 0, notes);
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

/** The shared "threshold / potent / charged" damage notes. */
function damageNotes(dmg) {
  const lines = [];
  if (dmg.charged) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.charged")}</em>`);
  if (dmg.dmgReasons.includes("threshold")) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.thresholdBonus")}</em>`);
  if (dmg.potent) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.potent", { n: dmg.potent })}</em>`);
  const modLine = rollModLine(dmg.rmods); if (modLine) lines.push(modLine);
  return lines;
}

/** Multi-target damage card: one fixed amount, applied per target. */
async function postAoeDamageCard(actor, item, targetActors, { charged = false, spec = null, sourceMessageId = null, thresholdMet = false } = {}) {
  const dmg = await computeDamageRoll(actor, item, { target: targetActors[0], charged, spec, thresholdMet });
  const lines = [`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetActors.length })}</em>`];
  const rows = [];
  const killed = [];
  const hits = [];
  // Riders apply once per originating card (first Roll Damage click), per target that took >0 damage.
  const doRiders = !dmg.heal && !spec && isDamagingStrike(item) && !ridersAlreadyDone(sourceMessageId);
  let ridersApplied = false;
  for (const ta of targetActors) {
    const adj = adjustForTarget(dmg.raw, ta, { heal: dmg.heal });
    let through = 0;
    const healPool = dmg.heal ? dmg.pool : "hp";   // a Heal clears its chosen pool
    if (adj.heal && curseBlocks(ta, healPool)) {
      // A Cursed creature regains nothing to its cursed pool — the heal is voided.
      lines.push(curseNote(ta.name, healPool));
    } else if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation. An active Barrier
      // on that pool eats its share first (the row shows what got through).
      const pool = adj.heal ? healPool : dmg.pool;
      const bc = barrierCalc(ta, adj, pool);
      if (killsTarget(ta, { ...adj, amount: bc.amount }, pool)) killed.push(ta);
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
      through = bc.amount;
    } else {
      // Nothing dealt (e.g. immune) — note it, but there's nothing to apply or undo.
      lines.push(`<span class="card-target-row"><strong>${escHTML(ta.name)}</strong> <span class="muted">${adj.line}</span></span>`);
    }
    // House rule: an area Strike visits its on-hit riders on each target ONLY where the blow dealt
    // >0 net damage (a fully mitigated target takes none).
    if (doRiders && through > 0) {
      lines.push(...(await applySkillOnHit(actor, item, ta)));
      ridersApplied = true;
    }
    if (!adj.heal && through > 0) hits.push({ actor: ta, amount: through });
  }
  if (ridersApplied) await markRidersDone(sourceMessageId);
  lines.push(...damageNotes(dmg));
  // Drain: 1 box per creature the area actually damaged (Barrier-absorbed hits never
  // touched the creature, so they feed no drain).
  await applyDrain(actor, item, hits.length, lines);
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
/** The per-encounter use ledger for 1/Conflict Skills: { [skillId]: usesSpent }. */
function conflictUsesMap(actor) {
  return actor?.flags?.["project-anime"]?.conflictUses ?? {};
}

/** Uses left this Conflict for a 1/Conflict Skill (Infinity for an unlimited Skill). */
export function conflictUsesLeft(actor, item) {
  const sys = item?.system ?? {};
  if (!sys.perConflict) return Infinity;
  const limit = Number(sys.usesLimit) || 1;
  const used = Number(conflictUsesMap(actor)[item.id]) || 0;
  return Math.max(0, limit - used);
}

/** Record one 1/Conflict use of a Skill on its owner. */
async function spendConflictUse(actor, item) {
  if (!item?.system?.perConflict || !actor) return;
  const used = Number(conflictUsesMap(actor)[item.id]) || 0;
  await actor.setFlag("project-anime", `conflictUses.${item.id}`, used + 1);
}

/** Clear an actor's 1/Conflict ledger — fired at combat start and end (project-anime.mjs). GM/owner. */
export async function resetConflictUses(actor) {
  if (actor?.flags?.["project-anime"]?.conflictUses) await actor.unsetFlag("project-anime", "conflictUses");
}

export async function rollSkill(actor, item) {
  const sys = item.system;
  // Sealed prevents activating Techniques (passives are always-on, not activated).
  if (actor.statuses?.has?.("exhausted") && sys.actionType !== "passive") {
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.exhausted"));
  }

  // Per-Conflict limiter: a Technique flagged usesPerConflict (a GM enemy-design knob) may be
  // used only so many times per encounter. Enforced only inside a live Conflict; the counter
  // resets when combat starts and ends (project-anime.mjs).
  if (sys.perConflict && game.combat?.started && conflictUsesLeft(actor, item) <= 0) {
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.perConflictSpent"));
  }

  const mods = sys.modifiers ?? [];
  // Devour (a Modifier): a dedicated flow — copy one Technique the all-boxes-marked target
  // knows. No attack.
  if (mods.includes("devour")) return resolveDevour(actor, item);

  // Aura (a Modifier): the Effect is delivered by a continuous field (helpers/aura.mjs), not an
  // on-use attack/effect. A PASSIVE aura is always-on (just report it); an ACTIVE/React aura
  // starts or refreshes a duration marker here. Either way, skip the normal resolution.
  if (mods.includes("aura")) return resolveAura(actor, item);

  // Whole-subsystem Effects run their own flows: Companion bonds its creature (helpers/
  // servants.mjs); Conjure materializes an item; Gate links two tiles. None of them roll an
  // attack; each handles its own targeting and Energy.
  if (sys.effect === "companion") return resolveCompanion(actor, item);
  if (sys.effect === "conjure") return resolveConjure(actor, item);
  if (sys.effect === "gate") return resolveGate(actor, item);

  // Charge (a Skill modifier): the first activation spends a turn focusing; the next activation
  // (or the card's Release button) resolves it at double power. A miss dissipates the charge.
  const isChargeSkill = mods.includes("charge");
  const releasingCharge = isChargeSkill && actor.getFlag("project-anime", "charge") === item.id;
  if (isChargeSkill && !releasingCharge) return startCharge(actor, item);
  // v0.03 Charge: the focus turn already rolled — a stored hit strikes true at release, no re-roll.
  const chargeLockedHit = releasingCharge && !!actor.getFlag("project-anime", "chargeHit");

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
    // Abort, don't roll total-only: a chain has no path without targeted creatures.
    if (!chainTokens.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needTarget"));
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
  if (releasingCharge) {
    await actor.unsetFlag("project-anime", "charge");
    if (chargeLockedHit) await actor.unsetFlag("project-anime", "chargeHit");
  } else if (!(await spendSkillEnergy(actor, sys, item))) return null;

  // Commit one 1/Conflict use now the cast is going through (inside a live Conflict).
  if (sys.perConflict && game.combat?.started) await spendConflictUse(actor, item);

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
  return resolveSingleSkill(actor, item, { charged: releasingCharge, chargeLockedHit });
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
    const duration = scene ? {} : makeRoundsDuration(dur);
    // Refresh: drop any existing marker for this aura, then stamp a fresh one on the caster. The
    // marker tells the reconcile the aura is running (and for how long); its create/expire nudges the
    // field engine via the createActiveEffect/deleteActiveEffect hooks.
    const old = actor.effects.filter((e) => e.flags?.["project-anime"]?.auraMarker === item.id).map((e) => e.id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: item.name,
      img: item.img,
      duration,
      flags: { "project-anime": { auraMarker: item.id, scene, creatorSide: actorSide(actor) } }
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
  // A `skillMod` rule (Trait/gear) can discount the cost of Skills carrying its Modifier — e.g.
  // an effect making Burst Skills cost −1 Energy. `energy` is a signed delta (−1 = cheaper).
  if (energyCost > 0 && item) {
    energyCost = Math.max(0, energyCost + collectSkillModBonuses(actor, item).energy);
  }
  if (energyCost > 0) {
    const current = actor.system.energy?.value ?? 0;
    if (current < energyCost) { ui.notifications.warn(i18n("PROJECTANIME.Roll.noEnergy", { n: energyCost })); return false; }
    await actor.update({ "system.energy.value": current - energyCost });
  }
  // Manifest (a Modifier): EVERY activation path pays through here (single/area/aura/conjure/
  // gate/charge), so a successful activation WAKES the bound Passive — stamp (refresh) its
  // duration marker on the caster. The Passive's effects run while the marker lives (effects.mjs
  // gates on it); its energy lock stays lifted either way (the bond itself unlocks it).
  if (item?.type === "skill" && sys.actionType !== "passive" && (sys.modifiers ?? []).includes("manifest")) {
    await ensureManifestMarker(actor, item);
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

/** Single-target Technique resolution (Energy is already spent). */
async function resolveSingleSkill(actor, item, { charged = false, chargeLockedHit = false } = {}) {
  const sys = item.system;
  const effects = skillEffectKeys(sys);
  const hasStrike = effects.includes("strike");
  // Apply on-use effects when any non-die Effect is carried OR a Modifier grants auto rules
  // (Protection / Barrier / Regen / Reflect / Retaliation) — a pure Strike with Protection
  // still wards its target.
  const hasOther = effects.some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length > 0;
  let targetToken = firstTargetToken();
  let targetActor = targetToken?.actor ?? null;

  // Sense vs Vanish (Opposing Techniques): aiming a Sense Technique at a Vanished creature
  // becomes the dedicated detection contest.
  if (effects.includes("sense") && targetActor?.statuses?.has?.("vanished")) {
    return resolveSenseDetect(actor, item, targetActor);
  }

  const lines = [];

  // Reflect (a Heavy Modifier): the next technique that targets the bearer redirects to its
  // user — consumed on use. Redirect BEFORE the roll: the caster becomes their own target.
  if (targetActor && targetActor !== actor && targetActor.statuses?.has?.("reflect")) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.reflected", { name: targetActor.name })}</em>`);
    await applyStatusTo(targetActor.uuid, "reflect", false);
    targetToken = casterToken(actor);
    targetActor = actor;
  }

  // The defender's number: GUARD for an attack, the CONTEST TARGET for an Opposing-Techniques
  // piece (Weaken / Disarm / Nullify).
  const { value: evasion, contest } = evasionVs(targetActor, item);
  // A roll to hit is made ONLY when the Technique targets an enemy — its explicit Target gates
  // first (Foe always rolls, Self/Ally never), then for "Any": an offensive Effect or Modifier,
  // or forced movement (Reposition) aimed at a HOSTILE target. Supportive Techniques just take
  // effect — you can't dodge a heal or a buff. One shared roll covers every Effect.
  const needsAccuracy = skillNeedsAccuracy(sys, { enemyTarget: tokensAreEnemies(casterToken(actor), targetToken) });

  // Weapon-range Strikes use the weapon's Threshold (rules: Technique Damage); non-weapon
  // ranges have none.
  const spec = skillRollSpec(actor, item);
  const threshold = hasStrike && spec.weapon ? thresholdVs(actor, spec.weapon, targetActor) : null;
  let thresholdMet = false;

  const badges = [];
  let vs = "";
  let roll = null, r1 = null, r2 = null, fumble = false, combo = false, hit = null;

  if (needsAccuracy && chargeLockedHit) {
    // The focus turn's roll already landed (Charge) — the release strikes true.
    hit = true;
    badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chargeHitCarried")}</em>`);
  } else if (needsAccuracy) {
    const rmods = collectRollModifiers(actor, hasStrike ? "attack" : "check", { target: targetActor });
    // A Weapon-range Technique borrows a weapon, so Weapon Adjustments (`weaponMod`) scoped to
    // it bump this roll too. Non-weapon Techniques borrow nothing → no bump.
    const wmods = spec.weapon ? collectWeaponModBonuses(actor, item, { src: spec.weapon, target: targetActor }) : { attack: 0, attackSources: [] };
    if (wmods.attack) rmods.sources.push(...wmods.attackSources);
    const { dieA, dieB, reasons } = steppedDice(actor, spec.dieA, spec.dieB, { accuracy: true });
    roll = new Roll(checkFormula(dieA, dieB, rmods.flat + spec.edge + spec.mod + wmods.attack));
    await roll.evaluate();
    [r1, r2] = dieResults(roll);
    fumble = r1 === 1 && r2 === 1;
    combo = r1 === r2 && r1 >= 6;
    if (fumble) { badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") }); hit = false; }
    else if (combo) { badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") }); hit = true; }
    else if (evasion != null) hit = roll.total >= evasion;
    if (hit === true && !combo) badges.push({ cls: "success", text: i18n("PROJECTANIME.Roll.hit") });
    else if (hit === false && !fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });
    thresholdMet = threshold != null && !fumble && roll.total >= threshold;

    lines.push(`<strong>${escHTML(spec.labelA)} + ${escHTML(spec.labelB)}</strong>${spec.edge ? ` <em class="muted">(+${spec.edge} ${i18n("PROJECTANIME.Roll.trainedEdge")})</em>` : ""}`);
    lines.push(...stepNotes(reasons));
    const skillModLine = rollModLine(rmods); if (skillModLine) lines.push(skillModLine);
    if (evasion != null) vs = `${vsEvasionText(contest)} <strong>${escHTML(targetActor.name)}</strong> <b>${evasion}</b>`;
    if (threshold != null && hit !== false) {
      lines.push(`<em class="muted">${i18n(thresholdMet ? "PROJECTANIME.Roll.thresholdMet" : "PROJECTANIME.Roll.thresholdMissed", { n: threshold })}</em>`);
    }
    if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
    // Attacking reveals a Vanished caster — the attempt itself, hit or miss.
    await revealVanished(actor, lines);
  }

  // The Skill "lands" if it makes no Accuracy Check, or its Check didn't explicitly miss.
  const landed = !needsAccuracy || hit !== false;
  // Charged release: note the double power when it lands, or that the charge dissipated on a miss.
  if (charged) lines.push(`<em class="muted">${i18n(landed ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  // Inflicted conditions + Decay land when the Skill landed. A SUPPORTIVE Skill (no Accuracy Check —
  // Self / Ally, or a beneficial Inflict like Regen / Barrier) inflicts on whoever its effects target
  // (the caster for a Self / untargeted self-buff, the chosen ally otherwise), so a Regen / Barrier
  // buff actually lands on you even with nothing targeted; an offensive Skill inflicts on the creature
  // it hit.
  const inflictTarget = needsAccuracy ? targetActor : (skillEffectTargets(actor, item, null)[0] ?? actor);
  // A damaging Strike defers its on-hit riders (conditions / Decay / target ensnare / applied effects)
  // to the Roll Damage step, where they land only if the blow dealt >0 net damage (house rule). A
  // non-damaging Skill has no damage step, so it applies them on land here as before.
  if (landed && !hasStrike) await applyOnHitConditions(actor, item, inflictTarget, lines);

  // Vanish (rules v0.01): a landed cast shrouds the CASTER — "you cannot be seen".
  if (effects.includes("vanish") && landed) await applyVanish(actor, item, lines);

  // The ensnaring Effects (Disguise / Illusion / Telepathy) leave a tracked marker on the affected
  // creature — visible to the table, clearable by the Overcome action. On a Strike the TARGET marker
  // defers with the other riders (applied only if damage lands); a Disguise still marks the CASTER on
  // land (it's a self-shroud, not a hit on the target).
  if (landed) {
    if (!hasStrike) {
      for (const eff of effects.filter((e) => ENSNARE_EFFECTS.includes(e))) {
        if (targetActor && targetActor !== actor) lines.push(...(await applyEnsnareMarker(actor, item, targetActor, eff)));
      }
    }
    if (effects.includes("disguise")) lines.push(...(await applyEnsnareMarker(actor, item, actor, "disguise", { self: true })));
  }

  // A Technique applies its Active Effect(s) whenever it carries any non-die Effect (Empower /
  // Weaken / Sense / Custom) in EITHER slot — to the targeted tokens, or the caster if none are
  // targeted. Supportive effects always apply; an auto-Weaken lands only on a hit (`landed`). A
  // Strike defers this to the Roll Damage step (applied only where damage landed).
  if (hasOther && !hasStrike) lines.push(...(await applySkillEffects(actor, item, null, { landed })));
  // Barrier / Regen / Reflect (Modifiers): stamp their markers on the Technique's recipients
  // when it lands — a Strike defers this to the damage step with its other riders.
  if (landed && !hasStrike) lines.push(...(await applyModifierStatuses(actor, item, null)));

  const buttons = [];
  // Spend Luck replaces a rolled die — offered for ANY enemy-targeting Technique. Fumble and
  // Combo read the dice as they stand after replacement, so even those results stay editable.
  if (needsAccuracy && roll) buttons.push(luckButton({ d1: r1, d2: r2, mod: 0, evasion, threshold, kind: "skill", actorUuid: actor.uuid, itemId: item.id, targetUuid: targetActor?.uuid ?? "" }));
  // Die-Effect follow-ups: a Strike offers Roll Damage (only on a landed hit); a Heal offers
  // Roll Healing regardless (self/ally healing isn't gated by a roll). The secondary slot
  // stamps its own Effect/pool so its application uses that slot's values.
  const tgt = targetActor ? ` data-target-uuid="${targetActor.uuid}"` : "";
  const chg = charged ? ` data-charged="true"` : "";
  const thr = thresholdMet ? ` data-threshold-met="true"` : "";
  for (const ds of skillDieSpecs(sys)) {
    const heal = ds.effect === "mend";
    if (!heal && !landed) continue;
    const sp = ds.primary ? ""
      : ` data-effect="${ds.effect}" data-damage-pool="${ds.damagePool ?? ""}"`;
    buttons.push({
      data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"${tgt}${chg}${heal ? "" : thr}${sp}`,
      label: `<i class="fas fa-${heal ? "heart" : "burst"}"></i> ${i18n(heal ? "PROJECTANIME.Roll.rollHealing" : "PROJECTANIME.Roll.rollDamage")}`,
      primary: true
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
    vs,
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
  const spec = skillRollSpec(actor, item);
  // A Strike rolls damage; a non-Strike area attack (e.g. Mass Weaken) lands its Effect on the
  // creatures it hit but offers no damage roll.
  const hasStrike = skillEffectKeys(sys).includes("strike");
  const primary = targetTokens[0]?.actor ?? null;

  const rmods = collectRollModifiers(actor, "attack", { target: primary });
  // A Weapon-range area Strike borrows a weapon, so Weapon Adjustments (`weaponMod`) bump its
  // roll too — matching the single-target path. Non-weapon area Techniques borrow nothing.
  const wmods = spec.weapon ? collectWeaponModBonuses(actor, item, { src: spec.weapon, target: primary }) : { attack: 0, attackSources: [] };
  if (wmods.attack) rmods.sources.push(...wmods.attackSources);
  const { dieA, dieB, reasons } = steppedDice(actor, spec.dieA, spec.dieB, { accuracy: true });
  const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + spec.edge + spec.mod + wmods.attack));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;
  // Weapon-range area Strikes still read the weapon's Threshold off the shared roll.
  const threshold = hasStrike && spec.weapon ? thresholdVs(actor, spec.weapon, null) : null;
  const thresholdMet = threshold != null && !fumble && roll.total >= threshold;

  const badges = [];
  if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
  else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });

  const lines = [`<strong>${escHTML(spec.labelA)} + ${escHTML(spec.labelB)}</strong>${spec.edge ? ` <em class="muted">(+${spec.edge} ${i18n("PROJECTANIME.Roll.trainedEdge")})</em>` : ""}`, ...stepNotes(reasons)];
  const modLine = rollModLine(rmods); if (modLine) lines.push(modLine);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeAffects", { n: targetTokens.length })}</em>`);

  const hitUuids = [];
  const hitActors = [];
  const luckTargets = [];
  for (const tok of targetTokens) {
    const ta = tok.actor; if (!ta) continue;
    // Each caught creature defends with its own number — Guard, or its Contest Target.
    const { value: ev, contest } = evasionVs(ta, item);
    const didHit = combo || (!fumble && (ev == null || roll.total >= ev));
    luckTargets.push({ uuid: ta.uuid, ev, name: ta.name });
    const evNum = ev != null ? `<span class="ctr-num">${evasionLabel(contest)} ${ev}</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${escHTML(ta.name)}</strong><span class="ctr-res ${didHit ? "is-hit" : "is-miss"}">${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evNum}</span></span>`);
    if (didHit) {
      hitUuids.push(ta.uuid);
      hitActors.push(ta);
      // A Strike defers its riders (conditions / Lingering / ensnare) to the Roll Damage step,
      // applied per target only where the blow dealt >0 damage (house rule). A non-Strike area
      // attack (Mass Weaken) has no damage step, so it inflicts on hit here as before.
      if (!hasStrike) {
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
  }
  if (!targetTokens.length) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.aoeNoTargets")}</em>`);
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
  // Attacking reveals a Vanished attacker (rules v0.01) — the attempt itself, hit or miss.
  await revealVanished(actor, lines);
  // Charged release: note the double power on any hit, or that the charge dissipated on a clean miss.
  if (charged) lines.push(`<em class="muted">${i18n(hitUuids.length ? "PROJECTANIME.Roll.charged" : "PROJECTANIME.Roll.chargeDissipated")}</em>`);

  // A secondary non-die Effect (e.g. an area Strike that also Empowers) — or a Modifier-granted
  // auto rule (Protection / Barrier / Regen / Reflect) — grants its Active Effect(s) to the
  // creatures it hit. An area STRIKE defers this to the Roll Damage step.
  if (!hasStrike && (skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length) && hitActors.length) {
    lines.push(...(await applySkillEffects(actor, item, hitActors)));
    lines.push(...(await applyModifierStatuses(actor, item, hitActors)));
  }

  const buttons = [];
  // Spend Luck re-evaluates the single roll against every caught target's number — offered for
  // ANY area attack; the follow-up applies what newly landed and, for a Strike, re-offers Roll
  // Damage. Replacement can make or unmake a Fumble/Combo (the dice read as they stand).
  if (luckTargets.length) buttons.push(aoeLuckButton({
    d1: r1, d2: r2, mod: rmods.flat + spec.edge + spec.mod + wmods.attack, targets: luckTargets, actorUuid: actor.uuid, itemId: item.id
  }));
  if (hasStrike && hitUuids.length) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}" data-target-uuids="${hitUuids.join(",")}"${charged ? ' data-charged="true"' : ''}${thresholdMet ? ' data-threshold-met="true"' : ''}`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`,
    primary: true
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
    lines.push(`<span class="card-target-row"><strong>${escHTML(ta.name)}</strong></span>`);
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

  // Any non-die Effect (Mass Empower / Weaken …) — including a secondary one riding a
  // Mass Heal — or a Modifier-granted auto rule (Protection / Barrier / Regen / Reflect) grants
  // the Technique's Active Effect(s) to every caught creature.
  if (skillEffectKeys(sys).some((e) => e !== "strike" && e !== "mend") || skillModifierRules(item).length) {
    lines.push(...(await applySkillEffects(actor, item, targetTokens.map((t) => t.actor).filter(Boolean))));
  }
  lines.push(...(await applyModifierStatuses(actor, item, targetTokens.map((t) => t.actor).filter(Boolean))));

  if (isMend && charged) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.charged")}</em>`);

  const buttons = [];
  if (isMend && uuids.length) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}" data-target-uuids="${uuids.join(",")}"${charged ? ' data-charged="true"' : ''}`,
    label: `<i class="fas fa-heart"></i> ${i18n("PROJECTANIME.Roll.rollHealing")}`,
    primary: true
  });

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img, meta: skillMeta(sys),
    description: await enrichDescription(item), lines, buttons
  }));
  return null;
}

/**
 * Chain: hit the primary (the player's first target), then leap to 1 additional target within
 * Talent die/2 tiles that the player ALSO targeted — so the chain only travels through chosen
 * creatures, never the caster. Each leap rolls to hit; the chain stops the moment a leap misses.
 * One combined attack+damage card.
 */
async function resolveChain(actor, item, chainTokens, { charged = false } = {}) {
  const sys = item.system;
  const spec = skillRollSpec(actor, item);
  const nearTiles = modifierValue(item, "chain");                       // leap distance: die/2 tiles (+1 Edge)
  const maxTargets = 1 + (PROJECTANIME.chainExtraTargets ?? 1);         // primary + 1 leap
  const chosen = new Set(chainTokens);   // the chain may only travel through targeted creatures
  const primaryToken = chainTokens[0];

  // One fixed damage amount (doubled on a charged release); every leap deals the same damage.
  const dmg = await computeDamageRoll(actor, item, { target: primaryToken.actor, charged });
  const threshold = spec.weapon ? thresholdVs(actor, spec.weapon, null) : null;

  const lines = [`<strong>${escHTML(spec.labelA)} + ${escHTML(spec.labelB)}</strong>${spec.edge ? ` <em class="muted">(+${spec.edge} ${i18n("PROJECTANIME.Roll.trainedEdge")})</em>` : ""}`];
  const rows = [];
  const rolls = [dmg.roll];
  const hitSet = new Set();
  let current = primaryToken;
  let stoppedName = null;
  const killed = [];
  const hits = [];
  // The card's dice box shows the PRIMARY attack roll (V2 damage is a fixed number — rendering
  // it read as a meaningless "1"); each leap's own roll renders under its target row instead.
  let primaryRollHTML = "";

  for (let i = 0; i < maxTargets && current; i++) {
    const ta = current.actor;
    if (!ta) break;
    hitSet.add(current);
    const rmods = collectRollModifiers(actor, "attack", { target: ta });
    const { dieA, dieB } = steppedDice(actor, spec.dieA, spec.dieB, { accuracy: true });
    const aroll = new Roll(checkFormula(dieA, dieB, rmods.flat + spec.edge + spec.mod));
    await aroll.evaluate();
    rolls.push(aroll);
    const [r1, r2] = dieResults(aroll);
    const fum = r1 === 1 && r2 === 1;
    const com = r1 === r2 && r1 >= 6;
    // Each leap's defender uses its own number — Guard, or its Contest Target.
    const { value: ev } = evasionVs(ta, item);
    const didHit = com || (!fum && (ev == null || aroll.total >= ev));
    // Weapon-range chains read the weapon's Threshold per leap (+1 box where met).
    const leapThresholdMet = threshold != null && !fum && aroll.total >= threshold;
    const raw = dmg.raw + (leapThresholdMet && !dmg.heal ? 1 : 0);

    const leapTag = i === 0 ? "" : `${i18n("PROJECTANIME.Roll.chainLeap", { n: i })} · `;
    const evText = ev != null ? ` vs ${ev}` : "";
    lines.push(`<span class="card-target-row">${leapTag}<strong>${escHTML(ta.name)}</strong> — ${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")} <span class="muted">(${aroll.total}${evText})</span></span>`);
    if (i === 0) primaryRollHTML = await aroll.render();
    else lines.push(await aroll.render());

    if (!didHit) { stoppedName = ta.name; break; }   // must hit before the leap continues

    const adj = adjustForTarget(raw, ta, { heal: dmg.heal });
    let through = 0;
    const healPool = dmg.heal ? dmg.pool : "hp";   // a Heal clears its chosen pool
    if (adj.heal && curseBlocks(ta, healPool)) {
      // A Cursed creature clears nothing on its cursed pool — the heal is voided.
      lines.push(curseNote(ta.name, healPool));
    } else if (adj.amount > 0 || adj.heal) {
      // Apply immediately; the per-target undo row carries the calculation. An active Barrier
      // eats its share first (the row shows what got through).
      const pool = adj.heal ? healPool : dmg.pool;
      const bc = barrierCalc(ta, adj, pool);
      if (killsTarget(ta, { ...adj, amount: bc.amount }, pool)) killed.push(ta);
      await routeApply(ta, ta.uuid, adj.amount, adj.heal, pool);
      rows.push({ uuid: ta.uuid, name: ta.name, img: ta.img, amount: bc.amount, heal: adj.heal, pool, calc: bc.calc, undone: false });
      through = bc.amount;
    } else {
      lines.push(`<span class="card-target-row"><span class="muted">${adj.line}</span></span>`);
    }
    // House rule: a leap inflicts its riders (conditions / Lingering) only where it dealt damage.
    if (!adj.heal && through > 0) {
      for (const c of collectInflictedConditions(item, ta)) {
        await applyConditionFromItem(actor, item, ta, c, lines);
      }
      await inflictDecay(item, ta, lines);
    }
    if (!adj.heal && through > 0) hits.push({ actor: ta, amount: through });
    current = tokensInRange(current, nearTiles).find((t) => chosen.has(t) && !hitSet.has(t)) ?? null;
  }

  if (stoppedName) lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chainStopped", { name: stoppedName })}</em>`);
  // Attacking reveals a Vanished attacker (rules v0.01) — the chain's first roll already did.
  await revealVanished(actor, lines);
  lines.push(...damageNotes(dmg));
  // Drain: 1 box per creature the chain actually damaged (Barrier-absorbed hits never
  // touched the creature, so they feed no drain).
  await applyDrain(actor, item, hits.length, lines);
  // Retaliation: each warded creature the chain hit punishes the attacker for its own hit.
  await applyRetaliation(actor, hits, lines);

  await postCard(actor, cardHTML({
    title: item.name, subtitle: i18n("PROJECTANIME.Roll.attack"),
    icon: item.img, meta: skillMeta(sys),
    rollHTML: primaryRollHTML,
    description: await enrichDescription(item), rows, lines
  }), rolls, rows.length ? { flags: { "project-anime": { damageCard: { rows } } } } : {});
  // Passive Devour: a chain that drops creatures to 0 HP lets a passive Devour Skill learn from each.
  await maybeDevourOnKill(actor, killed);
  return rolls;
}

/* -------------------------------------------- */
/*  Charge & Devour (Skill modifiers)           */
/* -------------------------------------------- */

/** Begin charging a Charge Skill: pay its Energy and — v0.03 — ROLL TO HIT on the focus turn.
 *  A miss fades the charge on the spot; a hit locks in, and the release (re-activating the
 *  Skill or its card's Release button) resolves next turn at double power without re-rolling.
 *  Non-accuracy and area Charges keep resolving at release (nothing to hit yet). One charge is
 *  held at a time per actor. */
async function startCharge(actor, item) {
  const sys = item.system;
  const targetToken = firstTargetToken();
  const targetActor = targetToken?.actor ?? null;
  const needsAccuracy = !aoeKind(item)
    && skillNeedsAccuracy(sys, { enemyTarget: tokensAreEnemies(casterToken(actor), targetToken) });
  if (needsAccuracy && !targetActor) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needTarget"));
  if (!(await spendSkillEnergy(actor, sys, item))) return null;

  if (needsAccuracy) {
    const spec = skillRollSpec(actor, item);
    const rmods = collectRollModifiers(actor, "attack", { target: targetActor });
    const wmods = spec.weapon ? collectWeaponModBonuses(actor, item, { src: spec.weapon, target: targetActor }) : { attack: 0, attackSources: [] };
    if (wmods.attack) rmods.sources.push(...wmods.attackSources);
    const { value: evasion, contest } = evasionVs(targetActor, item);
    const { dieA, dieB, reasons } = steppedDice(actor, spec.dieA, spec.dieB, { accuracy: true });
    const roll = new Roll(checkFormula(dieA, dieB, rmods.flat + spec.edge + spec.mod + wmods.attack));
    await roll.evaluate();
    const [r1, r2] = dieResults(roll);
    const fumble = r1 === 1 && r2 === 1;
    const combo = r1 === r2 && r1 >= 6;
    const hit = combo || (!fumble && (evasion == null || roll.total >= evasion));
    const badges = [];
    if (fumble) badges.push({ cls: "failure", text: i18n("PROJECTANIME.Roll.fumble") });
    else if (combo) badges.push({ cls: "combo", text: i18n("PROJECTANIME.Roll.combo") });
    badges.push(hit ? { cls: "success", text: i18n("PROJECTANIME.Roll.hit") } : { cls: "failure", text: i18n("PROJECTANIME.Roll.miss") });
    const lines = [...stepNotes(reasons)];
    const ml = rollModLine(rmods); if (ml) lines.push(ml);
    if (evasion != null) lines.push(`${vsEvasionText(contest)} <strong>${escHTML(targetActor.name)}</strong>: ${evasion}`);
    if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }
    await revealVanished(actor, lines);
    if (!hit) {
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chargeDissipated")}</em>`);
      return postCard(actor, cardHTML({
        title: item.name, subtitle: i18n("PROJECTANIME.Roll.charge"), icon: item.img,
        badges, rollHTML: await roll.render(), description: await enrichDescription(item), lines
      }), roll, { combo });
    }
    await actor.setFlag("project-anime", "chargeHit", { targetUuid: targetActor.uuid });
    await actor.setFlag("project-anime", "charge", item.id);
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.chargeReleases")}</em>`);
    return postCard(actor, cardHTML({
      title: item.name, subtitle: i18n("PROJECTANIME.Roll.charge"), icon: item.img,
      badges, rollHTML: await roll.render(), description: await enrichDescription(item), lines,
      buttons: [{
        data: `data-action="releaseCharge" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"`,
        label: `<i class="fas fa-bolt"></i> ${i18n("PROJECTANIME.Roll.release")}`,
        primary: true
      }]
    }), roll, { combo });
  }

  await actor.setFlag("project-anime", "charge", item.id);
  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.charge"),
    icon: item.img,
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Roll.chargeReleases")}</em>`],
    buttons: [{
      data: `data-action="releaseCharge" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}"`,
      label: `<i class="fas fa-bolt"></i> ${i18n("PROJECTANIME.Roll.release")}`,
      primary: true
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
  if (!target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needTarget"));
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
  stampCompendiumSource(data, chosen);
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
    `<strong>${escHTML(actor.name)}</strong>: ${i18n(PROJECTANIME.attributes[attrs[0]])} + ${i18n(PROJECTANIME.attributes[attrs[1]])}`,
    `<strong>${escHTML(defender.name)}</strong>: ${i18n(PROJECTANIME.attributes[defAttrs[0]])} + ${i18n(PROJECTANIME.attributes[defAttrs[1]])}`
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
    lines.push(`<span class="card-target-row"><strong>${escHTML(actor.name)}</strong> ${total} · <strong>${escHTML(defender.name)}</strong> ${defTotal}${total === defTotal ? ` — ${i18n("PROJECTANIME.Roll.contestedTie")}` : ""}</span>`);
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
  // v0.03: base Steal takes from INVENTORY only — equipped items need the Disarm Modifier
  // (won through the contested roll below).
  const canDisarm = (item.system?.modifiers ?? []).includes("disarm");
  const equipped = canDisarm ? lootable.filter((i) => i.system?.equipped) : [];
  if (!loose.length && !equipped.length) return ui.notifications.warn(i18n("PROJECTANIME.Roll.stealNothing", { name: target.name }));

  const pickedId = await pickStealDialog(target, loose, equipped);
  const picked = pickedId ? target.items.get(pickedId) : null;
  if (!picked) return null;

  if (picked.system?.equipped) {
    // Lifting an EQUIPPED item first wins the Disarm contest: roll the Technique's dice against
    // the target's Contest Target (rules: Opposing Techniques).
    const spec = skillRollSpec(actor, item);
    const ct = contestTargetFor(target);
    const { dieA, dieB } = steppedDice(actor, spec.dieA, spec.dieB);
    const roll = new Roll(checkFormula(dieA, dieB, spec.edge + spec.mod));
    await roll.evaluate();
    const [r1, r2] = dieResults(roll);
    const won = (r1 === r2 && r1 >= 6) || (!(r1 === 1 && r2 === 1) && roll.total >= ct);
    await postCard(actor, cardHTML({
      title: item.name, subtitle: i18n("PROJECTANIME.Roll.contested"), icon: item.img,
      badges: [won
        ? { cls: "success", text: i18n("PROJECTANIME.Roll.contestedWon") }
        : { cls: "failure", text: i18n("PROJECTANIME.Roll.contestedLost") }],
      rollHTML: await roll.render(),
      lines: [`${i18n("PROJECTANIME.Roll.vsContest")} <strong>${escHTML(target.name)}</strong>: ${ct}`]
    }), roll);
    if (!won) return null;
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
  stampCompendiumSource(data, picked);
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
  const duration = scene ? {} : makeRoundsDuration(mode === "instant" ? 1 : (sys.effectDuration ?? PROJECTANIME.standardDurationTurns));
  const markerFlags = { conjureMarker: conjureKey, scene, creatorSide: actorSide(actor) };
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
  const duration = scene ? {} : makeRoundsDuration(mode === "instant" ? 1 : (sys.effectDuration ?? PROJECTANIME.standardDurationTurns));
  const markerFlags = { gateMarker: gateKey, scene, creatorSide: actorSide(actor) };
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
  await applyStatusEffect(actor, "vanished", skillStatusDuration(item), { side: actorSide(actor) });
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

/** The Vanish Technique's "Stay Hidden" contest (rules: Opposing Techniques) — a creature is
 *  actively looking for you: the VANISHER rolls its Technique's dice against the seeker's
 *  Contest Target. */
async function onStayHiddenButton(event) {
  event.preventDefault();
  const el = event.currentTarget;
  const actor = await fromUuid(el.dataset.actorUuid);
  const item = actor?.items.get(el.dataset.itemId);
  if (!item) return ui.notifications.warn(i18n("PROJECTANIME.Roll.itemGone"));
  const seeker = firstTargetActor();
  if (!seeker) return ui.notifications.warn(i18n("PROJECTANIME.Roll.needTarget"));

  // The seeker's Contest Target — built on its Sense Technique when it has one.
  const senseSkill = (seeker.items ?? []).find((i) => i.type === "skill" && skillEffectKeys(i.system).includes("sense"));
  const ct = contestTargetFor(seeker, senseSkill);
  const spec = skillRollSpec(actor, item);
  const { dieA, dieB } = steppedDice(actor, spec.dieA, spec.dieB);
  const roll = new Roll(checkFormula(dieA, dieB, spec.edge + spec.mod));
  await roll.evaluate();
  const hidden = roll.total >= ct;
  return postCard(actor, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.stayHidden"),
    icon: item.img,
    badges: [hidden
      ? { cls: "success", text: i18n("PROJECTANIME.Roll.staysHidden") }
      : { cls: "failure", text: i18n("PROJECTANIME.Roll.detected") }],
    rollHTML: await roll.render(),
    lines: [`${i18n("PROJECTANIME.Roll.vsContest")} <strong>${escHTML(seeker.name)}</strong>: ${ct}`]
  }), roll);
}

/** Sense vs Vanish (rules: Opposing Techniques) — a Sense Technique aimed at a Vanished
 *  creature rolls its own dice (+ Trained Edge) against the vanisher's Contest Target (built
 *  on its Vanish Technique's die). Reports detection; the table adjudicates. */
async function resolveSenseDetect(actor, item, targetActor) {
  const spec = skillRollSpec(actor, item);
  const vanishSkill = (targetActor.items ?? []).find((i) => i.type === "skill" && skillEffectKeys(i.system).includes("vanish"));
  const ct = contestTargetFor(targetActor, vanishSkill);

  const { dieA, dieB } = steppedDice(actor, spec.dieA, spec.dieB);
  const roll = new Roll(checkFormula(dieA, dieB, spec.edge + spec.mod));
  await roll.evaluate();
  const detected = roll.total >= ct;
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
    lines: [`${i18n("PROJECTANIME.Roll.vsContest")} <strong>${escHTML(targetActor.name)}</strong>: ${ct}`]
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
 * the lifetime (Scene/Channeled ride the usual flags), 7 + the Skill's SP cost (max 16) as the
 * Overcome CT (v0.03), and an autoKey so a re-cast refreshes rather than stacks. `self` marks
 * the caster's own Disguise shroud. Skipped while the target is Overcome-immune to this Skill.
 */
async function applyEnsnareMarker(actor, item, targetActor, effectKey, { self = false } = {}) {
  if (!targetActor) return [];
  if (!self && overcomeImmune(targetActor, item.uuid)) {
    return [`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeImmune", { name: targetActor.name, condition: item.name })}</em>`];
  }
  const mode = skillDuration(item.system);
  const scene = mode === "scene" || mode === "channeled";
  const duration = scene ? {} : makeRoundsDuration(mode === "instant" ? 1 : (item.system?.effectDuration ?? PROJECTANIME.standardDurationTurns));
  const flags = {
    ensnare: effectKey,
    ensnareSource: item.uuid,
    autoKey: `${item.id}:${effectKey}:${targetActor.id}`,
    overcomeCT: overcomeCTFor(item),
    scene,
    creatorSide: actorSide(actor)
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
 * against a Challenge Threshold — prefilled with 7 + the inflicting Skill's SP cost, max 16
 * (v0.03), when one was stamped; otherwise the table sets it. Success ends
 * the effect and grants immunity to re-application from the same source for the next 2 rounds.
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
  // A Talent in the second slot rolls Attribute + Talent (+1 Trained Edge), like any Check.
  const talent = typeof choice.attrB === "string" && choice.attrB.startsWith("talent:")
    ? getTalent(actor, choice.attrB.slice(7)) : null;
  const rawB = talent ? talent.die : attrValue(actor, choice.attrB);
  const edge = talent ? PROJECTANIME.trainedEdge : 0;
  const { dieA, dieB, reasons } = steppedDice(actor, attrValue(actor, choice.attrA), rawB);
  const roll = new Roll(checkFormula(dieA, dieB, choice.mod + rmods.flat + edge));
  await roll.evaluate();
  const [r1, r2] = dieResults(roll);
  const fumble = r1 === 1 && r2 === 1;
  const combo = r1 === r2 && r1 >= 6;
  const success = combo || (!fumble && roll.total >= ct);

  const lines = [
    `<strong>${i18n(PROJECTANIME.attributes[choice.attrA])} + ${talent ? talent.name : i18n(PROJECTANIME.attributes[choice.attrB])}</strong>`,
    ...stepNotes(reasons)
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
    // with it; an ensnare marker just deletes. Then ward against the same source for 2 rounds.
    const immunityKey = ensnare ? (flags.ensnareSource || effect.uuid) : `status:${statusId}`;
    if (statusId) await applyStatusTo(actor.uuid, statusId, false);
    else await effect.delete();
    // Overcome success wards against re-application for 2 ROUNDS (v0.03), counted down by the
    // OVERCOMING creature's own phase (creatorSide) on the duration engine.
    const duration = makeRoundsDuration(2);
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.format("PROJECTANIME.Roll.overcomeMarker", { name: effect.name }),
      img: "icons/svg/angel.svg",
      duration,
      flags: { "project-anime": { overcomeImmunity: immunityKey, creatorSide: actorSide(actor) } }
    }]);
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeEnds", { name: actor.name, effect: effect.name })}</em>`);
  }
  if (combo) { lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`); maybeGrantComboTurn(actor); }

  await postCard(actor, cardHTML({
    title: i18n("PROJECTANIME.Roll.overcome"),
    subtitle: effect.name,
    icon: effect.img,
    badges,
    vs: `${i18n("PROJECTANIME.Roll.ct")} <b>${ct}</b>`,
    rollHTML: await roll.render(),
    lines
  }), roll, { combo });
  return roll;
}

/**
 * Right-click router for an effect entry — shared by the floating Effects Panel and the actor
 * sheet's Effects drawer so both surfaces behave identically. An overcomeable effect (a Status
 * condition or an ensnaring Skill marker) that lives on an owned actor opens the Overcome-or-Remove
 * choice; anything else is removed outright. An effect borne by an item can't be cleared here (its
 * source item must be unequipped/removed) and an effect you don't own warns instead. `uuid` is the
 * ActiveEffect UUID from the clicked row/icon.
 */
export async function contextRemoveEffect(uuid) {
  const effect = uuid ? await fromUuid(uuid) : null;
  if (!effect) return;
  const flags = effect.flags?.["project-anime"] ?? {};
  const isCondition = [...(effect.statuses ?? [])].some((s) => (PROJECTANIME.conditionKeys ?? []).includes(s));
  const onActor = effect.parent?.documentName === "Actor";
  if (onActor && effect.isOwner && (isCondition || flags.ensnare)) {
    const action = await foundry.applications.api.DialogV2.wait({
      window: { title: effect.name },
      content: "",
      buttons: [
        { action: "overcome", label: i18n("PROJECTANIME.Roll.overcome"), icon: "fas fa-hand-fist", default: true },
        { action: "remove", label: i18n("PROJECTANIME.Effect.remove"), icon: "fas fa-trash" },
        { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
      ],
      rejectClose: false
    });
    if (action === "overcome") return performOvercome(effect.parent, effect);
    if (action !== "remove") return;
  }
  return removeEffectDirect(effect);
}

/** Delete an effect that lives on an owned actor; item-borne or unowned effects are refused with a
 *  notice instead. Extracted so the panel and drawer share one removal path. */
async function removeEffectDirect(effect) {
  if (!effect) return;
  if (effect.parent?.documentName !== "Actor") {
    return ui.notifications.info(i18n("PROJECTANIME.Effect.removeFromItem",
      { name: effect.name, item: effect.parent?.name ?? "" }));
  }
  if (!effect.isOwner) return ui.notifications.warn(i18n("PROJECTANIME.Effect.removeNoPermission"));
  game.tooltip?.deactivate?.();
  await effect.delete();
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
  if (flags.comboGranted === key) {          // no combo chains — instead, a Go-Again Combo
    restoreLuckDieOnGoAgain(actor);          // tunes a held Luck Die ±1, or restores a spent one (v0.03)
    return;
  }
  if (flags.comboTurn === key) return;       // already pending
  if (game.user.isGM) combat.setFlag("project-anime", "comboTurn", key);
  else if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "comboTurn", combatId: combat.id, combatantId: cur.id, actorUuid: actor.uuid });
  }
}

/**
 * A Combo rolled during a Combo-granted turn can't chain another extra turn — instead (rules:
 * Fumble and Combo): adjust ONE held Luck Die up or down by 1 (bounds 1…the Luck Die size), or,
 * with no Luck Dice remaining, roll the actor's Luck Die and record the result as a restored Luck
 * Die. Characters only (NPCs hold no Luck Dice). Fire-and-forget from the sync combo path.
 */
async function restoreLuckDieOnGoAgain(actor) {
  if (actor?.type !== "character" || !actor.isOwner) return;
  const dice = actor.system.luckDice ?? [];

  // No held dice → restore one spent Luck Die (roll the actor's Luck Die, record the result).
  if (!dice.length) {
    const roll = await new Roll(`1d${actor.system.luckDie ?? PROJECTANIME.luckDie}`).evaluate();
    await actor.update({ "system.luckDice": [roll.total] });
    await postRollCard(actor, {
      title: i18n("PROJECTANIME.Roll.goAgainLuckTitle"),
      subtitle: i18n("PROJECTANIME.Stat.luck"),
      lines: [game.i18n.format("PROJECTANIME.Roll.goAgainLuck", { name: actor.name, value: roll.total })],
      roll
    });
    // Lucky Pendant (rules: Accessories) — restoring a Luck Die lets the wearer tune one ±1.
    if (collectLuckTunes(actor) > 0) await tuneLuckDie(actor);
    return;
  }

  // Held dice → pick one and nudge it ±1 (bounds: 1 … 12).
  return tuneLuckDie(actor, {
    title: i18n("PROJECTANIME.Roll.goAgainLuckTitle"),
    message: "PROJECTANIME.Roll.goAgainLuckTuned"
  });
}

/**
 * Pick one held Luck Die and nudge it ±1 (bounds 1 … the Luck Die size) — the shared dialog behind the
 * Go-Again Combo reward (rules: Fumble and Combo) and the Lucky Pendant's restore rider
 * (rules: Accessories). Quietly no-ops when the actor holds no Luck Dice, isn't the user's
 * to edit, or the dialog is dismissed.
 */
export async function tuneLuckDie(actor, { title, message } = {}) {
  if (actor?.type !== "character" || !actor.isOwner) return;
  const dice = [...(actor.system.luckDice ?? [])];
  if (!dice.length) return;
  const die = actor.system.luckDie ?? PROJECTANIME.luckDie;

  const options = dice.map((v, i) =>
    `<label class="ms-row"><input type="radio" name="luckIndex" value="${i}" ${i === 0 ? "checked" : ""} /><span>${i18n("PROJECTANIME.Stat.luck")} ${i + 1}</span><b>${v}</b></label>`).join("");
  const pick = await foundry.applications.api.DialogV2.wait({
    window: { title: title ?? i18n("PROJECTANIME.Roll.luckTuneTitle"), icon: "fa-solid fa-clover" },
    classes: ["project-anime"],
    content: `<div class="project-anime roll-dialog pa-milestones">${options}</div>`,
    buttons: [
      { action: "up", label: "+1", icon: "fa-solid fa-angle-up", default: true, callback: (event, button) => ({ dir: 1, index: Number(button.form.elements.luckIndex?.value) || 0 }) },
      { action: "down", label: "−1", icon: "fa-solid fa-angle-down", callback: (event, button) => ({ dir: -1, index: Number(button.form.elements.luckIndex?.value) || 0 }) },
      { action: "cancel", label: i18n("Cancel"), icon: "fa-solid fa-times" }
    ],
    rejectClose: false
  });
  if (!pick || pick === "cancel") return;
  const index = Math.clamp(pick.index, 0, dice.length - 1);
  const from = dice[index];
  const to = Math.clamp(from + pick.dir, 1, die);
  if (to === from) return ui.notifications.info(i18n("PROJECTANIME.Roll.goAgainLuckBound"));
  dice[index] = to;
  await actor.update({ "system.luckDice": dice });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: tickerHTML(game.i18n.format(message ?? "PROJECTANIME.Roll.luckTuned", { name: actor.name, from, to }), { variant: "gold", icon: "fa-clover" })
  });
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
    label: `<i class="fas fa-play"></i> ${i18n("PROJECTANIME.Action.use")}`,
    primary: true
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
  // Long prose collapses behind a gradient fade — click the block to read all of it.
  html.querySelectorAll(".card-desc.is-clp").forEach((d) => { d.onclick = () => d.classList.remove("is-clp"); });
  // Assign via `.onclick` (not addEventListener) so re-rendering the same card
  // can't stack duplicate handlers — a stacked button would fire twice.
  html.querySelectorAll("[data-action='rollDamage']").forEach((btn) => { btn.onclick = onRollDamageButton; });
  // Undo arrows need the message (to read the stored rows + persist the undone state), so close over it.
  html.querySelectorAll("[data-action='undoDamage']").forEach((btn) => { btn.onclick = (e) => onUndoDamageButton(e, message); });
  html.querySelectorAll("[data-action='coverDamage']").forEach((btn) => { btn.onclick = (e) => onCoverDamageButton(e, message); });
  html.querySelectorAll("[data-action='releaseCharge']").forEach((btn) => { btn.onclick = onReleaseChargeButton; });
  html.querySelectorAll("[data-action='useConsumable']").forEach((btn) => { btn.onclick = onUseConsumableButton; });
  html.querySelectorAll("[data-action='spendLuck']").forEach((btn) => { btn.onclick = onSpendLuckButton; });
  html.querySelectorAll("[data-action='spendLuckAoe']").forEach((btn) => { btn.onclick = onSpendLuckAoeButton; });
  html.querySelectorAll("[data-action='stealItem']").forEach((btn) => { btn.onclick = onStealItemButton; });
  html.querySelectorAll("[data-action='stayHidden']").forEach((btn) => { btn.onclick = onStayHiddenButton; });
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
  // A secondary-Effect button carries its slot's Effect/pool; the primary button doesn't.
  const spec = el.dataset.effect
    ? { effect: el.dataset.effect, damagePool: el.dataset.damagePool }
    : null;
  // The originating card (holding this button) — stamped once its on-hit riders are applied, so a
  // second Roll Damage click can't re-inflict them.
  const sourceMessageId = el.closest?.("[data-message-id]")?.dataset?.messageId ?? null;
  return rollDamage(actor, item, {
    targetUuids,
    charged: el.dataset.charged === "true",
    thresholdMet: el.dataset.thresholdMet === "true",
    spec,
    sourceMessageId
  });
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
  // Boss Bars (v0.03): HP damage that would empty the current Bar breaks it instead of defeating the
  // Boss — unless it's the last Bar. On a break the excess is lost, the Bar refills, every Status ends,
  // Desperation rises (+2 ATK/Bar via the broken count), and Resolve resets. The last Bar dies normally.
  if (!heal && key === "hp" && target.type === "npc" && target.system.boss?.enabled) {
    const remaining = Number(target.system.boss.remaining) || 1;
    if (stat.value - applied <= 0) {
      if (remaining > 1) { await breakBossBar(target); return; }
      await postBossNote(target, "PROJECTANIME.Boss.defeated", { name: target.name });
      await target.update({ "system.hp.value": 0, "system.boss.remaining": 0 });
      return;
    }
  }
  const next = Math.clamp(stat.value + (heal ? applied : -applied), 0, stat.max);
  await target.update({ [`system.${key}.value`]: next });
}

/** Statuses that are BENEFICIAL (never shrugged by Boss Resolve, which only gates Detrimental ones). */
const BENEFICIAL_STATUSES = new Set(["barrier", "regen", "reflect", "vanished"]);

/** True for a Detrimental Status (a real condition that isn't beneficial) — what Boss Resolve shrugs. */
function isDetrimentalStatus(id) {
  return (PROJECTANIME.conditionKeys ?? []).includes(id) && !BENEFICIAL_STATUSES.has(id);
}

/** Post a Boss-bar announcement to chat (bar break / defeat / Resolve shrug). GM/owner side. */
async function postBossNote(actor, key, data) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: tickerHTML(i18n(key, data), { variant: "boss", icon: "fa-crown" })
  });
}

/** Break the Boss's current Bar (rules: Bosses): refill to one Bar, end every detrimental
 *  status on it (excess damage is lost), count the broken Bar, and announce the break — the
 *  next Bar's Techniques unlock. */
async function breakBossBar(target) {
  const boss = target.system.boss ?? {};
  const barHp = Number(boss.barHp) || Number(target.system.hp?.max) || 1;
  const remaining = Math.max(0, (Number(boss.remaining) || 1) - 1);
  const broken = (Number(boss.broken) || 0) + 1;
  // End every detrimental Status Effect on the Boss (the Bar refills).
  for (const s of [...(target.statuses ?? [])]) {
    if (!isDetrimentalStatus(s)) continue;
    try { await applyStatusTo(target.uuid, s, false); } catch (_e) { /* ignore a stubborn status */ }
  }
  await target.update({
    "system.hp.value": barHp,
    "system.boss.remaining": remaining,
    "system.boss.broken": broken
  });
  await postBossNote(target, "PROJECTANIME.Boss.barBroken",
    { name: target.name, remaining, total: Number(boss.bars) || 0 });
}

/** A status condition that auto-expires by counting down rounds (default Duration 2, set by its
 *  source), on the INFLICTER'S phase-start. Excludes the EVENT-based `prone` (until you spend
 *  half your movement to stand). The countdown itself lives in project-anime.mjs
 *  (runPhaseDurationTick). */
function isTimedStatus(statusId) {
  return (PROJECTANIME.conditionKeys ?? []).includes(statusId) && statusId !== "prone";
}

/** How many of the target's own turns a status inflicted by this item lasts: the Skill's authored
 *  Duration if it set one ("said otherwise by the skill"), else the rules default of 2. Weapons have
 *  no Duration field, so weapon-inflicted statuses always use the default. */
function skillStatusDuration(item) {
  const d = item?.system?.effectDuration;
  return Number.isInteger(d) && d >= 1 ? d : 2;
}

/** True if an item-borne effect grants `status` — via its native statuses set OR a condition rule
 *  authored on it (either way the status lands on whoever the effect is applied to). */
function effectGrantsStatus(effect, status) {
  if ([...(effect?.statuses ?? [])].includes(status)) return true;
  return effectRules(effect).some((r) => r?.type === "condition" && r.status === status);
}

/**
 * Apply (or remove) a status condition on a target. Runs on whichever client owns the target.
 * Exported for the GM-side socket relay in project-anime.mjs. For a timed condition (see
 * isTimedStatus) a per-target counter is stamped under flags.project-anime.statusTimers as
 * `{ n: rounds, side }` — `side` is the INFLICTER'S side, so the v0.03 duration engine counts it
 * down when that side's phase begins (project-anime.mjs runPhaseDurationTick) and removes it at 0.
 * Re-applying the same status REFRESHES it to the longer remaining Duration rather than stacking
 * (rules p.13). Removing a status clears its counter. `duration` defaults to the rules' 2 rounds.
 */
export async function applyStatusTo(targetUuid, statusId, active = true, duration = 2, { value = 0, pool = "hp", overcomeCT = 0, side = null } = {}) {
  const target = await fromUuid(targetUuid);
  if (!target?.toggleStatusEffect) return;
  await target.toggleStatusEffect(statusId, { active });
  // Lingering (`decay`) once carried an optional Element flag — retire any stale one so old
  // data self-cleans, then fall through to the standard timer stamping below.
  if (statusId === "decay" && target.getFlag("project-anime", "decayType")) {
    await target.update({ "flags.project-anime.-=decayType": null });
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
  // The Overcome action's Difficulty is 7 + the Skill's SP cost, max 16 (v0.03) — a
  // Skill-inflicted status stamps it so the Overcome dialog can prefill the CT. Cleared with the status.
  if (active && overcomeCT > 0) await target.setFlag("project-anime", "overcomeCT", { [statusId]: Math.round(overcomeCT) });
  else if (!active && statusId in (target.getFlag("project-anime", "overcomeCT") ?? {})) {
    await target.update({ [`flags.project-anime.overcomeCT.-=${statusId}`]: null });
  }
  if (!isTimedStatus(statusId)) return;
  if (active) {
    // Duration engine (v0.03): the timer stores its length in ROUNDS + the CREATOR'S SIDE, and counts
    // down when that side's phase begins (project-anime.mjs runPhaseDurationTick) — not on the bearer's
    // own turn. Re-applying REFRESHES to the longer remaining and re-stamps the refreshing caster's side.
    const rounds = Number.isInteger(duration) && duration >= 1 ? duration : 2;
    const prev = normalizeTimer(target.getFlag("project-anime", "statusTimers")?.[statusId]);
    const n = Math.max(prev.n, rounds);
    await target.setFlag("project-anime", "statusTimers", { [statusId]: { n, side: side ?? prev.side ?? null } });
  } else if (statusId in (target.getFlag("project-anime", "statusTimers") ?? {})) {
    await target.update({ [`flags.project-anime.statusTimers.-=${statusId}`]: null });
  }
}

/** Read a stored status timer in either shape: the v0.03 `{ n, side }` object, or a legacy bare number
 *  (pre-v0.03 saves) whose creator side is unknown → `side: null` (ticks on the Player Phase). Always
 *  returns a well-formed `{ n, side }`. Exported so the phase engine and the HUDs share one reader. */
export function normalizeTimer(raw) {
  if (raw && typeof raw === "object") return { n: Number(raw.n) || 0, side: raw.side ?? null };
  return { n: Number(raw) || 0, side: null };
}

/** Inflict a status on a target from a roll: directly if owned, else via the GM relay. The status
 *  lifetime is the Skill's Duration or the rules default of 2 (see skillStatusDuration). */
async function applyStatusEffect(targetActor, statusId, duration = 2, { value = 0, pool = "hp", overcomeCT = 0, side = null } = {}) {
  if (!targetActor || !statusId) return;
  // Affinity (Status) Resist (v0.03): the target halves the inflicted Status's duration
  // (round down, minimum 1). Full Immunity is checked earlier (statusImmunities).
  if (statusResists(targetActor).has(statusId)) {
    duration = Math.max(1, Math.floor((Number(duration) || 2) / 2));
  }
  if (targetActor.isOwner) await applyStatusTo(targetActor.uuid, statusId, true, duration, { value, pool, overcomeCT, side });
  else if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "applyStatus", targetUuid: targetActor.uuid, statusId, active: true, duration, value, pool, overcomeCT, side });
  }
}

/** Overcome immunity (v0.03: succeeding on Overcome makes you immune to that Skill's effects for
 *  the next 2 rounds): true while the target carries an immunity marker keyed to this source —
 *  the inflicting Skill's uuid, or `status:<id>` for a plain overcome status. */
function overcomeImmune(target, sourceKey) {
  if (!target || !sourceKey) return false;
  return (target.effects ?? []).some((e) => e.flags?.["project-anime"]?.overcomeImmunity === sourceKey);
}

/** The Overcome action's target against a Technique-inflicted effect (rules: Overcoming
 *  Effects — "you contest against the user"): the inflicting Technique's Contest Target,
 *  6 + its die/2 (+1 Trained Edge when Talent-built). */
function overcomeCTFor(item) {
  if (item?.type !== "skill") return 0;
  const { die, hasTalent } = techniqueDie(item);
  return contestTarget(die, hasTalent);
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
  // A standing Status Immunity (from a live Active-Effect rule) shrugs off the inflict entirely.
  if (statusImmunities(targetActor).has(c.id)) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.immune", { name: targetActor.name, condition: c.label })}</em>`);
    return;
  }
  const opts = {};
  let label = c.label;
  if (item?.type === "skill") {
    opts.overcomeCT = overcomeCTFor(item);
    if ((PROJECTANIME.valuedStatuses ?? []).includes(c.id)) {
      // Barrier grants temporary hit boxes equal to the Technique's TOTAL Energy cost, capped
      // at the target's maximum hit boxes; Regen clears a flat 1 per turn (V2 Modifiers).
      opts.value = valuedStatusValue(item.system?.totalCost, c.id);
      if (c.id === "barrier") opts.value = Math.min(opts.value, Number(targetActor.system?.hp?.max) || opts.value);
      opts.pool = "hp";
      label = `${c.label} ${opts.value}`;
    } else if (c.id === "curse") {
      // Cursed blocks the single pool chosen at creation.
      opts.pool = item.system?.inflictPool === "energy" ? "energy" : "hp";
      label = `${c.label} (${i18n(`PROJECTANIME.Stat.${opts.pool}`)})`;
    }
  }
  opts.side = actorSide(actor);   // the inflicter's phase owns this status's Duration countdown (v0.03)
  await applyStatusEffect(targetActor, c.id, skillStatusDuration(item), opts);
  lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: label, name: targetActor.name })}</em>`);
}

/** A Skill whose Inflict Modifier chose LINGERING marks the creature it lands on with the
 *  Lingering status (1 damage at the end of each of their turns, on the standard condition timer —
 *  the damage + count-down live in the combat turn-tick in project-anime.mjs). The Skill's
 *  Duration overrides the default 2 turns. No-op for non-Skills / other Inflict choices. */
async function inflictDecay(item, targetActor, lines) {
  if (item?.type !== "skill" || !targetActor) return;
  if (!(item.system.modifiers ?? []).includes("inflict") || item.system.inflictStatus !== "decay") return;
  const condition = i18n("PROJECTANIME.Status.decay");
  // A target still immune from a successful Overcome shrugs the Lingering off like any condition.
  if (overcomeImmune(targetActor, item.uuid) || overcomeImmune(targetActor, "status:decay")) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.overcomeImmune", { name: targetActor.name, condition })}</em>`);
    return;
  }
  // Immunity to Lingering (the `decay` status) blocks it like any other inflicted condition.
  if (statusImmunities(targetActor).has("decay")) {
    lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.immune", { name: targetActor.name, condition })}</em>`);
    return;
  }
  const overcomeCT = overcomeCTFor(item);
  await applyStatusEffect(targetActor, "decay", skillStatusDuration(item), { overcomeCT, side: actorSide(item.parent) });
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

/** The full on-hit (enemy) payload of a Technique landing on one target: inflicted conditions,
 *  Lingering, the Barrier/Regen/Reflect Modifier markers, and the Technique's Active Effect(s)
 *  (auto-Weaken + authored / Empower). Idempotent — auto-effects refresh by `autoKey` and
 *  status toggles no-op if already set — so Spend Luck can call it when a re-roll turns a miss
 *  into a hit without double-applying. Returns chat-card lines. */
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
  lines.push(...(await applyModifierStatuses(actor, item, targetActor ? [targetActor] : null)));
  return lines;
}

/**
 * The Barrier / Regen / Reflect Modifiers stamp their status markers on the Technique's
 * recipients (rules: Modifiers — Barrier grants temporary hit boxes equal to the Technique's
 * total Energy cost, up to the target's maximum; Regen clears 1 hit box at the start of each
 * of the bearer's turns; Reflect redirects the next technique that targets the bearer, consumed
 * on use). Duration follows the Technique. Returns chat-card lines.
 */
async function applyModifierStatuses(actor, item, recipients = null) {
  if (item?.type !== "skill") return [];
  const mods = item.system?.modifiers ?? [];
  const wanted = ["barrier", "regen", "reflect"].filter((m) => mods.includes(m));
  if (!wanted.length) return [];
  const targets = skillEffectTargets(actor, item, recipients);
  const side = actorSide(actor);
  const lines = [];
  for (const ta of targets) {
    if (!ta) continue;
    for (const m of wanted) {
      const opts = { side, overcomeCT: overcomeCTFor(item), pool: "hp" };
      let label = i18n(`PROJECTANIME.Status.${m}`);
      if (m === "barrier") {
        opts.value = Math.min(Number(item.system?.totalCost) || 1, Number(ta.system?.hp?.max) || 1);
        label = `${label} ${opts.value}`;
      } else if (m === "regen") {
        opts.value = PROJECTANIME.regenHeal;
      }
      await applyStatusEffect(ta, m, skillStatusDuration(item), opts);
      lines.push(`<em class="muted">${i18n("PROJECTANIME.Roll.inflicts", { condition: label, name: ta.name })}</em>`);
    }
  }
  return lines;
}

/** The damaging attacks whose on-hit riders the house rule defers to actually-dealt damage: a basic
 *  weapon / shield attack, or a Skill whose Effect includes a Strike. A non-damaging Skill has no
 *  damage step — it applies its effects on land in its own resolver and never routes through here. */
function isDamagingStrike(item) {
  if (item?.type === "weapon" || item?.type === "shield") return true;
  return item?.type === "skill" && skillEffectKeys(item?.system ?? {}).includes("strike");
}

/** True once a damaging attack's on-hit riders have been applied for its originating card — so a
 *  repeated Roll Damage click on the same card can't re-inflict conditions or stack effect copies. */
function ridersAlreadyDone(sourceMessageId) {
  return !!(sourceMessageId && game.messages.get(sourceMessageId)?.getFlag("project-anime", "ridersDone"));
}

/** Stamp the originating card once its riders have landed (owner-only — the attacker authored it). */
async function markRidersDone(sourceMessageId) {
  const msg = sourceMessageId ? game.messages.get(sourceMessageId) : null;
  if (msg?.isOwner && !msg.getFlag("project-anime", "ridersDone")) {
    await msg.setFlag("project-anime", "ridersDone", true);
  }
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

/** The lifetime a Skill's USE grants to everything it applies — its auto Bolster/Hinder effects AND
 *  its authored Active Effect copies — derived from the Skill's single authored Duration (rules
 *  v0.01): Instant → this round only; Standard → its turn count (default 2 rounds); Scene/Channeled
 *  → no round timer (swept when the scene/channel ends). Returns { duration, scene }. This is the
 *  same "2 turns, or whatever the Skill set" rule the inflicted-status timer uses
 *  (skillStatusDuration), so a Skill's Duration governs every status/effect it hands out the same
 *  way — a Regen / Barrier the Skill grants counts down for the Skill's Duration, not its own. */
function skillAppliedDuration(item) {
  const mode = skillDuration(item.system);
  const scene = mode === "scene" || mode === "channeled";
  const duration = scene ? {} : makeRoundsDuration(mode === "instant" ? 1 : (item.system?.effectDuration ?? PROJECTANIME.standardDurationTurns));
  return { duration, scene };
}

/** Auto-built effects for a Skill's on-use application — one ActiveEffect per Empower/Weaken/
 *  Transform Effect it carries (primary AND the Secondary-Effect slot), plus one bundling its
 *  auto Modifier rules (Protection — effects.mjs skillModifierRules), so the
 *  designer needn't author any of them. The Skill's Duration shapes the copy's lifetime
 *  (rules v0.01): Standard → its turn count (default 2 rounds); Instant → this round only;
 *  Scene → no timer, cleared when combat ends; Channeled → no timer, swept when the channel ends
 *  (every copy carries the cast's channel key — see ensureChannelMarker / tickChanneled).
 *  Passive Skills are handled in-memory by the effects engine, not here. Each carries `autoKey`
 *  (`<skillId>:<mode>`) so re-casting REFRESHES rather than stacks. */
function autoBolsterHinderEffects(item, { channelKey = null } = {}) {
  if (item?.type !== "skill" || item.system?.actionType === "passive") return [];
  const scene = ["scene", "channeled"].includes(skillDuration(item.system));
  const buildDuration = () => skillAppliedDuration(item).duration;
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
  // Modifier-granted rules (Protection) ride one bundled effect of their own.
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

/** Drain on a PASSIVE Technique (mirroring Devour's maybeDevourOnKill): a weapon or shield
 *  attack feeds every passive Drain Technique the attacker carries. Technique casts ride their
 *  own applyDrain; this covers the basic-attack special only. */
async function applyPassiveDrains(actor, item, total, lines) {
  if (item?.type !== "weapon" && item?.type !== "shield") return;
  if (!(total > 0)) return;
  for (const skill of actor?.items ?? []) {
    if (skill.type !== "skill" || skill.system?.actionType !== "passive") continue;
    if (!(skill.system?.modifiers ?? []).includes("drain")) continue;
    await applyDrain(actor, skill, 1, lines);
  }
}

/** Drain (rules: Modifiers — "When you deal damage with this technique, clear 1 hit box or 1
 *  energy box (chosen at creation)"), house-ruled PER CREATURE: `count` is how many creatures
 *  this use actually damaged (a fully Barrier-absorbed hit counts for nothing), and the caster
 *  clears that many boxes of the chosen pool — a chain that damages 2 foes clears 2. Clamped to
 *  max by applyDamageTo and routed through the owner/GM relay. Mutates `lines`. */
async function applyDrain(actor, item, count, lines) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (item?.type !== "skill" || n <= 0) return;
  if (!(item.system.modifiers ?? []).includes("drain")) return;
  const pool = item.system.drainPool === "energy" ? "energy" : "hp";
  // A Cursed caster clears nothing on a cursed pool — the drain is voided (the damage landed).
  if (curseBlocks(actor, pool)) { lines.push(curseNote(actor.name, pool)); return; }
  await routeApply(actor, actor.uuid, n, true, pool);
  const key = pool === "energy"
    ? (n > 1 ? "PROJECTANIME.Roll.drainsEnergyPlural" : "PROJECTANIME.Roll.drainsEnergy")
    : (n > 1 ? "PROJECTANIME.Roll.drainsHPPlural" : "PROJECTANIME.Roll.drainsHP");
  lines.push(`<em class="muted">${i18n(key, { n })}</em>`);
}

/** Retaliation (Skill modifier): a creature warded by a live Retaliation effect punishes a FOE
 *  that damages it — the attacker takes the warded value (Defense ignored, like the Lingering
 *  tick). Fired from every damage path after the hit lands, mirroring applyDrain but keyed off
 *  the TARGET's ward, not the attacker's Skill — so a basic weapon blow triggers it too. Only
 *  enemies retaliate (tokensAreEnemies), so a creature hurting itself or an ally never sets it
 *  off; multiple wards on one target stack. The bounce routes through the owner/GM relay and is
 *  clamped to the attacker's max. `hits` = [{actor, amount}] of the creatures this attack
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
      const adj = adjustForTarget(w.value, attacker);
      if (adj.amount > 0) await routeApply(attacker, attacker.uuid, adj.amount, false, "hp");
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

/**
 * Manifest (rules: Manifest Modifier): stamp (refresh) the "bound Passive is running" marker on
 * the caster. While a live marker points at the Passive, its effects apply (effects.mjs gates on
 * it). Lifetime = the carrier's Duration: Standard/Instant → its turn count (default 2 rounds);
 * Scene/Channeled → until removed (the end-of-combat sweep clears `scene` markers). Refreshing
 * replaces any prior marker for the same Passive, so re-casting never stacks.
 */
async function ensureManifestMarker(actor, item) {
  const passive = actor.items.get(item.system.manifestSkillId);
  if (!passive) return;
  const durKey = skillDuration(item.system);
  const scene = durKey === "scene" || durKey === "channeled";
  const duration = scene ? {} : makeRoundsDuration(item.system.effectDuration ?? PROJECTANIME.standardDurationTurns);
  const old = (actor.effects ?? []).filter((e) => e.flags?.["project-anime"]?.manifestSkillId === passive.id).map((e) => e.id);
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("PROJECTANIME.Roll.manifestName", { name: passive.name }),
    img: passive.img,
    duration,
    origin: item.uuid,
    flags: { "project-anime": { manifestSkillId: passive.id, scene, creatorSide: actorSide(actor) } }
  }]);
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
  // Apply an authored effect that has rules OR carries a status condition (a "grant Regen/Barrier/…"
  // effect needs no rule — its status IS its payload), so a status-only effect isn't silently dropped.
  const enabled = (item.effects ?? []).filter((e) => !e.disabled && (effectRules(e).length || (e.statuses?.size ?? 0) > 0));
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
  const creator = actorSide(actor);   // the caster's phase owns the Duration countdown of every copy (v0.03)
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
      } else {
        // The Skill's Duration governs how long everything it applies lasts (rules v0.01): the copy
        // takes the Skill's authored Duration — 2 turns by default, or whatever the Skill set — not
        // the effect's own authored lifetime, so a status it carries (Regen / Barrier / …) counts
        // down for the Skill's Duration exactly like an inflicted status. Scene → no round timer
        // (swept at combat end via the scene flag).
        const { duration, scene } = skillAppliedDuration(item);
        data.duration = duration;
        foundry.utils.setProperty(data, "flags.project-anime.scene", scene);
      }
      // A Skill effect that GRANTS the Regen status heals the bearer the Skill's Rank × 2 each turn
      // (rules: Sustain) — like the old Sustain rule did. The value rides the granting effect's
      // `regenValue` flag so collectSustain folds it in for as long as the effect (and its Regen
      // status) lives; the pool is the Skill's inflictPool (HP default). Self-contained on the copy,
      // so it works whether the recipient is owned (direct) or applied via the GM relay.
      if (effectGrantsStatus(effect, "regen")) {
        foundry.utils.setProperty(data, "flags.project-anime.regenValue", {
          pool: "hp",
          value: valuedStatusValue(1, "regen")
        });
      }
      foundry.utils.setProperty(data, "flags.project-anime.creatorSide", creator);
      if (await routeEffectApply(ta, data)) names.push(effect.name);
    }
    for (const auto of autoEffects) {
      const autoCopy = foundry.utils.deepClone(auto);
      foundry.utils.setProperty(autoCopy, "flags.project-anime.creatorSide", creator);
      if (await routeEffectApply(ta, autoCopy)) names.push(auto.name);
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

/** Cover (the Skill Modifier): redirect one damage row to whoever throws themselves in front of it.
 *  The clicker designates the covering creature by TARGETING it (a single target), then clicks the
 *  bullseye — the hit is reversed on the original target and re-applied to the coverer, who "takes
 *  the damage for the target". The coverer's own Barrier soaks its share first (same split the
 *  original apply uses). The row is rewritten to the coverer and tagged "Covered for {name}", so the
 *  undo arrow now reverses the coverer's hit and the row can even be covered again (passed along).
 *  Routes through the owner/GM relay like undo; persisted on the message flag so everyone sees it. */
async function onCoverDamageButton(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  if (el.disabled) return;
  const card = message?.flags?.["project-anime"]?.damageCard;
  const i = Number(el.dataset.row);
  const row = card?.rows?.[i];
  if (!row || row.undone || row.heal) return;

  // The covering creature is the clicker's single current target.
  const coverer = firstTargetActor();
  if (!coverer || (game.user?.targets?.size ?? 0) !== 1) return ui.notifications.warn(i18n("PROJECTANIME.Roll.coverNoTarget"));
  if (coverer.uuid === row.uuid) return ui.notifications.warn(i18n("PROJECTANIME.Roll.coverSame"));
  const original = await fromUuid(row.uuid);
  if (!original) return ui.notifications.warn(i18n("PROJECTANIME.Roll.targetGone"));

  el.disabled = true;   // guard against a double-click landing the transfer twice
  // 1) Reverse the hit on the original target — heal back exactly what landed (bookkeeping, so the
  //    Barrier doesn't absorb the refund), mirroring undo.
  if (!(await routeApply(original, row.uuid, row.amount, true, row.pool, { ignoreBarrier: true }))) {
    el.disabled = false;
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
  }
  // 2) The coverer takes the blow. routeApply lets their Barrier eat its share; we split here only
  //    for the row's display amount + note (same pattern as the original apply's barrierCalc).
  const split = barrierSplit(coverer, row.amount, row.pool);
  if (!(await routeApply(coverer, coverer.uuid, row.amount, false, row.pool))) {
    await routeApply(original, row.uuid, row.amount, false, row.pool, { ignoreBarrier: true });   // put it back
    el.disabled = false;
    return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
  }

  // 3) Rewrite the row to the coverer, tagging it "Covered for {original}".
  const baseCalc = row.baseCalc ?? row.calc ?? "";
  const tag = i18n("PROJECTANIME.Roll.coveredFor", { name: original.name });
  const barrierNote = split.absorbed ? ` · ${i18n("PROJECTANIME.Roll.barrierAbsorbed", { n: split.absorbed })}` : "";
  const next = { ...row, uuid: coverer.uuid, name: coverer.name, img: coverer.img, amount: split.through, baseCalc, calc: `${tag}${baseCalc ? " · " + baseCalc : ""}${barrierNote}` };
  const rows = card.rows.map((r, idx) => (idx === i ? next : r));
  if (message.canUserModify(game.user, "update")) {
    await message.update({ "flags.project-anime.damageCard.rows": rows });   // render hook redraws
  } else {
    el.disabled = false;   // couldn't persist; let another owner/GM redraw it
  }
  ui.notifications.info(i18n("PROJECTANIME.Roll.covered", {
    coverer: coverer.name, target: original.name, n: split.through, unit: row.pool === "energy" ? "EN" : "HP"
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
  const threshold = !el.dataset.threshold ? null : Number(el.dataset.threshold);
  const kind = el.dataset.kind || "check";

  const choice = await promptLuck({ d1, d2, pool });
  if (!choice) return;
  const spend = applyLuckChoice({ ...choice, d1, d2, pool });
  if (!spend) return;
  // Fumble and Combo read the dice AS THEY STAND after replacement (rules: Luck Dice) — a
  // replacement can make or unmake either.
  const res = evalPair(spend.a, spend.b, mod, { ct, evasion, threshold });
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
    // A non-damaging Skill's on-hit payload (conditions / Decay / Hinder) lands now that the re-roll
    // hit. A Strike (and any weapon attack) defers its riders to the Roll Damage step below — they
    // land only if the blow dealt >0 net damage (house rule).
    if (item?.type === "skill" && !skillEffectKeys(item.system).includes("strike")) {
      lines.push(...(await applySkillOnHit(srcActor, item, targetActor)));
    }
    // Roll Damage: weapon attacks always deal damage; a Technique only if it Strikes. The
    // recomputed Threshold outcome rides along (+1 box where met).
    const dealsDamage = kind === "attack" || (item?.type === "skill" && skillEffectKeys(item.system).includes("strike"));
    if (dealsDamage) {
      const tgt = el.dataset.targetUuid ? ` data-target-uuid="${el.dataset.targetUuid}"` : "";
      const thr = res.thresholdMet ? ` data-threshold-met="true"` : "";
      buttons.push({
        data: `data-action="rollDamage" data-actor-uuid="${el.dataset.actorUuid}" data-item-id="${el.dataset.itemId}"${tgt}${thr}`,
        label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`,
        primary: true
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
    const evNum = t.ev != null ? `<span class="ctr-num">${i18n("PROJECTANIME.Stat.guard")} ${t.ev}</span>` : "";
    lines.push(`<span class="card-target-row"><strong>${escHTML(t.name)}</strong><span class="ctr-res ${didHit ? "is-hit" : "is-miss"}">${didHit ? i18n("PROJECTANIME.Roll.hit") : i18n("PROJECTANIME.Roll.miss")}${evNum}</span></span>`);
    if (!didHit) continue;
    hitUuids.push(t.uuid);
    // A non-Strike Skill's on-hit payload (conditions / Decay / Hinder) lands on each creature the
    // re-roll hits. A Strike defers its riders to the Roll Damage step (applied per target only where
    // damage landed — house rule).
    if (item?.type === "skill" && !hasStrike) {
      const ta = await fromUuid(t.uuid);
      if (ta) lines.push(...(await applySkillOnHit(srcActor, item, ta)));
    }
  }
  if (res.combo) lines.push(`<em>${i18n("PROJECTANIME.Roll.extraTurn")}</em>`);

  const buttons = [];
  // Roll Damage only when the Skill actually Strikes (a Mass Hinder already applied its Effect above).
  if (hasStrike && hitUuids.length && itemId && actorUuid) buttons.push({
    data: `data-action="rollDamage" data-actor-uuid="${actorUuid}" data-item-id="${itemId}" data-target-uuids="${hitUuids.join(",")}"`,
    label: `<i class="fas fa-burst"></i> ${i18n("PROJECTANIME.Roll.rollDamage")}`,
    primary: true
  });

  return postCard(actor, cardHTML({
    title: i18n("PROJECTANIME.Roll.spendLuck"),
    subtitle: actor.name,
    badges,
    lines,
    buttons
  }), null, { combo: res.combo });
}
