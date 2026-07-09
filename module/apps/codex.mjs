/**
 * Project: Anime — THE CODEX: the campaign QUEST LOG window.
 *
 * One standalone window (opened from the scene-controls book button, or "L") holding the Chronicle
 * quest log: a quest rail + cinematic detail view, GM inline authoring, reward distribution, and the
 * on-canvas quest tracker (ChronicleTracker). Quests are world-scoped data (the `quests` world
 * setting), so the Codex isn't bound to any one actor.
 *
 * The window carries the legacy `chronicle-app` CSS class so the entire quest UI styling (scoped
 * under `.chronicle-app`) applies verbatim.
 */

import {
  getQuests,
  saveQuests,
  blankQuest,
  questProgress,
  QUEST_CATEGORIES,
  QUEST_SIZES,
  postingBudget,
  partyTier,
  grantRewards,
  promptMilestoneAward,
  TRACKED_SETTING,
  TRACKER_VISIBLE_SETTING
} from "../helpers/chronicle.mjs";
import { partyMembers, partyActors } from "../helpers/party-folder.mjs";
import { isImageIcon } from "../helpers/config.mjs";
import { cardHTML } from "../helpers/dice.mjs";
import { postQuestToDiscord } from "../helpers/discord.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Fallback banner gradients (used when a quest has no banner image) — by category. */
const BANNER_GRAD = {
  main: "radial-gradient(120% 120% at 78% 12%, #b78a2e55, transparent 55%), linear-gradient(150deg,#4a3563,#2c1d3f 58%,#16101f)",
  side: "radial-gradient(120% 120% at 24% 16%, #6c4f9c66, transparent 55%), linear-gradient(150deg,#36294f,#231838 60%,#150e22)",
  personal: "radial-gradient(120% 120% at 50% 14%, #43b88a55, transparent 55%), linear-gradient(150deg,#1e3a34,#142824 60%,#0e1a17)"
};

/** Banner zoom factor (scroll-wheel on the hero), clamped to 1–4× (1 = cover / no zoom). */
const BANNER_ZOOM_MIN = 1, BANNER_ZOOM_MAX = 4;
const bannerZoomOf = (q) => Math.max(BANNER_ZOOM_MIN, Math.min(BANNER_ZOOM_MAX, Number(q?.bannerZoom) || 1));

/** Escape text before injecting into innerHTML (GM-authored text, but be safe). */
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Per-type display data for a quest reward chip. */
function rewardView(r, i) {
  const L = (k) => game.i18n.localize(`PROJECTANIME.Chronicle.reward.${k}`);
  switch (r.type) {
    case "sp":
      return { idx: i, type: "sp", icon: "◆", v: `+${r.value ?? 0}`, l: L("sp"), rg: "#9a78e0" };
    case "gold":
      return { idx: i, type: "gold", icon: "G", v: `${r.value ?? 0}`, l: L("gold"), rg: "#e0c14a" };
    case "item":
      return { idx: i, type: "item", img: r.img || "icons/svg/item-bag.svg", v: r.name || L("item"), l: L("item"), rg: "#9ad0ff" };
    case "unlock":
      return { idx: i, type: "unlock", icon: "⚿", v: r.label || L("unlock"), l: L("unlock"), rg: "#6fe0b0" };
    default:
      return { idx: i, type: r.type, icon: "?", v: "", l: r.type, rg: "#9a78e0" };
  }
}

/* -------------------------------------------------------------------------- */
/*  The Codex app                                                             */
/* -------------------------------------------------------------------------- */

