/**
 * Dice resolution engine for Shards of Mana.
 * Handles stat tests, attack rolls, healing rolls, and contest rolls.
 * All roll logic is centralized here — sheets and documents call these helpers.
 */

import { evaluateFormula, buildFormulaContext } from "./formulas.mjs";
import { fillLimitBreak, consumeLimitBreak } from "./limit-break.mjs";
import { collectDamageAlterations, applyDamageAlterations } from "./damage-alteration.mjs";

/* -------------------------------------------- */
/*  Constants                                    */
/* -------------------------------------------- */

/** Outcome priority for contest comparison (higher = better). */
const OUTCOME_RANK = {
  "critical-success": 3,
  "success": 2,
  "failure": 1,
  "critical-failure": 0
};

/* -------------------------------------------- */
/*  Stat Test                                    */
/* -------------------------------------------- */

/**
 * Roll a d100 stat test against a single stat.
 * Formula: target = STAT_TEST_BASE + (stat - STAT_BASELINE) × STAT_TEST_SCALAR + modifier
 * @param {Actor} actor - The actor making the test
 * @param {string} statKey - The stat key (str, agi, etc.)
 * @param {object} [options={}]
 * @param {number} [options.modifier=0] - Difficulty modifier
 * @returns {Promise<{roll: Roll, target: number, outcome: string}>}
 */
