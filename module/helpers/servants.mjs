/**
 * Project: Anime — Animate & Companion (rules v0.01).
 *
 * Animate raises a targeted DEAD creature as a servant under the caster's control: a real Actor
 * cloned from the corpse (skills above the Animate Skill's Rank stripped, Animate/Companion
 * skills always stripped), filed under the "Servants & Companions" folder, owned by the casting
 * player, its token dropped where the corpse lies. While the servant exists it locks part of the
 * caster's MAXIMUM Energy (tier × the Skill's Energy cost — config.mjs servantTax), recorded in
 * a ledger on the caster (flags.project-anime.servants) that the actor model folds into
 * `energy.max` beside the Passive-Skill tax. Dismissing the servant — or deleting its actor —
 * prunes the ledger and restores the Energy (the deleteActor hook in project-anime.mjs).
 *
 * Companion bonds a loyal creature chosen when the Skill is learned: a fresh NPC with all-d6
 * Attributes and its own HP/Energy (6 + ⟪Might⟫×2 / 6 + ⟪Spirit⟫×2 = 18/18), no Energy tax (the doc
 * gives Companion none). One companion per Companion Skill — re-using the Skill reports the
 * existing bond instead of duplicating it.
 *
 * Neither joins the combat tracker: each acts ON the caster's turn (rules), so it simply never
 * rolls Initiative — the player moves it during their own turn. Both creature kinds are flagged
 * (servantOf / companionOf), which bars them from ever learning Animate or Companion themselves
 * (rules v0.01 "Raised Servants/Companions cannot have Skills with the Animate or Companion
 * Effect" — enforced by the Skill Builder).
 */
import { PROJECTANIME, servantTax, skillEffectKeys } from "./config.mjs";
import { postCard, cardHTML, enrichDescription, skillMeta, spendSkillEnergy } from "./dice.mjs";

const i18n = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const FLAG = "project-anime";

/** The corpse's servant tier, validated against the tax table (blank / unknown / PC → standard). */
function tierOf(corpse) {
  const t = corpse?.system?.tier;
  return t in PROJECTANIME.servantTierTax ? t : "standard";
}

/** The shared "Servants & Companions" Actor folder, created on first use (GM-side callers). */
async function ensureServantFolder() {
  const existing = game.folders.find((f) => f.type === "Actor" && f.getFlag(FLAG, "servants"));
  if (existing) return existing;
  return Folder.create({
    name: i18n("PROJECTANIME.Servant.folder"),
    type: "Actor",
    color: "#4f6c9c",
    flags: { [FLAG]: { servants: true } }
  });
}

/** Drop a creature's token at a point (the corpse's tile, or near the caster). GM-side. */
async function placeServantToken(created, refToken, disposition) {
  if (!canvas?.ready || !refToken) return;
  const tokenData = await created.getTokenDocument({
    x: refToken.document.x,
    y: refToken.document.y,
    disposition,
    hidden: false
  });
  await canvas.scene.createEmbeddedDocuments("Token", [tokenData.toObject()]);
}

/* -------------------------------------------- */
/*  Animate                                     */
/* -------------------------------------------- */

/**
 * Cast Animate: validate the targeted corpse BEFORE Energy is spent, then raise it — directly
 * for a GM, via the socket relay for a player (cloning a GM-owned corpse + creating actors,
 * folders, and tokens are GM rights).
 */
export async function resolveAnimate(actor, item) {
  const target = [...(game.user?.targets ?? [])][0]?.actor ?? null;
  if (!target) return ui.notifications.warn(i18n("PROJECTANIME.Roll.noTarget"));
  if ((target.system?.hp?.value ?? 0) > 0) return ui.notifications.warn(i18n("PROJECTANIME.Servant.notDead"));
  if (target.flags?.[FLAG]?.servantOf || target.flags?.[FLAG]?.companionOf) {
    return ui.notifications.warn(i18n("PROJECTANIME.Servant.alreadyBound"));
  }
  if (!(await spendSkillEnergy(actor, item.system))) return null;

  if (game.user.isGM) return raiseServant(actor.uuid, item.id, target.uuid, game.user.id);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", {
      type: "raiseServant", casterUuid: actor.uuid, itemId: item.id, corpseUuid: target.uuid, userId: game.user.id
    });
    return null;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/**
 * Raise the servant (GM-side; exported for the socket relay): clone the corpse, strip what the
 * rules strip, flag + file + own + place it, and record the Energy tax on the caster's ledger.
 */
