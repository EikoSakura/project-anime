/**
 * Shared gear/inventory logic — the stateless half of the actor sheet's Gear drawer, extracted so
 * BOTH the actor sheet (module/sheets/actor-sheet.mjs) and the Monster Creator's Gear step
 * (module/apps/monster-creator.mjs) drive the SAME paperdoll + bag-grid + equip/transfer behavior.
 *
 * Everything here is a free function taking the `actor` (and, where relevant, a `selectedBag` id)
 * explicitly — no `this`, no private fields — so either host can call it. The hosts keep their own
 * thin action handlers, popovers, and drag bindings; the substance lives here.
 */

/** Loose gear item types shown as inventory grids (Skills + Containers are handled
 *  separately — containers are the WoW-style "bags" in the container bar). */
export const GEAR_GROUPS = ["weapon", "armor", "shield", "accessory", "consumable", "gear"];

/** Item types that can be equipped (and so get an equip toggle). */
export const EQUIPPABLE = new Set(["weapon", "armor", "shield", "accessory"]);

/** Item types that can be copied onto an actor via drag-drop (every embeddable Item type). */
export const TRANSFERABLE_ITEM_TYPES = new Set([...GEAR_GROUPS, "skill", "container", "package"]);

/** Paperdoll equip slots, positioned over the portrait in the Gear drawer (the
 *  template places each by `key` via CSS). The two accessory slots use the
 *  "accessory:N" form (N = position among equipped). */
export const PAPERDOLL_SLOTS = [
  { key: "mainHand",    icon: "fa-hand-fist",     base: "mainHand"  },
  { key: "offHand",     icon: "fa-shield-halved", base: "offHand"   },
  { key: "armor",       icon: "fa-shirt",         base: "armor"     },
  { key: "accessory:0", icon: "fa-ring",          base: "accessory" },
  { key: "accessory:1", icon: "fa-ring",          base: "accessory" }
];

/** Item types each paperdoll slot accepts (keyed by the slot's `base`). */
export const SLOT_ACCEPTS = {
  mainHand: ["weapon", "shield"],
  offHand: ["weapon", "shield"],
  armor: ["armor"],
  container: ["container"],
  accessory: ["accessory"]
};

/** Stable inventory ordering: by sort, then name. */
export const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

/** Which equipped item currently fills a paperdoll slot (null if empty). */
export function slotOccupant(slotKey, equipped) {
  if (slotKey === "mainHand") return equipped.find((i) => (i.type === "weapon" || i.type === "shield") && i.system.hand === "main") ?? null;
  if (slotKey === "offHand") return equipped.find((i) => (i.type === "weapon" || i.type === "shield") && i.system.hand === "off") ?? null;
  if (slotKey === "armor") return equipped.find((i) => i.type === "armor") ?? null;
  if (slotKey === "container") return equipped.find((i) => i.type === "container") ?? null;
  if (slotKey.startsWith("accessory:")) {
    const idx = Number(slotKey.split(":")[1]) || 0;
    return equipped.filter((i) => i.type === "accessory").sort(bySort)[idx] ?? null;
  }
  return null;
}

/**
 * The carried-gear render context: the container "bag" bar, the flat inventory grid scoped to the
 * selected bag, and the paperdoll. `selectedBag` is corrected here (a deleted bag falls back to the
 * backpack) and returned so the caller can write the corrected value back to its own state.
 */
