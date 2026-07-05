/**
 * Project: Anime — the Crafting engine (rules doc "Crafting", v0.03).
 *
 * Materials are carried `material` Items (grade Common/Prime × Tier I–IV × type Essence/Hide/Ore/
 * Reagent). This module owns the material economy and the five Craft operations a character performs
 * at a rest (never rolls, never fails):
 *   • Forge   — half list Gold + 3 Commons of the matching type at party Tier → printed gear.
 *   • Trait   — one of 14 permanent modifications (2-cap, each once, accessories barred).
 *   • Temper  — +1 DMG / +1 Protection, cap party Tier − 1, 2 Primes of the matching type each.
 *   • Brew    — a batch of consumables of one of 7 recipes, Reagent cost at ≥ recipe Tier.
 *   • Project — advance one Stage of a Stage-based work (one Stage per rest).
 * Plus Sockets (empty fittings holding Module-defined content) and the 5 Specialties that bend the
 * mechanics above.
 *
 * A "crafter" is a Character (or the Party stash) chosen in the Workbench; materials, Gold, and the
 * produced Items all live on that actor. Defeat drops and shop buys deposit materials; players carry
 * or move them to whoever does the work. NOTE: gear Traits here are UNRELATED to NPC Signature
 * Traits (helpers/trait-effect.mjs, system.traits, PROJECTANIME.Talent.*).
 */
import { PROJECTANIME } from "./config.mjs";
import { partyTier } from "./chronicle.mjs";

/* -------------------------------------------------------------------------- */
/*  Material naming / stacking                                                */
/* -------------------------------------------------------------------------- */

const MATERIAL_IMG = "icons/svg/item-bag.svg";

export function materialTypeLabel(category) {
  return game.i18n.localize(PROJECTANIME.materialTypes[category] ?? category);
}
export function materialGradeLabel(grade) {
  return game.i18n.localize(PROJECTANIME.materialGrades[grade] ?? grade);
}
/** The default flavor name for an auto-generated material ("Common Ore"). */
export function defaultMaterialName(grade, category) {
  return game.i18n.format("PROJECTANIME.Material.defaultName", {
    grade: materialGradeLabel(grade), type: materialTypeLabel(category)
  });
}

/** All material Items an actor carries. */
export function materialItems(actor) {
  return (actor?.items ?? []).filter((i) => i.type === "material");
}

/**
 * Deposit materials onto an actor, stacking onto an identical stack (same grade / Tier / type / name)
 * when one exists. `name` defaults to the generic flavor name so drops and purchases stack cleanly.
 * Returns the created/updated material Item.
 */
