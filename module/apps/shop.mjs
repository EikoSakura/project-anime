/**
 * Project: Anime — the Vendor SHOP.
 *
 * Opened from a `vendor`-role HQ facility (the Codex Home tab). A buy/sell storefront that consumes
 * the system's economy primitives: an item's `system.cost` priced through the buyer's derived
 * `system.buyRate` / `system.sellRate` (helpers/effects.mjs `collectTradeRates`, base 100% buy /
 * 50% sell), optionally shifted by the vendor's own `rateBuy` / `rateSell`. Stock is the facility's
 * GM-authored snapshots plus, if enabled, the Character-Creator compendium catalogue.
 *
 * Transactions act on a chosen BUYER actor: a player shops as one of their owned characters (they own
 * it, so buy/sell run directly — no socket relay); the GM may additionally shop as any party member or
 * the party itself (its treasury + stash). Buying copies the item onto the buyer and deducts gold;
 * selling deletes the buyer's item and credits gold. Stock is unlimited (a restocking storefront).
 */
import { getHQ, saveHQ } from "../helpers/factions.mjs";
import { hqShopRates } from "../helpers/hq.mjs";
import { stampCompendiumSource } from "../helpers/gear.mjs";
import { partyActors, partyMembers } from "../helpers/party-folder.mjs";
import { getCreationConfig } from "../helpers/creation.mjs";
import { BASE_BUY_PCT, BASE_SELL_PCT } from "../helpers/effects.mjs";
import { PROJECTANIME } from "../helpers/config.mjs";
import { partyTier, tierNumeral } from "../helpers/chronicle.mjs";
import { depositMaterial, materialTypeLabel, materialGradeLabel } from "../helpers/crafting.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Item types a shop trades in (skills aren't merchandise). */
const SELLABLE_TYPES = ["weapon", "armor", "shield", "accessory", "consumable", "container", "gear"];

const clampBuy = (v) => Math.max(0, Math.min(1000, Math.round(v)));
const clampSell = (v) => Math.max(0, Math.min(100, Math.round(v)));

