/**
 * Damage Alteration System — items can define modifications to the attack roll pipeline.
 *
 * Alterations are stored in item flags:
 *   flags["shards-of-mana"].damageAlterations = [{ id, type, ... }]
 *
 * Types:
 *   - changeElement: Replace the attack's damage element
 *   - bonusDamage: Add flat or formula bonus damage
 *   - addPierce: Grant pierce (treat Resist as Normal)
 *   - changeDefenseType: Switch physical/magical defense check
 *
 * Each alteration has a filter that determines which attacks it applies to.
 */

import { evaluateFormula } from "./formulas.mjs";

/* -------------------------------------------- */
/*  Public API                                    */
/* -------------------------------------------- */

/**
 * Check whether an item has any damage alteration definitions.
 * @param {Item} item
 * @returns {boolean}
 */
export function hasDamageAlterations(item) {
  const alts = item.flags?.["shards-of-mana"]?.damageAlterations;
  return Array.isArray(alts) && alts.length > 0;
}

/**
 * Collect all damage alterations from an actor's equipped/owned items.
 * Returns a flat array of alteration objects.
 * @param {ShardsActor} actor
 * @returns {object[]}
 */
export function collectDamageAlterations(actor) {
  const alterations = [];
  for (const item of actor.items) {
    const alts = item.flags?.["shards-of-mana"]?.damageAlterations;
    if (!Array.isArray(alts)) continue;
    for (const alt of alts) {
      alterations.push({ ...alt, _sourceItemId: item.id, _sourceItemName: item.name });
    }
  }
  return alterations;
}

/**
 * Apply collected damage alterations to an attack context.
 * Mutates the context object in place.
 *
 * @param {object[]} alterations - From collectDamageAlterations()
 * @param {object}   ctx - Mutable attack context:
 *   @param {string}  ctx.element       - Damage element (e.g. "fire", "physical")
 *   @param {number}  ctx.baseDamage    - Base damage after formula + crit
 *   @param {boolean} ctx.pierce        - Whether pierce is active
 *   @param {string}  ctx.defenseType   - "physical" | "magical" | "none"
 *   @param {string}  [ctx.skillId]     - ID of the skill being used (null for weapon attacks)
 *   @param {string}  [ctx.skillType]   - Skill type (active/passive/reaction/limitBreak)
 *   @param {string}  [ctx.weaponGroup] - Weapon group of the equipped weapon
 *   @param {object}  [ctx.formulaCtx]  - Formula context for evaluateFormula
 */
export function applyDamageAlterations(alterations, ctx) {
  for (const alt of alterations) {
    if (!_matchesFilter(alt, ctx)) continue;

    switch (alt.type) {
      case "changeElement":
        if (alt.newElement) ctx.element = alt.newElement;
        break;

      case "bonusDamage": {
        let bonus = 0;
        if (alt.bonusFormula && ctx.formulaCtx) {
          const evaluated = evaluateFormula(alt.bonusFormula, ctx.formulaCtx);
          bonus = typeof evaluated === "number" ? evaluated : 0;
        } else {
          bonus = Number(alt.bonusFormula) || 0;
        }
        ctx.baseDamage += bonus;
        break;
      }

      case "addPierce":
        ctx.pierce = true;
        break;

      case "changeDefenseType":
        if (alt.newDefenseType) ctx.defenseType = alt.newDefenseType;
        break;
    }
  }
}

/* -------------------------------------------- */
/*  Filter Matching                               */
/* -------------------------------------------- */

/**
 * Check if an alteration's filter matches the current attack context.
 * @param {object} alt - The alteration definition
 * @param {object} ctx - The attack context
 * @returns {boolean}
 * @private
 */
function _matchesFilter(alt, ctx) {
  const filter = alt.filter;
  if (!filter || filter.scope === "all") return true;

  switch (filter.scope) {
    case "specific":
      return ctx.skillId && ctx.skillId === filter.skillId;
    case "weaponGroup":
      return ctx.weaponGroup && ctx.weaponGroup === filter.weaponGroup;
    case "skillType":
      return ctx.skillType && ctx.skillType === filter.skillType;
    default:
      return true;
  }
}
