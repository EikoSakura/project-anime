/**
 * Project: Anime — Token Dossier (right-click inspect dialog).
 *
 * A read-only, themed ApplicationV2 window opened by right-clicking a token you do NOT own
 * (owners and the GM get the core Token HUD on right-click instead — see the _canHUD /
 * _onClickRight patch in project-anime.mjs). It shows the token's portrait, HP / Energy, and
 * the deeper layers — Attributes, Combat Stats, Skills, Affinities — each gated by the
 * VIEWER's Reveal effects (a Scouter). GM and owners see every layer. Skill Points ride along
 * with the hover panel's gate (the basics row at the top).
 */
import { PROJECTANIME, rangeLabel } from "../helpers/config.mjs";
import { viewerReveals, totalSkillPoints, canSeeTokenVitals, actorStatBlock } from "./token-info.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = (k) => (k ? game.i18n.localize(k) : "");

export class TokenDossier extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "token-dossier"],
    position: { width: 320, height: "auto" },
    window: { title: "PROJECTANIME.Dossier.title", icon: "fa-solid fa-id-card-clip", resizable: false }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/token-dossier.hbs" }
  };

  /** The token whose actor we display. */
  #token;

  /** Skill names currently expanded — preserved across live re-renders so a real-time update
   *  (a reveal changing, HP ticking) doesn't snap an open skill shut. */
  #openSkills = new Set();

  constructor(token, options = {}) {
    super({ ...options, id: `pa-token-dossier-${token.id}` });
    this.#token = token;
  }

  get title() {
    return this.#token?.document?.name || this.#token?.actor?.name || game.i18n.localize("PROJECTANIME.Dossier.title");
  }

  /** Open (or focus) the dossier for a token, positioned near the originating click. */
  static open(token, event) {
    if (!token?.actor) return null;
    const id = `pa-token-dossier-${token.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.render(true);
    const options = {};
    const x = event?.clientX;
    const y = event?.clientY;
    if (Number.isFinite(x) && Number.isFinite(y)) options.position = { left: Math.round(x + 8), top: Math.round(y + 8) };
    return new TokenDossier(token, options).render(true);
  }

  /** True when this dossier is showing `actor` (for live refresh on actor updates). */
  isShowing(actor) {
    return this.#token?.actor === actor;
  }

  /** Map the token disposition to a tint key (shared with the hover panel's classes). */
  static #dispKey(token) {
    const D = CONST.TOKEN_DISPOSITIONS;
    switch (token.document.disposition) {
      case D.HOSTILE: return "hostile";
      case D.FRIENDLY: return "friendly";
      case D.SECRET: return "secret";
      default: return "neutral";
    }
  }

  /** @override */
  async _prepareContext() {
    const token = this.#token;
    const actor = token?.actor;
    if (!actor) return { show: false };
    const sys = actor.system ?? {};
    const pct = (v, m) => (m > 0 ? Math.clamp(Math.round(((v ?? 0) / m) * 100), 0, 100) : 0);

    // Owners + the GM (isOwner is true for the GM) see every layer; any other viewer sees a
    // deeper layer only if their own Scouter unlocks that category.
    const full = actor.isOwner;
    const reveals = full ? null : viewerReveals();
    const can = (cat) => full || !!reveals?.has(cat);

    const hp = sys.hp ?? {};
    const energy = sys.energy ?? {};
    const badge = actor.type === "npc"
      ? L(PROJECTANIME.dispositions[sys.disposition] ?? "TYPES.Actor.npc")
      : L("TYPES.Actor.character");

    // Attributes / Combat Stats / Affinities / custom dossier fields — the shared reveal-gated stat
    // block (also consumed by the Codex Archive). Skills + HP/Energy stay local to this surface.
    const stat = actorStatBlock(actor, { full, reveals });

    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const skills = can("skills")
      ? await Promise.all(
          actor.items
            .filter((i) => i.type === "skill")
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(async (i) => {
              const s = i.system ?? {};
              const meta = [
                L(PROJECTANIME.actionTypes?.[s.actionType]),
                s.energyCost ? `${s.energyCost} EN` : "",
                rangeLabel(s.range),
                L(PROJECTANIME.skillEffects?.[s.effect])
              ].filter(Boolean);
              return {
                name: i.name,
                stars: s.spCost != null ? `${s.spCost} SP` : "",
                meta,
                description: s.description ? await TextEditor.enrichHTML(s.description, { secrets: false }) : "",
                open: this.#openSkills.has(i.name)
              };
            })
        )
      : [];

    const hasSkillPoints = sys.skillPoints !== undefined;

    return {
      show: true,
      disp: TokenDossier.#dispKey(token),
      img: actor.img,
      name: token.document.name || actor.name,
      badge,
      // Same HP/Energy gate as the bars + hover panel ("allies only" hides enemy/neutral vitals).
      vitals: canSeeTokenVitals(token),
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, pct: pct(hp.value, hp.max) },
      energy: { value: energy.value ?? 0, max: energy.max ?? 0, pct: pct(energy.value, energy.max) },
      sp: { show: hasSkillPoints && can("skillPoints"), value: totalSkillPoints(actor) },
      attributes: stat.attributes,
      combat: stat.combat,
      affinities: stat.affinities,
      skills,
      customFields: stat.customFields
    };
  }

  /** @override — tint the window frame by disposition (reuses the panel's .ti-disp-* hooks). */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.classList.remove("ti-disp-hostile", "ti-disp-friendly", "ti-disp-neutral", "ti-disp-secret");
    if (context.disp) el.classList.add(`ti-disp-${context.disp}`);
    // Track expand/collapse so the open set survives the next live re-render.
    for (const d of el.querySelectorAll("details.td-skill[data-skill]")) {
      d.addEventListener("toggle", () => {
        if (d.open) this.#openSkills.add(d.dataset.skill);
        else this.#openSkills.delete(d.dataset.skill);
      });
    }
  }
}