export class ShopWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(facilityId, options = {}) {
    super({ ...options, id: facilityId?.startsWith("vendor-") ? `pa-shop-${facilityId}` : `pa-shop-${facilityId}` });
    this.facilityId = facilityId;
    this.vendorKind = options.vendorKind ?? null;   // v0.03 catalog vendor ("consumable" | "gear")
  }

  /** Open (or focus) the shop for a legacy vendor facility (by id). */
  static open(facilityId) {
    const existing = foundry.applications.instances.get(`pa-shop-${facilityId}`);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new ShopWindow(facilityId);
    app.render(true);
    return app;
  }

  /** Open (or focus) the v0.03 HQ Shop for a catalog vendor — the Apothecary ("consumable") or Forge
   *  ("gear"). Prices come from the HQ rank + the vendor facility's staffed/favor/upgrade lines
   *  (helpers/hq.mjs `hqShopRates`); stock is drawn from the compendium catalogue, filtered to the kind. */
  static openVendor(kind) {
    const vk = kind === "consumable" ? "consumable" : "gear";
    const id = `vendor-${vk}`;
    const existing = foundry.applications.instances.get(`pa-shop-${id}`);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new ShopWindow(id, { vendorKind: vk });
    app.render(true);
    return app;
  }

  /** Item types this vendor trades in, or null (all). Forge = arms (+ accessories once upgraded). */
  #vendorTypes() {
    if (!this.vendorKind) return null;
    if (this.vendorKind === "consumable") return new Set(["consumable"]);
    const rates = hqShopRates("gear");
    return new Set(rates.stocksAccessories ? ["weapon", "armor", "shield", "accessory"] : ["weapon", "armor", "shield"]);
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "theme-dark", "pa-shop"],
    position: { width: 720, height: 640 },
    window: { title: "PROJECTANIME.Shop.title", icon: "fa-solid fa-store", resizable: true },
    actions: {
      buyItem: ShopWindow.#onBuyItem,
      sellItem: ShopWindow.#onSellItem,
      removeStock: ShopWindow.#onRemoveStock,
      buyMaterial: ShopWindow.#onBuyMaterial
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/shop.hbs", scrollable: [".shop-buy", ".shop-sell"] }
  };

  /** Chosen buyer actor id (transient; survives re-render). */
  #buyerId = null;

  /** Cached compendium catalogue (raw {uuid,name,img,type,cost}) — fetched once per window. */
  #compendiumCache = null;

  get isGM() { return game.user.isGM; }

  /** The vendor facility. For a v0.03 catalog vendor this is synthesized from the HQ rank + facility
   *  lines (rates as ±points off the buyer's base 100% buy / 50% sell); otherwise a legacy vendor record. */
  get facility() {
    if (this.vendorKind) {
      const r = hqShopRates(this.vendorKind);
      const name = this.vendorKind === "consumable"
        ? (CONFIG.PROJECTANIME.hqFacilities?.apothecary?.name ?? "Apothecary")
        : (CONFIG.PROJECTANIME.hqFacilities?.forge?.name ?? "Forge");
      const img = this.vendorKind === "consumable" ? "icons/svg/pill.svg" : "icons/svg/anvil.svg";
      return {
        id: this.facilityId, name, img, role: "vendor", drawFromShop: true, stock: [], sellsMaterials: false,
        rateBuy: Math.round(r.buyMult * 100 - 100),          // 0.9 → −10 points off the buy price
        rateSell: Math.round(r.sellMult * 100 - 50)          // 0.6 → +10 points onto the sell price
      };
    }
    return getHQ().facilities.find((e) => e.id === this.facilityId) ?? null;
  }

  get title() {
    const name = this.facility?.name || game.i18n.localize("PROJECTANIME.Shop.title");
    return `${name} — ${game.i18n.localize("PROJECTANIME.Shop.title")}`;
  }

  /** Signature of the HQ slice this window draws — lets notifyHQChanged skip a no-op re-render. */
  #hqSig = null;

  /** A shop reads only ITS vendor facility from the HQ object (the buyer's gold/items are actor state,
   *  not HQ). So any HQ change elsewhere — people, missions, the turn, another facility — leaves this
   *  untouched and the shop doesn't flash. */
  #hqDigest() {
    return JSON.stringify(this.facility);
  }

  /** The HQ world object changed — re-render only if our vendor facility moved (seamless-refresh entry
   *  point). Stock authoring + rate edits flow through here too; buy/sell patch the DOM directly. */
  notifyHQChanged() {
    if (this.#hqDigest() === this.#hqSig) return;
    this.render(false);
  }

  /** Buy/sell rate percentages for a buyer: the buyer's derived rates shifted by the vendor's modifiers.
   *  Factored so _prepareContext and the transaction handlers price items the same way. */
  #effRates(buyer) {
    const f = this.facility;
    const rateBuy = Math.round(Number(f?.rateBuy) || 0);
    const rateSell = Math.round(Number(f?.rateSell) || 0);
    const effBuy = clampBuy((buyer ? (buyer.system.buyRate ?? BASE_BUY_PCT) : BASE_BUY_PCT) + rateBuy);
    const effSell = clampSell((buyer ? (buyer.system.sellRate ?? BASE_SELL_PCT) : BASE_SELL_PCT) + rateSell);
    return { rateBuy, rateSell, effBuy, effSell };
  }

  /** The buyer's tradeable items as Sell-row view-models (skips the innate Natural Attack), name-sorted.
   *  Shared by _prepareContext (first paint) and #applyBuyerState (in-place refresh after a trade). */
  #sellData(buyer, effSell) {
    if (!buyer) return [];
    const typeLabel = (t) => (t ? game.i18n.localize(`TYPES.Item.${t}`) : "");
    return buyer.items
      .filter((i) => SELLABLE_TYPES.includes(i.type) && !i.getFlag?.("project-anime", "natural"))
      .map((i) => { const cost = Number(i.system?.cost ?? 0) || 0; return { id: i.id, name: i.name, img: i.img, type: i.type, typeLabel: typeLabel(i.type), cost, price: Math.floor(cost * effSell / 100) }; })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Eligible buyers: a player shops as their own character(s); the GM may also pick any party member
   *  or the party itself (treasury + stash). Each entry caches the resolved actor. */
  #buyerOptions() {
    const out = [];
    const party = partyActors()[0] ?? null;
    if (this.isGM) {
      for (const m of (party ? partyMembers(party) : [])) out.push({ id: m.id, name: m.name, actor: m });
      if (party) out.push({ id: party.id, name: party.name, actor: party });
    } else {
      for (const a of game.actors ?? []) if (a.type === "character" && a.isOwner) out.push({ id: a.id, name: a.name, actor: a });
    }
    return out;
  }

  /** Resolve the active buyer actor from #buyerId (falling back to the assigned character, then the
   *  first option). Returns null when there's no eligible buyer. */
  #buyer(options) {
    const opts = options ?? this.#buyerOptions();
    if (!opts.length) return null;
    let pick = opts.find((o) => o.id === this.#buyerId)
      ?? opts.find((o) => o.id === game.user.character?.id)
      ?? opts[0];
    this.#buyerId = pick.id;
    return pick.actor;
  }

  /** The compendium catalogue (cached): the creation-config open packs filtered to allowed types. */
  async #compendiumStock() {
    if (this.#compendiumCache) return this.#compendiumCache;
    const { allowedTypes, packs } = getCreationConfig();
    const allowed = new Set(allowedTypes);
    const open = new Set(packs);
    const out = [];
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item" || !open.has(pack.collection)) continue;
      try {
        for (const item of await pack.getDocuments()) {
          if (!allowed.has(item.type)) continue;
          out.push({ uuid: item.uuid, name: item.name, img: item.img, type: item.type, cost: Number(item.system?.cost ?? 0) || 0 });
        }
      } catch (_e) { /* unreadable pack — skip */ }
    }
    this.#compendiumCache = out;
    return out;
  }

  async _prepareContext() {
    const f = this.facility;
    if (!f) return { gone: true };

    const buyerOpts = this.#buyerOptions();
    const buyer = this.#buyer(buyerOpts);

    const { rateBuy, rateSell, effBuy, effSell } = this.#effRates(buyer);
    const buyPrice = (cost) => Math.ceil((Number(cost) || 0) * effBuy / 100);
    const typeLabel = (t) => (t ? game.i18n.localize(`TYPES.Item.${t}`) : "");

    // A v0.03 catalog vendor trades only in its own goods (Apothecary = consumables, Forge = arms).
    const vTypes = this.#vendorTypes();

    // BUY catalogue: GM-authored snapshots + (optional) the creation-config compendium catalogue.
    const buy = [];
    (f.stock ?? []).forEach((snap, idx) => {
      if (vTypes && !vTypes.has(snap?.type)) return;
      const cost = Number(snap?.system?.cost ?? 0) || 0;
      buy.push({ isStock: true, idx, name: snap?.name ?? "—", img: snap?.img ?? "icons/svg/item-bag.svg", type: snap?.type ?? "", typeLabel: typeLabel(snap?.type), cost, price: buyPrice(cost) });
    });
    if (f.drawFromShop) {
      for (const c of await this.#compendiumStock()) {
        if (vTypes && !vTypes.has(c.type)) continue;
        buy.push({ isStock: false, uuid: c.uuid, name: c.name, img: c.img, type: c.type, typeLabel: typeLabel(c.type), cost: c.cost, price: buyPrice(c.cost) });
      }
    }
    buy.sort((a, b) => a.name.localeCompare(b.name));

    // SELL list: the buyer's tradeable items (skipping the innate Natural Attack), filtered to the vendor's kind.
    const buyerGold = buyer ? (buyer.system.gold ?? 0) : 0;
    const sell = this.#sellData(buyer, effSell).filter((s) => !vTypes || vTypes.has(s.type));

    // Material stock (v0.03): Common materials of the settlement's Tier at 50G × Tier. Never Prime;
    // the flat price ignores the buy-rate. Tier defaults to the party Tier until the GM pins one.
    const settlementTier = this.#settlementTier(f);
    const materials = f.sellsMaterials ? PROJECTANIME.materialTypeKeys.map((cat) => ({
      category: cat,
      label: materialTypeLabel(cat),
      icon: PROJECTANIME.materialTypeIcons[cat],
      price: PROJECTANIME.materialShopPricePerTier * settlementTier
    })) : [];

    return {
      isGM: this.isGM,
      vendor: { name: f.name || game.i18n.localize("PROJECTANIME.Shop.title"), img: f.img || "icons/svg/mystery-man.svg" },
      buyers: buyerOpts.map((o) => ({ id: o.id, name: o.name, sel: o.id === this.#buyerId })),
      hasBuyer: !!buyer,
      buyerGold,
      rateBuy, rateSell,
      drawFromShop: !!f.drawFromShop,
      sellsMaterials: !!f.sellsMaterials,
      settlementTier,
      matTierRoman: tierNumeral(settlementTier),
      commonLabel: materialGradeLabel("common"),
      materials, hasMaterials: materials.length > 0,
      buy, hasBuy: buy.length > 0,
      sell, hasSell: sell.length > 0
    };
  }

  /** The settlement's Tier for material pricing: the GM's pin, else the current party Tier. */
  #settlementTier(f) {
    return Math.max(1, Math.min(4, Number(f?.settlementTier) || partyTier()));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this.#hqSig = this.#hqDigest();      // remember what we just drew (seamless-refresh gate)
    // Buyer selector → re-render with that buyer's gold + rates.
    const sel = root.querySelector('[data-shop="buyer"]');
    if (sel) sel.addEventListener("change", (ev) => { this.#buyerId = ev.target.value; this.render(false); });
    if (!this.isGM) return;
    // GM stock authoring: toggle compendium draw, set vendor rate modifiers, drop items into stock.
    for (const el of root.querySelectorAll("[data-vendor-field]")) {
      el.addEventListener("change", this.#onVendorField.bind(this));
    }
    const drop = root.querySelector("[data-stock-drop]");
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("drag-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
      drop.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.remove("drag-over"); this.#onStockDrop(ev); });
    }
  }

  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** Mutate the vendor facility in the HQ pool (GM only), persist. The save's onChange routes back
   *  through notifyHQChanged, which re-renders this shop once (stock/rates changed) — no double render. */
  async #mutateFacility(fn) {
    if (!this.isGM) return;
    const hq = getHQ();
    const e = hq.facilities.find((x) => x.id === this.facilityId);
    if (!e) return;
    fn(e);
    await saveHQ(hq);
  }

  async #onVendorField(event) {
    const el = event.currentTarget;
    const field = el.dataset.vendorField;
    if (!field) return;
    const val = el.type === "checkbox" ? el.checked : Math.round(Number(el.value) || 0);
    return this.#mutateFacility((e) => { e[field] = val; });
  }

  async #onStockDrop(event) {
    const data = this.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item?.toObject) return;
    const snap = item.toObject();
    delete snap._id;
    stampCompendiumSource(snap, item);
    return this.#mutateFacility((e) => { (e.stock ??= []).push(snap); });
  }

  static async #onRemoveStock(event, target) {
    if (!game.user.isGM) return;
    const idx = Number(target.dataset.idx);
    await this.#mutateFacility((e) => { if (Array.isArray(e.stock)) e.stock.splice(idx, 1); });
  }

  static async #onBuyItem(event, target) {
    const buyer = this.#buyer();
    const f = this.facility;
    if (!buyer || !f) return;
    // Resolve the source item (authored snapshot or compendium uuid) into a fresh object.
    let snap = null, source = null;
    if (target.dataset.idx !== undefined) snap = foundry.utils.deepClone((f.stock ?? [])[Number(target.dataset.idx)] ?? null);
    else if (target.dataset.uuid) { source = await fromUuid(target.dataset.uuid).catch(() => null); snap = source?.toObject?.() ?? null; }
    if (!snap) return;
    // Authored stock already carries its origin (stamped on drop); a live compendium buy stamps here.
    if (source) stampCompendiumSource(snap, source);

    const cost = Number(snap.system?.cost ?? 0) || 0;
    const price = Math.ceil(cost * this.#effRates(buyer).effBuy / 100);
    const gold = buyer.system.gold ?? 0;
    if (price > gold) return ui.notifications.warn(game.i18n.format("PROJECTANIME.Shop.cantAfford", { name: snap.name, price, gold }));

    delete snap._id;
    await buyer.createEmbeddedDocuments("Item", [snap]);
    if (price > 0) await buyer.update({ "system.gold": gold - price });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Shop.bought", { name: snap.name, price, buyer: buyer.name }));
    // Patch the buyer's gold + Sell list in place — the (possibly huge) Buy catalogue never reflows.
    this.#applyBuyerState(buyer);
  }

  static async #onBuyMaterial(event, target) {
    const buyer = this.#buyer();
    const f = this.facility;
    if (!buyer || !f?.sellsMaterials) return;
    const category = target.dataset.category;
    if (!PROJECTANIME.materialTypeKeys.includes(category)) return;

    const tier = this.#settlementTier(f);
    const price = PROJECTANIME.materialShopPricePerTier * tier;
    const gold = buyer.system.gold ?? 0;
    const name = `${materialGradeLabel("common")} ${materialTypeLabel(category)}`;
    if (price > gold) return ui.notifications.warn(game.i18n.format("PROJECTANIME.Shop.cantAfford", { name, price, gold }));

    await depositMaterial(buyer, { grade: "common", tier, category, qty: 1 });
    await buyer.update({ "system.gold": gold - price });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Shop.bought", { name, price, buyer: buyer.name }));
    this.#applyBuyerState(buyer); // refresh the buyer's gold in place (materials aren't a Sell row)
  }

  static async #onSellItem(event, target) {
    const buyer = this.#buyer();
    if (!buyer) return;
    const item = buyer.items.get(target.dataset.itemId);
    if (!item) return;

    const cost = Number(item.system?.cost ?? 0) || 0;
    const price = Math.floor(cost * this.#effRates(buyer).effSell / 100);
    const gold = buyer.system.gold ?? 0;
    const name = item.name;
    await item.delete();
    if (price > 0) await buyer.update({ "system.gold": gold + price });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Shop.sold", { name, price, buyer: buyer.name }));
    // Patch in place — the sold row drops out, gold updates, Buy catalogue stays put (no flash).
    this.#applyBuyerState(buyer);
  }

  /** Refresh the buyer-dependent parts of the live shop WITHOUT a re-render: the gold readout and the
   *  Sell column body. Called after a buy/sell so the (potentially large, compendium-fed) Buy catalogue
   *  never reflows — the seamless transaction path. The buyer's items are read live, so a just-bought
   *  item appears and a just-sold one disappears. */
  #applyBuyerState(buyer) {
    const root = this.element;
    if (!root) return;
    const goldEl = root.querySelector(".shop-gold");
    if (goldEl) goldEl.innerHTML = `<i class="fa-solid fa-coins"></i> ${buyer ? (buyer.system.gold ?? 0) : 0}`;

    const col = root.querySelector(".shop-sell");
    if (!col) return;
    // Drop everything under the column heading, then rebuild the list (or an empty state) from scratch.
    for (const el of [...col.children]) if (!el.classList.contains("shop-h")) el.remove();
    const empty = (key) => { const d = document.createElement("div"); d.className = "shop-empty"; d.textContent = game.i18n.localize(key); col.appendChild(d); };
    if (!buyer) return empty("PROJECTANIME.Shop.noBuyer");
    const rows = this.#sellData(buyer, this.#effRates(buyer).effSell);
    if (!rows.length) return empty("PROJECTANIME.Shop.noSell");
    const list = document.createElement("div");
    list.className = "shop-list";
    for (const r of rows) list.appendChild(this.#sellRow(r));
    col.appendChild(list);
  }

  /** Build one Sell-column row element (mirrors templates/apps/shop.hbs). Built in JS — not via a
   *  re-render — so #applyBuyerState can refresh the list in place; an explicit click listener stands
   *  in for the template's `data-action="sellItem"` (action delegation only covers rendered markup). */
  #sellRow(r) {
    const row = document.createElement("div");
    row.className = "shop-row";
    const img = document.createElement("img");
    img.className = "shop-ic"; img.src = r.img || "icons/svg/item-bag.svg"; img.alt = "";
    const meta = document.createElement("div");
    meta.className = "shop-meta";
    const name = document.createElement("span");
    name.className = "shop-name"; name.textContent = r.name ?? "—";
    meta.appendChild(name);
    if (r.typeLabel) { const t = document.createElement("span"); t.className = "shop-type"; t.textContent = r.typeLabel; meta.appendChild(t); }
    const price = document.createElement("span");
    price.className = "shop-price";
    price.innerHTML = `<i class="fa-solid fa-coins"></i> ${Number(r.price) || 0}`;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "shop-btn sell"; btn.dataset.itemId = r.id;
    btn.textContent = game.i18n.localize("PROJECTANIME.Shop.sellBtn");
    btn.addEventListener("click", (ev) => ShopWindow.#onSellItem.call(this, ev, btn));
    row.append(img, meta, price, btn);
    return row;
  }
}