export class Codex extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  /** Open (or focus) the shared Codex window. */
  static open() {
    if (!this._instance || this._instance.rendered === false) this._instance = new Codex();
    this._instance.render(true);
    return this._instance;
  }

  constructor(options = {}) {
    super({ ...options, id: "pa-codex" });
    this._tab = "all";   // quest category filter (all | main | side | personal | completed)
    this._selId = null;  // selected quest id
  }

  static DEFAULT_OPTIONS = {
    id: "pa-codex",
    // `chronicle-app` is kept so the quest-pane CSS (scoped under it) applies verbatim.
    classes: ["project-anime", "theme-dark", "pa-codex", "chronicle-app"],
    position: { width: 1080, height: 720 },
    window: { title: "PROJECTANIME.Codex.title", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      openActor: Codex.#onOpenActor,
      selectQuest: Codex.#onSelectQuest,
      setTab: Codex.#onSetTab,
      newQuest: Codex.#onNewQuest,
      milestone: Codex.#onMilestone,
      deleteQuest: Codex.#onDeleteQuest,
      exitEdit: Codex.#onExitEdit,
      toggleObjective: Codex.#onToggleObjective,
      addObjective: Codex.#onAddObjective,
      removeObjective: Codex.#onRemoveObjective,
      addReward: Codex.#onAddReward,
      removeReward: Codex.#onRemoveReward,
      setLevel: Codex.#onSetLevel,
      clearGiver: Codex.#onClearGiver,
      openGiver: Codex.#onOpenGiver,
      pickIcon: Codex.#onPickIcon,
      complete: Codex.#onComplete,
      distribute: Codex.#onDistribute,
      reopen: Codex.#onReopen,
      abandon: Codex.#onAbandon,
      track: Codex.#onTrack,
      postDiscord: Codex.#onPostDiscord
    }
  };

  static PARTS = {
    quests: { template: "systems/project-anime/templates/codex/quests.hbs", scrollable: [".q-list", ".q-detail"] }
  };

  /** GM quest-authoring toggle. Off → every quest shows its pretty read-only view (same as players);
   *  on → the selected quest reveals its inline edit fields. Transient; reset when navigating away. */
  #editMode = false;

  /** Live banner-zoom while the GM is scrolling the hero (null between gestures), + its debounce-save
   *  timer — so rapid wheel ticks update the DOM but persist to the setting only once they settle. */
  #bannerZoom = null;
  #bannerZoomTimer = null;

  get isGM() {
    return game.user.isGM;
  }

  /* ----------------------------- context ----------------------------- */

  async _prepareContext(options) {
    const isGM = this.isGM;
    const ctx = {
      isGM,
      editMode: isGM && this.#editMode
    };
    Object.assign(ctx, await this.#questsContext());
    return ctx;
  }

  /** Build the Quests-pane view-model (the former Chronicle context). */
  async #questsContext() {
    const quests = getQuests();

    const counts = {
      all: quests.length,
      main: quests.filter((q) => q.category === "main" && q.status !== "done").length,
      side: quests.filter((q) => q.category === "side" && q.status !== "done").length,
      personal: quests.filter((q) => q.category === "personal" && q.status !== "done").length,
      completed: quests.filter((q) => q.status === "done").length
    };

    let list = quests.filter((q) => {
      if (this._tab === "all") return true;
      if (this._tab === "completed") return q.status === "done";
      return q.category === this._tab && q.status !== "done";
    });

    if (!this._selId || !quests.find((q) => q.id === this._selId)) {
      this._selId = list[0]?.id ?? quests[0]?.id ?? null;
    }
    const selected = quests.find((q) => q.id === this._selId) ?? null;

    const card = (q) => {
      const cat = QUEST_CATEGORIES[q.category] ?? QUEST_CATEGORIES.main;
      const prog = questProgress(q);
      const levelNum = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
      const bz = bannerZoomOf(q);
      const deadline = Number(q.deadline);
      return {
        id: q.id,
        title: q.title,
        category: q.category,
        status: q.status,
        isDone: q.status === "done",
        isNew: q.status === "active" && prog.done === 0, // auto: new until progress/closed
        deadline: q.status === "active" && Number.isFinite(deadline) && deadline > 0 ? deadline : null,
        giverName: q.giver?.name ?? "",
        icon: q.icon || "",
        color: cat.color,
        levelNum,
        levelStars: [1, 2, 3, 4, 5].map((n) => ({ n, on: n <= levelNum })),
        banner: q.banner || "",
        bannerPos: `${Number.isFinite(q.bannerPos?.x) ? q.bannerPos.x : 50}% ${Number.isFinite(q.bannerPos?.y) ? q.bannerPos.y : 50}%`,
        bannerSize: bz > 1 ? `${(bz * 100).toFixed(2)}%` : "cover",
        pct: prog.pct,
        progLabel: q.status === "done" ? "✓" : `${prog.done}/${prog.total}`,
        selected: q.id === this._selId
      };
    };

    const tabs = [
      { k: "all", label: game.i18n.localize("PROJECTANIME.Chronicle.tab.all"), color: "var(--pa-gold)", n: counts.all },
      { k: "main", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.main"), color: "var(--q-main)", n: counts.main },
      { k: "side", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.side"), color: "var(--q-side)", n: counts.side },
      { k: "personal", label: game.i18n.localize("PROJECTANIME.Chronicle.cat.personal"), color: "var(--q-personal)", n: counts.personal },
      { k: "completed", label: game.i18n.localize("PROJECTANIME.Chronicle.tab.completed"), color: "var(--q-done)", n: counts.completed }
    ].map((t) => ({ ...t, on: t.k === this._tab }));

    return {
      tab: this._tab,
      tabs,
      hasQuests: quests.length > 0,
      quests: list.map(card),
      detail: selected ? await this.#detailContext(selected) : null,
      trackedId: game.settings.get("project-anime", TRACKED_SETTING)
    };
  }

  async #detailContext(q) {
    const cat = QUEST_CATEGORIES[q.category] ?? QUEST_CATEGORIES.main;
    const prog = questProgress(q);
    const bannerX = Number.isFinite(q.bannerPos?.x) ? q.bannerPos.x : 50;
    const bannerY = Number.isFinite(q.bannerPos?.y) ? q.bannerPos.y : 50;
    const bannerZoom = bannerZoomOf(q);
    const levelNum = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
    const levelStars = [1, 2, 3, 4, 5].map((n) => ({ n, on: n <= levelNum }));
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let brief = q.brief ?? "";
    try {
      brief = await TE.enrichHTML(q.brief ?? "", { secrets: this.isGM });
    } catch (_e) {
      brief = q.brief ?? "";
    }

    const objectives = (q.objectives ?? []).filter((o) => this.isGM || !o.hidden);

    const opt = (arr, cur) =>
      arr.map((k) => ({ k, label: game.i18n.localize(`PROJECTANIME.Chronicle.cat.${k}`) || k, sel: k === cur }));
    const statusOpt = ["active", "done", "failed"].map((k) => ({
      k,
      label: game.i18n.localize(`PROJECTANIME.Chronicle.state.${k}`),
      sel: k === q.status
    }));

    // Posting economy (v0.03): Size + its Reward Budget (posting Tier = the star rank clamped to
    // I–IV, else the party's Tier; per-character sizes read the first party's roster count).
    const size = QUEST_SIZES.includes(q.size) ? q.size : "";
    // Legacy quests predate the Size axis — an unset one shows "—" until the GM picks a Size.
    const sizeOptions = [
      ...(size ? [] : [{ k: "", label: "—", sel: true }]),
      ...QUEST_SIZES.map((k) => ({
        k, label: game.i18n.localize(`PROJECTANIME.Chronicle.size.${k}`), sel: k === size
      }))
    ];
    const starTier = Math.round(Number(q.level) || 0);
    const postingTier = starTier >= 1 ? Math.min(4, starTier) : partyTier();
    const roster = partyActors()[0];
    const budget = size ? postingBudget(size, postingTier, roster ? partyMembers(roster).length : 1) : 0;

    const deadline = Number(q.deadline);
    const hasDeadline = q.status === "active" && Number.isFinite(deadline) && deadline > 0;

    // Optional real-world scheduled time (epoch ms). The edit input wants a LOCAL "YYYY-MM-DDTHH:mm"
    // string (never toISOString, which is UTC and would shift the shown time); the read strip shows
    // it in the browser's locale.
    const sms = Number(q.scheduledAt);
    const sd = Number.isFinite(sms) && sms > 0 ? new Date(sms) : null;
    const p2 = (x) => String(x).padStart(2, "0");
    const scheduledInput = sd
      ? `${sd.getFullYear()}-${p2(sd.getMonth() + 1)}-${p2(sd.getDate())}T${p2(sd.getHours())}:${p2(sd.getMinutes())}`
      : "";
    const scheduledLabel = sd
      ? sd.toLocaleString(game.i18n.lang, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "";

    const giver = q.giver
      ? { ...q.giver, initial: String(q.giver.name || "?").trim().charAt(0).toUpperCase() }
      : null;

    return {
      ...q,
      giver,
      briefRaw: q.brief ?? "",
      tracked: game.settings.get("project-anime", TRACKED_SETTING) === q.id,
      color: cat.color,
      hasBanner: !!q.banner,
      bannerStyle: q.banner
        ? `background-image:url('${q.banner}'); background-position:${bannerX}% ${bannerY}%${bannerZoom > 1 ? `; background-size:${(bannerZoom * 100).toFixed(2)}%` : ""}`
        : `background:${BANNER_GRAD[q.category] ?? BANNER_GRAD.main}`,
      levelNum,
      levelStars,
      catLabel: game.i18n.localize(`PROJECTANIME.Chronicle.cat.${q.category}`),
      statusLabel: game.i18n.localize(`PROJECTANIME.Chronicle.state.${q.status}`),
      size,
      sizeLabel: size ? game.i18n.localize(`PROJECTANIME.Chronicle.size.${size}`) : "",
      sizeOptions,
      budgetLabel: budget ? game.i18n.format("PROJECTANIME.Chronicle.budget", { g: budget }) : "",
      deadlineNum: Number.isFinite(deadline) && deadline > 0 ? deadline : "",
      deadlineLabel: hasDeadline
        ? game.i18n.format(deadline === 1 ? "PROJECTANIME.Chronicle.deadlineOne" : "PROJECTANIME.Chronicle.deadlineMany", { n: deadline })
        : "",
      deadlineUrgent: hasDeadline && deadline === 1,
      scheduledInput,
      scheduledLabel,
      consequence: q.consequence ?? "",
      complication: q.complication ?? "",
      brief,
      objectives,
      // Map with the real array index first (so the remove/hide controls target the right reward),
      // then drop hidden rewards for players — the GM still sees them, dimmed.
      rewards: (q.rewards ?? [])
        .map((r, i) => ({ ...rewardView(r, i), hidden: !!r.hidden }))
        .filter((rv) => this.isGM || !rv.hidden),
      prog,
      isDone: q.status === "done",
      catOptions: opt(["main", "side", "personal"], q.category),
      statusOptions: statusOpt
    };
  }

  /* ----------------------------- render wiring ----------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this.#bindQuestEvents(root);
  }

  /** Quests-pane listeners: live search filter + (GM) field edits + giver/reward drop zones. */
  #bindQuestEvents(root) {
    // Live client-side search filter (no re-render, keeps input focus).
    const search = root.querySelector(".cw-search input");
    if (search) {
      search.addEventListener("input", (ev) => {
        const q = ev.target.value.trim().toLowerCase();
        for (const c of root.querySelectorAll(".q-card")) {
          const t = (c.dataset.title || "").toLowerCase();
          c.style.display = !q || t.includes(q) ? "" : "none";
        }
      });
    }

    if (!this.isGM) return;

    // GM edits — quest fields, objective fields, and the reward hide toggle, saved on change/blur.
    for (const el of root.querySelectorAll("[data-field], [data-obj-field], [data-rwd-field]")) {
      el.addEventListener("change", this.#onFieldChange.bind(this));
    }
    // GM drop zones: drag an Item → item reward; drag an Actor → quest giver.
    for (const zone of root.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (ev) => { zone.classList.remove("drag-over"); this.#onQuestDrop(ev, zone.dataset.drop); });
    }
    // GM right-click a quest card in the rail → context menu (track, complete/reopen, abandon, delete).
    for (const card of root.querySelectorAll(".q-card")) {
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.#openQuestContext(card.dataset.id, ev);
      });
    }
    // GM (any view, not just edit mode): the hero banner is interactive — a plain click opens the
    // image FilePicker; a drag repositions its focal point (only when a banner image exists — `.repos`);
    // the scroll wheel zooms the image in/out (`bannerZoom`, 1–4×).
    const hero = root.querySelector(".q-hero");
    if (hero) {
      hero.addEventListener("pointerdown", (ev) => this.#startBannerDrag(ev, hero));
      hero.addEventListener("wheel", (ev) => this.#onBannerWheel(ev, hero), { passive: false });
    }
  }

  /** GM: the quest hero banner is interactive — a plain click opens the image FilePicker; a drag
   *  repositions the banner's focal point (`bannerPos`, {x,y} %), but only when a banner image
   *  exists (the hero carries `.repos`). Grabs on the title/meta inputs, the stars, or the hero
   *  tools are ignored so those stay usable. */
  #startBannerDrag(ev, hero) {
    if (ev.button !== 0 || ev.target.closest("input, select, textarea, button, label, a, [data-action]")) return;
    ev.preventDefault();
    const canRepos = hero.classList.contains("repos");
    const rect = hero.getBoundingClientRect();
    const startX = ev.clientX, startY = ev.clientY;
    const q0 = getQuests().find((x) => x.id === this._selId);
    const start = {
      x: Number.isFinite(q0?.bannerPos?.x) ? q0.bannerPos.x : 50,
      y: Number.isFinite(q0?.bannerPos?.y) ? q0.bannerPos.y : 50
    };
    let pos = { ...start }, moved = false;
    const move = (e) => {
      if (!canRepos) return;                                // no image yet → pointerup opens the picker
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) moved = true;
      if (!moved) return;
      pos = {
        x: Math.max(0, Math.min(100, start.x - ((e.clientX - startX) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, start.y - ((e.clientY - startY) / rect.height) * 100))
      };
      hero.classList.add("dragging");
      hero.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    };
    const up = async () => {
      hero.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return this.#openQuestBannerPicker();     // plain click → choose / replace the image
      if (pos.x !== start.x || pos.y !== start.y) await this._mutateSelected((q) => { q.bannerPos = pos; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Open the image FilePicker for the quest hero banner (GM only). */
  #openQuestBannerPicker() {
    if (!this.isGM) return;
    const FP = foundry.applications.apps.FilePicker?.implementation ?? foundry.applications.apps.FilePicker ?? globalThis.FilePicker;
    const cur = getQuests().find((x) => x.id === this._selId)?.banner ?? "";
    new FP({ type: "image", current: cur, callback: (path) => this._mutateSelected((q) => { q.banner = path; }) }).browse();
  }

  /** GM: scroll the hero banner to zoom the image (`bannerZoom`, 1–4× of cover). Updates the DOM
   *  live and debounce-saves so a flurry of wheel events doesn't thrash the world setting / re-render. */
  #onBannerWheel(ev, hero) {
    const q = getQuests().find((x) => x.id === this._selId);
    if (!q?.banner) return;                                 // nothing to zoom without an image
    ev.preventDefault();
    const cur = this.#bannerZoom ?? bannerZoomOf(q);
    const next = Math.max(BANNER_ZOOM_MIN, Math.min(BANNER_ZOOM_MAX, +(cur + (ev.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)));
    this.#bannerZoom = next;
    hero.style.backgroundSize = next > 1 ? `${(next * 100).toFixed(2)}%` : "cover";
    clearTimeout(this.#bannerZoomTimer);
    this.#bannerZoomTimer = setTimeout(() => {
      this.#bannerZoom = null;
      this._mutateSelected((x) => { x.bannerZoom = next; });
    }, 350);
  }

  /** Open a listed actor's (quest giver) own sheet. */
  static async #onOpenActor(event, target) {
    const el = target.closest("[data-ref], [data-uuid]");
    const ref = el?.dataset.ref ?? el?.dataset.uuid;
    const actor = ref ? await fromUuid(ref) : null;
    actor?.sheet?.render(true);
  }

  /* =============================== QUESTS =============================== */

  #dropData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch (_e) { return {}; }
  }

  /** GM-only: mutate a quest by id, persist, re-render. */
  async _mutateQuest(id, fn) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;
    fn(q);
    await saveQuests(quests);
    this.render(false);
  }

  /** GM-only: mutate the selected quest, persist, re-render. */
  async _mutateSelected(fn) {
    return this._mutateQuest(this._selId, fn);
  }

  async #onQuestDrop(event, zone) {
    event.preventDefault();
    if (!this.isGM) return;
    const data = this.#dropData(event);
    if (!data?.type || !data.uuid) return;

    if (zone === "giver") {
      if (data.type !== "Actor") return;
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return;
      const role = actor.type === "npc" ? actor.system?.role ?? "" : "";
      await this._mutateSelected((q) => {
        q.giver = { uuid: actor.uuid, name: actor.name, img: actor.img, role };
      });
    } else if (zone === "reward") {
      if (data.type !== "Item") return;
      const item = await fromUuid(data.uuid).catch(() => null);
      if (!item) return;
      await this._mutateSelected((q) => {
        q.rewards.push({ type: "item", uuid: item.uuid, name: item.name, img: item.img });
      });
    }
  }

  async #onFieldChange(event) {
    const el = event.currentTarget;
    const val = el.type === "checkbox" ? el.checked : el.value;

    // Objective sub-fields: data-obj="<id>" data-obj-field="text|done|hidden|optional"
    const oid = el.dataset.obj;
    if (oid !== undefined) {
      await this._mutateSelected((q) => {
        const o = (q.objectives ?? []).find((x) => x.id === oid);
        if (o) o[el.dataset.objField] = val;
      });
      return;
    }

    // Reward sub-fields: data-rwd="<index>" data-rwd-field="hidden" (the eye-slash hide toggle).
    const rwd = el.dataset.rwd;
    if (rwd !== undefined) {
      const idx = Number(rwd);
      await this._mutateSelected((q) => {
        const r = (q.rewards ?? [])[idx];
        if (r) r[el.dataset.rwdField] = val;
      });
      return;
    }

    const field = el.dataset.field;
    if (field === "giverRole") {
      await this._mutateSelected((q) => {
        if (q.giver) q.giver.role = val;
      });
      return;
    }
    await this._mutateSelected((q) => {
      // Deadline is a rest COUNTER ("" = none) — keep it a clean non-negative integer.
      if (field === "deadline") {
        const n = Math.max(0, Math.round(Number(val)));
        q.deadline = Number.isFinite(n) && n > 0 ? n : "";
        return;
      }
      if (field === "scheduledAt") {
        // datetime-local (no timezone) parses as LOCAL time → epoch ms; empty clears it.
        const t = el.value ? new Date(el.value).getTime() : NaN;
        q.scheduledAt = Number.isFinite(t) ? t : "";
        return;
      }
      q[field] = val;
    });
  }

  static #onSelectQuest(event, target) {
    const id = target.dataset.id;
    if (id !== this._selId) this.#editMode = false; // left-click navigates → pretty view
    this._selId = id;
    this.render(false);
  }

  static #onSetTab(event, target) {
    this._tab = target.dataset.tab;
    this.#editMode = false; // switching category filters leaves edit mode
    this.render(false);
  }

  static async #onNewQuest() {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = blankQuest();
    q.category = ["main", "side", "personal"].includes(this._tab) ? this._tab : "main";
    quests.unshift(q);
    await saveQuests(quests);
    this._selId = q.id;
    this.#editMode = true; // a fresh quest opens ready to author
    this.render(false);
  }

  /** Milestone SP (v0.03): Episode 2 / Arc 3 / Season 5, stacking — the campaign's SP faucet. */
  static async #onMilestone() {
    if (!this.isGM) return;
    await promptMilestoneAward();
  }

  static async #onDeleteQuest() {
    return this.#deleteQuest(this._selId);
  }

  /** Delete a quest by id, confirm first. Shared by the GM-bar button and the rail right-click. */
  async #deleteQuest(id) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Chronicle.deleteTitle") },
      content: `<p>${game.i18n.format("PROJECTANIME.Chronicle.deleteConfirm", { name: q.title })}</p>`
    }).catch(() => false);
    if (!ok) return;
    await saveQuests(quests.filter((x) => x.id !== id));
    if (this._selId === id) this._selId = null;
    this.render(false);
  }

  /** Leave quest edit mode (the GM-bar "Done" button) → back to the pretty read-only view. */
  static #onExitEdit() {
    this.#editMode = false;
    this.render(false);
  }

  /** Enter edit mode for a quest (selecting it first), or leave it if that quest is already the one
   *  being edited. The GM authoring toggle behind the rail context menu's Edit / Done Editing row. */
  #toggleEdit(id) {
    if (this.#editMode && this._selId === id) {
      this.#editMode = false;
    } else {
      this._selId = id;
      this.#editMode = true;
    }
    this.render(false);
  }

  /** A cursor-anchored popover context menu (top-layer, so it escapes the window's clipping).
   *  Returns an `add(icon, label, onClick, cls?)` row builder and a `show()` — mirrors the actor
   *  sheet's menu so the shared `.pd-picker.context-menu` styling applies. */
  #contextMenu(ev) {
    this.element.querySelector(".pd-picker")?.remove();
    const menu = document.createElement("div");
    menu.className = "pd-picker context-menu";
    menu.setAttribute("popover", "auto");

    const add = (icon, label, onClick, cls = "") => {
      const row = document.createElement("div");
      row.className = cls ? `pd-option ${cls}` : "pd-option";
      const i = document.createElement("i");
      i.className = `fas ${icon}`;
      const span = document.createElement("span");
      span.textContent = game.i18n.localize(label);
      row.append(i, span);
      row.addEventListener("click", () => { menu.hidePopover(); onClick(); });
      menu.appendChild(row);
    };

    const show = () => {
      this.element.appendChild(menu);
      menu.addEventListener("toggle", (e) => {
        if (e.newState !== "open") { menu.remove(); return; }
        Object.assign(menu.style, { position: "fixed", inset: "auto", margin: "0", left: `${ev.clientX}px`, top: `${ev.clientY}px`, minWidth: "160px" });
        const h = menu.offsetHeight, w = menu.offsetWidth;
        if (ev.clientY + h > window.innerHeight - 4) menu.style.top = `${Math.max(4, ev.clientY - h)}px`;
        if (ev.clientX + w > window.innerWidth - 4) menu.style.left = `${Math.max(4, ev.clientX - w)}px`;
      });
      menu.showPopover();
    };

    return { add, show };
  }

  /** GM right-click on a rail quest card → context menu acting on THAT quest (not necessarily the
   *  selected one): track/untrack, complete-or-reopen, abandon, delete. */
  #openQuestContext(id, ev) {
    if (!this.isGM) return;
    const q = getQuests().find((x) => x.id === id);
    if (!q) return;
    const tracked = game.settings.get("project-anime", TRACKED_SETTING) === id;
    const editingThis = this.#editMode && this._selId === id;
    const { add, show } = this.#contextMenu(ev);
    add(editingThis ? "fa-eye" : "fa-pen-to-square",
      editingThis ? "PROJECTANIME.Chronicle.doneEditing" : "PROJECTANIME.Action.edit",
      () => this.#toggleEdit(id));
    add(tracked ? "fa-flag-checkered" : "fa-flag",
      tracked ? "PROJECTANIME.Chronicle.untrack" : "PROJECTANIME.Chronicle.track",
      () => this.#trackQuest(id));
    if (q.status === "done") {
      add("fa-rotate-left", "PROJECTANIME.Chronicle.reopen", () => this._mutateQuest(id, (x) => { x.status = "active"; }));
    } else {
      add("fa-check", "PROJECTANIME.Chronicle.complete", () => this.#completeQuest(id));
      add("fa-ban", "PROJECTANIME.Chronicle.abandon", () => this._mutateQuest(id, (x) => { x.status = "failed"; }));
    }
    add("fa-trash", "PROJECTANIME.Chronicle.delete", () => this.#deleteQuest(id), "danger");
    show();
  }

  static async #onToggleObjective(event, target) {
    if (!this.isGM) return;
    const oid = target.dataset.obj;
    await this._mutateSelected((q) => {
      const o = (q.objectives ?? []).find((x) => x.id === oid);
      if (o) o.done = !o.done;
    });
  }

  static async #onAddObjective() {
    await this._mutateSelected((q) => {
      q.objectives.push({ id: foundry.utils.randomID(), text: "", done: false, hidden: false, optional: false });
    });
  }

  static async #onRemoveObjective(event, target) {
    const oid = target.dataset.obj;
    await this._mutateSelected((q) => {
      q.objectives = (q.objectives ?? []).filter((x) => x.id !== oid);
    });
  }

  /** Add rewards from the form: the filled Gold box becomes its own reward chip. (SP retired
   *  v0.03 — the Milestone tool pays Episode/Arc/Season SP; quests never pay SP directly.) */
  static async #onAddReward(event, target) {
    const box = target.closest(".add-reward");
    if (!box) return;
    const gold = Math.max(0, Number(box.querySelector('[data-ar="gold"]')?.value) || 0);
    if (!gold) return; // nothing entered
    await this._mutateSelected((q) => {
      q.rewards.push({ type: "gold", value: gold });
    });
  }

  static async #onRemoveReward(event, target) {
    const idx = Number(target.dataset.idx);
    await this._mutateSelected((q) => {
      q.rewards.splice(idx, 1);
    });
  }

  /** Click a level star → set the quest's difficulty rank (1–5); re-click the current rank to clear it. */
  static async #onSetLevel(event, target) {
    if (!this.isGM) return;
    const n = Math.max(0, Math.min(5, Number(target.dataset.star) || 0));
    await this._mutateSelected((q) => {
      const cur = Math.max(0, Math.min(5, Math.round(Number(q.level) || 0)));
      q.level = cur === n ? 0 : n; // toggle off when re-clicking the current rank
    });
  }

  static async #onClearGiver() {
    await this._mutateSelected((q) => {
      q.giver = null;
    });
  }

  static async #onOpenGiver() {
    const quests = getQuests();
    const q = quests.find((x) => x.id === this._selId);
    if (!q?.giver?.uuid) return;
    const actor = await fromUuid(q.giver.uuid).catch(() => null);
    actor?.sheet?.render(true);
  }

  static async #onPickIcon() {
    if (!this.isGM) return;
    const current = getQuests().find((x) => x.id === this._selId)?.icon ?? "";
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "image",
      current,
      callback: (path) => this._mutateSelected((q) => {
        q.icon = path;
      })
    }).render(true);
  }

  static async #onComplete() {
    return this.#completeQuest(this._selId);
  }

  /** Grant rewards once (idempotent), then mark a quest done by id. Shared by the action button and
   *  the rail context menu. Aborts if rewards needed a party and none resolved. */
  async #completeQuest(id) {
    if (!this.isGM) return;
    const quests = getQuests();
    const q = quests.find((x) => x.id === id);
    if (!q) return;

    if (!q.granted) {
      const summary = await grantRewards(q);
      if (summary === null) return; // needed a party, none resolved — abort, leave active
      q.granted = true;
      this.#announce(q, summary);
    }
    q.status = "done";
    await saveQuests(quests);
    this.render(false);
  }

  /** GM "Distribute Rewards" → a review screen of the quest's rewards with a Gold/Items destination
   *  toggle (shared party stash vs split to each player), then pays out via grantRewards. Sets
   *  `granted` so Mark Complete won't pay again; confirms first if already distributed once. */
  static async #onDistribute() {
    if (!this.isGM) return;
    const quest = getQuests().find((x) => x.id === this._selId);
    if (!quest) return;
    if (!(quest.rewards?.length)) { ui.notifications.info(game.i18n.localize("PROJECTANIME.Chronicle.distEmpty")); return; }

    if (quest.granted) {
      const again = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("PROJECTANIME.Chronicle.distribute") },
        content: `<p>${game.i18n.localize("PROJECTANIME.Chronicle.alreadyDistributed")}</p>`
      }).catch(() => false);
      if (!again) return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("PROJECTANIME.Chronicle.distTitle", { name: quest.title }), icon: "fa-solid fa-gift" },
      classes: ["project-anime", "theme-dark"],
      content: this.#distributeContent(quest),
      buttons: [
        {
          action: "distribute", label: game.i18n.localize("PROJECTANIME.Chronicle.distribute"), icon: "fa-solid fa-paper-plane", default: true,
          callback: (event, button, dialog) => {
            const root = dialog?.element ?? button?.form;
            return { goldItemsTo: root?.querySelector('input[name="goldItemsTo"]:checked')?.value || "stash" };
          }
        },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!choice || typeof choice !== "object") return; // closed or cancelled

    const summary = await grantRewards(quest, { goldItemsTo: choice.goldItemsTo });
    if (summary === null) return; // needed a party, none resolved — grantRewards already warned
    const quests = getQuests();
    const q = quests.find((x) => x.id === quest.id);
    if (q) { q.granted = true; await saveQuests(quests); }
    this.#announce(quest, summary, "PROJECTANIME.Chronicle.rewardsDistributed");
    this.render(false);
  }

  /** Reward-list HTML for the Distribute screen + the Gold/Items destination toggle (shown only when
   *  the quest actually has gold or items to route). */
  #distributeContent(quest) {
    const rows = (quest.rewards ?? []).map((r, i) => {
      const v = rewardView(r, i);
      const ic = v.img ? `<img src="${v.img}" alt="">` : v.icon;
      const hide = r.hidden ? ` <i class="fa-solid fa-eye-slash dr-hidden" title="${escHtml(game.i18n.localize("PROJECTANIME.Chronicle.hiddenReward"))}"></i>` : "";
      return `<div class="dr-row"><span class="dr-ic" style="--rg:${v.rg}">${ic}</span>`
        + `<span class="dr-v">${escHtml(String(v.v))}</span><span class="dr-l">${escHtml(v.l)}${hide}</span>`
        + `<span class="dr-dest">→ ${escHtml(this.#rewardDest(r))}</span></div>`;
    }).join("");
    const hasShareable = (quest.rewards ?? []).some((r) => r.type === "gold" || r.type === "item");
    const toggle = hasShareable
      ? `<fieldset class="dr-target"><legend>${game.i18n.localize("PROJECTANIME.Chronicle.distTo")}</legend>`
        + `<label><input type="radio" name="goldItemsTo" value="stash" checked> ${game.i18n.localize("PROJECTANIME.Chronicle.distStash")}</label>`
        + `<label><input type="radio" name="goldItemsTo" value="players"> ${game.i18n.localize("PROJECTANIME.Chronicle.distPlayers")}</label></fieldset>`
      : "";
    return `<div class="project-anime theme-dark"><div class="pa-distribute">${rows}${toggle}</div></div>`;
  }

  /** Where a reward will land, for the Distribute screen's "→ …" hint. */
  #rewardDest(r) {
    switch (r.type) {
      case "sp": return game.i18n.localize("PROJECTANIME.Chronicle.destMembers");
      case "gold": case "item": return game.i18n.localize("PROJECTANIME.Chronicle.destShareable");
      case "unlock": return game.i18n.localize("PROJECTANIME.Chronicle.destNarrative");
      default: return "";
    }
  }

  static async #onReopen() {
    if (!this.isGM) return;
    await this._mutateSelected((q) => {
      q.status = "active";
    });
  }

  static async #onAbandon() {
    if (!this.isGM) return;
    await this._mutateSelected((q) => {
      q.status = "failed";
    });
  }

  static async #onTrack() {
    return this.#trackQuest(this._selId);
  }

  /** Toggle the tracked quest (client setting) by id. Shared by the action button + context menu. */
  async #trackQuest(id) {
    const cur = game.settings.get("project-anime", TRACKED_SETTING);
    const next = cur === id ? "" : id;
    await game.settings.set("project-anime", TRACKED_SETTING, next);
    // Tracking a quest un-hides the on-canvas tracker if the user had hidden it.
    if (next && !game.settings.get("project-anime", TRACKER_VISIBLE_SETTING)) {
      await game.settings.set("project-anime", TRACKER_VISIBLE_SETTING, true);
    }
    this.render(false);
  }

  /** GM: post the selected quest's player-facing view to the configured Discord channel webhook. */
  static async #onPostDiscord() {
    if (!this.isGM) return;
    const quest = getQuests().find((x) => x.id === this._selId);
    if (!quest) return;
    const res = await postQuestToDiscord(quest);
    if (res.ok) {
      ui.notifications.info(game.i18n.format("PROJECTANIME.Chronicle.discordPosted",
        { name: quest.title || game.i18n.localize("PROJECTANIME.Chronicle.untitled") }));
    } else if (res.reason === "no-url") {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Chronicle.discordNoWebhook"));
    } else {
      ui.notifications.error(game.i18n.localize("PROJECTANIME.Chronicle.discordFailed"));
    }
  }

  /** Post a chat card summarizing what the party received (heading varies: completed vs distributed). */
  #announce(quest, summary, headingKey = "PROJECTANIME.Chronicle.completed") {
    if (!summary) return;
    const bits = [];
    if (summary.sp) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.sp", { n: summary.sp, members: summary.members }));
    if (summary.gold) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.gold", { n: summary.gold }));
    if (summary.items) bits.push(game.i18n.format("PROJECTANIME.Chronicle.grant.items", { n: summary.items }));
    const qIcon = isImageIcon(quest.icon) ? quest.icon : (isImageIcon(quest.img) ? quest.img : "");
    ChatMessage.create({
      content: cardHTML({
        icon: qIcon,
        glyph: qIcon ? "" : "fa-scroll",
        title: quest.title || game.i18n.localize("PROJECTANIME.Chronicle.untitled"),
        subtitle: game.i18n.localize(headingKey),
        lines: bits
      })
    });
  }

}

