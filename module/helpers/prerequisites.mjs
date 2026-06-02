/**
 * Check if an actor meets a job's prerequisites.
 * Basic category jobs always pass. All prerequisites use AND logic.
 * @param {Actor} actor - The adventurer actor to check.
 * @param {Item} job - The job item to check prerequisites for.
 * @returns {{ met: boolean, unmet: Array<{skillName: string, minLevel: number, currentLevel: number|null}> }}
 */
export function checkJobPrerequisites(actor, job) {
  const system = job.system;

  // Basic jobs always pass
  if (system.category === "basic") {
    return { met: true, unmet: [] };
  }

  const prerequisites = system.prerequisites ?? [];
  if (prerequisites.length === 0) {
    return { met: true, unmet: [] };
  }

  const unmet = [];
  for (const prereq of prerequisites) {
    if (!prereq.skillName?.trim()) continue; // skip empty entries

    // Find a matching skill item on the actor (case-insensitive)
    const actorSkill = actor.items.find(
      i => i.type === "skill" && i.name.toLowerCase() === prereq.skillName.trim().toLowerCase()
    );

    const currentLevel = actorSkill?.system.skillLevel ?? null;
    if (currentLevel === null || currentLevel < prereq.minLevel) {
      unmet.push({
        skillName: prereq.skillName,
        minLevel: prereq.minLevel,
        currentLevel
      });
    }
  }

  return { met: unmet.length === 0, unmet };
}

// Magic parent-child system removed in the Skill Simplification Overhaul.
// All skills level independently — no spell parent resolution needed.
