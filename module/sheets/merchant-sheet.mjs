import { bySort, cleanItemForTransfer, readDrag } from "../helpers/gear.mjs";
import { MERCHANT_STOCK, STACKABLE_STOCK, tradePrices, requestBuy, requestSell } from "../helpers/merchant.mjs";
import { enrichDescription } from "../helpers/dice.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The Merchant sheet — a shop window wearing the character sheet's Status Window skin
 * (its classes include `sheet actor`, so CSS §19/§19b apply whole). Left rail: portrait /
 * name / till / trade rates (GM-editable). Main pane: the stock as command rows — players
 * buy with the row button and sell by dragging their own gear anywhere onto the pane.
 *
 * Merchants default to OBSERVER ownership (preCreateActor), so any player can open the shop;
 * trades route through helpers/merchant.mjs — locally when the user owns both sides, else
 * over the GM relay — and the sheet itself never writes documents the viewer doesn't own.
 */
export class ProjectAnimeMerchantSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "sheet", "actor", "merchant"],
    position: { width: 720, height: 660 },
    window: { resizable: true, icon: "fa-solid fa-shop" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage: ProjectAnimeMerchantSheet.#onEditImage,
      buyItem: ProjectAnimeMerchantSheet.#onBuyItem,
      editItem: ProjectAnimeMerchantSheet.#onEditItem,
      deleteItem: ProjectAnimeMerchantSheet.#onDeleteItem
    }
  };

  static PARTS = {
    header: { template: "systems/project-anime/templates/merchant/header.hbs" },
    shop: { template: "systems/project-anime/templates/merchant/shop.hbs", scrollable: [""] }
  };

  /** The character this viewer shops as: their assigned character, else their only owned one. */
  #patron() {
    const assigned = game.user.character;
    if (assigned?.type === "character") return assigned;
    const owned = game.actors.filter((a) => a.type === "character" && a.isOwner);
    return owned.length === 1 ? owned[0] : null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    context.actor = this.actor;
    context.system = sys;
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;

    const patron = this.#patron();
    context.patron = patron ? { name: patron.name, img: patron.img, gold: Number(patron.system.gold) || 0 } : null;
    context.canBuy = !!patron;

    const items = this.actor.items.filter((i) => MERCHANT_STOCK.has(i.type)).sort(bySort);
    context.stock = await Promise.all(items.map(async (i) => {
      const qty = STACKABLE_STOCK.has(i.type) ? (Number(i.system.quantity) || 0) : null;
      const price = tradePrices(this.actor, patron, i).buy;
      return {
        id: i.id,
        name: i.name,
        img: i.img,
        typeLabel: game.i18n.localize(`TYPES.Item.${i.type}`),
        qty: sys.infiniteStock ? "∞" : (qty !== null && qty !== 1 ? `×${qty}` : null),
        price,
        short: patron ? price > (Number(patron.system.gold) || 0) : false,
        desc: await enrichDescription(i)
      };
    }));
    return context;
  }

  /** @override — the whole shop pane is one drop zone: the GM drops stock in; a player drops
   *  their own character's gear to offer it for sale. Bound for everyone (observers included —
   *  selling is exactly the non-owner case), routing decides what a drop may do. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const zone = this.element.querySelector(".merchant-shop");
    if (!zone) return;
    zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (ev) => { ev.preventDefault(); zone.classList.remove("drag-over"); this.#onDrop(ev); });
  }

  /** Route a drop: GM → stock the shelf (copy in, like the party Stash); player → sell offer. */
  async #onDrop(event) {
    const data = readDrag(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    if (!item || item.parent?.id === this.actor.id) return;   // own stock re-sorts via core
    if (!MERCHANT_STOCK.has(item.type)) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.gearOnly"));

    if (game.user.isGM) {
      await this.actor.createEmbeddedDocuments("Item", [cleanItemForTransfer(item)]);
      return;
    }

    const seller = item.parent;
    if (!seller || seller.documentName !== "Actor" || seller.type !== "character" || !seller.isOwner)
      return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.sellOwn"));
    const pa = item.flags?.["project-anime"] ?? {};
    if (pa.natural || pa.granted) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.cantSell"));
    return this.#confirmSell(seller, item);
  }

  /** Confirm a sale: quantity (for stacks) + the shop's offer, then route it. */
  async #confirmSell(seller, item) {
    const { sell } = tradePrices(this.actor, seller, item);
    const owned = STACKABLE_STOCK.has(item.type) ? (Number(item.system.quantity) || 0) : 1;
    const qty = await this.#tradeDialog({
      title: game.i18n.format("PROJECTANIME.Merchant.sellTitle", { item: item.name }),
      each: sell,
      max: owned,
      button: game.i18n.localize("PROJECTANIME.Merchant.sell")
    });
    if (!qty) return;
    return requestSell(this.actor, seller, item, qty);
  }

  /** Quantity + price confirm. Resolves the chosen quantity, or 0 when cancelled. */
  async #tradeDialog({ title, each, max, purse = null, button }) {
    const qtyRow = max > 1
      ? `<div class="form-group">
           <label>${game.i18n.localize("PROJECTANIME.Merchant.qty")}</label>
           <input type="number" name="qty" value="1" min="1" max="${max}" step="1" autofocus />
         </div>`
      : "";
    const priceLine = game.i18n.format("PROJECTANIME.Merchant.each", { g: each })
      + (purse !== null ? ` · ${game.i18n.format("PROJECTANIME.Merchant.purse", { g: purse })}` : "");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title, icon: "fa-solid fa-coins" },
      content: `<div class="pa-trade">${qtyRow}<p class="pa-trade-line"><i class="fas fa-coins"></i> ${priceLine}</p></div>`,
      buttons: [
        {
          action: "ok", label: button, icon: "fa-solid fa-coins", default: true,
          callback: (event, btn) => Math.max(1, Math.min(max, Math.floor(Number(btn.form?.elements?.qty?.value) || 1)))
        },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    return typeof result === "number" ? result : 0;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Buy button on a stock row — quantity/confirm dialog, then route the purchase. */
  static async #onBuyItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = id ? this.actor.items.get(id) : null;
    if (!item) return;
    const patron = this.#patron();
    if (!patron) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.noBuyer"));

    const sys = this.actor.system;
    const { buy } = tradePrices(this.actor, patron, item);
    const purse = Number(patron.system.gold) || 0;
    if (buy > purse) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.cantAfford"));

    const stackable = STACKABLE_STOCK.has(item.type);
    const stock = stackable ? (Number(item.system.quantity) || 0) : 1;
    const affordable = buy > 0 ? Math.floor(purse / buy) : 99;
    const max = stackable ? Math.max(1, Math.min(sys.infiniteStock ? 99 : stock, affordable)) : 1;

    target.disabled = true;   // one dialog per click — a double-click can't queue two purchases
    try {
      const qty = await this.#tradeDialog({
        title: game.i18n.format("PROJECTANIME.Merchant.buyTitle", { item: item.name }),
        each: buy,
        max,
        purse,
        button: game.i18n.localize("PROJECTANIME.Merchant.buy")
      });
      if (!qty) return;
      if (buy * qty > purse) return void ui.notifications.warn(game.i18n.localize("PROJECTANIME.Merchant.cantAfford"));
      await requestBuy(this.actor, item, patron, qty);
    } finally {
      target.disabled = false;
    }
  }

  static #onEditItem(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  static async #onDeleteItem(event, target) {
    if (!this.isEditable) return;
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    await this.actor.items.get(id)?.delete();
  }

  static async #onEditImage() {
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.actor.img || "",
      callback: (path) => this.actor.update({ img: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  /* -------------------------------------------- */
  /*  Drops — suppress core's auto-create         */
  /* -------------------------------------------- */

  /** Foundry's ActorSheetV2 binds its own `element.ondrop` every render, which auto-creates a raw
   *  copy of any dropped Item — our #onDrop routes stocking/selling itself, so both channels would
   *  land the drop twice. Suppress the base auto-create for foreign items; keep delegating own-item
   *  drops to core so re-sorting the shelf still works. */
  async _onDropItem(event, item) {
    if (this.actor.uuid !== item?.parent?.uuid) return null;
    return super._onDropItem(event, item);
  }

  /** No ActiveEffects live on a merchant — suppress the base auto-create on effect drops. */
  async _onDropActiveEffect(event, effect) {
    return null;
  }

  /** Dropping an actor on the shop does nothing. */
  async _onDropActor(event, actor) {
    return null;
  }
}
