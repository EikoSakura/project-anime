/**
 * Project: Anime — the STRUCTURES window.
 *
 * Opened from the Codex Home/Facilities tab (the "Structures" button) — a standalone manager for the
 * party HQ's buildings. It is the single home for everything structure-related: the GM creates and
 * configures each structure (kind, build cost, per-turn output, boon, service/vendor/upgrade), and
 * everyone BUILDS from here. A structure is just a facility at tier 0 (an unbuilt blueprint); Building
 * spends resources to raise it 0→1→…→3, and a built facility (tier ≥ 1) is an active building.
 *
 * Layout is master-detail: a left rail lists facilities under two headers — "Structures" (tier 0,
 * buildable) over "Built" (tier ≥ 1, active) — and the right pane shows the selected facility's book
 * (full GM authoring, or a read-only summary + Build button for players). Selection is pure DOM
 * (no re-render) so authoring inputs keep focus.
 *
 * The window reuses the Codex's `.pa-hq` styling (its root carries that class), reads/writes the same
 * world HQ object via getHQ/saveHQ, and shares the build path: a GM builds directly; a player relays
 * the build to the active GM over the system socket (validated GM-side against the `unlocked` flag).
 * An HQ change routes through notifyHQChanged (digest-gated) so a no-op change doesn't flash; the GM's
 * own high-frequency authoring edits save QUIETLY and patch the live DOM in place (no re-render) —
 * structural ops (role/build/tier/staff/new/delete) still take a full re-render. See codex.mjs.
 */
import { getHQ, saveHQ, blankFacility, buildFacility, assignStaff, unassignStaff, facilityStaffCap } from "../helpers/factions.mjs";
import { EffectBuilder } from "./effect-builder.mjs";
import { ShopWindow } from "./shop.mjs";
import { WorkshopWindow } from "./workshop.mjs";
import { summarizeRule, normalizeRule, scaleRuleByTier, collectGather } from "../helpers/effects.mjs";
import { getMaterialCategories, isImageIcon, materialCategoryLabel } from "../helpers/materials.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Facility KINDS — what a building is (mirrors codex.mjs). */
const FACILITY_KINDS = ["service", "vendor", "passive", "upgrade", "workshop"];
/** What a `service` facility restores to the party each HQ Turn. */
const SERVICE_KINDS = ["restoreHP", "restoreEnergy", "fullRest", "cleanse"];
/** Attributes a legacy attribute-only boon can buff. */
const BOON_ATTRS = ["might", "agility", "mind", "spirit", "charm"];

const initialOf = (name) => String(name || "?").trim().charAt(0).toUpperCase() || "?";

/** Kind <select> options, alphabetical by label, `cur` marked selected. */
const kindOptions = (cur) => FACILITY_KINDS
  .map((k) => ({ key: k, label: game.i18n.localize(`PROJECTANIME.Covenant.role.${k}`), sel: k === cur }))
  .sort((a, b) => a.label.localeCompare(b.label));