export function buildGearContext(actor, { selectedBag = "", bagView = "single" } = {}) {
  const containers = [];
  const groups = Object.fromEntries(GEAR_GROUPS.map((k) => [k, []]));
  for (const item of actor.items) {
    if (item.type === "container") containers.push(item);
    else if (groups[item.type]) groups[item.type].push(item);
  }

  const lite = (i) => ({ id: i.id, name: i.name, img: i.img, system: i.system });

  // Containers (WoW-style bags): a bar of [Backpack] + one tab per container item.
  // The inventory grid below is scoped to whichever bag is selected.
  const containerIds = new Set(containers.map((c) => c.id));
  let sel = selectedBag;
  if (sel && !containerIds.has(sel)) sel = ""; // deleted bag → backpack
  // An item's effective bag: its container if that still exists, else the backpack.
  const bagOf = (i) => {
    const c = i.system?.container || "";
    return c && containerIds.has(c) ? c : "";
  };
  const containable = GEAR_GROUPS.flatMap((k) => groups[k]);

  // One reusable tile mapping: lite item + stack qty badge + equip flags.
  const mapItem = (i) => {
    const l = lite(i);
    const q = Number(i.system?.quantity);
    l.qty = q > 1 ? q : null;          // quantity badge (stacks)
    l.equippable = EQUIPPABLE.has(i.type);
    l.equipped = !!i.system?.equipped;
    return l;
  };
  // Items filed under a bag, lightly ordered by type so like items cluster (FFXIV-style, no headers).
  const itemsInBag = (id) => containable
    .filter((i) => bagOf(i) === id)
    .sort((a, b) => GEAR_GROUPS.indexOf(a.type) - GEAR_GROUPS.indexOf(b.type) || bySort(a, b))
    .map(mapItem);

  // Per-bag sections (the WoW "Combine Bags" view): backpack first, then each container. Weight-based
  // system → a bag's badge is its item COUNT (no slot cap); global carry weight lives in the tab-meta.
  const bagSections = [
    { id: "", name: game.i18n.localize("PROJECTANIME.Container.backpack"), icon: "fa-box-open", backpack: true, capacityBonus: 0 },
    ...containers.sort(bySort).map((c) => ({ id: c.id, name: c.name, img: c.img, backpack: false, capacityBonus: Number(c.system?.capacityBonus) || 0 }))
  ].map((m) => { const items = itemsInBag(m.id); return { ...m, count: items.length, selected: m.id === sel, items }; });

  // Bag-bar tabs derive from the sections (counts stay in sync).
  const bags = bagSections.map((s) => ({ id: s.id, name: s.name, icon: s.icon, img: s.img, backpack: s.backpack, count: s.count, selected: s.selected }));

  // Single-bag ("Open a Bag") view: the selected bag + its items.
  const openBag = bagSections.find((s) => s.selected) ?? bagSections[0];
  const bagItems = openBag.items;

  // Paperdoll: resolve each slot's current occupant. A flat list — the template
  // positions each slot over the portrait by its `key`.
  const equipped = actor.items.filter((i) => i.system?.equipped);
  // A two-handed main weapon spans both hands, so the off-hand slot reads as locked (empty but held).
  const mainWeapon = slotOccupant("mainHand", equipped);
  const twoHandedMain = !!mainWeapon && mainWeapon.type === "weapon"
    && (mainWeapon.system.grip === "two" || mainWeapon.system.twoHandedOnly);
  const paperdoll = PAPERDOLL_SLOTS.map((def) => {
    const it = slotOccupant(def.key, equipped);
    let label = game.i18n.localize(`PROJECTANIME.Equipment.${def.base}`);
    if (def.base === "accessory") label += ` ${Number(def.key.split(":")[1]) + 1}`;
    return {
      key: def.key,
      icon: def.icon,
      label,
      locked: def.key === "offHand" && !it && twoHandedMain,
      // Shields carry their Wield-As mode so the slot can show an inline toggle (Dual Wield ↔
      // Shield Only) — see the `pdSlot` partial + the host's cycleShieldUse handler.
      item: it ? {
        id: it.id, name: it.name, img: it.img,
        shield: it.type === "shield",
        dualWield: it.type === "shield" && it.system.use === "dual",
        // The main-hand weapon slot shows an inline one-/two-handed grip toggle (a Two-Handed-Only
        // weapon has no grip to flip). Two-handed spans both hands → the off hand reads as locked.
        weapon: it.type === "weapon",
        gripToggle: def.key === "mainHand" && it.type === "weapon" && !it.system.twoHandedOnly,
        twoHanded: it.type === "weapon" && it.system.grip === "two"
      } : null
    };
  });

  return { selectedBag: sel, bagView, bags, bagItems, bagSections, openBag, paperdoll };
}

/** Equip `item` into a paperdoll slot on `actor`, clearing whatever it displaces. */
export async function equipToSlot(actor, item, slotKey) {
  if (!item || !slotKey) return;
  const base = slotKey.startsWith("accessory") ? "accessory" : slotKey;
  if (!SLOT_ACCEPTS[base]?.includes(item.type)) return;

  const equipped = actor.items.filter((i) => i.system?.equipped && i.id !== item.id);
  const updates = [];
  const clear = (it) => updates.push({ _id: it.id, "system.equipped": false });
  const target = { _id: item.id, "system.equipped": true };

  switch (base) {
    case "mainHand": {
      const twoHanded = item.system.grip === "two";
      target["system.hand"] = "main";
      for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "main") clear(it);
      // A two-handed grip occupies both hands → also free the off hand.
      if (twoHanded) for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "off") clear(it);
      break;
    }
    case "offHand": {
      target["system.hand"] = "off";
      for (const it of equipped) if ((it.type === "weapon" || it.type === "shield") && it.system.hand === "off") clear(it);
      // A two-handed weapon in the main hand must give up a hand for this.
      for (const it of equipped) if (it.type === "weapon" && it.system.hand === "main" && it.system.grip === "two") clear(it);
      break;
    }
    case "armor":
      for (const it of equipped) if (it.type === "armor") clear(it);
      break;
    case "container":
      for (const it of equipped) if (it.type === "container") clear(it);
      break;
    case "accessory": {
      const idx = Number(slotKey.split(":")[1]) || 0;
      const accs = equipped.filter((i) => i.type === "accessory").sort(bySort);
      if (accs[idx]) clear(accs[idx]);               // swap out this slot's occupant
      const rest = accs.filter((_, i) => i !== idx);
      while (rest.length >= 2) clear(rest.pop());     // never exceed two accessory slots
      break;
    }
  }

  updates.push(target);
  await actor.updateEmbeddedDocuments("Item", updates);
}

