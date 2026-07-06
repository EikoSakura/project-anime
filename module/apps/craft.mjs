/**
 * Project: Anime — the Craft Workbench (rules doc "Crafting", v0.03).
 *
 * A character's downtime crafting bench: Forge gear, apply/remove Traits, Temper, Brew consumables,
 * and advance Projects. Crafting never rolls and never fails — each operation just spends its bill
 * (Gold + carried materials) and one Craft Activity (a Downtime Slot spent at a rest). Sockets place/
 * remove at no Activity. In a Town no tools are needed; outside a Town it wants an Artisan's Kit and
 * the Fieldcrafter Specialty (a soft advisory — the ST adjudicates location).
 *
 * Opened from the actor sheet. A "crafter" is chosen (default the opener; the GM may craft as any
 * party member or the party stash); materials, Gold, and produced Items live on that actor.
 */
import { getCreationConfig } from "../helpers/creation.mjs";
import { partyMembers, partyActors } from "../helpers/party-folder.mjs";
import { partyTier, tierNumeral } from "../helpers/chronicle.mjs";
import { PROJECTANIME } from "../helpers/config.mjs";
import { elementChoices } from "../helpers/elements.mjs";
import {
  materialItems, materialTypeLabel, materialGradeLabel, specialtyOf,
  canAfford, forgeCost, forgeGear, matchingType,
  traitAppliesTo, traitCost, itemTraits, applyTrait, removeTrait,
  temperCap, temperCost, temperItem,
  brewBatchSize, brew,
  getProjects, blankProject, saveProjects, projectStageBill, advanceProject, hasArtisansKit,
  removeSocketContent
} from "../helpers/crafting.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GEAR_KINDS = ["weapon", "shield", "armor"];

