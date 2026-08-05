import { ZONE_KEYWORDS, ZONE_TINTS } from "../config.mjs";

const { ArrayField, BooleanField, ColorField, SchemaField, StringField } = foundry.data.fields;

/* The Zone behavior: keyword-named text effects, a tint, and a plate
   toggle. The Zone's name is the Region document's name. Effects are
   text; nothing rolls or applies itself. */
export default class ZoneBehaviorData extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      effects: new ArrayField(new SchemaField({
        keyword: new StringField({
          required: true,
          initial: ZONE_KEYWORDS[0],
          choices: Object.fromEntries(ZONE_KEYWORDS.map(k => [k, `PROJECTANIME.Zone.${k}`]))
        }),
        name: new StringField({ required: true, initial: "" }),
        text: new StringField({ required: true, initial: "" })
      })),
      tint: new ColorField({ required: true, nullable: false, initial: ZONE_TINTS[0] }),
      showPlate: new BooleanField({ initial: true })
    };
  }

  /* Membership: the active Storyteller's client keeps a display flag of
     the token's current Zone. Display only, no mechanical use. */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: onTokenExit
  };
}

async function onTokenEnter(event) {
  if (game.users.activeGM?.isSelf !== true) return;
  const token = event.data.token;
  if (!token.parent?.tokens.has(token.id)) return;
  await token.setFlag("project-anime", "zone", { id: this.region.id, name: this.region.name });
}

/* On exit the flag moves to another Zone the token still stands in, or
   clears. */
async function onTokenExit(event) {
  if (game.users.activeGM?.isSelf !== true) return;
  const token = event.data.token;
  if (!token.parent?.tokens.has(token.id)) return;
  if (token.getFlag("project-anime", "zone")?.id !== this.region.id) return;
  const next = [...token.regions].find(r => (r !== this.region)
    && r.behaviors.some(b => (b.type === "project-anime.zone") && !b.disabled));
  if (next) await token.setFlag("project-anime", "zone", { id: next.id, name: next.name });
  else await token.unsetFlag("project-anime", "zone");
}