export class StructuresWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Open (or focus) the single Structures window, optionally pre-selecting a facility. */
  static open(selectId = null) {
    const existing = foundry.applications.instances.get("pa-structures");
    if (existing) {
      if (selectId) existing.select(selectId);
      existing.render();
      existing.bringToFront();
      return existing;
    }
    const app = new StructuresWindow();
    if (selectId) app.#selId = selectId;
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    id: "pa-structures",
    classes: ["project-anime", "theme-dark", "pa-hq", "pa-structures"],
    position: { width: 760, height: 620 },
    window: { title: "PROJECTANIME.HQ.structures", icon: "fa-solid fa-helmet-safety", resizable: true },
    actions: {
      selectStructure: StructuresWindow.#onSelectStructure,
      openPool: StructuresWindow.#onOpenPool,
      newStructure: StructuresWindow.#onNewStructure,
      buildFacility: StructuresWindow.#onBuildFacility,
      setFacilityTier: StructuresWindow.#onSetFacilityTier,
      editBoon: StructuresWindow.#onEditBoon,
      removeYieldItem: StructuresWindow.#onRemoveYieldItem,
      visitShop: StructuresWindow.#onVisitShop,
      visitWorkshop: StructuresWindow.#onVisitWorkshop,
      pickStructureImage: StructuresWindow.#onPickImage,
      openStructureActor: StructuresWindow.#onOpenActor,
      removeStructure: StructuresWindow.#onRemoveStructure,
      assignStaff: StructuresWindow.#onAssignStaff,
      unassignStaff: StructuresWindow.#onUnassignStaff,
      toggleAccept: StructuresWindow.#onToggleAccept
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/structures.hbs", scrollable: [".struct-rail", ".struct-detail-wrap"] }
  };

  /** Selected facility id (transient; survives re-render — re-validated in _prepareContext). */
  #selId = null;

  /** Signature of the HQ slice this window draws — lets notifyHQChanged skip a no-op re-render. */
  #hqSig = null;

  /** Arm exactly one render to be skipped — a quiet (DOM-patched) authoring edit eats the onChange
   *  re-render it triggered, so adjusting a field doesn't flash the whole window. Mirrors codex.mjs. */
  #skipRenderOnce = false;

  get isGM() { return game.user.isGM; }

  /** What this window renders from the HQ object: the facilities (minus the Workshop `recipes` / Shop
   *  `stock` / the facility `img`, none of which it draws — rail + head use the role icon), the resource
   *  stockpile, the people (for staffing), and the HQ accent (its theme tint). An HQ change that touches
   *  only missions / the craft queue / a recipe / a facility image / the turn leaves this untouched, so
   *  no flash (and a quiet image pick here genuinely early-returns rather than swallowing a render). */
  #hqDigest() {
    const hq = getHQ();
    const facilities = (hq.facilities ?? []).map((f) => { const { recipes, stock, img, ...rest } = f; return rest; });
    return JSON.stringify({ facilities, resources: hq.resources, people: hq.people, accent: hq.accent });
  }

  /** The HQ world object changed — re-render only if our slice moved (seamless-refresh entry point).
   *  When we DON'T render, consume any pending one-shot skip: a quiet edit that reverts a field to the
   *  last-rendered value leaves the digest === sig, so this early-returns without rendering — the armed
   *  flag would otherwise leak and silently swallow the next legitimate render (codex.mjs CRITICAL FIX). */
  notifyHQChanged() {
    if (this.#hqDigest() === this.#hqSig) { this.#skipRenderOnce = false; return; }
    this.render(false);
  }

  /** Skip exactly one render (see #skipRenderOnce) so a quiet HQ save doesn't flash the window. */
  render(...args) {
    if (this.#skipRenderOnce) { this.#skipRenderOnce = false; return this; }
    return super.render(...args);
  }

  /** Set the selected facility and reflect it on the live DOM (no re-render). */
  select(id) {
    this.#selId = id;
    this.#applySelection();
  }

  /* --------------------------------- context --------------------------------- */

  /** The per-facility view-model the rail + detail book consume (mirrors codex.mjs facility map). */
  #facilityVM(e, { resTypes, hqResources, facilityList, people }) {
    const tier = Math.min(3, Math.max(0, Number(e.facilityTier) || 0));
    const maxed = tier >= 3;
    const nextTier = tier + 1;
    const costEdit = resTypes.map((c) => ({ key: c.key, label: c.label, icon: c.icon, iconImg: isImageIcon(c.icon), amount: Math.max(0, Math.round(Number(e.cost?.[c.key]) || 0)) }));
    const nextCost = [];
    let affordable = true;
    if (!maxed) {
      for (const c of resTypes) {
        const base = Math.max(0, Math.round(Number(e.cost?.[c.key]) || 0));
        if (base <= 0) continue;
        const amt = base * nextTier;
        const enough = Math.max(0, Math.round(Number(hqResources?.[c.key]) || 0)) >= amt;
        if (!enough) affordable = false;
        nextCost.push({ key: c.key, label: c.label, icon: c.icon, iconImg: isImageIcon(c.icon), amount: amt, enough });
      }
    }
    const yieldGold = Math.max(0, Math.round(Number(e.yieldGold) || 0));
    const yieldSP = Math.max(0, Math.round(Number(e.yieldSP) || 0));
    const yieldItems = (e.yieldItems ?? []).map((o, idx) => ({ idx, name: o?.name ?? "—", img: o?.img ?? "icons/svg/item-bag.svg" }));
    const isService = e.role === "service";
    const isVendor = e.role === "vendor";
    const isPassive = e.role === "passive";
    const isUpgrade = e.role === "upgrade";
    const isWorkshop = e.role === "workshop";
    const upgradeTarget = e.upgradeTarget || "";
    const targetOptions = isUpgrade
      ? facilityList.filter((f) => f.id !== e.id).map((f) => ({ id: f.id, name: f.name, sel: f.id === upgradeTarget })).sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const upgradeTargetName = facilityList.find((f) => f.id === upgradeTarget)?.name || "";
    const serviceKind = e.serviceKind || "";
    // Phase-2 staffing (multiple by tier): the residents posted here (capacity = tier) + the idle pool
    // you can station. Capacity = tier.
    const cap = facilityStaffCap(e);
    const staff = (e.staffIds ?? [])
      .map((pid) => people.find((p) => p.id === pid && p.recruited))
      .filter(Boolean)
      .map((p) => ({ id: p.id, npcUuid: p.npcUuid, name: p.name || "—", img: p.img || "icons/svg/mystery-man.svg", initial: initialOf(p.name), present: p.status !== "away" }));
    const presentCount = staff.filter((s) => s.present).length;
    const staffed = presentCount > 0;
    const emptyCount = Math.max(0, cap - staff.length);
    const emptySlots = Array.from({ length: emptyCount }, (_, i) => ({ i }));
    const staffPool = people
      .filter((p) => p.recruited && p.status !== "away" && !p.facilityId)
      .map((p) => ({ id: p.id, name: p.name || "—", img: p.img || "icons/svg/mystery-man.svg", initial: initialOf(p.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Phase-3 gathering: the resources this facility ACCEPTS (GM toggles), and a live preview of what its
    // present residents would gather this turn — each resident's `gather` trait-rules ∩ accepts.
    const acceptsSet = new Set(Array.isArray(e.accepts) ? e.accepts : []);
    const acceptsEdit = resTypes.map((c) => ({ key: c.key, label: c.label, icon: c.icon, iconImg: isImageIcon(c.icon), on: acceptsSet.has(c.key) }));
    const gatherTotals = {};
    if (acceptsSet.size) {
      for (const s of staff) {
        if (!s.present || !s.npcUuid) continue;
        const npc = fromUuidSync(s.npcUuid);
        if (!npc) continue;
        for (const [k, v] of Object.entries(collectGather(npc))) {
          if (acceptsSet.has(k) && v > 0) gatherTotals[k] = (gatherTotals[k] || 0) + v;
        }
      }
    }
    const gathered = Object.entries(gatherTotals).map(([k, v]) => ({ key: k, label: materialCategoryLabel(k), amount: v }));
    const boonParts = [
      ...(e.boonRules ?? []).map((r) => normalizeRule(r)).filter(Boolean).map((r) => summarizeRule(scaleRuleByTier(r, tier))).filter(Boolean),
      ...(e.boonChanges ?? []).filter((c) => BOON_ATTRS.includes(c.attr) && Number(c.value))
        .map((c) => { const v = Math.round(Number(c.value)) * tier; return `${v > 0 ? "+" : ""}${v} ${game.i18n.localize(`PROJECTANIME.Attribute.${c.attr}.long`)}`; })
    ];
    const pp = [];
    if (tier > 0) {
      if (yieldGold) pp.push(`${yieldGold * tier} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
      if (yieldSP) pp.push(`${yieldSP * tier} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
      if (yieldItems.length) pp.push(yieldItems.map((i) => i.name).join(", "));
      for (const g of gathered) pp.push(`${g.amount} ${g.label}`);
      if (isService && serviceKind) pp.push(game.i18n.localize(`PROJECTANIME.HQ.serviceKind.${serviceKind}`));
    }
    return {
      id: e.id,
      npcUuid: e.npcUuid,
      name: e.name,
      img: e.img || "icons/svg/mystery-man.svg",
      initial: initialOf(e.name),
      role: e.role,
      roleLabel: game.i18n.localize(`PROJECTANIME.Covenant.role.${e.role}`),
      roleOptions: kindOptions(e.role),
      tier,
      isBuilt: tier >= 1,
      tierPips: [1, 2, 3].map((n) => ({ n, on: n <= tier })),
      costEdit,
      nextCost,
      hasNextCost: nextCost.length > 0,
      free: !maxed && nextCost.length === 0,
      canBuild: !maxed && affordable && !e.building,
      playerCanBuild: !maxed && affordable && !e.building && !!e.unlocked,
      maxed,
      buildLabel: tier === 0 ? game.i18n.localize("PROJECTANIME.HQ.build") : game.i18n.localize("PROJECTANIME.HQ.upgrade"),
      unlocked: !!e.unlocked,
      buildTime: Math.max(0, Math.round(Number(e.buildTime) || 0)),
      building: !!e.building,
      buildStatus: e.building ? game.i18n.format("PROJECTANIME.HQ.building", { n: Math.max(0, Math.round(Number(e.buildLeft) || 0)) }) : "",
      yieldGold,
      yieldSP,
      yieldItems,
      isService,
      isVendor,
      isPassive,
      isUpgrade,
      isWorkshop,
      facilityIcon: isService ? "fa-heart-pulse" : isVendor ? "fa-store" : isPassive ? "fa-hand-sparkles" : isUpgrade ? "fa-arrow-up-right-dots" : isWorkshop ? "fa-screwdriver-wrench" : "fa-chess-rook",
      upgradeTarget,
      targetOptions,
      upgradeTargetName,
      boonSummary: boonParts.join(", "),
      hasBoon: boonParts.length > 0,
      serviceKind,
      serviceKindOptions: [
        { key: "", label: game.i18n.localize("PROJECTANIME.HQ.serviceKind.none"), sel: !serviceKind },
        ...SERVICE_KINDS.map((k) => ({ key: k, label: game.i18n.localize(`PROJECTANIME.HQ.serviceKind.${k}`), sel: k === serviceKind })).sort((a, b) => a.label.localeCompare(b.label))
      ],
      staffed,
      staff,
      staffCap: cap,
      staffCount: staff.length,
      emptySlots,
      hasEmptySlots: emptyCount > 0,
      staffPool,
      canAssign: emptyCount > 0 && staffPool.length > 0,
      staffName: staff.map((s) => s.name).join(", "),
      acceptsEdit,
      hasResTypes: resTypes.length > 0,
      gathered,
      hasGathered: gathered.length > 0,
      produces: pp.length > 0,
      producesSummary: pp.join(" · ")
    };
  }

  async _prepareContext() {
    await this.#ensureStaffPartial();   // register the resident-section partial before the {{> …}} include renders
    const hq = getHQ();
    const isGM = this.isGM;
    const resTypes = getMaterialCategories();
    const facilityList = hq.facilities.map((e) => ({ id: e.id, name: e.name }));

    let all = hq.facilities.map((e) => this.#facilityVM(e, { resTypes, hqResources: hq.resources, facilityList, people: hq.people }));
    // Players only see structures the GM has Unlocked (offered to build); built facilities are visible to all.
    if (!isGM) all = all.filter((f) => f.isBuilt || f.unlocked);

    const structures = all.filter((f) => !f.isBuilt);
    const built = all.filter((f) => f.isBuilt);
    const ids = new Set(all.map((f) => f.id));
    if (!this.#selId || !ids.has(this.#selId)) this.#selId = structures[0]?.id ?? built[0]?.id ?? null;
    const mark = (f) => ({ ...f, sel: f.id === this.#selId });
    const structuresM = structures.map(mark);
    const builtM = built.map(mark);

    const resources = resTypes.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      iconImg: isImageIcon(c.icon),
      amount: Math.max(0, Math.round(Number(hq.resources?.[c.key]) || 0))
    }));

    return {
      isGM,
      accent: hq.accent,
      resources,
      hasResources: resources.length > 0,
      structures: structuresM,
      hasStructures: structuresM.length > 0,
      built: builtM,
      hasBuilt: builtM.length > 0,
      all: [...structuresM, ...builtM],
      hasAny: all.length > 0
    };
  }

  /* --------------------------------- render wiring --------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this.#applySelection();
    this.#hqSig = this.#hqDigest();      // remember what we just drew (seamless-refresh gate)
    if (!this.isGM) return;
    // GM authoring: facility field edits + per-resource cost editor + the per-turn item-yield drop zone.
    for (const el of root.querySelectorAll("[data-recruit-field]")) el.addEventListener("change", this.#onFacilityField.bind(this));
    for (const el of root.querySelectorAll("[data-facility-cost]")) el.addEventListener("change", this.#onFacilityCost.bind(this));
    for (const zone of root.querySelectorAll("[data-yield-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("drag-over"); this.#onYieldDrop(ev, zone.dataset.yieldDrop); });
    }
  }

  /** Reflect #selId on the live DOM (active rail row + visible detail pane) — no re-render. */
  #applySelection() {
    const root = this.element;
    if (!root) return;
    for (const r of root.querySelectorAll(".struct-row")) r.classList.toggle("sel", r.dataset.recruitId === this.#selId);
    for (const d of root.querySelectorAll(".struct-detail")) d.classList.toggle("active", d.dataset.detail === this.#selId);
  }

  /* --------------------------------- seamless patches --------------------------------- */
  /* After a quiet edit (no re-render), patch the few GM-visible bits the edited control doesn't itself
   * show. Each is fail-safe (missing node → skipped, refreshes on the next real render). */

  /** Recompute one facility's view-model (the same shape #facilityVM feeds the template) for in-place patches. */
  #vmFor(id) {
    const hq = getHQ();
    const resTypes = getMaterialCategories();
    const facilityList = hq.facilities.map((e) => ({ id: e.id, name: e.name }));
    const e = hq.facilities.find((x) => x.id === id);
    return e ? this.#facilityVM(e, { resTypes, hqResources: hq.resources, facilityList, people: hq.people }) : null;
  }

  /** Patch the rail row's name after a quiet name edit (the detail input already shows the value). */
  #patchRailName(id) {
    const row = this.element?.querySelector(`.struct-row[data-recruit-id="${id}"]`);
    const nm = row?.querySelector(".struct-row-nm");
    if (!nm) return;
    const name = this.#vmFor(id)?.name?.trim();
    nm.textContent = name || game.i18n.localize(row.classList.contains("built") ? "PROJECTANIME.HQ.newFacility" : "PROJECTANIME.HQ.newStructure");
  }

  /** Refresh how OTHER facilities' (always-rendered) upgrade-target dropdowns name this one after a quiet
   *  rename — every upgrade facility's <select> lists the rest by name, and this window draws all panes at
   *  once, so the sibling option would otherwise show the old name until a loud render. */
  #patchUpgradeRefs(id) {
    const name = this.#vmFor(id)?.name ?? "";
    for (const opt of this.element?.querySelectorAll(`.struct-detail select[data-recruit-field="upgradeTarget"] option[value="${id}"]`) ?? [])
      opt.textContent = name;
  }

  /** Patch the rail row's lock pip after a quiet `unlocked` toggle (tier-0 structure rows only). */
  #patchUnlockedLock(id, unlocked) {
    const row = this.element?.querySelector(`.struct-row[data-recruit-id="${id}"]`);
    if (!row || row.classList.contains("built")) return;
    const existing = row.querySelector(".struct-row-lock");
    if (unlocked) existing?.remove();
    else if (!existing) {
      const i = document.createElement("i");
      i.className = "fas fa-lock struct-row-lock";
      i.title = game.i18n.localize("PROJECTANIME.HQ.unlockedHint");
      row.appendChild(i);
    }
  }

  /** Patch the next-tier cost preview + Build button enable after a quiet cost edit. Material `label`/
   *  `icon` are GM-editable free text, so escape them like the Handlebars template does (a `"` in a
   *  label would otherwise break the attribute). */
  #patchCostPreview(id) {
    const vm = this.#vmFor(id);
    const detail = this.element?.querySelector(`.struct-detail[data-detail="${id}"]`);
    if (!vm || !detail) return;
    const esc = foundry.utils.escapeHTML;
    const snext = detail.querySelector(".hq-snext");
    if (snext && !vm.maxed && !vm.building) {
      let html = `<span class="hq-snext-lbl">${vm.buildLabel}:</span>`;
      if (vm.hasNextCost) html += vm.nextCost.map((c) =>
        `<span class="hq-scost${c.enough ? "" : " short"}" title="${esc(c.label)}">${c.iconImg ? `<img src="${esc(c.icon)}" alt="">` : `<i class="${esc(c.icon)}"></i>`} ${c.amount}</span>`).join("");
      else html += `<span class="hq-sfree">${game.i18n.localize("PROJECTANIME.HQ.free")}</span>`;
      snext.innerHTML = html;
    }
    detail.querySelector(".hq-sbuild")?.toggleAttribute("disabled", !vm.canBuild);
  }

  /** Register the shared resident-section partial before the first render (idempotent — getTemplate caches),
   *  so the `{{> …structures-staff.hbs}}` include resolves and the staff section can be re-rendered. */
  async #ensureStaffPartial() {
    const lt = foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
    try { await lt(["systems/project-anime/templates/apps/structures-staff.hbs"]); } catch (_e) { /* a staff edit falls back to a loud render if the partial can't be fetched */ }
  }

  /** Re-render ONE facility's resident section in place from its VM — covers slots, the gather note, the
   *  pool, the count and canAssign in one shot (no-op if the section isn't rendered, e.g. a tier-0
   *  blueprint). The data-action buttons keep working via AppV2's delegated root, so no re-bind needed. */
  async #patchStaffSection(id) {
    const sec = this.element?.querySelector(`.struct-staff-sec[data-staff-sec="${id}"]`);
    const vm = sec ? this.#vmFor(id) : null;
    if (!vm) return;
    const rt = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    sec.innerHTML = await rt("systems/project-anime/templates/apps/structures-staff.hbs", vm);
  }

  /** Re-render EVERY facility's resident section after a staff assign/unassign — the idle pool spans all
   *  panes (a person staffs one facility at a time), so one assignment changes the pool shown in all. */
  async #patchStaffEverywhere() {
    for (const sec of this.element?.querySelectorAll(".struct-staff-sec[data-staff-sec]") ?? [])
      await this.#patchStaffSection(sec.dataset.staffSec);
  }

  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** Mutate one facility (GM only), persist; the HQ onChange re-renders this window + the Codex.
   *  Pass { quiet: true } when the caller has already patched the live DOM, to suppress THIS window's
   *  re-render (the flash). The no-op guard ensures a change-nothing edit fires no onChange — otherwise
   *  an armed skip flag would leak and swallow the next render (mirrors codex.mjs #mutateHQ). */
  async #mutateFacility(id, fn, { quiet = false } = {}) {
    if (!this.isGM) return;
    const hq = getHQ();
    const e = hq.facilities.find((x) => x.id === id);
    if (!e) return;
    const before = JSON.stringify(hq);
    fn(e);
    if (JSON.stringify(hq) === before) return;
    if (quiet) this.#skipRenderOnce = true;
    await saveHQ(hq);
  }

  /** Mutate the WHOLE HQ quietly (GM only) for edits that span facilities/people (staffing). Same no-op
   *  guard + skip-flag as #mutateFacility; the caller has already patched the live DOM. */
  async #mutateHQQuiet(fn) {
    if (!this.isGM) return;
    const hq = getHQ();
    const before = JSON.stringify(hq);
    fn(hq);
    if (JSON.stringify(hq) === before) return;
    this.#skipRenderOnce = true;
    await saveHQ(hq);
  }

  /* --------------------------------- actions --------------------------------- */

  /** Click a rail row → select it (pure DOM, no re-render so authoring inputs keep focus). */
  static #onSelectStructure(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) this.select(id);
  }

  /** Click an empty "+" resident slot → reveal that facility's resident picker (pure DOM toggle; the
   *  picker is otherwise hidden so the detail isn't cluttered). A re-render closes it again. */
  static #onOpenPool(event, target) {
    target.closest(".struct-detail")?.classList.toggle("pool-open");
  }

  /** Create a fresh tier-0 structure (GM); it lands at the top of the list and is auto-selected. */
  static async #onNewStructure() {
    if (!this.isGM) return;
    const hq = getHQ();
    const f = blankFacility();
    (hq.facilities ??= []).unshift(f);
    this.#selId = f.id;
    await saveHQ(hq);
  }

  /** Build/upgrade one tier — GM builds directly; a player relays to the active GM (validated there). */
  static async #onBuildFacility(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (!id) return;
    if (this.isGM) { await buildFacility(id); return; }
    game.socket.emit("system.project-anime", { type: "buildFacility", facilityId: id, userId: game.user.id });
  }

  /** Set a structure's tier directly from a ✦ pip (GM testing aid). */
  static async #onSetFacilityTier(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const n = Math.min(3, Math.max(1, Number(target.dataset.ftier) || 1));
    await this.#mutateFacility(id, (e) => { e.facilityTier = n; });
  }

  /** Author the structure's projected effect in the shared Effect Builder (data mode, full vocabulary). */
  static #onEditBoon(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const fac = getHQ().facilities.find((x) => x.id === id);
    if (!fac) return;
    const winId = `hqboon-${id}`;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${winId}`);
    if (existing) return existing.bringToFront();
    EffectBuilder.forData({
      id: winId,
      title: game.i18n.localize("PROJECTANIME.HQ.editBoon"),
      name: fac.name || game.i18n.localize("PROJECTANIME.HQ.boonDefault"),
      img: fac.img || "icons/svg/aura.svg",
      rules: fac.boonRules ?? [],
      onSave: ({ name, img, rules }) => this.#mutateFacility(id, (e) => { e.name = name || e.name; e.img = img || e.img; e.boonRules = rules; })
    }).render(true);
  }

  /** Remove an authored per-turn item yield from a structure (GM). */
  static async #onRemoveYieldItem(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const idx = Number(target.dataset.yieldItem);
    await this.#mutateFacility(id, (e) => { if (Array.isArray(e.yieldItems)) e.yieldItems.splice(idx, 1); });
  }

  /** Open a vendor structure's Shop (everyone — players transact as their own character). */
  static #onVisitShop(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) ShopWindow.open(id);
  }

  /** Open a workshop structure's crafting window (everyone — players craft when the GM unlocks it). */
  static #onVisitWorkshop(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    if (id) WorkshopWindow.open(id);
  }

  /** Pick the structure's image/icon (GM). */
  static async #onPickImage(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const cur = getHQ().facilities.find((x) => x.id === id)?.img ?? "";
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    // The structure image isn't drawn in this window (rail + head use the role icon) and is excluded from
    // #hqDigest, so a quiet save here genuinely early-returns in notifyHQChanged — no flash.
    new FP({ type: "image", current: cur, callback: (path) => this.#mutateFacility(id, (e) => { e.img = path; }, { quiet: true }) }).browse();
  }

  /** Open the structure's backing NPC sheet, if any. */
  static async #onOpenActor(event, target) {
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const fac = getHQ().facilities.find((x) => x.id === id);
    const actor = fac?.npcUuid ? await fromUuid(fac.npcUuid).catch(() => null) : null;
    actor?.sheet?.render(true);
  }

  /** Delete a structure (GM), confirming first; clears any staffing person's link. */
  static async #onRemoveStructure(event, target) {
    if (!this.isGM) return;
    const id = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const hq = getHQ();
    const fac = hq.facilities.find((x) => x.id === id);
    if (!fac) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.HQ.removeRecruitTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Covenant.deleteConfirm", { name: fac.name || game.i18n.localize("PROJECTANIME.HQ.newStructure") })}</p>`
    }).catch(() => false);
    if (!ok) return;
    // Free every resident posted here before removing the building.
    for (const pid of fac.staffIds ?? []) { const o = hq.people.find((p) => p.id === pid); if (o) o.facilityId = ""; }
    hq.facilities = hq.facilities.filter((f) => f.id !== id);
    if (this.#selId === id) this.#selId = null;
    await saveHQ(hq);
  }

  /* --------------------------------- field handlers --------------------------------- */

  /** Edit a structure field (GM): kind/name/yield/unlocked/buildTime/serviceKind/upgradeTarget.
   *  All but `role` save quietly (the edited control already shows its value) — `role` reshapes the
   *  book (which sub-panels show + the icon), so it takes a full re-render. The few GM-visible bits the
   *  edited control doesn't itself show (the rail name + lock pip) are patched in place. */
  async #onFacilityField(event) {
    const el = event.currentTarget;
    const id = el.dataset.recruitId;
    const field = el.dataset.recruitField;
    if (!id || !field) return;
    const val = el.value;
    const quiet = field !== "role";
    await this.#mutateFacility(id, (e) => {
      if (field === "role") e.role = val;
      else if (field === "name") e.name = val;
      else if (field === "yieldGold") e.yieldGold = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "yieldSP") e.yieldSP = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "unlocked") e.unlocked = el.type === "checkbox" ? el.checked : !!val;
      else if (field === "buildTime") e.buildTime = Math.max(0, Math.round(Number(val) || 0));
      else if (field === "serviceKind") e.serviceKind = val;
      else if (field === "upgradeTarget") e.upgradeTarget = val;
    }, { quiet });
    if (!quiet) return; // role re-rendered the whole book
    if (field === "name") { this.#patchRailName(id); this.#patchUpgradeRefs(id); }
    else if (field === "unlocked") this.#patchUnlockedLock(id, el.checked);
  }

  /** Set a structure's BASE per-tier cost for one resource (GM); 0 clears that resource from the cost. */
  async #onFacilityCost(event) {
    const el = event.currentTarget;
    const id = el.dataset.recruitId;
    const key = el.dataset.facilityCost;
    if (!id || !key) return;
    const val = Math.max(0, Math.round(Number(el.value) || 0));
    await this.#mutateFacility(id, (e) => { e.cost ??= {}; if (val > 0) e.cost[key] = val; else delete e.cost[key]; }, { quiet: true });
    this.#patchCostPreview(id);
  }

  /** Station a resident at this facility (GM) — tap a pool portrait. Fills the next slot up to the
   *  facility's tier capacity; assignStaff touches both the facility and the person. Saves quietly + re-
   *  renders every pane's resident section in place (the idle pool spans them all) — no window flash. */
  static async #onAssignStaff(event, target) {
    if (!this.isGM) return;
    const fid = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const pid = target.closest("[data-person-id]")?.dataset.personId;
    if (!fid || !pid) return;
    await this.#mutateHQQuiet((hq) => assignStaff(hq, fid, pid));
    await this.#patchStaffEverywhere();
  }

  /** Remove a resident from this facility (GM) — the ✕ on a filled slot. Quiet + patch (see assign). */
  static async #onUnassignStaff(event, target) {
    if (!this.isGM) return;
    const pid = target.closest("[data-person-id]")?.dataset.personId;
    if (!pid) return;
    await this.#mutateHQQuiet((hq) => unassignStaff(hq, pid));
    await this.#patchStaffEverywhere();
  }

  /** Toggle whether this facility ACCEPTS a resource type (GM) — the "fit" a resident's Gather trait
   *  must match to be credited at the HQ turn. */
  static async #onToggleAccept(event, target) {
    if (!this.isGM) return;
    const fid = target.closest("[data-recruit-id]")?.dataset.recruitId;
    const key = target.closest("[data-accept]")?.dataset.accept;
    if (!fid || !key) return;
    await this.#mutateFacility(fid, (f) => {
      f.accepts = Array.isArray(f.accepts) ? f.accepts : [];
      const i = f.accepts.indexOf(key);
      if (i >= 0) f.accepts.splice(i, 1); else f.accepts.push(key);
    }, { quiet: true });
    target.classList.toggle("on");           // the chip lives outside the staff section — toggle it directly
    await this.#patchStaffSection(fid);      // refresh the gather note (accepts ∩ present staff)
  }

  /** Drop an Item onto the yield slot → store a snapshot as the structure's per-turn item yield (GM). */
  async #onYieldDrop(event, id) {
    if (!this.isGM || !id) return;
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    return this.#mutateFacility(id, (e) => { (e.yieldItems ??= []).push(snap); });
  }
}
