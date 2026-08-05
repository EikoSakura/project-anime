/* Ranks and Grades are indices 0..5 into the Ladder, E..S. */
export const LADDER = [
  { rank: "E", die: "d4", mod: 1, grade: 4, cssVar: "--rk-e" },
  { rank: "D", die: "d6", mod: 2, grade: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", mod: 3, grade: 10, cssVar: "--rk-c" },
  { rank: "B", die: "d10", mod: 4, grade: 13, cssVar: "--rk-b" },
  { rank: "A", die: "d12", mod: 5, grade: 16, cssVar: "--rk-a" },
  { rank: "S", die: "d12+1", mod: 6, grade: 19, cssVar: "--rk-s" }
];

/* Difficulty Grades: the Ladder plus the Difficulty-only SS. */
export const DIFFICULTY = [
  { rank: "E", number: 4, cssVar: "--rk-e" },
  { rank: "D", number: 7, cssVar: "--rk-d" },
  { rank: "C", number: 10, cssVar: "--rk-c" },
  { rank: "B", number: 13, cssVar: "--rk-b" },
  { rank: "A", number: 16, cssVar: "--rk-a" },
  { rank: "S", number: 19, cssVar: "--rk-s" },
  { rank: "SS", number: 22, cssVar: "--beni" }
];

/* The six Distances, nearest first, colored by their Rank letters.
   threshold is the band's reach in scene distance units, as a multiple
   of the scene's distance-per-square value: a measurement within the
   first threshold it fits lands in that band. Sight has no upper bound,
   and Beyond is never a measured result. */
export const DISTANCES = [
  { key: "engaged", label: "PROJECTANIME.Distance.Engaged", rank: "E", threshold: 1, color: "#8a8fa0" },
  { key: "near", label: "PROJECTANIME.Distance.Near", rank: "D", threshold: 3, color: "#3ba55d" },
  { key: "far", label: "PROJECTANIME.Distance.Far", rank: "C", threshold: 6, color: "#3c78d8" },
  { key: "distant", label: "PROJECTANIME.Distance.Distant", rank: "B", threshold: 12, color: "#7d5cd6" },
  { key: "sight", label: "PROJECTANIME.Distance.Sight", rank: "A", threshold: Infinity, color: "#e2632e" },
  { key: "beyond", label: "PROJECTANIME.Distance.Beyond", rank: "S", threshold: null, color: "#d9a13b" }
];

export const ATTRIBUTES = [
  { key: "might", label: "PROJECTANIME.Attribute.Might", desc: "PROJECTANIME.Attribute.MightDesc" },
  { key: "agility", label: "PROJECTANIME.Attribute.Agility", desc: "PROJECTANIME.Attribute.AgilityDesc" },
  { key: "mind", label: "PROJECTANIME.Attribute.Mind", desc: "PROJECTANIME.Attribute.MindDesc" },
  { key: "spirit", label: "PROJECTANIME.Attribute.Spirit", desc: "PROJECTANIME.Attribute.SpiritDesc" },
  { key: "charm", label: "PROJECTANIME.Attribute.Charm", desc: "PROJECTANIME.Attribute.CharmDesc" }
];

export const STANDARD_ADVANCEMENTS = [
  { key: "newTrait", label: "PROJECTANIME.Advancement.NewTrait" },
  { key: "rankTrait", label: "PROJECTANIME.Advancement.RankTrait" },
  { key: "newTech", label: "PROJECTANIME.Advancement.NewTech" },
  { key: "rankTech", label: "PROJECTANIME.Advancement.RankTech" },
  { key: "newHeart", label: "PROJECTANIME.Advancement.NewHeart" },
  { key: "newEnergy", label: "PROJECTANIME.Advancement.NewEnergy" }
];

export const SPECIAL_ADVANCEMENTS = [
  { key: "luck", label: "PROJECTANIME.Advancement.Luck" },
  { key: "grade", label: "PROJECTANIME.Advancement.Grade" },
  { key: "attribute", label: "PROJECTANIME.Advancement.Attribute" }
];
