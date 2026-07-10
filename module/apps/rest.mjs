/**
 * Project: Anime — Rest dialog (rules: Resting).
 *
 * Opened per-character from the actor sheet's Rest button, or party-wide from the party sheet
 * (every member rests together). Pick a Rest Scene, complete:
 *   • Camp — clear half your hit boxes (rounded up), all energy boxes, and restore one spent
 *     Luck Die (roll a d12). Only once per 24 hours of world time (a repeat asks first — soft
 *     gate).
 *   • Town — clear all hit boxes, all energy boxes, restore all three Luck Dice (3d12), and
 *     clear one Wound chosen by the player (rules: Wounds).
 */
import { PROJECTANIME } from "../helpers/config.mjs";
import { collectLuckTunes } from "../helpers/effects.mjs";
import { tuneLuckDie, cardHTML } from "../helpers/dice.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

  /** Selected Rest Scene ("camp" | "town") and each actor's chosen Wound to clear at a Town. */
  #restType = "camp";
  #woundPicks = {}; // actorId → wound id

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "rest-app"],
    position: { width: 400, height: "auto" },
    window: { title: "PROJECTANIME.Rest.title", icon: "fa-solid fa-campground" },
    actions: {
      pickRest: RestApp.#onPickRest,
      pickWound: RestApp.#onPickWound,
      completeRest: RestApp.#onComplete
    }
  };

  static PARTS = { body: { template: "systems/project-anime/templates/apps/rest.hbs" } };

  get title() {
    const who = this.party?.name ?? this.actors[0].name;
    return `${game.i18n.localize("PROJECTANIME.Rest.title")} — ${who}`;
  }

  /** This rest counts as a Town (an explicit Town pick). */
  get #town() {
    return this.#restType === "town";
  }

  /** The Wound this actor clears at a Town: the picked one, else their first. */
  #woundFor(actor) {
    const wounds = actor.system.wounds ?? [];
    const picked = this.#woundPicks[actor.id];
    if (wounds.some((w) => w.id === picked)) return picked;
    return wounds[0]?.id ?? null;
  }

  /** @override */
  async _prepareContext() {
    const town = this.#town;
    const woundLabel = game.i18n.localize("PROJECTANIME.Rest.wound");
    const actors = this.actors.map((a) => ({
      id: a.id,
      name: a.name,
      img: a.img,
      wounds: (a.system.wounds ?? []).map((w, i) => ({
        id: w.id,
        label: w.note || `${woundLabel} ${i + 1}`,
        picked: this.#woundFor(a) === w.id
      }))
    }));
    return {
      isCamp: !town,
      isTown: town,
      single: this.actors.length === 1,
      showWounds: town && actors.some((a) => a.wounds.length > 0),
      actors
    };
  }

  static #onPickRest(event, target) {
    const next = target.dataset.rest === "town" ? "town" : "camp";
    if (next === this.#restType) return;
    this.#restType = next;
    this.render();
  }

  static #onPickWound(event, target) {
    const { actor: actorId, wound: woundId } = target.dataset;
    this.#woundPicks[actorId] = woundId;
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

  /** Recovery for ONE actor. Returns the chat lines + luck rolls it produced. */
  async #completeFor(actor) {
    const sys = actor.system;
    const i18n = (k) => game.i18n.localize(k);
    const update = {};
    const rolls = [];
    const lines = [];
    let hpGain, enGain;
    let luckRestored = false;

    if (this.#restType === "camp") {
      // Clear half the hit boxes (rounded up) and all energy boxes.
      const hp = Math.min(sys.hp.max, sys.hp.value + Math.ceil(sys.hp.max / 2));
      hpGain = hp - sys.hp.value;
      enGain = sys.energy.max - sys.energy.value;
      update["system.hp.value"] = hp;
      update["system.energy.value"] = sys.energy.max;
      update["flags.project-anime.lastCampAt"] = game.time.worldTime;
      // Restore ONE spent Luck Die: roll the actor's Luck Die and record it (only if any are spent).
      if ((sys.luckDice?.length ?? 0) < PROJECTANIME.luckDiceCount) {
        const roll = await new Roll(`1d${sys.luckDie ?? PROJECTANIME.luckDie}`).evaluate();
        rolls.push(roll);
        update["system.luckDice"] = [...(sys.luckDice ?? []), roll.total];
        lines.push(game.i18n.format("PROJECTANIME.Rest.luckRestored", { value: roll.total }));
        luckRestored = true;
      }
    } else {
      // Clear one Wound, chosen by the player — its locked hit box comes back with this rest.
      const wounds = sys.toObject().wounds ?? [];
      const cleared = wounds.find((w) => w.id === this.#woundFor(actor)) ?? null;
      if (cleared) {
        update["system.wounds"] = wounds.filter((w) => w.id !== cleared.id);
        lines.push(`<i class="fas fa-heart-crack"></i> ${i18n("PROJECTANIME.Rest.woundCleared")}${cleared.note ? ` — <em>${cleared.note}</em>` : ""}`);
      }
      // Clear all hit boxes and all energy boxes.
      const hpMax = sys.hp.max + (cleared ? 1 : 0);
      hpGain = hpMax - sys.hp.value;
      enGain = sys.energy.max - sys.energy.value;
      update["system.hp.value"] = hpMax;
      update["system.energy.value"] = sys.energy.max;
      // Restore ALL Luck Dice: reroll the full set fresh at the actor's Luck Die and record each.
      const roll = await new Roll(`${PROJECTANIME.luckDiceCount}d${sys.luckDie ?? PROJECTANIME.luckDie}`).evaluate();
      rolls.push(roll);
      const values = roll.dice[0].results.map((r) => r.result);
      update["system.luckDice"] = values;
      lines.push(`${i18n("PROJECTANIME.Rest.luckRerolled")}: <strong>${values.join(", ")}</strong>`);
      luckRestored = true;
    }

    update["flags.project-anime.lastRestAt"] = game.time.worldTime;
    update["flags.project-anime.lastRestTown"] = this.#town;

    await actor.update(update);
    return { hpGain, enGain, lines, rolls, luckRestored };
  }

  static async #onComplete() {
    const i18n = (k) => game.i18n.localize(k);
    if (this.#restType === "camp" && !(await this.#confirmCampCooldown())) return;

    const results = [];
    for (const actor of this.actors) results.push({ actor, ...(await this.#completeFor(actor)) });

    const restLabel = i18n(`PROJECTANIME.Rest.${this.#restType}`);
    const icon = this.#restType === "camp" ? "fa-campground" : "fa-house-chimney";
    // One dotted-leader row per actor's recovery, then their notes — through the shared builder.
    const lines = results.flatMap((r) => [
      { k: r.actor.name, v: `+${r.hpGain} ${i18n("PROJECTANIME.Stat.hp")} · +${r.enGain} ${i18n("PROJECTANIME.Stat.energy")}`, cls: "good" },
      ...r.lines
    ]);
    const content = cardHTML({
      title: restLabel,
      subtitle: i18n("PROJECTANIME.Rest.title"),
      glyph: icon,
      accent: "var(--pac-gold)",
      lines
    });
    const speaker = this.party
      ? ChatMessage.getSpeaker({ alias: this.party.name })
      : ChatMessage.getSpeaker({ actor: this.actors[0] });
    await ChatMessage.create({ speaker, content, rolls: results.flatMap((r) => r.rolls) });

    // Lucky Pendant (rules: Accessories) — anyone who restored a Luck Die may tune one ±1.
    for (const r of results) {
      if (r.luckRestored && collectLuckTunes(r.actor) > 0) await tuneLuckDie(r.actor);
    }

    this.close();
  }
}
