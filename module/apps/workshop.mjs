/**
 * Project: Anime — the WORKSHOP (crafting storefront).
 *
 * Opened from a `workshop`-role HQ facility (the Codex Facilities tab / Structures window). Lists the
 * GM-authored recipes; crafting one spends the HQ resource stockpile and QUEUES a timed job that delivers
 * the output item to the party stash on a later HQ Turn (helpers/factions.mjs craftRecipe + advanceHQTurn).
 *
 * It mirrors the vendor ShopWindow: the GM authors recipes here (drop an output item, set the resource
 * cost, the minimum Workshop tier, prerequisite facilities, and the craft time); everyone with access
 * crafts. A player's craft RELAYS to the active GM over the system socket — gated GM-side by the
 * facility's `unlocked` flag — exactly like building a facility. The window re-renders on any HQ change
 * via the HQ setting's onChange (project-anime.mjs).
 */
import { getHQ, saveHQ, blankRecipe, craftRecipe, recipeCraftable, recipeCost } from "../helpers/factions.mjs";
import { getMaterialCategories, isImageIcon } from "../helpers/materials.mjs";
import { stampCompendiumSource } from "../helpers/gear.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const clampTier = (v) => Math.min(3, Math.max(0, Math.round(Number(v) || 0)));

export class WorkshopWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(facilityId, options = {}) {
    super({ ...options, id: `pa-workshop-${facilityId}` });
    this.facilityId = facilityId;
  }

  /** Open (or focus) the workshop for a workshop-role facility. */
  static open(facilityId) {
    const existing = foundry.applications.instances.get(`pa-workshop-${facilityId}`);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new WorkshopWindow(facilityId);
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "theme-dark", "pa-workshop"],
    position: { width: 720, height: 660 },
    window: { title: "PROJECTANIME.Workshop.title", icon: "fa-solid fa-screwdriver-wrench", resizable: true },
    actions: {
      craftItem: WorkshopWindow.#onCraft,
      addRecipe: WorkshopWindow.#onAddRecipe,
      removeRecipe: WorkshopWindow.#onRemoveRecipe,
      pickRecipeImage: WorkshopWindow.#onPickImage,
      addRequire: WorkshopWindow.#onAddRequire,
      removeRequire: WorkshopWindow.#onRemoveRequire
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/workshop.hbs", scrollable: [".wk-list"] }
  };

  get isGM() { return game.user.isGM; }

  /** The workshop facility (HQ facility entry), or null if it's been removed. */
  get facility() {
    return getHQ().facilities.find((e) => e.id === this.facilityId) ?? null;
  }

  get title() {
    const name = this.facility?.name || game.i18n.localize("PROJECTANIME.Workshop.title");
    return `${name} — ${game.i18n.localize("PROJECTANIME.Workshop.title")}`;
  }

  /** Signature of the HQ slice this window draws — lets notifyHQChanged skip a no-op re-render. */
  #hqSig = null;

  /** What this window renders from the HQ object: every facility (its own recipes + others' tier/name
   *  gate craftability; the Shop `stock` it never shows is dropped), the resource stockpile (cost +
   *  affordability), and the craft queue (jobs in progress). An HQ change to people / missions / a
   *  vendor's stock leaves this untouched — no flash. */
  #hqDigest() {
    const hq = getHQ();
    const facilities = (hq.facilities ?? []).map((f) => { const { stock, ...rest } = f; return rest; });
    return JSON.stringify({ facilities, resources: hq.resources, crafting: hq.crafting });
  }

  /** The HQ world object changed — re-render only if our slice moved (seamless-refresh entry point). */
  notifyHQChanged() {
    if (this.#hqDigest() === this.#hqSig) return;
    this.render(false);
  }

  async _prepareContext() {
    const hq = getHQ();
    const f = this.facility;
    if (!f) return { gone: true };
    const isGM = this.isGM;
    const resTypes = getMaterialCategories();                              // [{ key, label, icon }]
    const tier = clampTier(f.facilityTier);
    const isBuilt = tier >= 1;
    const canCraftHere = isGM || !!f.unlocked;                             // players craft only at an unlocked workshop
    const typeLabel = (t) => (t ? game.i18n.localize(`TYPES.Item.${t}`) : "");

    // Other facilities (the requires picker references buildings other than this workshop).
    const facilityOptions = hq.facilities
      .filter((x) => x.id !== this.facilityId)
      .map((x) => ({ id: x.id, name: x.name || game.i18n.localize("PROJECTANIME.HQ.facility") }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const facilityName = (id) => hq.facilities.find((x) => x.id === id)?.name || game.i18n.localize("PROJECTANIME.HQ.facility");

    const recipes = (f.recipes ?? []).map((r) => {
      const { ok, reason } = recipeCraftable(hq, f, r);
      const cost = recipeCost(r);
      const out = r.output || null;
      const costChips = resTypes.filter((c) => cost[c.key] > 0).map((c) => {
        const have = Math.max(0, Math.round(Number(hq.resources?.[c.key]) || 0));
        return { key: c.key, label: c.label, icon: c.icon, iconImg: isImageIcon(c.icon), amount: cost[c.key], have, enough: have >= cost[c.key] };
      });
      const costEdit = resTypes.map((c) => ({ key: c.key, label: c.label, icon: c.icon, iconImg: isImageIcon(c.icon), amount: Math.max(0, Math.round(Number(r.cost?.[c.key]) || 0)) }));
      const mt = clampTier(r.minTier);
      const requires = (r.requires ?? []).map((q, idx) => ({
        idx,
        facilityOptions: facilityOptions.map((o) => ({ ...o, sel: o.id === q.facilityId })),
        tierOptions: [1, 2, 3].map((n) => ({ n, sel: n === q.tier }))
      }));
      const craftReady = ok && !!out && canCraftHere;
      let lockReason = "";
      if (!ok) lockReason = reason;
      else if (!out) lockReason = game.i18n.localize("PROJECTANIME.Workshop.setOutput");
      else if (!canCraftHere) lockReason = game.i18n.localize("PROJECTANIME.Workshop.notOpen");
      return {
        id: r.id,
        name: r.name || "",
        img: r.img || out?.img || "icons/svg/item-bag.svg",
        hasOutput: !!out,
        output: out ? { name: out.name || "—", img: out.img || "icons/svg/item-bag.svg", typeLabel: typeLabel(out.type) } : null,
        costChips,
        hasCost: costChips.length > 0,
        costEdit,
        minTier: mt,
        minTierOptions: [0, 1, 2, 3].map((n) => ({ n, sel: n === mt })),
        craftTime: Math.max(1, Math.round(Number(r.craftTime) || 1)),
        requires,
        canCraft: craftReady,
        lockReason
      };
    });

    // Jobs in progress AT this workshop.
    const jobs = (hq.crafting ?? []).filter((j) => j.facilityId === this.facilityId).map((j) => {
      const left = Math.max(0, Math.round(Number(j.turnsLeft) || 0));
      return { id: j.id, name: j.name || game.i18n.localize("PROJECTANIME.Workshop.recipeUntitled"), img: j.img || j.output?.img || "icons/svg/item-bag.svg", readyLabel: game.i18n.format("PROJECTANIME.Workshop.readyIn", { n: left }) };
    });

    return {
      gone: false,
      isGM,
      workshop: { name: f.name || game.i18n.localize("PROJECTANIME.Workshop.title"), img: f.img || "icons/svg/mystery-man.svg" },
      tier,
      tierPips: [1, 2, 3].map((n) => ({ n, on: n <= tier })),
      notBuilt: !isBuilt,
      hasFacilityOptions: facilityOptions.length > 0,
      recipes,
      hasRecipes: recipes.length > 0,
      jobs,
      hasJobs: jobs.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this.#hqSig = this.#hqDigest();      // remember what we just drew (seamless-refresh gate)
    if (!this.isGM) return;
    // GM authoring: recipe field edits, per-resource cost editor, requirement edits, output drop zones.
    for (const el of root.querySelectorAll("[data-recipe-field]")) el.addEventListener("change", this.#onRecipeField.bind(this));
    for (const el of root.querySelectorAll("[data-recipe-cost]")) el.addEventListener("change", this.#onRecipeCost.bind(this));
    for (const el of root.querySelectorAll("[data-require-field]")) el.addEventListener("change", this.#onRequireField.bind(this));
    for (const zone of root.querySelectorAll("[data-output-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onOutputDrop(ev, zone.dataset.outputDrop); });
    }
  }

  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** Mutate one recipe in this workshop facility (GM only), persist; the HQ onChange re-renders. */
  async #mutateRecipe(recipeId, fn) {
    if (!this.isGM) return;
    const hq = getHQ();
    const f = hq.facilities.find((x) => x.id === this.facilityId);
    if (!f) return;
    const r = (f.recipes ??= []).find((x) => x.id === recipeId);
    if (!r) return;
    fn(r);
    await saveHQ(hq);
  }

  /* --------------------------------- actions --------------------------------- */

  /** Craft a recipe — the GM crafts directly; a player relays to the active GM (validated there). */
  static async #onCraft(event, target) {
    const recipeId = target.closest("[data-recipe-id]")?.dataset.recipeId;
    if (!recipeId) return;
    if (this.isGM) { await craftRecipe(this.facilityId, recipeId); return; }
    game.socket.emit("system.project-anime", { type: "craftRecipe", facilityId: this.facilityId, recipeId, userId: game.user.id });
  }

  /** Add a fresh blank recipe (GM). */
  static async #onAddRecipe() {
    if (!this.isGM) return;
    const hq = getHQ();
    const f = hq.facilities.find((x) => x.id === this.facilityId);
    if (!f) return;
    (f.recipes ??= []).push(blankRecipe());
    await saveHQ(hq);
  }

  /** Remove a recipe (GM). */
  static async #onRemoveRecipe(event, target) {
    if (!this.isGM) return;
    const recipeId = target.closest("[data-recipe-id]")?.dataset.recipeId;
    const hq = getHQ();
    const f = hq.facilities.find((x) => x.id === this.facilityId);
    if (!f) return;
    f.recipes = (f.recipes ?? []).filter((r) => r.id !== recipeId);
    await saveHQ(hq);
  }

  /** Pick a recipe's display icon (GM). */
  static async #onPickImage(event, target) {
    if (!this.isGM) return;
    const recipeId = target.closest("[data-recipe-id]")?.dataset.recipeId;
    const cur = this.facility?.recipes?.find((r) => r.id === recipeId)?.img ?? "";
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateRecipe(recipeId, (r) => { r.img = path; }) }).browse();
  }

  /** Add a facility requirement to a recipe (GM) — defaults to the first other facility at tier 1. */
  static async #onAddRequire(event, target) {
    if (!this.isGM) return;
    const recipeId = target.closest("[data-recipe-id]")?.dataset.recipeId;
    const first = getHQ().facilities.find((x) => x.id !== this.facilityId);
    if (!first) return;
    await this.#mutateRecipe(recipeId, (r) => { (r.requires ??= []).push({ facilityId: first.id, tier: 1 }); });
  }

  /** Remove a facility requirement (GM). */
  static async #onRemoveRequire(event, target) {
    if (!this.isGM) return;
    const recipeId = target.closest("[data-recipe-id]")?.dataset.recipeId;
    const idx = Number(target.dataset.requireIdx);
    await this.#mutateRecipe(recipeId, (r) => { if (Array.isArray(r.requires)) r.requires.splice(idx, 1); });
  }

  /* --------------------------------- field handlers --------------------------------- */

  async #onRecipeField(event) {
    const el = event.currentTarget;
    const recipeId = el.closest("[data-recipe-id]")?.dataset.recipeId;
    const field = el.dataset.recipeField;
    if (!recipeId || !field) return;
    const val = el.value;
    return this.#mutateRecipe(recipeId, (r) => {
      if (field === "name") r.name = val;
      else if (field === "minTier") r.minTier = clampTier(val);
      else if (field === "craftTime") r.craftTime = Math.max(1, Math.round(Number(val) || 1));
    });
  }

  async #onRecipeCost(event) {
    const el = event.currentTarget;
    const recipeId = el.closest("[data-recipe-id]")?.dataset.recipeId;
    const key = el.dataset.recipeCost;
    if (!recipeId || !key) return;
    const val = Math.max(0, Math.round(Number(el.value) || 0));
    return this.#mutateRecipe(recipeId, (r) => { r.cost ??= {}; if (val > 0) r.cost[key] = val; else delete r.cost[key]; });
  }

  async #onRequireField(event) {
    const el = event.currentTarget;
    const recipeId = el.closest("[data-recipe-id]")?.dataset.recipeId;
    const idx = Number(el.dataset.requireIdx);
    const field = el.dataset.requireField;
    if (!recipeId || !field || Number.isNaN(idx)) return;
    const val = el.value;
    return this.#mutateRecipe(recipeId, (r) => {
      if (!Array.isArray(r.requires) || !r.requires[idx]) return;
      if (field === "facilityId") r.requires[idx].facilityId = val;
      else if (field === "tier") r.requires[idx].tier = Math.min(3, Math.max(1, Math.round(Number(val) || 1)));
    });
  }

  /** Drop an Item onto a recipe's output slot → store a snapshot as the crafted result (GM). */
  async #onOutputDrop(event, recipeId) {
    if (!this.isGM || !recipeId) return;
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    stampCompendiumSource(snap, item);
    return this.#mutateRecipe(recipeId, (r) => { r.output = snap; if (!r.name) r.name = snap.name || ""; if (!r.img) r.img = snap.img || ""; });
  }
}