export class CraftApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-craft-${actor.id}` });
    this._openerId = actor.id;
    this.#crafterId = actor.id;
  }

  static open(actor) {
    const id = `pa-craft-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new CraftApp(actor);
    app.render(true);
    return app;
  }

  /** Resolve a sensible default crafter when the Workbench is opened without a bound actor (e.g. from
   *  the Headquarters). GM → first party member, else the party actor; player → their first owned
   *  character. The crafter can still be switched inside the window via its picker. */
  static defaultCrafter() {
    if (game.user.isGM) {
      const party = partyActors()[0] ?? null;
      return (party ? partyMembers(party)[0] : null) ?? party ?? null;
    }
    return (game.actors ?? []).find((a) => a.type === "character" && a.isOwner) ?? null;
  }

  /** Open the Workbench from a context with no bound actor (the Headquarters). */
  static openForParty() {
    const actor = CraftApp.defaultCrafter();
    if (!actor) { ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Craft.noCrafter")); return null; }
    return CraftApp.open(actor);
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "theme-dark", "craft-app"],
    position: { width: 720, height: 660 },
    window: { title: "PROJECTANIME.Craft.title", icon: "fa-solid fa-hammer", resizable: true },
    actions: {
      pickTab: CraftApp.#onPickTab,
      forgeItem: CraftApp.#onForge,
      selectTraitItem: CraftApp.#onSelectTraitItem,
      applyTrait: CraftApp.#onApplyTrait,
      removeTrait: CraftApp.#onRemoveTrait,
      unsocket: CraftApp.#onUnsocket,
      temperItem: CraftApp.#onTemper,
      brewRecipe: CraftApp.#onBrew,
      newProject: CraftApp.#onNewProject,
      advanceProject: CraftApp.#onAdvanceProject,
      abandonProject: CraftApp.#onAbandonProject
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/craft.hbs", scrollable: [".craft-scroll"] }
  };

  #crafterId = null;
  #tab = "forge";
  #traitItemId = null;
  #compendiumCache = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.Craft.title")} — ${this.#crafter()?.name ?? ""}`;
  }

  /* ---------- Crafter resolution (mirrors the Shop's buyer picker) ---------- */

  #crafterOptions() {
    const out = [];
    const party = partyActors()[0] ?? null;
    if (game.user.isGM) {
      for (const m of (party ? partyMembers(party) : [])) out.push({ id: m.id, name: m.name, actor: m });
      if (party) out.push({ id: party.id, name: party.name, actor: party });
    } else {
      for (const a of game.actors ?? []) if (a.type === "character" && a.isOwner) out.push({ id: a.id, name: a.name, actor: a });
    }
    return out;
  }

  #crafter(options) {
    const opts = options ?? this.#crafterOptions();
    if (!opts.length) return null;
    const pick = opts.find((o) => o.id === this.#crafterId) ?? opts[0];
    this.#crafterId = pick.id;
    return pick.actor;
  }

  /* ---------- Materials strip ---------- */

  #materialRows(actor) {
    return materialItems(actor)
      .map((i) => ({
        grade: i.system.grade, category: i.system.category, tier: Number(i.system.tier) || 1,
        qty: Number(i.system.quantity) || 0,
        gradeLabel: materialGradeLabel(i.system.grade), typeLabel: materialTypeLabel(i.system.category),
        tierRoman: tierNumeral(Number(i.system.tier) || 1),
        icon: PROJECTANIME.materialTypeIcons[i.system.category], prime: i.system.grade === "prime"
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.tier - b.tier || a.grade.localeCompare(b.grade));
  }

  /* ---------- Forge catalogue ---------- */

  async #forgeStock() {
    if (this.#compendiumCache) return this.#compendiumCache;
    const { packs } = getCreationConfig();
    const open = new Set(packs);
    const out = [];
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item" || !open.has(pack.collection)) continue;
      try {
        for (const item of await pack.getDocuments()) {
          if (!GEAR_KINDS.includes(item.type)) continue;
          out.push(item.toObject());
        }
      } catch (_e) { /* unreadable pack — skip */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    this.#compendiumCache = out;
    return out;
  }

  /* ---------- Context ---------- */

  async _prepareContext() {
    const L = (k) => game.i18n.localize(k);
    const opts = this.#crafterOptions();
    const crafter = this.#crafter(opts);
    if (!crafter) return { noCrafter: true };
    const tier = partyTier();
    const slots = Number(crafter.getFlag("project-anime", "craftSlots")) || 0;
    const isGM = game.user.isGM;
    const spec = specialtyOf(crafter);
    const costRow = (cost) => cost.map((c) => ({
      qty: c.qty, typeLabel: materialTypeLabel(c.type),
      gradeLabel: c.grade === "prime" ? materialGradeLabel("prime") : "", prime: c.grade === "prime"
    }));

    const ctx = {
      isGM,
      crafters: opts.map((o) => ({ id: o.id, name: o.name, sel: o.id === this.#crafterId })),
      crafterName: crafter.name, crafterImg: crafter.img,
      gold: Number(crafter.system.gold) || 0,
      slots, hasSlots: slots > 0 || isGM,
      slotsText: game.i18n.format("PROJECTANIME.Craft.slots", { n: slots }),
      tier, tierRoman: tierNumeral(tier),
      specialtyLabel: spec ? L(`PROJECTANIME.Specialty.name.${spec}`) : L("PROJECTANIME.Specialty.none"),
      gateOk: crafter.getFlag("project-anime", "lastRestTown") || (spec === "fieldcrafter" && hasArtisansKit(crafter)),
      materials: this.#materialRows(crafter),
      hasMaterials: materialItems(crafter).length > 0,
      tab: this.#tab,
      tabForge: this.#tab === "forge", tabTrait: this.#tab === "trait",
      tabTemper: this.#tab === "temper", tabBrew: this.#tab === "brew", tabProject: this.#tab === "project"
    };

    // FORGE
    if (this.#tab === "forge") {
      const stock = await this.#forgeStock();
      ctx.forge = stock.map((snap, idx) => {
        const { gold, material } = forgeCost(snap, crafter);
        return {
          idx, name: snap.name, img: snap.img, type: snap.type,
          typeLabel: L(`TYPES.Item.${snap.type}`),
          gold, matQty: material[0].qty, matType: materialTypeLabel(material[0].type),
          affordable: (Number(crafter.system.gold) || 0) >= gold && canAfford(crafter, material, tier)
        };
      });
      ctx.hasForge = ctx.forge.length > 0;
    }

    // TRAITS
    if (this.#tab === "trait") {
      const items = crafter.items.filter((i) => GEAR_KINDS.includes(i.type) && !i.getFlag?.("project-anime", "natural"));
      ctx.traitItems = items.map((i) => ({ id: i.id, name: i.name, img: i.img, typeLabel: L(`TYPES.Item.${i.type}`), sel: i.id === this.#traitItemId }));
      const item = items.find((i) => i.id === this.#traitItemId) ?? items[0] ?? null;
      if (item) {
        this.#traitItemId = item.id;
        const traits = itemTraits(item);
        ctx.selItem = {
          id: item.id, name: item.name, type: item.type,
          flaw: item.system.flaw || "",
          capMax: PROJECTANIME.gearTraitCap, capUsed: traits.length,
          traits: traits.map((t) => ({
            key: t.key, label: L(`PROJECTANIME.GearTrait.name.${t.key}`),
            effect: L(`PROJECTANIME.GearTrait.effect.${t.key}`),
            param: t.element || t.disguise || t.status || ""
          })),
          sockets: (item.system.sockets ?? []).map((s, idx) => ({
            idx, filled: !!s.content, name: s.content?.name || L("PROJECTANIME.Socket.empty")
          }))
        };
        // Available traits: applies to this kind, not already on it, cap not full.
        const full = traits.length >= PROJECTANIME.gearTraitCap;
        ctx.availTraits = PROJECTANIME.gearTraitKeys
          .filter((k) => traitAppliesTo(k, item.type) && !traits.some((t) => t.key === k))
          .map((k) => {
            const cost = traitCost(k, crafter);
            const def = PROJECTANIME.gearTraits[k];
            return {
              key: k, label: L(`PROJECTANIME.GearTrait.name.${k}`), effect: L(`PROJECTANIME.GearTrait.effect.${k}`),
              cost: costRow(cost), needs: def.needs || "",
              needsElement: def.needs === "element", needsDisguise: def.needs === "disguise", needsStatus: def.needs === "status",
              affordable: !full && canAfford(crafter, cost, tier), full
            };
          });
      }
      ctx.elements = Object.entries(elementChoices()).map(([key, label]) => ({ key, label }));
      ctx.statuses = PROJECTANIME.statusConditions.map((s) => ({ id: s.id, label: L(s.name) }));
    }

    // TEMPER — capped by the CRAFTER's own Tier (doc v0.03 revised: the owner's Tier − 1).
    if (this.#tab === "temper") {
      const cap = temperCap(crafter);
      ctx.temperCapRoman = tierNumeral(cap + 1);
      ctx.temperCap = cap;
      ctx.temperItems = crafter.items.filter((i) => GEAR_KINDS.includes(i.type) && !i.getFlag?.("project-anime", "natural")).map((i) => {
        const cur = Number(i.system.temper) || 0;
        const cost = temperCost(i);
        return {
          id: i.id, name: i.name, img: i.img, level: cur, cap, atCap: cur >= cap,
          gain: i.type === "armor" ? L("PROJECTANIME.Field.protection") : L("PROJECTANIME.Field.damage"),
          cost: costRow(cost), affordable: cur < cap && canAfford(crafter, cost, tier)
        };
      });
      ctx.hasTemper = ctx.temperItems.length > 0;
    }

    // BREW
    if (this.#tab === "brew") {
      const batch = brewBatchSize(crafter);
      ctx.brewBatch = batch;
      ctx.recipes = PROJECTANIME.brewRecipeKeys.map((k) => {
        const r = PROJECTANIME.brewRecipes[k];
        return {
          key: k, name: L(`PROJECTANIME.Brew.name.${k}`), effect: L(`PROJECTANIME.Brew.effect.${k}`),
          tierRoman: tierNumeral(r.tier),
          cost: costRow(r.cost), affordable: canAfford(crafter, r.cost, r.tier)
        };
      });
    }

    // PROJECTS
    if (this.#tab === "project") {
      ctx.projects = getProjects().map((p) => {
        const bill = projectStageBill(p, crafter);
        return {
          id: p.id, name: p.name, scopeLabel: L(`PROJECTANIME.Craft.project.scopeName.${p.scope}`),
          done: p.done, total: p.stages, pct: Math.round((p.done / (p.stages || 1)) * 100),
          finished: p.done >= p.stages, result: p.result || "",
          cost: costRow(bill),
          canAdvance: p.done < p.stages && canAfford(crafter, bill, tier)
        };
      });
      ctx.projectScopes = PROJECTANIME.projectScopeKeys.map((k) => ({ key: k, label: L(`PROJECTANIME.Craft.project.scopeName.${k}`) }));
    }

    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    const sel = root.querySelector('[data-craft="crafter"]');
    if (sel) sel.addEventListener("change", (ev) => { this.#crafterId = ev.target.value; this.#traitItemId = null; this.render(false); });
    const item = root.querySelector('[data-craft="traitItem"]');
    if (item) item.addEventListener("change", (ev) => { this.#traitItemId = ev.target.value; this.render(false); });
  }

  /* ---------- Slot spend ---------- */

  /** A Craft Activity is a Downtime Slot spent at a rest. Players need one; the GM may always craft.
   *  Returns true if the operation may proceed (and decrements a held slot). */
  async #spendSlot(crafter) {
    const slots = Number(crafter.getFlag("project-anime", "craftSlots")) || 0;
    if (slots <= 0 && !game.user.isGM) { ui.notifications.warn(game.i18n.localize("PROJECTANIME.Craft.noSlots")); return false; }
    if (slots > 0) await crafter.setFlag("project-anime", "craftSlots", slots - 1);
    return true;
  }

  /* ---------- Actions ---------- */

  static #onPickTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab || tab === this.#tab) return;
    this.#tab = tab;
    this.render(false);
  }

  static async #onForge(event, target) {
    const crafter = this.#crafter();
    const stock = await this.#forgeStock();
    const snap = stock[Number(target.dataset.idx)];
    if (!crafter || !snap) return;
    if (!(await this.#spendSlot(crafter))) return;
    const res = await forgeGear(crafter, snap);
    if (res?.error) { this.#warnCost(res.error); await this.#refundSlot(crafter); return; }
    ui.notifications.info(game.i18n.format("PROJECTANIME.Craft.forged", { name: res.item?.name ?? snap.name }));
    this.render(false);
  }

  static #onSelectTraitItem(event, target) {
    this.#traitItemId = target.dataset.id;
    this.render(false);
  }

  static async #onApplyTrait(event, target) {
    const crafter = this.#crafter();
    const item = crafter?.items.get(this.#traitItemId);
    const key = target.dataset.key;
    if (!crafter || !item || !key) return;
    // Read a needed parameter from the row (Attuned element / Concealed disguise / Warded status).
    const row = target.closest(".craft-trait-row");
    const params = {
      element: row?.querySelector('[data-param="element"]')?.value || "",
      disguise: row?.querySelector('[data-param="disguise"]')?.value || "",
      status: row?.querySelector('[data-param="status"]')?.value || ""
    };
    if (!(await this.#spendSlot(crafter))) return;
    const res = await applyTrait(crafter, item, key, params);
    if (res?.error) { this.#warnTrait(res.error); await this.#refundSlot(crafter); return; }
    ui.notifications.info(game.i18n.format("PROJECTANIME.Craft.applied", { trait: game.i18n.localize(`PROJECTANIME.GearTrait.name.${key}`), name: item.name }));
    this.render(false);
  }

  static async #onRemoveTrait(event, target) {
    const crafter = this.#crafter();
    const item = crafter?.items.get(this.#traitItemId);
    const key = target.dataset.key;
    if (!crafter || !item || !key) return;
    if (!(await this.#spendSlot(crafter))) return;
    const res = await removeTrait(crafter, item, key);
    if (res?.error) { await this.#refundSlot(crafter); return; }
    ui.notifications.info(game.i18n.format("PROJECTANIME.Craft.removedTrait", { trait: game.i18n.localize(`PROJECTANIME.GearTrait.name.${key}`), name: item.name }));
    this.render(false);
  }

  static async #onUnsocket(event, target) {
    // Removing a Socket CONTENT (not the Socket) — no Activity; the content is recovered to the crafter.
    const crafter = this.#crafter();
    const item = crafter?.items.get(this.#traitItemId);
    if (!crafter || !item) return;
    const res = await removeSocketContent(item, Number(target.dataset.idx), crafter);
    if (res?.content) ui.notifications.info(game.i18n.format("PROJECTANIME.Socket.recovered", { name: res.content.name }));
    this.render(false);
  }

  static async #onTemper(event, target) {
    const crafter = this.#crafter();
    const item = crafter?.items.get(target.dataset.id);
    if (!crafter || !item) return;
    if (!(await this.#spendSlot(crafter))) return;
    const res = await temperItem(crafter, item);
    if (res?.error) { this.#warnCost(res.error); await this.#refundSlot(crafter); return; }
    ui.notifications.info(game.i18n.format("PROJECTANIME.Craft.tempered", { name: item.name, n: res.level }));
    this.render(false);
  }

  static async #onBrew(event, target) {
    const crafter = this.#crafter();
    const key = target.dataset.key;
    if (!crafter || !key) return;
    if (!(await this.#spendSlot(crafter))) return;
    const res = await brew(crafter, key);
    if (res?.error) { this.#warnCost(res.error); await this.#refundSlot(crafter); return; }
    ui.notifications.info(game.i18n.format("PROJECTANIME.Brew.brewed", { n: res.n, name: game.i18n.localize(`PROJECTANIME.Brew.name.${key}`) }));
    this.render(false);
  }

  static async #onNewProject(event, target) {
    if (!game.user.isGM) return;
    const scope = target.dataset.scope || "grand";
    const list = getProjects();
    list.push(blankProject(scope));
    await saveProjects(list);
  }

  static async #onAdvanceProject(event, target) {
    // Advancing writes the world-scoped Projects list, so it's GM-driven (the GM picks the crafter,
    // whose materials are spent). The other operations touch only owned actors and are player-usable.
    if (!game.user.isGM) return;
    const crafter = this.#crafter();
    if (!crafter) return;
    if (!(await this.#spendSlot(crafter))) return;
    const restStamp = Number(crafter.getFlag("project-anime", "lastRestAt")) || 0;
    const res = await advanceProject(crafter, target.dataset.id, restStamp);
    if (res?.error) {
      if (res.error === "oncePerRest") ui.notifications.warn(game.i18n.localize("PROJECTANIME.Craft.project.oncePerRest"));
      else this.#warnCost(res.error);
      await this.#refundSlot(crafter);
      return;
    }
    const p = getProjects().find((x) => x.id === target.dataset.id);
    ui.notifications.info(game.i18n.format(res.finished ? "PROJECTANIME.Craft.finished" : "PROJECTANIME.Craft.advanced",
      { name: p?.name ?? "", done: res.done, total: res.total }));
    this.render(false);
  }

  static async #onAbandonProject(event, target) {
    if (!game.user.isGM) return;
    const list = getProjects().filter((p) => p.id !== target.dataset.id);
    await saveProjects(list);
  }

  /* ---------- Helpers ---------- */

  /** Refund a slot spent on an operation that then failed its affordability check. */
  async #refundSlot(crafter) {
    if (game.user.isGM) return; // GM crafts never consumed a real slot
    const slots = Number(crafter.getFlag("project-anime", "craftSlots")) || 0;
    await crafter.setFlag("project-anime", "craftSlots", slots + 1);
  }

  #warnCost(error) {
    ui.notifications.warn(game.i18n.localize(error === "gold" ? "PROJECTANIME.Craft.shortGold" : "PROJECTANIME.Craft.short"));
  }
  #warnTrait(error) {
    const map = {
      accessory: "PROJECTANIME.Craft.accessoryNoTrait",
      cap: "PROJECTANIME.Craft.traitCapFull",
      has: "PROJECTANIME.Craft.traitHas",
      material: "PROJECTANIME.Craft.short"
    };
    ui.notifications.warn(game.i18n.localize(map[error] || "PROJECTANIME.Craft.short"));
  }
}
