/**
 * Project: Anime — Rest dialog (v0.03 Downtime Slots).
 *
 * Opened per-character from the actor sheet's Rest button, or party-wide from the party sheet
 * (every member rests together). Pick a Rest Scene, spend Downtime Slots, complete:
 *   • Camp — half HP/EP back, one Luck Die restored (⟪Charm⟫ roll). Minor Downtime only (no
 *     slots), and only once per 24 hours of world time (a repeat asks first — soft gate).
 *   • Town — full HP/EP, all three Luck Dice rerolled. 2 Downtime Slots each, +1 per extra full
 *     day in the settlement (max 4). Slots don't carry over.
 * The seven Activities (doc v0.03): Bond · Craft (→ Workshop until the Phase-4 craft build) ·
 * Pursuit · Recover · Refine (arms Skill Enhancement in the Advancement dialog) · Train (1 SP,
 * once per rest) · Work (100G × party Tier).
 * A party-wide rest also ticks every active quest Posting's Deadline down one rest.
 */
import { collectLuckSteps, stepUpDie } from "../helpers/effects.mjs";
import { partyTier, tickQuestDeadlines } from "../helpers/chronicle.mjs";
import { hasArtisansKit, depositMaterial } from "../helpers/crafting.mjs";
import { hqRestContext, hqRankUpAtRest, tickMissionBoard } from "../helpers/hq.mjs";
import { getHQ } from "../helpers/factions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The Activities table (doc v0.03). `once` = once per rest. */
const ACTIVITIES = [
  { key: "bond" },
  { key: "craft" },
  { key: "pursuit" },
  { key: "recover" },
  { key: "refine" },
  { key: "train", once: true },
  { key: "work" }
];

const TRAIN_SP = 1;
const WORK_GOLD_PER_TIER = 100;
const BASE_SLOTS = 2;
const MAX_SLOTS = 4;
const CAMP_COOLDOWN = 86400; // seconds of world time

