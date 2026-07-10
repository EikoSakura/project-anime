import { cleanItemForTransfer } from "./gear.mjs";
import { BASE_SELL_PCT, BASE_BUY_PCT } from "./effects.mjs";
import { postCard, cardHTML, tickerHTML } from "./dice.mjs";

/** Item types a Merchant trades — gear only, never Skills / Packages (the party Stash's list). */
export const MERCHANT_STOCK = new Set(["weapon", "armor", "shield", "accessory", "consumable", "container", "gear"]);

/** Stackable stock — the two quantity-bearing item types; everything else trades one at a time. */
export const STACKABLE_STOCK = new Set(["consumable", "gear"]);

const i18n = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * Effective prices for one item at this shop, for this patron. The shop's own base rates
 * (`system.buyRate` / `system.sellRate`, percents of list cost) are shifted by the patron's
 * trade effects as DELTAS from the world baselines — so a Trader's Pass (sell 60%) is +10
 * at every stall. Single integer currency: buy rounds (min 1 G for anything with a cost),
 * sell floors; clamps mirror collectTradeRates (sell 0–100, buy 0–1000).
 */
export function tradePrices(merchant, patron, item) {
  const cost = Number(item?.system?.cost) || 0;
  const ms = merchant?.system ?? {};
  const dBuy = patron ? (Number(patron.system?.buyRate ?? BASE_BUY_PCT) - BASE_BUY_PCT) : 0;
  const dSell = patron ? (Number(patron.system?.sellRate ?? BASE_SELL_PCT) - BASE_SELL_PCT) : 0;
  const buyPct = Math.min(1000, Math.max(0, Number(ms.buyRate ?? BASE_BUY_PCT) + dBuy));
  const sellPct = Math.min(100, Math.max(0, Number(ms.sellRate ?? BASE_SELL_PCT) + dSell));
  const buy = cost > 0 ? Math.max(1, Math.round((cost * buyPct) / 100)) : 0;
  const sell = Math.floor((cost * sellPct) / 100);
  return { buy, sell, buyPct, sellPct };
}

/** Tell the requesting user something went wrong — a toast locally, a whisper across the relay. */
function tellUser(userId, text) {
  const user = game.users.get(userId);
  if (!user) return;
  if (user.isSelf) return void ui.notifications.warn(text);
  ChatMessage.create({ content: tickerHTML(text, { icon: "fa-coins" }), whisper: [userId] });
}

/** One-line trade receipt card, spoken by the trading character. */
function postReceipt(actor, merchant, snap, qty, gold, key) {
  return postCard(actor, cardHTML({
    title: snap.name,
    subtitle: merchant.name,
    icon: snap.img,
    lines: [i18n(key, { n: qty, g: gold })]
  }));
}

/**
 * Execute one purchase — run by a client allowed to write BOTH sides (the buyer's owner when
 * they also own the shop, else the active GM via the `merchantBuy` socket op). Everything is
 * re-validated here against current world state — stock clamp, recomputed price, live purse —
 * never trusted from the click (two racing buyers can't dupe the last item).
 */
export async function merchantBuyTo(merchantUuid, itemId, buyerUuid, qty, userId) {
  const merchant = await fromUuid(merchantUuid);
  const buyer = await fromUuid(buyerUuid);
  const user = game.users.get(userId);
  if (merchant?.type !== "merchant" || !buyer || !user) return;
  if (!buyer.testUserPermission(user, "OWNER")) return;
  const item = merchant.items.get(itemId);
  if (!item || !MERCHANT_STOCK.has(item.type)) return tellUser(userId, i18n("PROJECTANIME.Merchant.soldOut"));

  const ms = merchant.system;
  const stackable = STACKABLE_STOCK.has(item.type);
  const stock = stackable ? (Number(item.system.quantity) || 0) : 1;
  let n = Math.max(1, Math.floor(Number(qty) || 1));
  if (!stackable) n = 1;
  if (!ms.infiniteStock) n = Math.min(n, stock);
  if (n <= 0) return tellUser(userId, i18n("PROJECTANIME.Merchant.soldOut"));

  const { buy } = tradePrices(merchant, buyer, item);
  const total = buy * n;
  const purse = Number(buyer.system.gold) || 0;
  if (total > purse) return tellUser(userId, i18n("PROJECTANIME.Merchant.cantAfford"));

  // Snapshot + hand-over copy FIRST — the shelf item may be deleted below.
  const snap = { name: item.name, img: item.img };
  const obj = cleanItemForTransfer(item);
  if (stackable) foundry.utils.setProperty(obj, "system.quantity", n);

  await buyer.update({ "system.gold": purse - total });
  const existing = stackable ? buyer.items.find((i) => i.type === item.type && i.name === item.name) : null;
  if (existing) await existing.update({ "system.quantity": (Number(existing.system.quantity) || 0) + n });
  else await buyer.createEmbeddedDocuments("Item", [obj]);

  if (!ms.infiniteStock) {
    if (stackable && stock - n > 0) await item.update({ "system.quantity": stock - n });
    else await item.delete();
  }
  if (!ms.infiniteGold) await merchant.update({ "system.gold": (Number(ms.gold) || 0) + total });

  return postReceipt(buyer, merchant, snap, n, total, "PROJECTANIME.Merchant.bought");
}

