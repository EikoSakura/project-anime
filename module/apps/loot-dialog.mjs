import { rollDropTable, getEligibleRecipients } from "../helpers/drops.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Loot Allocation Dialog — allows the GM to assign manacite drops and gold
 * from a defeated monster to individual party members or the party stash.
 *
 * Opened via ShardsLootDialog.open(monsterId).
 * Singleton per monster (keyed by actor ID).
 */
export class ShardsLootDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Map<string, ShardsLootDialog>} Track one instance per monster */
  static #instances = new Map();

  /**
   * Open (or focus) the Loot Dialog for a given monster.
   * @param {string} monsterId - The monster actor ID
   * @returns {ShardsLootDialog}
   */
  static open(monsterId) {
    if (this.#instances.has(monsterId)) {
      const existing = this.#instances.get(monsterId);
      existing.render(true);
      existing.bringToFront();
      return existing;
    }
    const dialog = new this({ monsterId });
    this.#instances.set(monsterId, dialog);
    dialog.render(true);
    return dialog;
  }

  /* -------------------------------------------- */

  /** @type {string} Monster actor ID */
  monsterId;

  /** @type {object|null} Cached drop results */
  #dropResults = null;

  constructor(options = {}) {
    super(options);
    this.monsterId = options.monsterId;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "loot-dialog"],
    position: { width: 520, height: "auto" },
    window: {
      resizable: true,
      icon: "fa-solid fa-gem"
    },
    actions: {
      distribute: ShardsLootDialog.#onDistribute,
      reroll: ShardsLootDialog.#onReroll
    }
  };

  /** @override */
  static PARTS = {
    main: {
      template: "systems/shards-of-mana/templates/apps/loot-dialog.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  get title() {
    const monster = game.actors.get(this.monsterId);
    const name = monster?.name ?? "???";
    return `${game.i18n.localize("SHARDS.Drops.LootDialog")} — ${name}`;
  }

  /** @override */
  get id() {
    return `shards-loot-dialog-${this.monsterId}`;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    ShardsLootDialog.#instances.delete(this.monsterId);
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const monster = game.actors.get(this.monsterId);
    if (!monster) return { error: true };

    // Roll drops if not cached
    if (!this.#dropResults) {
      this.#dropResults = await rollDropTable(monster);
    }

    const recipients = getEligibleRecipients();
    const partyActor = game.actors.find(a => a.type === "party");

    // Build assignment options: each recipient + Party Stash + Unassigned
    const assignOptions = [
      { value: "", label: game.i18n.localize("SHARDS.Drops.Unassigned") },
      ...recipients.map(a => ({ value: a.id, label: a.name }))
    ];
    if (partyActor) {
      assignOptions.push({ value: partyActor.id, label: `${partyActor.name} (${game.i18n.localize("SHARDS.Drops.PartyTreasury")})` });
    }

    // Gold distribution options
    const goldOptions = [
      { value: "party", label: game.i18n.localize("SHARDS.Drops.PartyTreasury") },
      { value: "split", label: game.i18n.localize("SHARDS.Drops.EqualSplit") }
    ];

    return {
      error: false,
      monsterName: monster.name,
      monsterImg: monster.img,
      monsterId: this.monsterId,
      gold: this.#dropResults.gold,
      successfulDrops: this.#dropResults.successfulDrops,
      hasDrops: this.#dropResults.successfulDrops.length > 0,
      hasGold: this.#dropResults.gold > 0,
      assignOptions,
      goldOptions,
      recipients,
      partyId: partyActor?.id ?? ""
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  /**
   * Distribute all loot according to assignments.
   */
  static async #onDistribute(event, target) {
    const monster = game.actors.get(this.monsterId);
    if (!monster) return;

    const form = this.element.querySelector("form");
    if (!form) return;

    const results = this.#dropResults;
    const recipients = getEligibleRecipients();

    // --- Distribute Gold ---
    if (results.gold > 0) {
      const goldMode = form.querySelector("[name='goldDistribution']")?.value ?? "party";

      if (goldMode === "split" && recipients.length > 0) {
        const share = Math.floor(results.gold / recipients.length);
        const remainder = results.gold - (share * recipients.length);

        for (const actor of recipients) {
          const currentGold = actor.system.gold ?? 0;
          await actor.update({ "system.gold": currentGold + share });
        }
        // Remainder goes to first recipient
        if (remainder > 0) {
          const first = recipients[0];
          const currentGold = first.system.gold ?? 0;
          await first.update({ "system.gold": currentGold + remainder });
        }

        ui.notifications.info(
          game.i18n.format("SHARDS.Drops.GoldObtained", { gold: results.gold }) +
          ` (${game.i18n.localize("SHARDS.Drops.EqualSplit")})`
        );
      } else {
        // Send to party treasury
        const party = game.actors.find(a => a.type === "party");
        if (party) {
          const currentGold = party.system.gold ?? 0;
          await party.update({ "system.gold": currentGold + results.gold });
          ui.notifications.info(
            game.i18n.format("SHARDS.Drops.GoldObtained", { gold: results.gold }) +
            ` → ${party.name}`
          );
        }
      }
    }

    // --- Distribute Manacite Drops ---
    for (let i = 0; i < results.successfulDrops.length; i++) {
      const drop = results.successfulDrops[i];
      const select = form.querySelector(`[name='drop-${i}']`);
      const targetId = select?.value;
      if (!targetId) continue; // Skip unassigned

      const targetActor = game.actors.get(targetId);
      if (!targetActor) continue;

      const qty = drop.quantity ?? 1;
      const items = [];
      for (let q = 0; q < qty; q++) {
        items.push({
          name: drop.name,
          type: "manacite",
          img: "icons/svg/gem.svg",
          system: {
            rank: drop.rank,
            manaciteType: "monster",
            source: results.monsterName,
            skillGranted: drop.skillGranted ?? "",
            goldValue: _rankToGoldValue(drop.rank)
          }
        });
      }
      await targetActor.createEmbeddedDocuments("Item", items);
      ui.notifications.info(
        game.i18n.format("SHARDS.Drops.Claimed", { name: targetActor.name }) +
        ` — ${drop.name}`
      );
    }

    this.close();
  }

  /**
   * Re-roll the drop table.
   */
  static async #onReroll(event, target) {
    const monster = game.actors.get(this.monsterId);
    if (!monster) return;
    this.#dropResults = await rollDropTable(monster);
    this.render({ parts: ["main"] });
  }
}

/* -------------------------------------------- */
/*  Helper                                       */
/* -------------------------------------------- */

function _rankToGoldValue(rank) {
  const values = { F: 50, E: 150, D: 300, C: 600, B: 1200, A: 2500, S: 5000 };
  return values[rank] ?? 50;
}
