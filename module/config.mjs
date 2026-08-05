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

/* Zone effect keywords, stored as-is on the behavior. */
export const ZONE_KEYWORDS = [
  "Defensive", "Elevated", "Energizing", "Harmful", "Hindering",
  "Obscured", "Restorative", "Tight", "Unstable", "Volatile"
];

/* Zone tint swatches, drawn from the Rank colors: C, D, B, A, E. */
export const ZONE_TINTS = ["#3c78d8", "#3ba55d", "#7d5cd6", "#e2632e", "#8a8fa0"];

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