/**
 * Execute one sale (player → shop): the goods leave the seller and enter stock (stacking onto a
 * matching pile), the till pays out. Same authority + re-validation model as merchantBuyTo.
 */
export async function merchantSellTo(merchantUuid, sellerUuid, itemId, qty, userId) {
  const merchant = await fromUuid(merchantUuid);
  const seller = await fromUuid(sellerUuid);
  const user = game.users.get(userId);
  if (merchant?.type !== "merchant" || !seller || !user) return;
  if (!seller.testUserPermission(user, "OWNER")) return;
  const item = seller.items.get(itemId);
  if (!item || !MERCHANT_STOCK.has(item.type)) return tellUser(userId, i18n("PROJECTANIME.Merchant.cantSell"));
  const pa = item.flags?.["project-anime"] ?? {};
  if (pa.natural || pa.granted) return tellUser(userId, i18n("PROJECTANIME.Merchant.cantSell"));

  const ms = merchant.system;
  const stackable = STACKABLE_STOCK.has(item.type);
  const owned = stackable ? (Number(item.system.quantity) || 0) : 1;
  let n = Math.max(1, Math.floor(Number(qty) || 1));
  if (!stackable) n = 1;
  n = Math.min(n, owned);
  if (n <= 0) return;

  const { sell } = tradePrices(merchant, seller, item);
  const total = sell * n;
  const till = Number(ms.gold) || 0;
  if (!ms.infiniteGold && total > till) return tellUser(userId, i18n("PROJECTANIME.Merchant.merchantBroke", { name: merchant.name }));

  const snap = { name: item.name, img: item.img };
  const obj = cleanItemForTransfer(item);
  if (stackable) foundry.utils.setProperty(obj, "system.quantity", n);

  if (stackable && owned - n > 0) await item.update({ "system.quantity": owned - n });
  else await item.delete();
  await seller.update({ "system.gold": (Number(seller.system.gold) || 0) + total });

  const existing = stackable ? merchant.items.find((i) => i.type === obj.type && i.name === obj.name) : null;
  if (existing) await existing.update({ "system.quantity": (Number(existing.system.quantity) || 0) + n });
  else await merchant.createEmbeddedDocuments("Item", [obj]);
  if (!ms.infiniteGold) await merchant.update({ "system.gold": till - total });

  return postReceipt(seller, merchant, snap, n, total, "PROJECTANIME.Merchant.sold");
}

/** Route a purchase: run locally when this user may write both sides, else relay to the active GM. */
export function requestBuy(merchant, item, buyer, qty) {
  if (merchant.isOwner && buyer.isOwner) return merchantBuyTo(merchant.uuid, item.id, buyer.uuid, qty, game.user.id);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", {
      type: "merchantBuy", merchantUuid: merchant.uuid, itemId: item.id, buyerUuid: buyer.uuid, qty, userId: game.user.id
    });
    return true;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/** Route a sale: run locally when this user may write both sides, else relay to the active GM. */
export function requestSell(merchant, seller, item, qty) {
  if (merchant.isOwner && seller.isOwner) return merchantSellTo(merchant.uuid, seller.uuid, item.id, qty, game.user.id);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", {
      type: "merchantSell", merchantUuid: merchant.uuid, sellerUuid: seller.uuid, itemId: item.id, qty, userId: game.user.id
    });
    return true;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}
