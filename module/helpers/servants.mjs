import { PROJECTANIME } from "./config.mjs";
import { postCard, cardHTML, enrichDescription, skillMeta } from "./dice.mjs";

/**
 * Companions (rules: Companion Rules). The Companion Effect (cost 2, always Passive) bonds a
 * creature as a loyal ally. Its 2 energy boxes are locked only while the Companion is actively
 * adventuring (the Technique's `companionHome` toggle lifts the lock). The bonded creature is a
 * real NPC actor BUILT LIKE AN ENEMY: the shared base line (1 hit box, 1 energy box, all
 * Attributes d4, Guard 6), one free Talent at d6, Weapon/Armor Styles off the player tables,
 * and 8 starting EXP spent in the Monster Creator. On your turn you act OR your Companion acts
 * (table-adjudicated).
 */

const FLAG = "project-anime";
const i18n = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

/** The world folder companions are filed under (created on demand, GM-side). Also used by the
 *  Monster Creator's Companion tile to file hand-built companions. */
export async function ensureServantFolder() {
  const name = i18n("PROJECTANIME.Servant.folder");
  let folder = game.folders.find((f) => f.type === "Actor" && f.name === name);
  if (!folder && game.user.isGM) {
    folder = await Folder.create({ name, type: "Actor", color: "#4f7c9c" });
  }
  return folder ?? null;
}

/** The living companion bonded through this Technique, if any. */
function existingCompanion(actor, item) {
  return game.actors.find((a) =>
    a.getFlag(FLAG, "companionOf") === actor.uuid && a.getFlag(FLAG, "companionSkill") === item.id) ?? null;
}

/** Name prompt for a new companion. Returns the chosen name, or null if dismissed. */
async function promptCompanionName(actor) {
  const seed = i18n("PROJECTANIME.Servant.companionDefault", { name: actor.name });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Skill.effect.companion"), icon: "fas fa-paw" },
    classes: ["project-anime"],
    content: `
      <div class="project-anime roll-dialog">
        <div class="form-group"><label>${i18n("PROJECTANIME.Servant.companionName")}</label>
          <input type="text" name="name" value="${foundry.utils.escapeHTML(seed)}" autofocus /></div>
      </div>`,
    buttons: [
      { action: "ok", label: i18n("PROJECTANIME.Servant.companionCreate"), icon: "fas fa-paw", default: true, callback: (e, b) => ({ name: b.form.elements.name?.value ?? "" }) },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return (result.name ?? "").trim() || seed;
}

/**
 * Use a Companion Technique: the first use creates the bonded creature (its form was chosen when
 * the Technique was learned — the bond is the Technique's locked boxes); later uses report it.
 */
export async function resolveCompanion(actor, item) {
  const existing = existingCompanion(actor, item);
  if (existing) {
    return postCard(actor, cardHTML({
      title: item.name,
      subtitle: i18n("PROJECTANIME.Roll.skill"),
      icon: item.img,
      meta: skillMeta(item.system),
      description: await enrichDescription(item),
      lines: [`<em class="muted">${i18n("PROJECTANIME.Servant.companionBonded", { name: existing.name, master: actor.name })}</em>`]
    }));
  }
  const name = await promptCompanionName(actor);
  if (!name) return null;

  if (game.user.isGM) return createCompanion(actor.uuid, item.id, name, game.user.id);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", {
      type: "createCompanion", casterUuid: actor.uuid, itemId: item.id, name, userId: game.user.id
    });
    return null;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/**
 * Create the bonded companion (GM-side; exported for the socket relay): a fresh NPC on the
 * shared enemy base line (1 hit box, 1 energy box, all Attributes d4, Guard 6) with its free
 * Talent at d6 — the owner names the Talent and spends the 8 starting EXP in the Monster
 * Creator. Friendly, owned by its player, filed with the companions. The energy lock rides
 * the Companion Technique's own passive tax on the OWNER, not this actor.
 */
export async function createCompanion(casterUuid, itemId, name, userId) {
  const caster = await fromUuid(casterUuid);
  const item = caster?.items?.get(itemId);
  if (!caster || !item) return;

  const base = PROJECTANIME.enemyBase;
  const attrs = Object.fromEntries(PROJECTANIME.attributeKeys.map((k) =>
    [k, { base: base.attrDie, value: base.attrDie }]));
  const folder = await ensureServantFolder();
  const data = {
    name,
    type: "npc",
    img: item.img,
    folder: folder?.id,
    system: {
      attributes: attrs,
      hp: { value: base.hitBoxes, max: base.hitBoxes },
      energy: { value: base.energyBoxes, max: base.energyBoxes },
      guard: { bonus: 0 },
      movement: { bonus: 0 },
      npcType: "companion",
      disposition: "friendly",
      role: "npc",
      talents: {
        [foundry.utils.randomID()]: {
          name: i18n("PROJECTANIME.MonsterCreator.talentName"),
          die: PROJECTANIME.companion.talentDie,
          attribute: "might"
        }
      }
    },
    prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY },
    flags: { [FLAG]: { companionOf: caster.uuid, companionSkill: item.id, servantOf: caster.uuid } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
  };
  if (userId) data.ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

  const created = await Actor.create(data);
  if (!created) return;

  return postCard(caster, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(item.system),
    description: await enrichDescription(item),
    lines: [`<em class="muted">${i18n("PROJECTANIME.Servant.companionCreated", { name: created.name, master: caster.name })}</em>`]
  }));
}

/** Confirm, then release (delete) a bonded companion. */
export async function confirmAndDismiss(servant) {
  if (!servant) return;
  const go = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n("PROJECTANIME.Servant.dismiss") },
    content: `<p>${i18n("PROJECTANIME.Servant.dismissConfirm", { name: servant.name })}</p>`,
    rejectClose: false
  });
  if (!go) return;
  if (servant.isOwner) return removeServantActor(servant.uuid);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "dismissServant", servantUuid: servant.uuid });
    return;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/** Delete a companion actor and its placed tokens (GM-side; exported for the socket relay). */
export async function removeServantActor(servantUuid) {
  const servant = await fromUuid(servantUuid);
  if (!servant || servant.documentName !== "Actor") return;
  for (const scene of game.scenes) {
    const ids = scene.tokens.filter((t) => t.actorId === servant.id).map((t) => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
  }
  await servant.delete();
}