/** Equip a weapon/shield into a free hand — weapons prefer the main hand, shields the off; fall back
 *  to whichever hand is open, else swap the preferred one. A two-handed weapon always claims the main
 *  hand (freeing the off). Used by the gear menu's single "Equip". */
export async function equipToAvailableHand(actor, item) {
  if (!item || (item.type !== "weapon" && item.type !== "shield")) return;
  if (item.type === "weapon" && (item.system?.twoHandedOnly || item.system?.grip === "two")) {
    return equipToSlot(actor, item, "mainHand");
  }
  const hands = actor.items.filter((i) => i.system?.equipped && i.id !== item.id
    && (i.type === "weapon" || i.type === "shield"));
  const mainItem = hands.find((i) => i.system.hand === "main") ?? null;
  const offItem = hands.find((i) => i.system.hand === "off") ?? null;
  const mainTwoH = !!mainItem && mainItem.type === "weapon"
    && (mainItem.system.grip === "two" || mainItem.system.twoHandedOnly);
  const mainFree = !mainItem;
  const offFree = !offItem && !mainTwoH;   // a two-handed main weapon locks the off hand
  let slot;
  if (item.type === "shield") slot = offFree ? "offHand" : (mainFree ? "mainHand" : "offHand");
  else slot = mainFree ? "mainHand" : (offFree ? "offHand" : "mainHand");
  return equipToSlot(actor, item, slot);
}

/** Unequip whatever fills `slotKey` on `actor`. */
export async function clearSlot(actor, slotKey) {
  const occupant = slotOccupant(slotKey, actor.items.filter((i) => i.system?.equipped));
  if (occupant) await occupant.update({ "system.equipped": false });
}

/** Parse the drag payload (the JSON stashed on `text/plain` by our sheets + core Foundry). */
export function readDrag(ev) {
  try { return JSON.parse(ev.dataTransfer.getData("text/plain") || "{}"); } catch (_) { return {}; }
}

/** Resolve the embedded item being dragged within THIS actor's UI (null if foreign / not ours). */
export function draggedItem(actor, ev) {
  const data = readDrag(ev);
  return data.paItem ? (actor.items.get(data.paItem) ?? null) : null;
}

/** Stamp the compendium origin onto item-creation data so the copy can later be Refreshed from
 *  source (the item sheet's ↻ button reads `_stats.compendiumSource`). Mirrors core's
 *  WorldCollection#fromCompendium: a compendium document IS the origin (its own uuid); a
 *  world/actor document carries whatever origin it already had; a hand-made item has none.
 *  `compendiumSource` is not a server-managed stat, so it survives createEmbeddedDocuments. */
export function stampCompendiumSource(data, source) {
  const uuid = source?.pack ? source.uuid : (source?._stats?.compendiumSource ?? null);
  if (uuid) foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);
  return data;
}

/** Strip a source item down to a clean object for copying onto an actor: drop the id, the
 *  grant/natural/pin flags (meaningless or duplicative on a new owner), and reset the
 *  equipped/bag state so the copy lands loose in the chosen bag (default backpack). The
 *  compendium origin is preserved so the copy stays Refreshable. */
export function cleanItemForTransfer(item, { container = "" } = {}) {
  const obj = item.toObject();
  delete obj._id;
  delete obj.sort;
  const paFlags = obj.flags?.["project-anime"];
  if (paFlags) {
    delete paFlags.granted;     // a copy is a normally-owned ability, not a grant…
    delete paFlags.grantedBy;   // …and its source carrier doesn't exist on the new owner
    delete paFlags.natural;     // retired innate-strike flag — scrub it off legacy copies
    delete paFlags.readied;     // don't auto-pin to the new owner's quick panel
  }
  if (obj.system) {
    if ("equipped" in obj.system) obj.system.equipped = false;
    if ("container" in obj.system) obj.system.container = item.type === "container" ? "" : container;
  }
  stampCompendiumSource(obj, item);
  return obj;
}

/** Copy a dropped foreign Item (from another sheet / compendium / sidebar / stash) onto `actor`.
 *  Returns the created Item, or null if the drop wasn't a transferable foreign item. */
export async function importDroppedItem(actor, data, options = {}) {
  if (data?.type !== "Item" || !data.uuid) return null;
  const item = await fromUuid(data.uuid);
  if (!item || item.documentName !== "Item" || !TRANSFERABLE_ITEM_TYPES.has(item.type)) return null;
  if (item.parent?.id === actor.id) return null; // already ours — never self-copy
  const [created] = await actor.createEmbeddedDocuments("Item", [cleanItemForTransfer(item, options)]);
  return created ?? null;
}