export async function raiseServant(casterUuid, itemId, corpseUuid, userId) {
  const caster = await fromUuid(casterUuid);
  const item = caster?.items?.get(itemId);
  const corpse = await fromUuid(corpseUuid);
  if (!caster || !item || !corpse) return;

  const tier = tierOf(corpse);
  const tax = servantTax(tier, item.system?.energyCost);
  const rank = Number(item.system?.rank) || 1;

  const data = corpse.toObject();
  delete data._id;
  data.name = i18n("PROJECTANIME.Servant.name", { name: corpse.name });
  // Rules v0.01: raised servants lose Skills ranked above this Skill's Rank, and can never
  // carry Animate or Companion. Everything else (gear, attributes, vitals) returns with them.
  data.items = (data.items ?? []).filter((i) => {
    if (i.type !== "skill") return true;
    if ((Number(i.system?.rank) || 1) > rank) return false;
    const effects = [i.system?.effect, i.system?.secondaryEffect].filter(Boolean);
    return !effects.includes("animate") && !effects.includes("companion");
  });
  // It returns with the Hit Points and Energy it had in life — back on its feet at full.
  foundry.utils.setProperty(data, "system.hp.value", data.system?.hp?.max ?? 0);
  foundry.utils.setProperty(data, "system.energy.value", data.system?.energy?.max ?? 0);
  // The servant fights on its master's side.
  const casterTok = caster.getActiveTokens?.()[0] ?? null;
  const disposition = casterTok?.document?.disposition
    ?? (caster.type === "character" ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE);
  if (data.system && "disposition" in data.system) {
    data.system.disposition = disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? "friendly"
      : disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL ? "neutral" : "hostile";
  }
  foundry.utils.setProperty(data, "prototypeToken.disposition", disposition);
  foundry.utils.setProperty(data, "prototypeToken.actorLink", true);
  foundry.utils.setProperty(data, `flags.${FLAG}.servantOf`, caster.uuid);
  foundry.utils.setProperty(data, `flags.${FLAG}.servantSkill`, item.id);
  foundry.utils.setProperty(data, `flags.${FLAG}.servantTier`, tier);
  // The casting player commands it (the GM implicitly owns everything).
  data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  if (userId) data.ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

  const folder = await ensureServantFolder();
  if (folder) data.folder = folder.id;

  const created = await Actor.create(data);
  if (!created) return;

  // The Energy lock: ledger entry on the caster — the actor model folds the total into energy.max.
  await caster.setFlag(FLAG, "servants", {
    [created.id]: { name: created.name, tier, tax, skill: item.id }
  });

  // Stand it up where the corpse lies (its token, if one is on the canvas).
  const corpseTok = corpse.getActiveTokens?.()[0] ?? null;
  await placeServantToken(created, corpseTok, disposition);

  const tierLabel = i18n(PROJECTANIME.monsterTiers[tier]?.label ?? "PROJECTANIME.Tier.standard");
  return postCard(caster, cardHTML({
    title: item.name,
    subtitle: i18n("PROJECTANIME.Roll.skill"),
    icon: item.img,
    meta: skillMeta(item.system),
    description: await enrichDescription(item),
    lines: [
      `<em class="muted">${i18n("PROJECTANIME.Servant.raised", { name: created.name, master: caster.name })}</em>`,
      `<em class="muted">${i18n("PROJECTANIME.Servant.taxLine", { tier: tierLabel, n: tax })}</em>`
    ],
    buttons: [{
      data: `data-action="dismissServant" data-servant-uuid="${created.uuid}"`,
      label: `<i class="fas fa-person-walking-arrow-loop-left"></i> ${i18n("PROJECTANIME.Servant.dismiss")}`
    }]
  }));
}

/** Owner-gated confirm-then-release, shared by every dismissal entry point (the raise chat card,
 *  the Token HUD, and the servant's sheet header). Deleting a raised servant is hard to undo, so
 *  we confirm first; on OK it routes through dismissServant (GM-relayed for players). */
export async function confirmAndDismiss(servant) {
  if (!servant) return;
  if (!servant.isOwner) return ui.notifications.warn(i18n("PROJECTANIME.Servant.notYours"));
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n("PROJECTANIME.Servant.dismiss") },
    content: `<p>${i18n("PROJECTANIME.Servant.dismissConfirm", { name: servant.name })}</p>`
  });
  if (!ok) return;
  return dismissServant(servant);
}

