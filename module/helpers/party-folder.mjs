/**
 * Project: Anime — backs each Party actor with a real Foundry Folder.
 *
 * A Party's roster IS the Character actors in its folder, so Foundry's native folder UI manages
 * membership: drag a character into the folder to add them, out to remove them — with native
 * persistent collapse and the right-click folder menu. This module owns the folder lifecycle
 * (create it with the party, rename + delete to follow it) and exposes the membership accessors
 * the party sheet and the encounter budget read. All folder mutations are GM-side.
 *
 * Membership lives in the folder (not `system.members`), so there's a single source of truth and
 * zero sync bookkeeping; `system.members` is kept only as a legacy fallback + one-time migration
 * source for parties built before this existed.
 */

const FOLDER_FLAG = "folderId";

/** Brand purple (the system's --pa-accent) used to tint each Party folder in the sidebar. */
const PARTY_FOLDER_COLOR = "#6c4f9c";

/** Resolve a stored actor UUID synchronously (legacy `system.members` only); null if gone. */
function resolve(ref) {
  try { return fromUuidSync(ref); } catch (_e) { return null; }
}

/** The Folder backing a party (null until the GM has set it up). */
export function partyFolder(party) {
  const id = party?.getFlag?.("project-anime", FOLDER_FLAG);
  return id ? (game.folders?.get(id) ?? null) : null;
}

/** A party's member Characters = the Character actors in its folder. Falls back to the legacy
 *  `system.members` list while the folder is still being created (or on a very fresh client). */
export function partyMembers(party) {
  const folder = partyFolder(party);
  if (folder) return folder.contents.filter((a) => a.type === "character");
  return (party?.system?.members ?? []).map(resolve).filter((a) => a?.type === "character");
}

/** Every Party-type actor in the world. */
export function partyActors() {
  return game.actors?.filter((a) => a.type === "party") ?? [];
}

/**
 * The party's bonded Companions (rules: Companion Rules). Counts:
 *  • every actor flagged `companionOf` → a roster member (the Companion Effect's bond),
 *  • every NPC hand-typed `npcType: "companion"` (the Monster Creator's Companion tile),
 *    wherever it's filed, and
 *  • every other hand-made companion, found by WHERE it's filed: any Actor folder whose name
 *    (or an ancestor's) says "companion" — the system's "Servants & Companions" folder, a GM's
 *    own "Companions" folder — plus, for NPCs, the party's folder itself or any subfolder of it.
 * A raised servant (`servantOf` without a bond) and roster members never count. Read by the
 * party sheet's Companions strip and the Milestone tool (Companions advance with the party).
 */
export function partyCompanions(party) {
  const members = partyMembers(party);
  const memberUuids = new Set(members.map((m) => m.uuid));
  const memberIds = new Set(members.map((m) => m.id));
  const pFolder = partyFolder(party);
  const inPartyTree = (f) => { for (let x = f; x; x = x.folder) if (pFolder && x.id === pFolder.id) return true; return false; };
  const companionNamed = (f) => { for (let x = f; x; x = x.folder) if (/companion/i.test(x.name ?? "")) return true; return false; };
  return (game.actors ?? []).filter((a) => {
    if (a.type !== "npc" && a.type !== "character") return false;
    if (memberIds.has(a.id)) return false;
    const flags = a.flags?.["project-anime"] ?? {};
    if (flags.companionOf) return memberUuids.has(flags.companionOf);
    if (flags.servantOf) return false;
    if (a.type === "npc" && a.system?.npcType === "companion") return true;
    if (!a.folder) return false;
    // An NPC dropped into the party's own folder (or under it) reads as the party's companion;
    // a Character only counts from an explicit companions folder (party-folder Characters are members).
    return companionNamed(a.folder) || (a.type === "npc" && inPartyTree(a.folder));
  });
}

/** Resolve the party to act on (reward delivery, …). One party → it; several →
 *  ask the GM which; none → null. Used by the CHRONICLE quest rewards. */
export async function resolveParty() {
  const parties = partyActors();
  if (parties.length === 0) return null;
  if (parties.length === 1) return parties[0];
  const options = parties
    .map((p) => `<option value="${p.id}">${String(p.name).replace(/</g, "&lt;")}</option>`)
    .join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("PROJECTANIME.Chronicle.choosePartyTitle") },
    content: `<p>${game.i18n.localize("PROJECTANIME.Chronicle.chooseParty")}</p>
      <select name="party" style="width:100%">${options}</select>`,
    ok: {
      label: game.i18n.localize("PROJECTANIME.Chronicle.choose"),
      callback: (event, button) => button.form.elements.party.value
    }
  }).catch(() => null);
  return id ? game.actors.get(id) : null;
}

/** Ensure the party has a backing Folder; create it (GM only) if missing, filing the party
 *  actor and any legacy `system.members` into it. Returns the folder, or null for a non-GM
 *  before one exists. Idempotent. */
export async function ensurePartyFolder(party) {
  const existing = partyFolder(party);
  if (existing) {
    // Keep the folder tinted brand purple (GM-side; idempotent — only writes if it drifted).
    if (game.user.isGM && String(existing.color ?? "").toLowerCase() !== PARTY_FOLDER_COLOR) {
      await existing.update({ color: PARTY_FOLDER_COLOR });
    }
    return existing;
  }
  if (!game.user.isGM) return null;

  // Party folders are tinted purple and sort to the top of the Actors directory.
  const folder = await Folder.create({ name: party.name, type: "Actor", color: PARTY_FOLDER_COLOR, sort: -100000 });
  await party.setFlag("project-anime", FOLDER_FLAG, folder.id);

  // File the party actor itself + any legacy members into the new folder.
  const updates = [{ _id: party.id, folder: folder.id }];
  for (const ref of party.system.members ?? []) {
    const a = resolve(ref);
    if (a?.type === "character" && a.folder?.id !== folder.id) updates.push({ _id: a.id, folder: folder.id });
  }
  await Actor.updateDocuments(updates);
  return folder;
}

/** Create any missing party folders — one-time migration for parties made before this existed. */
export async function ensureAllPartyFolders() {
  if (!game.user.isGM) return;
  for (const party of game.actors.filter((a) => a.type === "party")) await ensurePartyFolder(party);
}

/** Keep the folder's name in step with the party's. */
export async function syncPartyFolderName(party) {
  const folder = partyFolder(party);
  if (folder && folder.name !== party.name) await folder.update({ name: party.name });
}

/** Delete a party's folder when the party is deleted. Its remaining contents fall back to the
 *  directory root — Foundry moves them up, it does NOT delete them. */
export async function deletePartyFolder(party) {
  if (!game.user.isGM) return;
  await partyFolder(party)?.delete();
}
