/* One-shot data migrations, run once per world by the active
   Storyteller's client when the recorded system version is older than
   the running one. */

const SETTING = "migrationVersion";

export function registerMigrations() {
  game.settings.register("project-anime", SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  Hooks.once("ready", async () => {
    if (game.users.activeGM?.isSelf !== true) return;
    const stored = game.settings.get("project-anime", SETTING);
    if (!foundry.utils.isNewerVersion(game.system.version, stored)) return;
    if (foundry.utils.isNewerVersion("0.2.0", stored)) await removeZones();
    await game.settings.set("project-anime", SETTING, game.system.version);
  });
}

/* 0.2.0 replaced Zones with Distance: delete the Zone behaviors from
   every scene's Regions and strip the membership flags from tokens.
   The Regions themselves stay; they belong to the world. Behaviors are
   read from source data because the type no longer validates. */
async function removeZones() {
  for (const scene of game.scenes) {
    for (const region of scene.regions) {
      const ids = region._source.behaviors
        .filter(b => b.type === "project-anime.zone")
        .map(b => b._id);
      if (ids.length) await region.deleteEmbeddedDocuments("RegionBehavior", ids);
    }
    const updates = scene.tokens
      .filter(t => t._source.flags?.["project-anime"]?.zone !== undefined)
      .map(t => ({ _id: t.id, "flags.project-anime.-=zone": null }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}