/** Release a servant: its tokens leave every scene and the actor is deleted — the deleteActor
 *  hook prunes the master's ledger, restoring the locked Energy. GM-relayed for players. */
export async function dismissServant(servant) {
  if (!servant) return;
  if (game.user.isGM) return removeServantActor(servant.uuid);
  if (game.users.activeGM) {
    game.socket.emit("system.project-anime", { type: "dismissServant", servantUuid: servant.uuid });
    return;
  }
  return ui.notifications.warn(i18n("PROJECTANIME.Roll.noGM"));
}

/** GM-side servant removal (exported for the socket relay): tokens first, then the actor. */
export async function removeServantActor(servantUuid) {
  const servant = await fromUuid(servantUuid);
  if (!servant || !(servant.flags?.[FLAG]?.servantOf || servant.flags?.[FLAG]?.companionOf)) return;
  for (const scene of game.scenes) {
    const ids = scene.tokens.filter((t) => t.actorId === servant.id).map((t) => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
  }
  await servant.delete();
}

/** When a flagged servant's actor is deleted (dismissal or a straight delete), prune its entry
 *  from the master's ledger so the locked Energy returns. Wired GM-side in project-anime.mjs. */
export async function pruneServantLedger(actor) {
  const masterUuid = actor?.flags?.[FLAG]?.servantOf;
  if (!masterUuid) return;
  let master = null;
  try { master = fromUuidSync(masterUuid); } catch (_e) { /* master gone — nothing to prune */ }
  if (!master?.getFlag) return;
  if (actor.id in (master.getFlag(FLAG, "servants") ?? {})) {
    await master.update({ [`flags.${FLAG}.servants.-=${actor.id}`]: null });
  }
}

/* -------------------------------------------- */
/*  Companion                                   */
/* -------------------------------------------- */

/** The companion bonded to this Skill, if it still exists. */
function existingCompanion(actor, item) {
  return game.actors.find((a) =>
    a.flags?.[FLAG]?.companionOf === actor.uuid && a.flags?.[FLAG]?.companionSkill === item.id) ?? null;
}

/** Name dialog for a fresh companion. Returns the chosen name or null. */
async function promptCompanionName(actor) {
  const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  const seed = i18n("PROJECTANIME.Servant.companionDefault", { name: actor.name });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("PROJECTANIME.Skill.effect.companion") },
    content: `
      <div class="project-anime roll-dialog companion-dialog">
        <div class="form-group"><label>${i18n("PROJECTANIME.Servant.companionName")}</label>
          <input type="text" name="name" value="${foundry.utils.escapeHTML(seed)}" /></div>
      </div>`,
    buttons: [
      { action: "bond", label: i18n("PROJECTANIME.Servant.bond"), icon: "fas fa-paw", default: true, callback: (e, b) => new FDE(b.form).object },
      { action: "cancel", label: i18n("Cancel"), icon: "fas fa-times" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;
  return (result.name ?? "").trim() || seed;
}

/**
 * Use a Companion Skill: the first use creates the bonded creature (its form was chosen when the
 * Skill was learned — no Energy; the bond is the Skill's SP); later uses report the companion.
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
 * Create the bonded companion (GM-side; exported for the socket relay): a fresh NPC — all
 * Attributes d6, HP 18 / Energy 18 (v0.03 baseline 6 + ⟪Might⟫×2 / 6 + ⟪Spirit⟫×2), friendly, owned by
 * its player, filed with the servants. No Energy tax (the doc gives Companion none).
 */
export async function createCompanion(casterUuid, itemId, name, userId) {
  const caster = await fromUuid(casterUuid);
  const item = caster?.items?.get(itemId);
  if (!caster || !item) return;

  const attrs = Object.fromEntries(PROJECTANIME.attributeKeys.map((k) => [k, { base: 6, value: 6 }]));
  const folder = await ensureServantFolder();
  const data = {
    name,
    type: "npc",
    img: item.img,
    folder: folder?.id,
    system: {
      attributes: attrs,
      hp: { value: 18, max: 18 },
      energy: { value: 18, max: 18 },
      disposition: "friendly"
    },
    prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY },
    flags: { [FLAG]: { companionOf: caster.uuid, companionSkill: item.id } },
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
