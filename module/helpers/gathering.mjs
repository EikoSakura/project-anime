/**
 * Project: Anime — Gathering (rules doc "Crafting → Gathering Materials", v0.03).
 *
 * Defeated foes yield materials automatically — no harvest roll — keyed off the Monster Creator's
 * Role × Tier (+ Boss Bars / Rival). Fired once per defeat from the defeat pipeline
 * (project-anime.mjs markDefeatedFromHP), depositing to the party stash and posting a card.
 *
 * Drops by Role: Brute→Hide, Caster→Essence, Grunt→Ore, Skirmisher→Hide or Ore (default Ore),
 * Support→Reagent, Swarm→Reagent at half yield, Elite→1 Prime of one type. A Boss yields 1 Prime per
 * Bar. A Rival yields nothing while it escapes — but a Rival that actually falls counts as Elite + 1
 * Threat. Count = 1 Common per point of Threat, of the foe's Tier.
 */
import { PROJECTANIME } from "./config.mjs";
import { depositMaterial, materialTypeLabel, materialGradeLabel } from "./crafting.mjs";
import { resolveParty } from "./party-folder.mjs";

/** Role → material type for Commons drops. Skirmisher defaults to Ore (ST may reflavor to Hide). */
const ROLE_DROP_TYPE = {
  brute: "hide",
  caster: "essence",
  grunt: "ore",
  skirmisher: "ore",
  support: "reagent",
  swarm: "reagent"
};

/** Default Prime type for an Elite/Boss when nothing pins one (the ST fits it to the creature). */
const DEFAULT_PRIME_TYPE = "ore";

/**
 * The material drops for a defeated NPC. Returns [{grade, tier, category, qty}] — empty for an
 * untiered / roleless NPC (those are ST-discretion, not automatic).
 */
export function computeDrops(actor) {
  const sys = actor?.system ?? {};
  const role = sys.enemyRole;
  const tier = Math.max(1, Math.min(4, Number(sys.enemyTier) || 0));
  if (!role || !(Number(sys.enemyTier) >= 1)) return [];

  // Boss: 1 Prime per Bar (type ST-fit → default), regardless of Role Commons.
  if (sys.boss?.enabled) {
    const bars = Math.max(1, Number(sys.boss.bars) || 1);
    return [{ grade: "prime", tier, category: DEFAULT_PRIME_TYPE, qty: bars }];
  }
  // Elite: 1 Prime of one type, in place of Commons.
  if (role === "elite") {
    return [{ grade: "prime", tier, category: DEFAULT_PRIME_TYPE, qty: 1 }];
  }

  // Threat per point → 1 Common each. A Rival that falls counts as Elite + 1 Threat.
  let threat = Number(PROJECTANIME.enemyRoles[role]?.threat) || 1;
  if (sys.rival) threat += 1;
  const category = ROLE_DROP_TYPE[role] || "ore";
  const qty = role === "swarm"
    ? Math.max(1, Math.round(threat * 0.5)) // Swarm: half yield
    : Math.max(1, Math.round(threat));
  return [{ grade: "common", tier, category, qty }];
}

/**
 * Award a defeated NPC's material drops to the party stash and post a card. GM-side. The caller
 * guards against double-firing (one drop per defeat) via the actor's `materialsDropped` flag.
 */
export async function awardDefeatDrops(actor) {
  if (!game.user.isGM || actor?.type !== "npc") return;
  const drops = computeDrops(actor);
  if (!drops.length) return;
  const party = await resolveParty();
  if (!party) return;

  const roman = (t) => PROJECTANIME.enemyTierNumerals[t] || String(t);
  const lines = [];
  for (const d of drops) {
    await depositMaterial(party, d);
    const mat = `${materialGradeLabel(d.grade)} ${materialTypeLabel(d.category)} · ${game.i18n.localize("PROJECTANIME.Material.tier")} ${roman(d.tier)}`;
    lines.push(game.i18n.format("PROJECTANIME.Gather.line", { qty: d.qty, material: mat }));
  }

  const L = (k) => game.i18n.localize(k);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="project-anime chat-card">
      <header class="card-header">
        <span class="card-icon is-glyph"><i class="fas fa-gem"></i></span>
        <div class="card-titles">
          <h3 class="card-title">${L("PROJECTANIME.Gather.title")}</h3>
          <span class="card-type">${game.i18n.format("PROJECTANIME.Gather.from", { name: actor.name })}</span>
        </div>
      </header>
      <div class="card-lines">
        ${lines.map((l) => `<div class="card-line">${l}</div>`).join("")}
        <div class="card-line muted">${L("PROJECTANIME.Gather.toStash")}</div>
      </div>
    </div>`
  });
}
