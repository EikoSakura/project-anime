/**
 * Project: Anime — Skill Browser (the "skill bag").
 *
 * An MMO-style inventory-bag picker for handing Skills to a monster/NPC. It scans every Skill it can
 * reach — the world's loose Skill items and every Item compendium — and lays them out as a grid of
 * icon slots, filed into "bags" by their Folder (with the source compendium/world as a subtitle). The
 * GM clicks a slot to give that Skill to the actor; clicking an already-given slot takes it back.
 *
 * Given skills are copied onto the actor via helpers/gear.mjs `cleanItemForTransfer` (so they keep a
 * Refreshable compendium origin) and stamped with a `browserSource` flag = the source UUID, which is
 * how a slot knows it is already in the loadout. Opened from the Monster Creator's Abilities step.
 */
import { cleanItemForTransfer } from "../helpers/gear.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = (k) => game.i18n.localize(`PROJECTANIME.${k}`);

/** Group-key separator joining a skill's source id to its folder name (HTML-attribute-safe; the source
 *  half is "world" or a pack collection id, so it never contains "::"). */
const SEP = "::";

/** Fallback icon for a Skill with no image. */
const FALLBACK_IMG = "icons/svg/book.svg";

export class SkillBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-skill-browser-${actor.id}` });
    this.actor = actor;
  }

  /** Open (or focus) the browser for an actor. */
  static open(actor) {
    const id = `pa-skill-browser-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new SkillBrowserApp(actor);
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "theme-dark", "pa-skill-browser"],
    position: { width: 620, height: 640 },
    window: { title: "PROJECTANIME.SkillBrowser.title", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      pickBag: SkillBrowserApp.#onPickBag,
      toggleSkill: SkillBrowserApp.#onToggleSkill,
      refresh: SkillBrowserApp.#onRefresh,
      done: SkillBrowserApp.#onDone
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/skill-browser.hbs", scrollable: [".sb-bags", ".sb-grid-wrap"] }
  };

  /** Cached catalogue of every reachable Skill (world + compendium index). Built once per open. */
  #catalogue = null;

  /** Selected bag key ("all" or a `sourceKey\0folderName` group). */
  #bag = "all";

  /** Live search text (client-side DOM filter — never triggers a re-render). */
  #query = "";

  get title() {
    return `${L("SkillBrowser.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Catalogue                                   */
  /* -------------------------------------------- */

  /** One catalogue record. `groupKey` bags by source+folder; `groupLabel` prefers the folder name. */
  #record(uuid, name, img, sourceKey, sourceLabel, folderName) {
    return {
      uuid, name, img: img || FALLBACK_IMG,
      sourceLabel,
      groupKey: `${sourceKey}${SEP}${folderName ?? ""}`,
      groupLabel: folderName || sourceLabel,
      nameLc: (name || "").toLowerCase()
    };
  }

  /** Load every reachable Skill: the world's loose Skill items + every Item compendium's Skill entries
   *  (via a lightweight index — full documents are only fetched when a slot is actually clicked). */
  async #ensureCatalogue() {
    if (this.#catalogue) return;
    const out = [];

    // World — loose Skill items, filed by their Folder.
    const worldLabel = L("SkillBrowser.world");
    for (const it of game.items ?? []) {
      if (it.type !== "skill") continue;
      out.push(this.#record(it.uuid, it.name, it.img, "world", worldLabel, it.folder?.name || null));
    }

    // Compendiums — any Item pack, Skill entries only, filed by their compendium Folder.
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item") continue;
      let index;
      try { index = await pack.getIndex({ fields: ["type", "img", "folder"] }); }
      catch (_e) { continue; }   // unreadable pack — skip it
      const packLabel = pack.metadata?.label || pack.title || pack.collection;
      for (const e of index) {
        if (e.type !== "skill") continue;
        const folderName = e.folder ? (pack.folders?.get(e.folder)?.name || null) : null;
        const uuid = e.uuid || `Compendium.${pack.collection}.Item.${e._id}`;
        out.push(this.#record(uuid, e.name, e.img, pack.collection, packLabel, folderName));
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    this.#catalogue = out;
  }

  /** UUIDs of every source already represented in the actor's loadout (browser copies + any item
   *  carrying a matching compendium origin), so a slot can show its "in loadout" state. */
  #ownedSources() {
    const set = new Set();
    for (const it of this.actor.items) {
      if (it.type !== "skill") continue;
      const cs = it._stats?.compendiumSource; if (cs) set.add(cs);
      const bs = it.getFlag("project-anime", "browserSource"); if (bs) set.add(bs);
    }
    return set;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    await this.#ensureCatalogue();
    const cat = this.#catalogue;
    const owned = this.#ownedSources();

    // Bags (folders) — one per group, with the source as a subtitle + a count. "All" leads.
    const bagMap = new Map();
    for (const s of cat) {
      let b = bagMap.get(s.groupKey);
      if (!b) { b = { key: s.groupKey, label: s.groupLabel, source: s.sourceLabel, count: 0 }; bagMap.set(s.groupKey, b); }
      b.count += 1;
    }
    const bags = [...bagMap.values()].sort((a, b) => a.source.localeCompare(b.source) || a.label.localeCompare(b.label));
    // A folder whose name equals its own source (e.g. an un-foldered "World") needs no subtitle.
    for (const b of bags) if (b.label === b.source) b.source = "";
    if (!bags.some((b) => b.key === this.#bag)) this.#bag = "all";
    bags.unshift({ key: "all", label: L("SkillBrowser.all"), source: "", count: cat.length });
    for (const b of bags) b.active = b.key === this.#bag;

    // Slots — every skill is rendered; the bag + search filters run client-side in #applyFilter.
    const tiles = cat.map((s) => ({
      uuid: s.uuid, name: s.name, img: s.img, group: s.groupKey, nameLc: s.nameLc,
      added: owned.has(s.uuid)
    }));

    return {
      bags,
      tiles,
      query: this.#query,
      empty: cat.length === 0,
      skillCount: this.actor.items.filter((i) => i.type === "skill").length
    };
  }

  /* -------------------------------------------- */
  /*  Render / filtering                          */
  /* -------------------------------------------- */

  /** @override — (re)wire the live search box, then apply the current bag + query filter. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector(".sb-search");
    if (search) search.addEventListener("input", () => { this.#query = search.value; this.#applyFilter(); });
    this.#applyFilter();
  }

  /** Show only slots that match the active bag AND the search text. A non-empty search reaches across
   *  every bag (find-anywhere); an empty search respects the selected bag. Pure DOM — no re-render. */
  #applyFilter() {
    const root = this.element;
    if (!root) return;
    const q = this.#query.trim().toLowerCase();
    const g = this.#bag;
    let anyVisible = false;
    for (const tile of root.querySelectorAll(".sb-slot")) {
      const nameMatch = !q || tile.dataset.name.includes(q);
      const bagMatch = q ? true : (g === "all" || tile.dataset.group === g);
      const show = nameMatch && bagMatch;
      tile.hidden = !show;
      if (show) anyVisible = true;
    }
    root.querySelector(".sb-empty")?.toggleAttribute("hidden", anyVisible);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Select a bag (folder) — re-render so the active chip + slot visibility update. */
  static #onPickBag(event, target) {
    this.#bag = target.dataset.bag || "all";
    this.render();
  }

  /** Give / take back a Skill. Already in the loadout → delete the copies; otherwise copy the source
   *  onto the actor (keeping its compendium origin) stamped with `browserSource` for future matching. */
  static async #onToggleSkill(event, target) {
    if (!this.actor.isOwner) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const matches = this.actor.items.filter((i) => i.type === "skill" &&
      (i._stats?.compendiumSource === uuid || i.getFlag("project-anime", "browserSource") === uuid));
    if (matches.length) {
      await this.actor.deleteEmbeddedDocuments("Item", matches.map((i) => i.id));
    } else {
      const src = await fromUuid(uuid);
      if (!src) return ui.notifications.warn(L("SkillBrowser.missing"));
      const data = cleanItemForTransfer(src);
      foundry.utils.setProperty(data, "flags.project-anime.browserSource", uuid);
      await this.actor.createEmbeddedDocuments("Item", [data]);
    }
    this.render();
  }

  /** Rebuild the catalogue (picks up newly-authored world/compendium Skills). */
  static #onRefresh() {
    this.#catalogue = null;
    this.render();
  }

  static #onDone() {
    this.close();
  }
}