export async function rollStatTest(actor, statKey, { modifier = 0, isReroll = false } = {}) {
  const cf = CONFIG.SHARDS.combatFormula;
  const statTotal = actor.system.statTotal(statKey);
  const target = Math.clamp(
    cf.STAT_TEST_BASE + (statTotal - cf.STAT_BASELINE) * cf.STAT_TEST_SCALAR + modifier,
    cf.HIT_FLOOR, cf.HIT_CEILING
  );
  const roll = new Roll("1d100");
  await roll.evaluate();

  const result = roll.total;
  const outcome = _determineTestOutcome(result, target);

  const statLabel = game.i18n.localize(`SHARDS.Stats.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);
  const outcomeLabel = game.i18n.localize(`SHARDS.Roll.${outcome}`);

  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: _actorTheme(actor),
    statLabel,
    target,
    modifier,
    modifierStr: modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : "",
    roll: result,
    outcome,
    outcomeLabel,
    outcomeCss: _outcomeCssClass(outcome),
    outcomeIcon: _outcomeIcon(outcome)
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/stat-test.hbs", templateData);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    flags: {
      "shards-of-mana": {
        rollType: "statTest",
        actorId: actor.id,
        statKey,
        modifier
      }
    }
  });

  return { roll, target, outcome };
}

/**
 * Determine the outcome of a d100 stat test.
 * Stat tests are binary pass/fail only — no critical outcomes.
 * Critical hits and misses only apply to attack rolls.
 * @param {number} roll - The d100 result
 * @param {number} target - The target number
 * @returns {string} Outcome key
 */
function _determineTestOutcome(roll, target) {
  if (roll <= target) return "success";
  return "failure";
}

/* -------------------------------------------- */
/*  Attack Roll                                  */
/* -------------------------------------------- */

/**
 * Execute a full attack roll sequence: validate → deduct resources → roll → damage → chat.
 * @param {Actor} actor - The attacking actor
 * @param {Item} skill - The skill item being used
 * @param {Token[]} targets - Array of target tokens
 * @returns {Promise<object|null>} Roll results or null if blocked
 */
export async function rollAttack(actor, skill, targets, { isReroll = false } = {}) {
  const sk = skill.system;
  const system = actor.system;

  // --- Precondition checks ---
  if (!_validateCanAct(actor, sk)) return null;

  const formulaCtx = buildFormulaContext(actor, skill);
  const pipCost = _evaluateCost(sk.pipCost, formulaCtx);
  const mpCost = _evaluateCost(sk.mpCost, formulaCtx);

  if (!_validateTargets(sk, targets)) return null;

  // Display-only mode: no targets selected and setting allows it
  const displayOnly = !targets.length && sk.target !== "self" && sk.target !== "field";

  // Only validate and deduct resources when actually executing (skip on reroll)
  if (!displayOnly && !isReroll) {
    if (!_validateResources(actor, pipCost, mpCost)) return null;

    const updates = {};
    if (pipCost > 0) updates["system.pips.value"] = system.pips.value - pipCost;
    if (mpCost > 0) updates["system.mana.value"] = system.mana.value - mpCost;
    if (Object.keys(updates).length) await actor.update(updates);
  }

  // --- Limit Break validation (skip on reroll) ---
  if (!isReroll && sk.timing === "limitBreak") {
    if (actor.type !== "adventurer" || system.limitBreak.value < 100) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LimitBreak.NotReady"));
      return null;
    }
  }

  // --- Compute attacker stats ---
  const derived = system.derived;
  const isPhysical = sk.defenseType === "physical";
  const isMagical = sk.defenseType === "magical";
  // Base accuracy from the skill (falls back to config default)
  const baseAccuracy = sk.baseAccuracy ?? CONFIG.SHARDS.combatFormula.UNARMED_ACCURACY;

  // --- Resolve against each target ---
  const results = [];
  for (const token of targets) {
    const targetActor = token.actor;
    if (!targetActor) continue;

    const targetResult = await _resolveAttackVsTarget({
      actor, skill, sk, formulaCtx,
      derived, baseAccuracy,
      targetActor, targetToken: token,
      isPhysical, isMagical
    });
    results.push(targetResult);
  }

  // --- Build and post chat card ---
  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: _actorTheme(actor),
    skillName: skill.name,
    skillImg: skill.img,
    damageType: sk.damageType,
    damageTypeLabel: sk.damageType ? game.i18n.localize(CONFIG.SHARDS.damageTypes[sk.damageType] ?? sk.damageType) : "",
    defenseType: sk.defenseType,
    pipCost,
    mpCost,
    results,
    isMultiTarget: results.length > 1,
    displayOnly,
    actorId: actor.id
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/attack-roll.hbs", templateData);
  const rolls = results.map(r => r.roll).filter(Boolean);

  // Build condition data for reroll support
  const conditionData = results
    .filter(r => r.conditionResult)
    .map(r => ({
      targetId: r.conditionResult.targetId,
      conditionKey: r.conditionResult.conditionKey,
      conditionChance: r.conditionResult.conditionChance
    }));

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: rolls.length ? rolls : undefined,
    sound: rolls.length ? CONFIG.sounds.dice : undefined,
    flags: {
      "shards-of-mana": {
        rollType: "attack",
        actorId: actor.id,
        skillId: skill.id,
        targetIds: targets.map(t => t.actor?.id).filter(Boolean),
        conditionData: conditionData.length ? conditionData : undefined,
        displayOnly
      }
    }
  });

  // --- Limit Break: crit fill trigger ---
  if (!displayOnly && actor.type === "adventurer") {
    const hasCrit = results.some(r => r.isCrit);
    if (hasCrit) {
      const critFill = game.settings.get("shards-of-mana", "limitBreakCritFill");
      if (critFill > 0) {
        await fillLimitBreak(actor, critFill, "SHARDS.LimitBreak.Reason.CritHit");
      }
    }
  }

  // --- Limit Break: consume gauge if this was a limit break skill (skip on reroll) ---
  if (!displayOnly && !isReroll && sk.timing === "limitBreak") {
    await consumeLimitBreak(actor);
  }

  return { results, pipCost, mpCost, displayOnly };
}

/**
 * Resolve a single attack against one target.
 * @param {object} params
 * @returns {Promise<object>} Result data for the template
 */
async function _resolveAttackVsTarget({
  actor, skill, sk, formulaCtx,
  derived, baseAccuracy,
  targetActor, targetToken,
  isPhysical, isMagical
}) {
  const cf = CONFIG.SHARDS.combatFormula;
  const targetDerived = targetActor.system.derived;
  const targetName = targetActor.name;
  const targetId = targetActor.id;

  // --- Hit calculation (single ACC vs EVA track) ---
  let outcome, roll, hitTarget, critThreshold;

  if (sk.defenseType === "none") {
    // Auto-hit: no roll needed
    outcome = "auto-hit";
    roll = null;
    hitTarget = null;
    critThreshold = null;
  } else {
    hitTarget = Math.clamp(
      baseAccuracy + (derived.acc - targetDerived.eva) * cf.HIT_SCALAR,
      cf.HIT_FLOOR, cf.HIT_CEILING
    );
    critThreshold = Math.clamp(
      cf.CRIT_BASE + derived.crit,
      cf.CRIT_FLOOR, cf.CRIT_CEILING
    );

    roll = new Roll("1d100");
    await roll.evaluate();
    const d100 = roll.total;

    if (d100 <= critThreshold) {
      outcome = "critical-hit";
    } else if (d100 <= hitTarget) {
      outcome = "hit";
    } else {
      outcome = "miss";
    }
  }

  const isHit = outcome === "hit" || outcome === "critical-hit" || outcome === "auto-hit";
  const isCrit = outcome === "critical-hit";

  // --- Damage calculation (if hit) ---
  let baseDamage = 0, defReduction = 0, finalDamage = 0;
  let isAbsorb = false, isImmune = false, reflected = false, pierced = false;
  let resistanceTier = 0, resistanceTierLabel = "", resistanceTierCss = "";

  if (isHit) {
    // Base damage from effective formula (auto-generated or manual override)
    const dmgFormula = sk.effectiveFormula || sk.damageFormula || "0";
    const formulaDmg = typeof evaluateFormula(dmgFormula, formulaCtx) === "number"
      ? evaluateFormula(dmgFormula, formulaCtx) : 0;
    baseDamage = formulaDmg;

    // Critical multiplier
    if (isCrit) baseDamage = Math.floor(baseDamage * 1.5);

    // --- Damage Alterations (from actor's owned items) ---
    const altCtx = {
      element: sk.damageType || "physical",
      baseDamage,
      pierce: !!sk.pierce,
      defenseType: sk.defenseType || "physical",
      skillId: skill?.id ?? null,
      skillType: sk.skillType ?? null,
      weaponGroup: null,
      formulaCtx
    };
    const alterations = collectDamageAlterations(actor);
    if (alterations.length) applyDamageAlterations(alterations, altCtx);
    baseDamage = altCtx.baseDamage;
    const altElement = altCtx.element;
    const altDefenseType = altCtx.defenseType;
    const altIsPhysical = altDefenseType === "physical";
    const altIsMagical = altDefenseType === "magical";

    // --- Tiered element resistance ---
    resistanceTier = targetActor.system.elementResistances?.[altElement] ?? 0;

    // Pierce: from skill or from alteration
    pierced = altCtx.pierce && resistanceTier === 1;
    const effectiveTier = pierced ? 0 : resistanceTier;

    // Look up tier multiplier from config
    const tierConfig = CONFIG.SHARDS.resistanceTiers?.[String(effectiveTier)];
    const multiplier = tierConfig?.multiplier ?? 1.0;

    // Tier display info
    const tierInfo = _resistanceTierDisplay(effectiveTier);
    resistanceTierLabel = tierInfo.label;
    resistanceTierCss = tierInfo.css;

    if (effectiveTier >= 2) {
      // Immune (2) or Absorb (3)
      if (multiplier < 0) {
        // Absorb: negative multiplier means healing
        isAbsorb = true;
        finalDamage = Math.floor(baseDamage * Math.abs(multiplier));
      } else {
        // Immune: zero multiplier
        isImmune = true;
        finalDamage = 0;
      }
    } else {
      // Normal, Resist, or Weak — apply multiplier then defense
      const afterResist = Math.floor(baseDamage * multiplier);
      defReduction = altIsPhysical ? targetDerived.pDef : altIsMagical ? targetDerived.mDef : 0;
      const damageFloor = Math.max(1, Math.ceil(afterResist * cf.DMG_FLOOR_PCT / 100));
      finalDamage = Math.max(afterResist - defReduction, damageFloor);
    }

    // Reflect check: magical attacks bounce off reflect targets
    if (altIsMagical && targetActor.system.conditions.reflect > 0 && !isAbsorb && !isImmune) {
      reflected = true;
    }
  }

  // --- Condition infliction check (boolean immunity) ---
  let conditionResult = null;
  const condChance = _evaluateConditionChance(sk.conditionChance, formulaCtx);
  if (isHit && sk.conditionApplied && condChance > 0) {
    // Determine who receives the condition (reflected → caster, otherwise → target)
    const condTarget = reflected ? actor : targetActor;
    const condImmune = !!(condTarget?.system?.conditionResistances?.[sk.conditionApplied]);

    const condRoll = new Roll("1d100");
    await condRoll.evaluate();
    const condInflicted = !condImmune && condRoll.total <= condChance;
    const condLabel = game.i18n.localize(CONFIG.SHARDS.conditions[sk.conditionApplied] ?? sk.conditionApplied);
    conditionResult = {
      conditionKey: sk.conditionApplied,
      conditionLabel: condLabel,
      conditionChance: condChance,
      conditionImmune: condImmune,
      condRoll: condRoll.total,
      inflicted: condInflicted,
      targetId: reflected ? actor.id : targetId,
      targetName: reflected ? actor.name : targetName
    };
  }

  const outcomeLabel = game.i18n.localize(`SHARDS.Roll.${outcome === "auto-hit" ? "AutoHit"
    : outcome === "critical-hit" ? "CriticalHit"
    : outcome === "hit" ? "Hit" : "Miss"}`);

  return {
    targetName,
    targetId: reflected ? actor.id : targetId,
    damageTargetId: reflected ? actor.id : targetId,
    damageTargetName: reflected ? actor.name : targetName,
    roll,
    rollTotal: roll?.total ?? null,
    hitTarget,
    critThreshold,
    outcome,
    outcomeCss: _outcomeCssClass(outcome),
    outcomeIcon: _outcomeIcon(outcome),
    outcomeLabel,
    isHit,
    isCrit,
    baseDamage,
    resistanceTier,
    resistanceTierLabel,
    resistanceTierCss,
    showResistance: resistanceTier !== 0,
    defReduction,
    finalDamage,
    isAbsorb,
    isImmune,
    pierced,
    reflected,
    conditionResult
  };
}

/* -------------------------------------------- */
/*  Healing Roll                                 */
/* -------------------------------------------- */

/**
 * Execute a healing skill: validate → deduct resources → compute → chat.
 * @param {Actor} actor - The casting actor
 * @param {Item} skill - The healing skill
 * @param {Token[]} targets - Target tokens to heal
 * @returns {Promise<object|null>}
 */
export async function rollHealing(actor, skill, targets, { isReroll = false } = {}) {
  const sk = skill.system;
  const system = actor.system;

  if (!_validateCanAct(actor, sk)) return null;

  // Limit Break validation for healing skills (skip on reroll)
  if (!isReroll && sk.timing === "limitBreak") {
    if (actor.type !== "adventurer" || system.limitBreak.value < 100) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LimitBreak.NotReady"));
      return null;
    }
  }

  const formulaCtx = buildFormulaContext(actor, skill);
  const pipCost = _evaluateCost(sk.pipCost, formulaCtx);
  const mpCost = _evaluateCost(sk.mpCost, formulaCtx);

  // Display-only mode: no targets selected and setting allows it
  const displayOnly = !targets.length && sk.target !== "self";

  if (!displayOnly && !isReroll) {
    if (!_validateResources(actor, pipCost, mpCost)) return null;

    // Deduct resources
    const updates = {};
    if (pipCost > 0) updates["system.pips.value"] = system.pips.value - pipCost;
    if (mpCost > 0) updates["system.mana.value"] = system.mana.value - mpCost;
    if (Object.keys(updates).length) await actor.update(updates);
  }

  // Compute healing amount (formula only — no auto-add of stat bonuses)
  // Healing amount from effective formula (auto-generated or manual override)
  const healFormula = sk.effectiveFormula || sk.damageFormula || "0";
  const formulaHeal = typeof evaluateFormula(healFormula, formulaCtx) === "number"
    ? evaluateFormula(healFormula, formulaCtx) : 0;
  const healAmount = formulaHeal;

  // Build per-target data, checking for Undead targets
  const derived = system.derived;
  const isMagical = sk.defenseType === "magical";
  const healTargets = [];
  const rolls = [];

  for (const token of targets) {
    const targetActor = token.actor;
    if (!targetActor) continue;
    const targetName = targetActor.name ?? token.name;
    const targetId = targetActor.id ?? token.id;
    const isUndead = targetActor.system.flags?.undead;

    if (isUndead) {
      // Undead: healing is treated as an attack — roll to hit (ACC vs EVA)
      const cf = CONFIG.SHARDS.combatFormula;
      if (sk.defenseType === "none") {
        // Auto-hit: no roll needed
        healTargets.push({
          targetName, targetId, healAmount,
          isUndead: true,
          hitRoll: null,
          hitTarget: null,
          outcome: "auto-hit",
          isHit: true,
          outcomeLabel: game.i18n.localize("SHARDS.Roll.AutoHit"),
          outcomeCss: _outcomeCssClass("auto-hit"),
          outcomeIcon: _outcomeIcon("auto-hit"),
          attackType: "none"
        });
      } else {
        const targetDerived = targetActor.system.derived;
        const healBaseAcc = sk.baseAccuracy ?? cf.UNARMED_ACCURACY;
        const hitTarget = Math.clamp(
          healBaseAcc + (derived.acc - targetDerived.eva) * cf.HIT_SCALAR,
          cf.HIT_FLOOR, cf.HIT_CEILING
        );

        const roll = new Roll("1d100");
        await roll.evaluate();
        const d100 = roll.total;
        rolls.push(roll);

        const outcome = d100 <= hitTarget ? "hit" : "miss";
        const isHit = outcome === "hit";
        const outcomeLabel = game.i18n.localize(`SHARDS.Roll.${isHit ? "Hit" : "Miss"}`);

        healTargets.push({
          targetName, targetId, healAmount,
          isUndead: true,
          hitRoll: d100,
          hitTarget,
          outcome,
          isHit,
          outcomeLabel,
          outcomeCss: _outcomeCssClass(outcome),
          outcomeIcon: _outcomeIcon(outcome),
          attackType: isMagical ? "magical" : "physical"
        });
      }
    } else {
      healTargets.push({ targetName, targetId, healAmount, isUndead: false });
    }
  }

  const hasUndead = healTargets.some(t => t.isUndead);

  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: _actorTheme(actor),
    skillName: skill.name,
    skillImg: skill.img,
    pipCost,
    mpCost,
    healAmount,
    targets: healTargets,
    displayOnly,
    actorId: actor.id,
    hasUndead
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/healing-roll.hbs", templateData);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: rolls.length ? rolls : undefined,
    sound: displayOnly ? undefined : CONFIG.sounds.dice,
    flags: {
      "shards-of-mana": {
        rollType: "healing",
        actorId: actor.id,
        skillId: skill.id,
        targetIds: targets.map(t => t.actor?.id).filter(Boolean),
        displayOnly
      }
    }
  });

  // Limit Break: consume gauge if this was a limit break skill
  if (!displayOnly && !isReroll && sk.timing === "limitBreak") {
    await consumeLimitBreak(actor);
  }

  return { healAmount, targets: healTargets, displayOnly };
}

/* -------------------------------------------- */
/*  Buff Roll                                    */
/* -------------------------------------------- */

/**
 * Activate a buff/debuff skill, applying its embedded Active Effects to targets.
 * Deducts resources, evaluates buffDuration formula for round count, clones AEs.
 * @param {Actor} actor - The casting actor
 * @param {Item} skill - The buff skill item (must have damageType "buff")
 * @param {Token[]} targets - Target tokens (often just the caster for self-buffs)
 * @param {object} [options]
 * @param {boolean} [options.isReroll=false]
 * @returns {Promise<object|null>}
 */
export async function rollBuff(actor, skill, targets, { isReroll = false } = {}) {
  const sk = skill.system;
  const system = actor.system;

  // --- Precondition checks ---
  if (!_validateCanAct(actor, sk)) return null;

  // Limit Break validation
  if (!isReroll && sk.timing === "limitBreak") {
    if (actor.type !== "adventurer" || system.limitBreak.value < 100) {
      ui.notifications.warn(game.i18n.localize("SHARDS.LimitBreak.NotReady"));
      return null;
    }
  }

  // --- Cost evaluation ---
  const formulaCtx = buildFormulaContext(actor, skill);
  const pipCost = _evaluateCost(sk.pipCost, formulaCtx);
  const mpCost = _evaluateCost(sk.mpCost, formulaCtx);

  // Display-only mode: no targets and not self/field
  const displayOnly = !targets.length && sk.target !== "self" && sk.target !== "field";

  // --- Deduct resources ---
  if (!displayOnly && !isReroll) {
    if (!_validateResources(actor, pipCost, mpCost)) return null;
    const updates = {};
    if (pipCost > 0) updates["system.pips.value"] = system.pips.value - pipCost;
    if (mpCost > 0) updates["system.mana.value"] = system.mana.value - mpCost;
    if (Object.keys(updates).length) await actor.update(updates);
  }

  // --- Evaluate buff duration ---
  let durationRounds = 0;
  if (sk.buffDuration?.trim()) {
    const raw = evaluateFormula(sk.buffDuration, formulaCtx);
    durationRounds = typeof raw === "number" ? Math.max(Math.floor(raw), 0) : 0;
  }

  // --- Gather skill's embedded AEs ---
  const sourceEffects = skill.effects.map(ae => {
    const data = ae.toObject();
    delete data._id;
    // Override duration if buffDuration was specified
    if (durationRounds > 0) {
      data.duration = { rounds: durationRounds };
    }
    return data;
  });

  // --- Apply to each target ---
  const buffTargets = [];
  if (!displayOnly) {
    for (const token of targets) {
      const targetActor = token.actor;
      if (!targetActor) continue;
      const targetName = targetActor.name ?? token.name;
      const targetId = targetActor.id ?? token.id;

      const appliedEffects = [];
      if (sourceEffects.length) {
        const created = await targetActor.createEmbeddedDocuments("ActiveEffect", sourceEffects);
        for (const ae of created) {
          appliedEffects.push({ name: ae.name, img: ae.img });
        }
      }

      buffTargets.push({
        targetName,
        targetId,
        appliedEffects,
        effectCount: appliedEffects.length
      });
    }
  }

  // --- Build and post chat card ---
  const durationLabel = durationRounds > 0
    ? game.i18n.format("SHARDS.Roll.BuffDuration", { rounds: durationRounds })
    : game.i18n.localize("SHARDS.Roll.BuffPermanent");

  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: _actorTheme(actor),
    skillName: skill.name,
    skillImg: skill.img,
    pipCost,
    mpCost,
    durationRounds,
    durationLabel,
    targets: buffTargets,
    hasEffects: sourceEffects.length > 0,
    displayOnly,
    actorId: actor.id
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/buff-roll.hbs", templateData);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    sound: displayOnly ? undefined : CONFIG.sounds.notification,
    flags: {
      "shards-of-mana": {
        rollType: "buff",
        actorId: actor.id,
        skillId: skill.id,
        targetIds: targets.map(t => t.actor?.id).filter(Boolean),
        displayOnly
      }
    }
  });

  // Limit Break: consume gauge if this was a limit break skill
  if (!displayOnly && !isReroll && sk.timing === "limitBreak") {
    await consumeLimitBreak(actor);
  }

  return { targets: buffTargets, durationRounds, displayOnly };
}

/* -------------------------------------------- */
/*  Contest Roll                                 */
/* -------------------------------------------- */

/**
 * Roll a contest between two actors, each rolling against a chosen stat.
 * @param {Actor} actorA - First actor
 * @param {string} statKeyA - Stat key for actor A
 * @param {Actor} actorB - Second actor
 * @param {string} statKeyB - Stat key for actor B
 * @returns {Promise<object>}
 */
export async function rollContest(actorA, statKeyA, actorB, statKeyB) {
  const cf = CONFIG.SHARDS.combatFormula;
  const statA = actorA.system.statTotal(statKeyA);
  const statB = actorB.system.statTotal(statKeyB);
  const targetA = Math.clamp(
    cf.STAT_TEST_BASE + (statA - cf.STAT_BASELINE) * cf.STAT_TEST_SCALAR, cf.HIT_FLOOR, cf.HIT_CEILING
  );
  const targetB = Math.clamp(
    cf.STAT_TEST_BASE + (statB - cf.STAT_BASELINE) * cf.STAT_TEST_SCALAR, cf.HIT_FLOOR, cf.HIT_CEILING
  );

  const rollA = new Roll("1d100");
  const rollB = new Roll("1d100");
  await rollA.evaluate();
  await rollB.evaluate();

  const outcomeA = _determineTestOutcome(rollA.total, targetA);
  const outcomeB = _determineTestOutcome(rollB.total, targetB);

  // Compare outcomes
  let winner;
  const rankA = OUTCOME_RANK[outcomeA];
  const rankB = OUTCOME_RANK[outcomeB];

  if (rankA > rankB) {
    winner = "A";
  } else if (rankB > rankA) {
    winner = "B";
  } else {
    // Same tier — compare margin (stat - roll), higher is better
    const marginA = targetA - rollA.total;
    const marginB = targetB - rollB.total;
    if (marginA > marginB) winner = "A";
    else if (marginB > marginA) winner = "B";
    else winner = "tie";
  }

  const statLabelA = game.i18n.localize(`SHARDS.Stats.${statKeyA.charAt(0).toUpperCase() + statKeyA.slice(1)}`);
  const statLabelB = game.i18n.localize(`SHARDS.Stats.${statKeyB.charAt(0).toUpperCase() + statKeyB.slice(1)}`);

  const templateData = {
    actorTheme: _actorTheme(actorA),

    actorAName: actorA.name,
    actorAImg: actorA.img,
    statLabelA,
    targetA,
    rollA: rollA.total,
    outcomeA,
    outcomeALabel: game.i18n.localize(`SHARDS.Roll.${outcomeA}`),
    outcomeCssA: _outcomeCssClass(outcomeA),
    outcomeIconA: _outcomeIcon(outcomeA),

    actorBName: actorB.name,
    actorBImg: actorB.img,
    statLabelB,
    targetB,
    rollB: rollB.total,
    outcomeB,
    outcomeBLabel: game.i18n.localize(`SHARDS.Roll.${outcomeB}`),
    outcomeCssB: _outcomeCssClass(outcomeB),
    outcomeIconB: _outcomeIcon(outcomeB),

    winner,
    winnerName: winner === "A" ? actorA.name : winner === "B" ? actorB.name : null,
    isTie: winner === "tie"
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/contest-roll.hbs", templateData);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: actorA }),
    content,
    rolls: [rollA, rollB],
    sound: CONFIG.sounds.dice,
    flags: {
      "shards-of-mana": {
        rollType: "contest",
        actorIdA: actorA.id,
        statKeyA,
        actorIdB: actorB.id,
        statKeyB
      }
    }
  });

  return { winner, rollA, rollB, outcomeA, outcomeB };
}

/* -------------------------------------------- */
/*  Chat Button Handlers                         */
/* -------------------------------------------- */

/**
 * Handle clicks on Apply Damage / Apply Healing / Apply Condition buttons in chat.
 * Called from the renderChatMessage hook.
 * @param {HTMLElement} html - The chat message HTML element
 */
export function activateChatListeners(html) {
  html.querySelectorAll("[data-action='apply-damage']").forEach(btn => {
    btn.addEventListener("click", _onApplyDamage);
  });
  html.querySelectorAll("[data-action='apply-healing']").forEach(btn => {
    btn.addEventListener("click", _onApplyHealing);
  });
  html.querySelectorAll("[data-action='apply-condition']").forEach(btn => {
    btn.addEventListener("click", _onApplyCondition);
  });
  html.querySelectorAll("[data-action='spend-resources']").forEach(btn => {
    btn.addEventListener("click", _onSpendResources);
  });
}

/**
 * Apply damage to a target actor from a chat button.
 * @param {Event} event
 */
async function _onApplyDamage(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const targetId = btn.dataset.targetId;
  const damage = Number(btn.dataset.damage);
  const actor = game.actors.get(targetId);
  if (!actor) return ui.warn("Target actor not found.");

  const oldHp = actor.system.health.value;
  const hasUndying = actor.system.conditions.undying > 0;
  const minHp = hasUndying ? 1 : 0;
  const newHp = Math.max(minHp, oldHp - damage);

  await actor.update({ "system.health.value": newHp });

  // Disable the button
  btn.disabled = true;
  btn.classList.add("used");

  // Auto-apply downed if HP reaches 0
  if (newHp <= 0 && !hasUndying) {
    const downedEffect = CONFIG.statusEffects.find(e => e.id === "downed");
    if (downedEffect) {
      const tokens = actor.getActiveTokens();
      for (const token of tokens) {
        if (!token.actor.statuses.has("downed")) {
          await token.toggleActiveEffect(downedEffect);
        }
      }
    }
  }

  // Post confirmation
  let confirmMsg;
  if (hasUndying && oldHp - damage < 1) {
    confirmMsg = game.i18n.format("SHARDS.Roll.Undying", { name: actor.name });
  } else if (newHp <= 0) {
    confirmMsg = `${game.i18n.format("SHARDS.Roll.DamageTaken", { name: actor.name, damage, old: oldHp, new: newHp })} ${game.i18n.format("SHARDS.Roll.DownedAuto", { name: actor.name })}`;
  } else {
    confirmMsg = game.i18n.format("SHARDS.Roll.DamageTaken", { name: actor.name, damage, old: oldHp, new: newHp });
  }

  await ChatMessage.create({
    content: `<p class="shards-chat-confirm">${confirmMsg}</p>`,
    speaker: ChatMessage.getSpeaker()
  });

  // --- Limit Break gauge fill: target takes damage ---
  if (actor.type === "adventurer" && damage > 0) {
    const fillAmount = game.settings.get("shards-of-mana", "limitBreakDamageFill");
    if (fillAmount > 0) {
      await fillLimitBreak(actor, fillAmount, "SHARDS.LimitBreak.Reason.DamageTaken");
    }
  }

  // --- Limit Break gauge fill: ally KO'd ---
  if (newHp <= 0 && !hasUndying && game.combat) {
    const allyFill = game.settings.get("shards-of-mana", "limitBreakAllyKOFill");
    if (allyFill > 0) {
      for (const combatant of game.combat.combatants) {
        const ally = combatant.actor;
        if (!ally || ally.id === actor.id) continue;
        if (ally.type !== "adventurer") continue;
        await fillLimitBreak(ally, allyFill, "SHARDS.LimitBreak.Reason.AllyKO");
      }
    }
  }

  // --- Manacite Drop Trigger (monsters only) ---
  if (actor.type === "monster" && newHp <= 0 && !actor.system.dropsRolled) {
    const dropMode = game.settings.get("shards-of-mana", "dropMode");
    if (dropMode === "auto") {
      const { rollDropTable, postLootCard } = await import("./drops.mjs");
      const results = await rollDropTable(actor);
      if (results.gold > 0 || results.successfulDrops.length > 0) {
        await postLootCard(actor, results);
      }
      await actor.update({ "system.dropsRolled": true });
    }
  }
}

/**
 * Apply healing to a target actor from a chat button.
 * For Undead targets, healing deals damage instead.
 * @param {Event} event
 */
async function _onApplyHealing(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const targetId = btn.dataset.targetId;
  const healing = Number(btn.dataset.healing);
  const actor = game.actors.get(targetId);
  if (!actor) return ui.warn("Target actor not found.");

  const isUndead = btn.dataset.isUndead === "true" || actor.system.flags?.undead;

  if (isUndead) {
    // Undead: healing deals damage instead
    const oldHp = actor.system.health.value;
    const hasUndying = actor.system.conditions.undying > 0;
    const minHp = hasUndying ? 1 : 0;
    const newHp = Math.max(minHp, oldHp - healing);

    await actor.update({ "system.health.value": newHp });

    btn.disabled = true;
    btn.classList.add("used");

    let confirmMsg;
    if (hasUndying && oldHp - healing < 1) {
      confirmMsg = game.i18n.format("SHARDS.Roll.Undying", { name: actor.name });
    } else {
      confirmMsg = game.i18n.format("SHARDS.Roll.UndeadHealDamage", {
        name: actor.name, damage: healing, old: oldHp, new: newHp
      });
    }

    await ChatMessage.create({
      content: `<p class="shards-chat-confirm">${confirmMsg}</p>`,
      speaker: ChatMessage.getSpeaker()
    });

    // Auto-apply downed if HP reaches 0
    if (newHp <= 0 && !hasUndying) {
      const downedEffect = CONFIG.statusEffects.find(e => e.id === "downed");
      if (downedEffect) {
        const tokens = actor.getActiveTokens();
        for (const token of tokens) {
          if (!token.actor.statuses.has("downed")) {
            await token.toggleActiveEffect(downedEffect);
          }
        }
      }
    }
  } else {
    // Normal healing
    const oldHp = actor.system.health.value;
    const maxHp = actor.system.health.max;
    const newHp = Math.min(maxHp, oldHp + healing);

    await actor.update({ "system.health.value": newHp });

    btn.disabled = true;
    btn.classList.add("used");

    const confirmMsg = game.i18n.format("SHARDS.Roll.HealingReceived", {
      name: actor.name, amount: healing, old: oldHp, new: newHp
    });

    await ChatMessage.create({
      content: `<p class="shards-chat-confirm">${confirmMsg}</p>`,
      speaker: ChatMessage.getSpeaker()
    });
  }
}

/**
 * Apply a condition to a target actor from a chat button.
 * @param {Event} event
 */
async function _onApplyCondition(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const targetId = btn.dataset.targetId;
  const conditionKey = btn.dataset.condition;
  const actor = game.actors.get(targetId);
  if (!actor) return ui.warn("Target actor not found.");

  const condEffect = CONFIG.statusEffects.find(e => e.id === conditionKey);
  if (!condEffect) return;

  const tokens = actor.getActiveTokens();
  for (const token of tokens) {
    if (!token.actor.statuses.has(conditionKey)) {
      await token.toggleActiveEffect(condEffect);
    }
  }

  btn.disabled = true;
  btn.classList.add("used");
}

/**
 * Spend resources (pips/MP) from a display-only chat card.
 * Lets the player commit to a skill/weapon use without having targeted first.
 * @param {Event} event
 */
async function _onSpendResources(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  if (btn.disabled) return;

  const actorId = btn.dataset.actorId;
  const pipCost = Number(btn.dataset.pipCost) || 0;
  const mpCost = Number(btn.dataset.mpCost) || 0;
  const actor = game.actors.get(actorId);
  if (!actor) return ui.notifications.warn("Actor not found.");

  // Validate resources
  const system = actor.system;
  if (pipCost > 0 && system.pips.value < pipCost) {
    ui.notifications.warn(game.i18n.format("SHARDS.Roll.NotEnoughPips", {
      cost: pipCost, current: system.pips.value
    }));
    return;
  }
  if (mpCost > 0 && system.mana.value < mpCost) {
    ui.notifications.warn(game.i18n.format("SHARDS.Roll.NotEnoughMP", {
      cost: mpCost, current: system.mana.value
    }));
    return;
  }

  // Deduct resources
  const updates = {};
  if (pipCost > 0) updates["system.pips.value"] = system.pips.value - pipCost;
  if (mpCost > 0) updates["system.mana.value"] = system.mana.value - mpCost;
  if (Object.keys(updates).length) await actor.update(updates);

  btn.disabled = true;
  btn.classList.add("used");

  // Build confirmation parts
  const parts = [];
  if (pipCost > 0) parts.push(`${pipCost} Pip${pipCost > 1 ? "s" : ""}`);
  if (mpCost > 0) parts.push(`${mpCost} MP`);
  const costStr = parts.join(" + ");

  await ChatMessage.create({
    content: `<p class="shards-chat-confirm">${actor.name} spent ${costStr}.</p>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

/* -------------------------------------------- */
/*  Validation Helpers                           */
/* -------------------------------------------- */

/**
 * Check if the actor can act (not stunned, not downed, not silenced for magical).
 * @param {Actor} actor
 * @param {object} sk - Skill system data
 * @returns {boolean}
 */
function _validateCanAct(actor, sk) {
  const cond = actor.system.conditions;

  if (cond.stun > 0) {
    ui.notifications.warn(game.i18n.localize("SHARDS.Roll.Stunned"));
    return false;
  }
  if (cond.downed > 0) {
    ui.notifications.warn(game.i18n.localize("SHARDS.Roll.Downed"));
    return false;
  }
  if (cond.silence > 0 && sk.defenseType === "magical") {
    ui.notifications.warn(game.i18n.localize("SHARDS.Roll.Silenced"));
    return false;
  }
  return true;
}

/**
 * Check if the actor has enough pips and MP.
 * @param {Actor} actor
 * @param {number} pipCost
 * @param {number} mpCost
 * @returns {boolean}
 */
function _validateResources(actor, pipCost, mpCost) {
  const system = actor.system;

  if (pipCost > 0 && system.pips.value < pipCost) {
    ui.notifications.warn(game.i18n.format("SHARDS.Roll.NotEnoughPips", {
      cost: pipCost, current: system.pips.value
    }));
    return false;
  }
  if (mpCost > 0 && system.mana.value < mpCost) {
    ui.notifications.warn(game.i18n.format("SHARDS.Roll.NotEnoughMP", {
      cost: mpCost, current: system.mana.value
    }));
    return false;
  }
  return true;
}

/**
 * Validate that the skill has appropriate targets.
 * When the requireTargeting setting is off, allows rolls without targets (display-only mode).
 * @param {object} sk - Skill system data
 * @param {Token[]} targets
 * @returns {boolean}
 */
function _validateTargets(sk, targets) {
  // Self and field skills don't need external targets
  if (sk.target === "self" || sk.target === "field") return true;

  if (!targets.length) {
    const requireTargeting = game.settings.get("shards-of-mana", "requireTargeting");
    if (requireTargeting) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Roll.NoTarget"));
      return false;
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  Utility Helpers                              */
/* -------------------------------------------- */

/**
 * Evaluate a cost formula string to a number.
 * @param {string} formula
 * @param {object} ctx - Formula context
 * @returns {number}
 */
function _evaluateCost(formula, ctx) {
  if (!formula) return 0;
  const result = evaluateFormula(formula, ctx);
  return typeof result === "number" ? Math.max(Math.floor(result), 0) : 0;
}

/**
 * Evaluate a conditionChance formula string to a number clamped 0-100.
 * @param {string} formula
 * @param {object} ctx - Formula context
 * @returns {number}
 */
function _evaluateConditionChance(formula, ctx) {
  if (!formula) return 0;
  const result = evaluateFormula(formula, ctx);
  return typeof result === "number" ? Math.clamp(Math.floor(result), 0, 100) : 0;
}

/**
 * Get display info for a resistance tier value.
 * @param {number} tier - The resistance tier (-1 to 3)
 * @returns {{label: string, css: string}}
 */
function _resistanceTierDisplay(tier) {
  switch (tier) {
    case -1: return { label: game.i18n.localize("SHARDS.Resistance.Weak"), css: "weak" };
    case 0:  return { label: game.i18n.localize("SHARDS.Resistance.Normal"), css: "normal" };
    case 1:  return { label: game.i18n.localize("SHARDS.Resistance.Resist"), css: "resist" };
    case 2:  return { label: game.i18n.localize("SHARDS.Resistance.Immune"), css: "immune" };
    case 3:  return { label: game.i18n.localize("SHARDS.Resistance.Absorb"), css: "absorb" };
    default: return { label: game.i18n.localize("SHARDS.Resistance.Normal"), css: "normal" };
  }
}

/**
 * Map an outcome string to a CSS class.
 * @param {string} outcome
 * @returns {string}
 */
function _outcomeCssClass(outcome) {
  switch (outcome) {
    case "critical-success":
    case "critical-hit": return "outcome-crit-success";
    case "success":
    case "hit":
    case "auto-hit": return "outcome-success";
    case "miss":
    case "failure": return "outcome-failure";
    case "critical-failure": return "outcome-crit-failure";
    default: return "";
  }
}

/**
 * Map an outcome string to a FontAwesome icon class.
 * @param {string} outcome
 * @returns {string}
 */
function _outcomeIcon(outcome) {
  switch (outcome) {
    case "critical-success":
    case "critical-hit": return "fa-gem";
    case "success":
    case "hit":
    case "auto-hit": return "fa-check";
    case "miss":
    case "failure": return "fa-xmark";
    case "critical-failure": return "fa-skull-crossbones";
    default: return "fa-circle";
  }
}

/**
 * Get the actor's chosen sheet theme, defaulting to "silver".
 * @param {Actor} actor
 * @returns {string}
 */
function _actorTheme(actor) {
  return actor?.getFlag("shards-of-mana", "sheetTheme") ?? "silver";
}

/* -------------------------------------------- */
/*  Weapon Attack (Basic Attack)                 */
/* -------------------------------------------- */

/**
 * Execute a basic weapon attack: validate → roll → damage → chat.
 * Used when a player attacks with an equipped weapon directly (no skill).
 * @param {Actor} actor - The attacking actor
 * @param {Item} weapon - The equipment item (weapon/offhand)
 * @param {Token[]} targets - Array of target tokens
 * @returns {Promise<object|null>} Roll results or null if blocked
 */
export async function rollWeaponAttack(actor, weapon, targets, { isReroll = false } = {}) {
  const sys = weapon.system;
  const system = actor.system;

  // --- Precondition checks ---
  const cond = system.conditions;
  if (cond.stun > 0) {
    ui.notifications.warn(game.i18n.localize("SHARDS.Roll.Stunned"));
    return null;
  }
  if (cond.downed > 0) {
    ui.notifications.warn(game.i18n.localize("SHARDS.Roll.Downed"));
    return null;
  }

  // Check targeting requirement
  const displayOnly = !targets.length;
  if (displayOnly) {
    const requireTargeting = game.settings.get("shards-of-mana", "requireTargeting");
    if (requireTargeting) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Roll.NoTarget"));
      return null;
    }
  }

  // --- Deduct 1 pip for a basic attack (skip in display-only mode and rerolls) ---
  if (!displayOnly && !isReroll) {
    if (system.pips.value < 1) {
      ui.notifications.warn(game.i18n.format("SHARDS.Roll.NotEnoughPips", {
        cost: 1, current: system.pips.value
      }));
      return null;
    }
    await actor.update({ "system.pips.value": system.pips.value - 1 });
  }

  // --- Compute attacker stats ---
  const cf = CONFIG.SHARDS.combatFormula;
  const derived = system.derived;
  const isPhysical = sys.mDmg > 0 ? false : true; // Default to physical unless weapon has magical damage
  const isMagical = !isPhysical;

  const weaponBaseAccuracy = sys.baseAccuracy ?? cf.UNARMED_ACCURACY;
  const damageType = "physical"; // Basic weapon attacks are physical element

  // --- Resolve against each target ---
  const results = [];
  for (const token of targets) {
    const targetActor = token.actor;
    if (!targetActor) continue;

    const targetDerived = targetActor.system.derived;
    const targetName = targetActor.name;
    const targetId = targetActor.id;

    // Hit calculation (single ACC vs EVA track)
    const hitTarget = Math.clamp(
      weaponBaseAccuracy + (derived.acc - targetDerived.eva) * cf.HIT_SCALAR,
      cf.HIT_FLOOR, cf.HIT_CEILING
    );
    const critThreshold = Math.clamp(
      cf.CRIT_BASE + derived.crit,
      cf.CRIT_FLOOR, cf.CRIT_CEILING
    );

    const roll = new Roll("1d100");
    await roll.evaluate();
    const d100 = roll.total;

    let outcome;
    if (d100 <= critThreshold) {
      outcome = "critical-hit";
    } else if (d100 <= hitTarget) {
      outcome = "hit";
    } else {
      outcome = "miss";
    }

    const isHit = outcome === "hit" || outcome === "critical-hit";
    const isCrit = outcome === "critical-hit";

    // Damage calculation (if hit) — weapon pDmg/mDmg + STR/MAG (weapon IS the source)
    let baseDamage = 0, defReduction = 0, finalDamage = 0;
    let isAbsorb = false, isImmune = false, pierced = false, reflected = false;
    let resistanceTier = 0, resistanceTierLabel = "", resistanceTierCss = "";

    if (isHit) {
      // Weapon attacks: stat + weapon flat bonus
      baseDamage = isPhysical
        ? system.statTotal("str") + (sys.pDmg ?? 0)
        : system.statTotal("mag") + (sys.mDmg ?? 0);
      if (isCrit) baseDamage = Math.floor(baseDamage * 1.5);

      // --- Damage Alterations (from actor's owned items) ---
      const wAltCtx = {
        element: damageType,
        baseDamage,
        pierce: false,
        defenseType: isPhysical ? "physical" : "magical",
        skillId: null,
        skillType: null,
        weaponGroup: sys.weaponGroup ?? null,
        formulaCtx: buildFormulaContext(actor, weapon)
      };
      const wAlterations = collectDamageAlterations(actor);
      if (wAlterations.length) applyDamageAlterations(wAlterations, wAltCtx);
      baseDamage = wAltCtx.baseDamage;
      const wElement = wAltCtx.element;
      const wDefenseType = wAltCtx.defenseType;
      const wIsPhysical = wDefenseType === "physical";
      const wIsMagical = wDefenseType === "magical";

      // --- Tiered element resistance ---
      resistanceTier = targetActor.system.elementResistances?.[wElement] ?? 0;

      // Pierce: from alteration only (basic weapon attacks have no innate pierce)
      pierced = wAltCtx.pierce && resistanceTier === 1;
      const effectiveTier = pierced ? 0 : resistanceTier;

      // Look up tier multiplier from config
      const tierConfig = CONFIG.SHARDS.resistanceTiers?.[String(effectiveTier)];
      const multiplier = tierConfig?.multiplier ?? 1.0;

      // Tier display info
      const tierInfo = _resistanceTierDisplay(effectiveTier);
      resistanceTierLabel = tierInfo.label;
      resistanceTierCss = tierInfo.css;

      if (effectiveTier >= 2) {
        if (multiplier < 0) {
          isAbsorb = true;
          finalDamage = Math.floor(baseDamage * Math.abs(multiplier));
        } else {
          isImmune = true;
          finalDamage = 0;
        }
      } else {
        const afterResist = Math.floor(baseDamage * multiplier);
        defReduction = wIsPhysical ? targetDerived.pDef : wIsMagical ? targetDerived.mDef : 0;
        const damageFloor = Math.max(1, Math.ceil(afterResist * cf.DMG_FLOOR_PCT / 100));
        finalDamage = Math.max(afterResist - defReduction, damageFloor);
      }

      // Reflect check: magical weapon attacks bounce off reflect targets
      if (wIsMagical && targetActor.system.conditions.reflect > 0 && !isAbsorb && !isImmune) {
        reflected = true;
      }
    }

    const outcomeLabel = game.i18n.localize(`SHARDS.Roll.${
      outcome === "critical-hit" ? "CriticalHit"
        : outcome === "hit" ? "Hit" : "Miss"}`);

    results.push({
      targetName,
      targetId,
      damageTargetId: reflected ? actor.id : targetId,
      damageTargetName: reflected ? actor.name : targetName,
      roll,
      rollTotal: roll.total,
      hitTarget,
      critThreshold,
      outcome,
      outcomeCss: _outcomeCssClass(outcome),
      outcomeIcon: _outcomeIcon(outcome),
      outcomeLabel,
      isHit,
      isCrit,
      baseDamage,
      resistanceTier,
      resistanceTierLabel,
      resistanceTierCss,
      showResistance: resistanceTier !== 0,
      defReduction,
      finalDamage,
      isAbsorb,
      isImmune,
      pierced,
      reflected
    });
  }

  // --- Build and post chat card ---
  const slotLabel = game.i18n.localize(CONFIG.SHARDS.equipmentSlots[sys.slot] ?? sys.slot);
  let classificationLabel = "";
  if (sys.weaponGroup) {
    classificationLabel = game.i18n.localize(CONFIG.SHARDS.weaponGroups[sys.weaponGroup] ?? sys.weaponGroup);
  }

  const damageTypeLabel = game.i18n.localize(CONFIG.SHARDS.damageTypes[damageType] ?? damageType);
  const templateData = {
    actorName: actor.name,
    actorImg: actor.img,
    actorTheme: _actorTheme(actor),
    weaponName: weapon.name,
    weaponImg: weapon.img,
    weaponRank: sys.rank,
    slotLabel,
    classificationLabel,
    damageType,
    damageTypeLabel,
    results,
    isMultiTarget: results.length > 1,
    displayOnly,
    actorId: actor.id
  };

  const content = await renderTemplate("systems/shards-of-mana/templates/chat/weapon-attack.hbs", templateData);
  const rolls = results.map(r => r.roll).filter(Boolean);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: rolls.length ? rolls : undefined,
    sound: rolls.length ? CONFIG.sounds.dice : undefined,
    flags: {
      "shards-of-mana": {
        rollType: "weaponAttack",
        actorId: actor.id,
        weaponId: weapon.id,
        targetIds: targets.map(t => t.actor?.id).filter(Boolean),
        displayOnly
      }
    }
  });

  return { results, displayOnly };
}
