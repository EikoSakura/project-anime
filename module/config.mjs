/* Ranks and Grades are indices 0..5 into the Ladder, E..S. */
export const LADDER = [
  { rank: "E", die: "d4", mod: 1, grade: 4, cssVar: "--rk-e" },
  { rank: "D", die: "d6", mod: 2, grade: 7, cssVar: "--rk-d" },
  { rank: "C", die: "d8", mod: 3, grade: 10, cssVar: "--rk-c" },
  { rank: "B", die: "d10", mod: 4, grade: 13, cssVar: "--rk-b" },
  { rank: "A", die: "d12", mod: 5, grade: 16, cssVar: "--rk-a" },
  { rank: "S", die: "d12+1", mod: 6, grade: 19, cssVar: "--rk-s" }
];
