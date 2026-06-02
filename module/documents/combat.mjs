/**
 * Custom Combat document for Shards of Mana.
 * - AGI-based initiative formula (1d100 + AGI total)
 * - Tie-breaking by AGI stat total, then alphabetical name
 */
export class ShardsCombat extends Combat {

  /** @override */
  _getInitiativeFormula(combatant) {
    return "1d100 + @system.stats.agi.total";
  }

  /** @override */
  _sortCombatants(a, b) {
    // Higher initiative first
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    if (ia !== ib) return ib - ia;

    // Tie-break: higher AGI total wins
    const agiA = a.actor?.system?.stats?.agi?.total ?? 0;
    const agiB = b.actor?.system?.stats?.agi?.total ?? 0;
    if (agiA !== agiB) return agiB - agiA;

    // Final tie-break: alphabetical by name
    const nameA = a.name ?? "";
    const nameB = b.name ?? "";
    return nameA.localeCompare(nameB);
  }
}