export class RestApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** One actor (sheet Rest button) or the whole roster (`party` option set → party-wide rest). */
  constructor(actors, options = {}) {
    const list = Array.isArray(actors) ? actors : [actors];
    const party = options.party ?? null;
    super({ ...options, id: party ? `pa-rest-party-${party.id}` : `pa-rest-${list[0].id}` });
    this.actors = list;
    this.party = party;
  }

  /** Selected Rest Scene ("camp" | "town"), days in the settlement, and slot spends per actor. */
  #restType = "camp";
  #days = 1;
  #picks = {}; // actorId → { activityKey: count }
  /** Party-wide rest AT the Headquarters (rank C: counts as a Town; rank A: +1 slot, cap 5; facility
   *  grants apply; the base ranks up and the Mission Board ticks on complete). */
  #atHQ = false;

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "rest-app"],
    position: { width: 400, height: "auto" },
    window: { title: "PROJECTANIME.Rest.title", icon: "fa-solid fa-campground" },
    actions: {
      pickRest: RestApp.#onPickRest,
      toggleHQ: RestApp.#onToggleHQ,
      stepDays: RestApp.#onStepDays,
      incActivity: RestApp.#onIncActivity,
      decActivity: RestApp.#onDecActivity,
      completeRest: RestApp.#onComplete
    }
  };

  static PARTS = { body: { template: "systems/project-anime/templates/apps/rest.hbs" } };

  get title() {
    const who = this.party?.name ?? this.actors[0].name;
    return `${game.i18n.localize("PROJECTANIME.Rest.title")} — ${who}`;
  }

  /** Whether an HQ rest is on the table (a party-wide rest at an established base). */
  get #canHQ() {
    return !!this.party && (() => { try { return getHQ().established; } catch { return false; } })();
  }

  /** The HQ rest benefits for this rest, or null when not resting at the base. */
  #hq() {
    if (!this.#atHQ || !this.#canHQ) return null;
    const ctx = hqRestContext();
    return ctx.established ? ctx : null;
  }

  /** This rest counts as a Town (an explicit Town pick, or resting at the HQ — rank C). */
  get #town() {
    return this.#restType === "town" || (this.#atHQ && this.#canHQ);
  }

  /** Downtime Slots each rester gets under the current selection (rank A at the HQ: +1 slot, cap 5). */
  get #slots() {
    if (!this.#town) return 0;
    const hq = this.#hq();
    const cap = hq?.maxSlots ?? MAX_SLOTS;
    return Math.min(cap, BASE_SLOTS + (this.#days - 1) + (hq?.slotBonus ?? 0));
  }

  #pickFor(actorId) {
    return (this.#picks[actorId] ??= {});
  }

  #spentFor(actorId) {
    return Object.values(this.#pickFor(actorId)).reduce((n, c) => n + c, 0);
  }

  /** @override */
  async _prepareContext() {
    const town = this.#town;
    const slots = this.#slots;
    const hq = this.#hq();
    const gold = WORK_GOLD_PER_TIER * partyTier() + (hq?.workGoldBonus ?? 0);
    return {
      isCamp: !town,
      isTown: town,
      single: this.actors.length === 1,
      canHQ: this.#canHQ,
      atHQ: this.#atHQ,
      hqRank: hq ? hq.status.rank.key : "",
      hqRankName: hq ? hq.status.rank.name : "",
      hqRankUp: hq?.rankUpTo ?? "",
      days: this.#days,
      slots,
      spent: this.#spentFor(this.actors[0].id),
      tierLabel: game.i18n.localize(town ? "PROJECTANIME.Rest.major" : "PROJECTANIME.Rest.minor"),
      actors: this.actors.map((a) => {
        const picks = this.#pickFor(a.id);
        const spent = this.#spentFor(a.id);
        return {
          id: a.id,
          name: a.name,
          img: a.img,
          spent,
          slots,
          activities: ACTIVITIES.map((act) => {
            const count = picks[act.key] ?? 0;
            let note = "";
            if (act.key === "train") note = game.i18n.format("PROJECTANIME.Rest.activitySp", { sp: TRAIN_SP });
            else if (act.key === "work") note = game.i18n.format("PROJECTANIME.Rest.activityGold", { g: gold });
            else if (act.key === "craft") note = game.i18n.localize("PROJECTANIME.Rest.craftNote");
            return {
              key: act.key,
              label: game.i18n.localize(`PROJECTANIME.Rest.activity.${act.key}`),
              note,
              count,
              picked: count > 0,
              canAdd: spent < slots && !(act.once && count >= 1),
              canSub: count > 0
            };
          })
        };
      })
    };
  }

  static #onPickRest(event, target) {
    const next = target.dataset.rest === "town" ? "town" : "camp";
    if (next === this.#restType) return;
    this.#restType = next;
    if (next === "camp") this.#atHQ = false; // a Camp is never "at the base"
    this.#picks = {};
    this.render();
  }

  /** Toggle "resting at our Headquarters" (party rests only). At the base a rest always counts as a Town. */
  static #onToggleHQ() {
    if (!this.#canHQ) return;
    this.#atHQ = !this.#atHQ;
    if (this.#atHQ && this.#restType === "camp") this.#restType = "town";
    this.#picks = {};
    this.render();
  }

  static #onStepDays(event, target) {
    const next = Math.max(1, Math.min(1 + (MAX_SLOTS - BASE_SLOTS), this.#days + (Number(target.dataset.delta) || 0)));
    if (next === this.#days) return;
    this.#days = next;
    // Slots shrank below what someone already spent → their picks reset.
    for (const a of this.actors) if (this.#spentFor(a.id) > this.#slots) this.#picks[a.id] = {};
    this.render();
  }

  static #onIncActivity(event, target) {
    const { actor: actorId, key } = target.dataset;
    const act = ACTIVITIES.find((x) => x.key === key);
    if (!act || this.#spentFor(actorId) >= this.#slots) return;
    const picks = this.#pickFor(actorId);
    if (act.once && (picks[key] ?? 0) >= 1) return;
    picks[key] = (picks[key] ?? 0) + 1;
    this.render();
  }

  static #onDecActivity(event, target) {
    const { actor: actorId, key } = target.dataset;
    const picks = this.#pickFor(actorId);
    if (!(picks[key] > 0)) return;
    picks[key] -= 1;
    if (!picks[key]) delete picks[key];
    this.render();
  }

  /** Camp cooldown: anyone here who already camped within 24h of world time? Ask once. */
  async #confirmCampCooldown() {
    const now = game.time.worldTime;
    const recent = this.actors.filter((a) => {
      const last = Number(a.getFlag("project-anime", "lastCampAt"));
      return Number.isFinite(last) && now - last < CAMP_COOLDOWN;
    });
    if (!recent.length) return true;
    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PROJECTANIME.Rest.camp"), icon: "fa-solid fa-campground" },
      content: `<p>${game.i18n.format("PROJECTANIME.Rest.campRecent", { names: recent.map((a) => a.name).join(", ") })}</p>`,
      rejectClose: false
    }).catch(() => false);
  }

  /** Recovery + activities for ONE actor. Returns the chat lines + luck rolls it produced. `hq` is the
   *  HQ rest context (helpers/hq.mjs) when resting at the base, else null. */
  async #completeFor(actor, hq) {
    const sys = actor.system;
    const i18n = (k) => game.i18n.localize(k);
    const update = {};
    const rolls = [];
    const lines = [];
    let hpGain, enGain;

    // A Lucky Pendant (or any "luck" effect) Steps Up the Charm die for Luck Dice rolls. Resting at a
    // staffed Shrine steps it up once more (rank C HQ = Town, so all three dice are rerolled here).
    const luckSteps = collectLuckSteps(actor) + (hq?.luckStep ?? 0);
    const luckDie = stepUpDie(sys.attributes.charm.value, luckSteps);
    const luckNote = luckSteps > 0 ? ` · ${i18n("PROJECTANIME.Effect.luckStepUp")}` : "";

    if (this.#restType === "camp") {
      const hp = Math.min(sys.hp.max, sys.hp.value + Math.floor(sys.hp.max / 2));
      const en = Math.min(sys.energy.max, sys.energy.value + Math.floor(sys.energy.max / 2));
      hpGain = hp - sys.hp.value;
      enGain = en - sys.energy.value;
      update["system.hp.value"] = hp;
      update["system.energy.value"] = en;
      update["flags.project-anime.lastCampAt"] = game.time.worldTime;
      if ((sys.luckDice?.length ?? 0) < 3) {
        const roll = await new Roll(`1d${luckDie}`).evaluate();
        rolls.push(roll);
        update["system.luckDice"] = [...(sys.luckDice ?? []), roll.total];
        lines.push(game.i18n.format("PROJECTANIME.Rest.luckRestored", { value: roll.total }) + luckNote);
      }
    } else {
      hpGain = sys.hp.max - sys.hp.value;
      enGain = sys.energy.max - sys.energy.value;
      update["system.hp.value"] = sys.hp.max;
      update["system.energy.value"] = sys.energy.max;
      const roll = await new Roll(`3d${luckDie}`).evaluate();
      rolls.push(roll);
      const values = roll.dice[0].results.map((r) => r.result);
      update["system.luckDice"] = values;
      lines.push(`${i18n("PROJECTANIME.Rest.luckRerolled")}: <strong>${values.join(", ")}</strong>${luckNote}`);
    }

    // Spend the Downtime Slots (Town only — Camp cleared any picks when selected).
    const picks = this.#pickFor(actor.id);
    for (const act of ACTIVITIES) {
      const n = picks[act.key] ?? 0;
      if (!n) continue;
      const label = i18n(`PROJECTANIME.Rest.activity.${act.key}`);
      const mult = n > 1 ? ` ×${n}` : "";
      if (act.key === "train") {
        update["system.skillPoints.value"] = (sys.skillPoints?.value ?? 0) + TRAIN_SP;
        lines.push(`${label} (${game.i18n.format("PROJECTANIME.Rest.activitySp", { sp: TRAIN_SP })})`);
      } else if (act.key === "work") {
        // Rank B Open Doors (+50) and a staffed Garden (+50 / +100 upgraded) add to each Work at the base.
        const gold = (WORK_GOLD_PER_TIER * partyTier() + (hq?.workGoldBonus ?? 0)) * n;
        update["system.gold"] = (sys.gold ?? 0) + gold;
        lines.push(`${label}${mult} (${game.i18n.format("PROJECTANIME.Rest.activityGold", { g: gold })})`);
      } else if (act.key === "refine") {
        update["flags.project-anime.refineReady"] = true;
        lines.push(`${label}${mult}`);
      } else {
        lines.push(`${label}${mult}`);
      }
    }

    // v0.03 Craft Activity: this rest's Craft slots (they don't carry over — set, don't accumulate).
    // A Fieldcrafter carrying an Artisan's Kit gets one Craft Activity even at a Camp. The rest marker
    // lets the Workbench treat this as facility-free Town crafting and pace one Project Stage per rest.
    let craftSlots = this.#pickFor(actor.id).craft ?? 0;
    if (this.#restType === "camp" && actor.system?.specialty === "fieldcrafter" && hasArtisansKit(actor)) {
      craftSlots = Math.max(craftSlots, 1);
    }

    // Facility rest grants (staffed once-per-rest lines). Work Gold + Gathering materials are handled
    // elsewhere (per-Work / party-wide); here we apply the per-character ones and note the rest.
    for (const g of (hq?.grants ?? [])) {
      if (g.kind === "freeCraft") { craftSlots += 1; lines.push(`<i class="fas fa-screwdriver-wrench"></i> ${game.i18n.format("PROJECTANIME.HQ.grantCraft", { name: g.name })}`); }
      else if (g.kind === "freeConsumable") { const got = await this.#grantConsumable(actor, g.favor); if (got) lines.push(`<i class="fas fa-flask"></i> ${game.i18n.format("PROJECTANIME.HQ.grantConsumable", { name: got })}`); }
      else if (g.kind === "freeBondScene") lines.push(`<i class="fas fa-hot-tub-person"></i> ${game.i18n.format("PROJECTANIME.HQ.grantBondScene", { name: g.name })}`);
    }

    update["flags.project-anime.craftSlots"] = craftSlots;
    update["flags.project-anime.lastRestAt"] = game.time.worldTime;
    update["flags.project-anime.lastRestTown"] = this.#town;

    await actor.update(update);
    return { hpGain, enGain, lines, rolls };
  }

  /** Mint one free consumable (Apothecary, staffed) onto the actor — a Strong variant on the Favor line.
   *  Best-effort by name from world items / the open compendia; returns the item name, or "" if none found. */
  async #grantConsumable(actor, favor) {
    const wantHP = (sys) => (Number(sys?.system?.hp ?? sys?.system?.value) || 0) >= 0;
    const names = favor
      ? ["Strong HP Potion", "Strong Energy Drink", "HP Potion", "Energy Drink"]
      : ["HP Potion", "Energy Drink"];
    const findByName = async (name) => {
      const world = game.items?.find((i) => i.type === "consumable" && i.name === name);
      if (world) return world;
      for (const pack of game.packs ?? []) {
        if (pack.documentName !== "Item") continue;
        const entry = pack.index?.find?.((e) => e.name === name && e.type === "consumable");
        if (entry) { const doc = await pack.getDocument(entry._id).catch(() => null); if (doc) return doc; }
      }
      return null;
    };
    for (const n of names) {
      const src = await findByName(n);
      if (src) { await actor.createEmbeddedDocuments("Item", [src.toObject()]); return src.name; }
    }
    return "";
  }

  static async #onComplete() {
    const i18n = (k) => game.i18n.localize(k);
    if (this.#restType === "camp" && !(await this.#confirmCampCooldown())) return;

    const hq = this.#hq();
    const results = [];
    for (const actor of this.actors) results.push({ actor, ...(await this.#completeFor(actor, hq)) });

    // A party-wide rest is "the party's rest" — active Posting Deadlines tick down one (GM).
    let deadlineLines = [];
    if (this.party && game.user.isGM) deadlineLines = await tickQuestDeadlines();

    // Resting at the base (GM): rank it up if Renown qualifies, gather materials to the stash, and tick
    // the Mission Board — dispatched teams that reach 0 rests resolve now.
    let hqLines = [];
    if (hq && game.user.isGM) {
      const up = await hqRankUpAtRest();
      if (up) hqLines.push(game.i18n.format("PROJECTANIME.HQ.rankedUp", { rank: up }));
      const tier = partyTier();
      for (const g of hq.grants) {
        if (g.kind !== "materials") continue;
        const types = [g.gatherType, ...(g.upgraded ? [g.gatherType2] : [])].map((t) => String(t || "").trim()).filter(Boolean);
        for (const t of (types.length ? types : ["ore"])) {
          await depositMaterial(this.party, { grade: "common", tier, category: t.toLowerCase(), qty: 3, name: t });
          hqLines.push(game.i18n.format("PROJECTANIME.HQ.grantMaterials", { qty: 3, type: t, tier }));
        }
      }
      hqLines.push(...(await tickMissionBoard()));
    }

    const restLabel = hq ? i18n("PROJECTANIME.HQ.title") : i18n(`PROJECTANIME.Rest.${this.#restType}`);
    const icon = hq ? "fa-fort-awesome" : this.#restType === "camp" ? "fa-campground" : "fa-house-chimney";
    const blocks = results.map((r) => {
      const recover = `+${r.hpGain} ${i18n("PROJECTANIME.Stat.hp")} · +${r.enGain} ${i18n("PROJECTANIME.Stat.energy")}`;
      const head = results.length > 1 ? `<div class="card-line"><strong>${r.actor.name}</strong></div>` : "";
      return head + [recover, ...r.lines].map((l) => `<div class="card-line">${l}</div>`).join("");
    });
    if (hqLines.length) {
      blocks.push(
        `<div class="card-line"><strong>${i18n("PROJECTANIME.HQ.title")}</strong></div>` +
        hqLines.map((l) => `<div class="card-line">${l}</div>`).join("")
      );
    }
    if (deadlineLines.length) {
      blocks.push(
        `<div class="card-line"><strong>${i18n("PROJECTANIME.Rest.deadlines")}</strong></div>` +
        deadlineLines.map((l) => `<div class="card-line">${l}</div>`).join("")
      );
    }
    const content = `<div class="project-anime chat-card">
      <header class="card-header">
        <span class="card-icon is-glyph"><i class="fas ${icon}"></i></span>
        <div class="card-titles">
          <h3 class="card-title">${restLabel}</h3>
          <span class="card-type">${i18n("PROJECTANIME.Rest.title")}</span>
        </div>
      </header>
      <div class="card-lines">${blocks.join("")}</div>
    </div>`;
    const speaker = this.party
      ? ChatMessage.getSpeaker({ alias: this.party.name })
      : ChatMessage.getSpeaker({ actor: this.actors[0] });
    await ChatMessage.create({ speaker, content, rolls: results.flatMap((r) => r.rolls) });

    this.close();
  }
}