export async function depositMaterial(actor, { grade = "common", tier = 1, category = "ore", qty = 1, name = null, img = null } = {}) {
  if (!actor || qty <= 0) return null;
  tier = Math.max(1, Math.min(4, Math.round(Number(tier) || 1)));
  const finalName = name || defaultMaterialName(grade, category);
  const stack = materialItems(actor).find((i) =>
    i.system.grade === grade && (Number(i.system.tier) || 0) === tier
    && i.system.category === category && i.name === finalName);
  if (stack) {
    await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + qty });
    return stack;
  }
  const created = await actor.createEmbeddedDocuments("Item", [{
    name: finalName, type: "material", img: img || MATERIAL_IMG,
    system: { grade, tier, category, quantity: qty }
  }]);
  return created?.[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Paying material costs                                                     */
/* -------------------------------------------------------------------------- */

/** Materials of a type at ≥ minTier (optionally a specific grade). */
function poolOf(actor, category, minTier, grade = null) {
  return materialItems(actor).filter((i) =>
    i.system.category === category
    && (Number(i.system.tier) || 0) >= minTier
    && (grade ? i.system.grade === grade : true));
}

/** Commons-equivalent available of a type at ≥ minTier (a Prime counts as 2). */
export function commonsAvailable(actor, category, minTier = 1) {
  return poolOf(actor, category, minTier).reduce((n, i) => n + (Number(i.system.commonsValue) || 0), 0);
}
/** Primes available of a type at ≥ minTier. */
export function primesAvailable(actor, category, minTier = 1) {
  return poolOf(actor, category, minTier, "prime").reduce((n, i) => n + (Number(i.system.quantity) || 0), 0);
}

/**
 * Simulate paying a cost list and return a spend plan. Prime costs are honoured FIRST (Primes are
 * reserved for them) so a shared pool — e.g. a Socket's "2 Essence + 1 Prime Essence" — can't
 * double-count one Prime. Then Commons costs spend Commons first (saving Primes), then Primes (each
 * pays 2, may overpay by 1). Returns { ok, updates, deletes }; ok:false when unaffordable.
 * cost = [{ type, qty, grade? }] — grade "prime" = a Prime cost; otherwise a Commons cost.
 */
function planSpend(actor, cost, minTier = 1) {
  const left = new Map(); // itemId → qty remaining (working copy)
  const mats = materialItems(actor);
  for (const i of mats) left.set(i.id, Number(i.system.quantity) || 0);
  const byTierAsc = (a, b) => (Number(a.system.tier) || 0) - (Number(b.system.tier) || 0);
  const pool = (type, grade) => mats.filter((i) =>
    i.system.category === type && (Number(i.system.tier) || 0) >= minTier
    && (grade ? i.system.grade === grade : true)).sort(byTierAsc);

  // Prime costs before Commons costs (reserve Primes for the Prime lines).
  const ordered = [...cost].sort((a, b) => (a.grade === "prime" ? 0 : 1) - (b.grade === "prime" ? 0 : 1));
  for (const c of ordered) {
    let need = Number(c.qty) || 0;
    if (need <= 0) continue;
    if (c.grade === "prime") {
      for (const i of pool(c.type, "prime")) {
        if (need <= 0) break;
        const have = left.get(i.id); if (have <= 0) continue;
        const take = Math.min(have, need); left.set(i.id, have - take); need -= take;
      }
    } else {
      for (const i of pool(c.type, "common")) {
        if (need <= 0) break;
        const have = left.get(i.id); if (have <= 0) continue;
        const take = Math.min(have, need); left.set(i.id, have - take); need -= take;
      }
      for (const i of pool(c.type, "prime")) {
        if (need <= 0) break;
        const have = left.get(i.id); if (have <= 0) continue;
        const usePrimes = Math.min(have, Math.ceil(need / 2)); left.set(i.id, have - usePrimes); need -= usePrimes * 2;
      }
    }
    if (need > 0) return { ok: false };
  }

  const updates = [];
  const deletes = [];
  for (const i of mats) {
    const q = left.get(i.id);
    const orig = Number(i.system.quantity) || 0;
    if (q === orig) continue;
    if (q <= 0) deletes.push(i.id);
    else updates.push({ _id: i.id, "system.quantity": q });
  }
  return { ok: true, updates, deletes };
}

/** Can the actor pay this cost list at minTier? cost = [{type, qty, grade?}]. */
export function canAfford(actor, cost, minTier = 1) {
  return planSpend(actor, cost, minTier).ok;
}

/** Spend a cost list, mutating the actor's materials. Returns false (no change) if unaffordable. */
export async function spendCost(actor, cost, minTier = 1) {
  const plan = planSpend(actor, cost, minTier);
  if (!plan.ok) return false;
  if (plan.updates.length) await actor.updateEmbeddedDocuments("Item", plan.updates);
  if (plan.deletes.length) await actor.deleteEmbeddedDocuments("Item", plan.deletes);
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Specialties                                                               */
/* -------------------------------------------------------------------------- */

/** The crafter's learned Specialty key ("" = none). Only Characters carry one. */
export function specialtyOf(actor) {
  return actor?.type === "character" ? (actor.system?.specialty || "") : "";
}

/** Does the actor carry an Artisan's Kit (the field-crafting tool)? Detected by an explicit flag or
 *  the item name, so an ST can hand one out as plain gear. */
export function hasArtisansKit(actor) {
  return (actor?.items ?? []).some((i) =>
    ["gear", "container", "accessory"].includes(i.type)
    && (i.getFlag?.("project-anime", "artisansKit") || /artisan'?s\s+kit/i.test(i.name || "")));
}

/* -------------------------------------------------------------------------- */
/*  Forging                                                                   */
/* -------------------------------------------------------------------------- */

/** The matching material type for Forging/Temper: Ore for weapons & shields, Hide for armor. */
export function matchingType(itemType) {
  return itemType === "armor" ? "hide" : "ore";
}

/** The Forge bill for a gear snapshot at party Tier: half list Gold (0 with the Smith Specialty) +
 *  3 Commons of the matching type. */
export function forgeCost(snapshot, actor = null) {
  const listGold = Number(snapshot?.system?.cost) || 0;
  const gold = specialtyOf(actor) === "smith" ? 0 : Math.floor(listGold / 2);
  return { gold, material: [{ type: matchingType(snapshot.type), qty: 3 }] };
}

/** Forge one weapon/shield/armor from a gear snapshot. Deducts the bill and creates the (renameable)
 *  gear on the crafter. Returns the created Item or null (unaffordable). */
export async function forgeGear(actor, snapshot) {
  if (!actor || !["weapon", "shield", "armor"].includes(snapshot?.type)) return null;
  const tier = partyTier();
  const { gold, material } = forgeCost(snapshot, actor);
  if ((Number(actor.system.gold) || 0) < gold) return { error: "gold" };
  if (!canAfford(actor, material, tier)) return { error: "material" };

  await spendCost(actor, material, tier);
  if (gold > 0) await actor.update({ "system.gold": (Number(actor.system.gold) || 0) - gold });
  const obj = foundry.utils.deepClone(snapshot);
  delete obj._id;
  // Forged gear is printed gear — start clean of any source Traits/Temper/Flaw from the template.
  if (obj.system) { obj.system.gearTraits = []; obj.system.temper = 0; obj.system.sockets = []; obj.system.flaw = ""; }
  const created = await actor.createEmbeddedDocuments("Item", [obj]);
  return { item: created?.[0] ?? null };
}

/* -------------------------------------------------------------------------- */
/*  Traits                                                                     */
/* -------------------------------------------------------------------------- */

/** Which item kinds a Trait may be crafted onto. A shield only accepts "any" Traits (weapon Traits
 *  like Honed don't fit it); accessories accept none. */
export function traitAppliesTo(traitKey, itemType) {
  const t = PROJECTANIME.gearTraits[traitKey];
  if (!t || itemType === "accessory") return false;
  return t.applies === "any" || t.applies === itemType;
}

/** The material bill for one Trait application, adjusted by the Smith Specialty (Trait bills −1
 *  Common, min 1 — Prime components are untouched). */
export function traitCost(traitKey, actor = null) {
  const base = (PROJECTANIME.gearTraits[traitKey]?.cost ?? []).map((c) => ({ ...c }));
  if (specialtyOf(actor) === "smith") {
    for (const c of base) if (c.grade !== "prime") c.qty = Math.max(1, (Number(c.qty) || 0) - 1);
  }
  return base;
}

/** Trait entries currently on an item (Sockets count; Temper does not). */
export function itemTraits(item) {
  return Array.isArray(item?.system?.gearTraits) ? item.system.gearTraits : [];
}

/**
 * Apply a Trait to a weapon/shield/armor. Enforces: kind eligibility, the 2-Trait cap (a Socket
 * counts), one-of-each, and the material bill at party Tier. `params` carries Attuned's element,
 * Concealed's disguise, Warded's status. Returns { ok } or { error }.
 */
export async function applyTrait(actor, item, traitKey, params = {}) {
  const def = PROJECTANIME.gearTraits[traitKey];
  if (!actor || !item || !def) return { error: "invalid" };
  if (item.type === "accessory") return { error: "accessory" };
  if (!traitAppliesTo(traitKey, item.type)) return { error: "applies" };
  const traits = itemTraits(item);
  if (traits.length >= (PROJECTANIME.gearTraitCap || 2)) return { error: "cap" };
  if (traits.some((t) => t.key === traitKey)) return { error: "has" };

  const tier = partyTier();
  const cost = traitCost(traitKey, actor);
  if (!canAfford(actor, cost, tier)) return { error: "material" };
  await spendCost(actor, cost, tier);

  const entry = { key: traitKey, element: "", disguise: "", status: "" };
  if (def.needs === "element") entry.element = params.element || "";
  if (def.needs === "disguise") entry.disguise = params.disguise || "";
  if (def.needs === "status") entry.status = params.status || "";

  const update = { "system.gearTraits": [...traits, entry] };
  // The Socket Trait also adds one empty fitting.
  if (def.socket) update["system.sockets"] = [...(item.system.sockets ?? []), { content: null }];
  await item.update(update);
  return { ok: true };
}

/**
 * Remove a Trait (one Craft Activity, no materials — the Trait is destroyed). Removing a Socket
 * Trait removes one empty Socket and destroys its content. The Salvager Specialty recovers half the
 * Trait's material cost (rounded down) to the crafter. Returns { ok } or { error }.
 */
export async function removeTrait(actor, item, traitKey) {
  const traits = itemTraits(item);
  const idx = traits.findIndex((t) => t.key === traitKey);
  if (idx < 0) return { error: "missing" };
  const def = PROJECTANIME.gearTraits[traitKey];

  const next = traits.slice();
  next.splice(idx, 1);
  const update = { "system.gearTraits": next };
  if (def?.socket) {
    // Drop the last Socket fitting (its content, if any, is destroyed with the Socket).
    const sockets = (item.system.sockets ?? []).slice();
    sockets.pop();
    update["system.sockets"] = sockets;
  }
  await item.update(update);

  // Salvager — recover half the Trait's cost (rounded down), at party Tier.
  if (specialtyOf(actor) === "salvager") {
    const tier = partyTier();
    for (const c of (def?.cost ?? [])) {
      const half = Math.floor((Number(c.qty) || 0) / 2);
      if (half > 0) await depositMaterial(actor, { grade: c.grade || "common", tier, category: c.type, qty: half });
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Temper                                                                     */
/* -------------------------------------------------------------------------- */

/** The Temper cap: party Tier − 1 (0 at Tier I). */
export function temperCap() {
  return Math.max(0, partyTier() - 1);
}
/** The Temper bill for one level: 2 Primes of the matching type at ≥ party Tier. */
export function temperCost(item) {
  return [{ type: matchingType(item.type), qty: 2, grade: "prime" }];
}

/** Temper an item one level (never past the cap). Returns { ok, level } or { error }. */
export async function temperItem(actor, item) {
  if (!actor || !["weapon", "shield", "armor"].includes(item?.type)) return { error: "invalid" };
  const cur = Number(item.system.temper) || 0;
  if (cur >= temperCap()) return { error: "cap" };
  const tier = partyTier();
  const cost = temperCost(item);
  if (!canAfford(actor, cost, tier)) return { error: "material" };
  await spendCost(actor, cost, tier);
  await item.update({ "system.temper": cur + 1 });
  return { ok: true, level: cur + 1 };
}

/* -------------------------------------------------------------------------- */
/*  Brewing                                                                    */
/* -------------------------------------------------------------------------- */

/** Batch size for a crafter (Brewer makes 4, everyone else 3). */
export function brewBatchSize(actor) {
  return specialtyOf(actor) === "brewer"
    ? (PROJECTANIME.brewBatchSizeBrewer || 4)
    : (PROJECTANIME.brewBatchSize || 3);
}

/** One brewed consumable snapshot for a recipe. */
function brewConsumable(recipeKey) {
  const r = PROJECTANIME.brewRecipes[recipeKey];
  return {
    name: game.i18n.localize(`PROJECTANIME.Brew.name.${recipeKey}`),
    type: "consumable", img: MATERIAL_IMG,
    system: {
      restoreType: r.out.restore || "none",
      restoreAmount: Number(r.out.amount) || 0,
      quantity: 1, cost: 0,
      description: `<p>${game.i18n.localize(`PROJECTANIME.Brew.effect.${recipeKey}`)}</p>`
    }
  };
}

/** Brew a batch of one recipe. Materials must match the recipe Tier or higher. Returns { ok, n } or
 *  { error }. */
export async function brew(actor, recipeKey) {
  const r = PROJECTANIME.brewRecipes[recipeKey];
  if (!actor || !r) return { error: "invalid" };
  const minTier = r.tier;
  if (!canAfford(actor, r.cost, minTier)) return { error: "material" };
  await spendCost(actor, r.cost, minTier);
  const n = brewBatchSize(actor);
  const snap = brewConsumable(recipeKey);
  await actor.createEmbeddedDocuments("Item", Array.from({ length: n }, () => foundry.utils.deepClone(snap)));
  return { ok: true, n };
}

/* -------------------------------------------------------------------------- */
/*  Sockets                                                                    */
/* -------------------------------------------------------------------------- */

/** Place a content (a stored Item snapshot) into an empty Socket on an item. No Activity. */
export async function placeSocketContent(item, socketIndex, content) {
  const sockets = (item.system.sockets ?? []).map((s) => ({ ...s }));
  if (!sockets[socketIndex] || sockets[socketIndex].content) return { error: "occupied" };
  sockets[socketIndex] = { content };
  await item.update({ "system.sockets": sockets });
  return { ok: true };
}

/** Remove a content from a Socket, recovering it (never destroyed) to `recoverTo` if given. No
 *  Activity. Returns the recovered content object. */
export async function removeSocketContent(item, socketIndex, recoverTo = null) {
  const sockets = (item.system.sockets ?? []).map((s) => ({ ...s }));
  const content = sockets[socketIndex]?.content ?? null;
  if (!content) return { error: "empty" };
  sockets[socketIndex] = { content: null };
  await item.update({ "system.sockets": sockets });
  if (recoverTo && content?.type) {
    const obj = foundry.utils.deepClone(content); delete obj._id;
    await recoverTo.createEmbeddedDocuments("Item", [obj]);
  }
  return { ok: true, content };
}

/* -------------------------------------------------------------------------- */
/*  Projects (rules doc "Projects")                                           */
/* -------------------------------------------------------------------------- */

export const CRAFT_PROJECTS_SETTING = "craftProjects";

/** The full Project list (a safe deep copy). GM-owned world setting; everyone reads. */
export function getProjects() {
  let raw = [];
  try { raw = game.settings.get("project-anime", CRAFT_PROJECTS_SETTING); } catch (_e) { /* not registered yet */ }
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}
export async function saveProjects(list) {
  return game.settings.set("project-anime", CRAFT_PROJECTS_SETTING, list);
}

/** A fresh Project of a given scope. The per-Stage bill comes from the scope benchmark (Personal is
 *  author-defined). */
export function blankProject(scope = "grand") {
  const def = PROJECTANIME.projectScopes[scope] ?? PROJECTANIME.projectScopes.grand;
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.localize("PROJECTANIME.Craft.project.new"),
    scope,
    stages: def.stages,
    done: 0,
    bill: foundry.utils.deepClone(def.bill),
    result: "",
    lastAdvanced: 0
  };
}

/** The material bill to advance one Stage of a Project (Steward: −1 Common, min 1). */
export function projectStageBill(project, actor = null) {
  const bill = (project.bill ?? []).map((c) => {
    // A scope bill entry lacks a `type` (types fit the work) — the ST fills them per project; if
    // unset, default Ore for Commons and Essence for Primes so it can still be paid.
    const type = c.type || (c.grade === "prime" ? "essence" : "ore");
    return { type, grade: c.grade || "common", qty: Number(c.qty) || 0 };
  });
  if (specialtyOf(actor) === "steward") {
    for (const c of bill) if (c.grade !== "prime") c.qty = Math.max(1, c.qty - 1);
  }
  return bill;
}

/** Advance one Stage of a Project: pay the Stage bill at party Tier, mark progress. `restStamp` is
 *  the current party rest marker (world time); a Project advances at most one Stage per rest.
 *  Returns { ok, done, total, finished } or { error }. */
export async function advanceProject(actor, projectId, restStamp = 0) {
  const list = getProjects();
  const p = list.find((x) => x.id === projectId);
  if (!p || !actor) return { error: "missing" };
  if (p.done >= p.stages) return { error: "done" };
  if (restStamp && p.lastAdvanced === restStamp) return { error: "oncePerRest" };
  const tier = partyTier();
  const bill = projectStageBill(p, actor);
  if (!canAfford(actor, bill, tier)) return { error: "material" };
  await spendCost(actor, bill, tier);
  p.done += 1;
  p.lastAdvanced = restStamp || p.lastAdvanced;
  await saveProjects(list);
  return { ok: true, done: p.done, total: p.stages, finished: p.done >= p.stages };
}