/* -------------------------------------------------------------------------- */
/*  On-canvas quest tracker — per client, driven by the tracked-quest setting. */
/* -------------------------------------------------------------------------- */

export const ChronicleTracker = {
  el: null,
  pos: null,    // { x, y } in px (left/top) once the user has dragged it; null = default CSS corner
  min: false,   // collapsed to just its header + title?
  STORE: "project-anime.trackerState", // per-client persistence (localStorage)

  /** Load the persisted position + minimized state (per client). */
  loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(this.STORE) || "{}");
      this.pos = (Number.isFinite(s.x) && Number.isFinite(s.y)) ? { x: s.x, y: s.y } : null;
      this.min = !!s.min;
    } catch (_e) { this.pos = null; this.min = false; }
  },

  /** Persist position + minimized state. */
  saveState() {
    try {
      localStorage.setItem(this.STORE, JSON.stringify({ x: this.pos?.x ?? null, y: this.pos?.y ?? null, min: this.min }));
    } catch (_e) { /* non-fatal (private mode / quota) */ }
  },

  /** Apply the stored minimized class + position to the live element, clamped to the viewport. */
  applyState() {
    if (!this.el) return;
    this.el.classList.toggle("min", this.min);
    if (this.pos) {
      const w = this.el.offsetWidth || 246, h = this.el.offsetHeight || 80;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, this.pos.x));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, this.pos.y));
      Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
    }
  },

  /** Rebuild (or remove) the floating tracker for the currently tracked quest. */
  refresh() {
    const visible = game.settings.get("project-anime", TRACKER_VISIBLE_SETTING);
    const id = game.settings.get("project-anime", TRACKED_SETTING);
    const quest = id ? getQuests().find((q) => q.id === id) : null;
    if (!visible || !quest || quest.status === "done") {
      this.el?.remove();
      this.el = null;
      return;
    }
    if (!this.el) {
      this.loadState();
      this.el = document.createElement("aside");
      this.el.className = "project-anime theme-dark chronicle-tracker";
      document.body.appendChild(this.el);
    }
    const cat = QUEST_CATEGORIES[quest.category] ?? QUEST_CATEGORIES.main;
    const prog = questProgress(quest);
    const objs = (quest.objectives ?? [])
      .filter((o) => !o.hidden)
      .slice(0, 4)
      .map((o) => `<div class="ct-obj ${o.done ? "done" : ""}"><span class="b"></span><span>${escHtml(o.text)}</span></div>`)
      .join("");
    this.el.style.setProperty("--cat", cat.color);
    this.el.innerHTML = `
      <div class="ct-head" title="${game.i18n.localize("PROJECTANIME.Chronicle.minimizeHint")}">
        <span class="tk">${game.i18n.localize("PROJECTANIME.Chronicle.tracking")}</span>
        <span class="ct-btn ct-hide" data-ct="hide" title="${game.i18n.localize("PROJECTANIME.Chronicle.hideTracker")}"><i class="fa-solid fa-eye-slash"></i></span>
        <span class="ct-btn ct-x" data-ct="untrack" title="${game.i18n.localize("PROJECTANIME.Chronicle.untrack")}">✕</span>
      </div>
      <div class="ct-name" data-ct="open" title="${escHtml(quest.title)}">${escHtml(quest.title)}</div>
      <div class="ct-objs">${objs}</div>
      <div class="ct-foot"><div class="bar"><div class="fill" style="width:${prog.pct}%"></div></div></div>`;
    this.applyState();
    this.bindControls();
  },

  /** (Re)bind the header drag + control buttons after each rebuild (innerHTML wipes prior handlers). */
  bindControls() {
    const el = this.el;
    el.querySelector('[data-ct="untrack"]')?.addEventListener("click", () =>
      game.settings.set("project-anime", TRACKED_SETTING, "")
    );
    el.querySelector('[data-ct="hide"]')?.addEventListener("click", () =>
      game.settings.set("project-anime", TRACKER_VISIBLE_SETTING, false)
    );
    el.querySelector('[data-ct="open"]')?.addEventListener("click", () => Codex.open());
    const head = el.querySelector(".ct-head");
    // Double-click the header bar to minimize / restore — like a Foundry sheet's title bar.
    head?.addEventListener("dblclick", (ev) => {
      if (ev.target.closest("[data-ct]")) return; // ignore the ✕ control
      this.min = !this.min;
      el.classList.toggle("min", this.min);
      this.saveState();
    });
    head?.addEventListener("pointerdown", (ev) => this.startDrag(ev));
  },

  /** Drag the tracker by its header bar (clicks on the control buttons are left alone). */
  startDrag(ev) {
    if (ev.button !== 0 || ev.target.closest("[data-ct]")) return;
    ev.preventDefault();
    const el = this.el;
    const rect = el.getBoundingClientRect();
    const offX = ev.clientX - rect.left, offY = ev.clientY - rect.top;
    el.classList.add("dragging");
    const move = (e) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - offX));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - offY));
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
      this.pos = { x, y };
    };
    const up = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.saveState();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
};
