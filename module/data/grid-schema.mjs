const { ArrayField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Schema for a single Mana Grid socket.
 *
 * Socket types:
 * - "job": holds a Job item, branches spawn skill sockets
 * - "skill": holds Manacite, must match parent job's school (or "general")
 * - "free": holds any Manacite regardless of school
 *
 * @returns {SchemaField}
 */
function createSocketSchema() {
  return new SchemaField({
    id: new StringField({ required: true }),
    type: new StringField({ required: true, initial: "free" }),
    parentJobSocketId: new StringField({ required: true, blank: true, initial: "" }),
    itemId: new StringField({ required: true, blank: true, initial: "" }),
    position: new SchemaField({
      x: new NumberField({ required: true, integer: true, initial: 0 }),
      y: new NumberField({ required: true, integer: true, initial: 0 })
    })
  });
}

/**
 * Create the Mana Grid field for the adventurer data model.
 * Contains an array of socket objects.
 * @returns {SchemaField}
 */
export function createGridField() {
  return new SchemaField({
    sockets: new ArrayField(createSocketSchema(), { initial: [] })
  });
}

/**
 * Generate the initial grid layout for a new adventurer at a given level.
 * Creates: 1 job socket (center-left), 1 free socket (center-right).
 * Additional sockets are added as the character levels up and jobs rank up.
 *
 * @param {number} level - Adventurer level
 * @returns {{ sockets: object[] }}
 */
export function generateInitialGrid(level = 1) {
  const sockets = [];

  // Core job socket (always present)
  sockets.push({
    id: "job-1",
    type: "job",
    parentJobSocketId: "",
    itemId: "",
    position: { x: 0, y: -1 }
  });

  // Free socket (always present)
  sockets.push({
    id: "free-1",
    type: "free",
    parentJobSocketId: "",
    itemId: "",
    position: { x: -2, y: 0 }
  });

  // Additional job sockets based on level thresholds
  const jobLevels = CONFIG.SHARDS?.gridJobSocketLevels ?? [1, 10, 20];
  if (level >= (jobLevels[1] ?? 10)) {
    sockets.push({
      id: "job-2",
      type: "job",
      parentJobSocketId: "",
      itemId: "",
      position: { x: 0, y: 1 }
    });
  }
  if (level >= (jobLevels[2] ?? 20)) {
    sockets.push({
      id: "job-3",
      type: "job",
      parentJobSocketId: "",
      itemId: "",
      position: { x: 0, y: 3 }
    });
  }

  // Additional free sockets based on level
  const freeTable = CONFIG.SHARDS?.gridFreeSocketsByLevel;
  const freeCount = freeTable ? freeTable(level) : Math.max(1, 1 + Math.floor((level - 1) / 5));
  for (let i = 2; i <= freeCount; i++) {
    sockets.push({
      id: `free-${i}`,
      type: "free",
      parentJobSocketId: "",
      itemId: "",
      position: { x: -2, y: i - 1 }
    });
  }

  return { sockets };
}

/**
 * Expand the grid when conditions change (level-up, job rank-up).
 * Adds missing job sockets, free sockets, and skill sockets for ranked-up jobs.
 *
 * @param {{ sockets: object[] }} currentGrid - Current grid state
 * @param {number} level - Current adventurer level
 * @param {object[]} socketedJobs - Array of { socketId, rank } for socketed jobs
 * @returns {{ sockets: object[] }} Updated grid (new object, does not mutate input)
 */
export function expandGrid(currentGrid, level, socketedJobs = []) {
  const sockets = foundry.utils.deepClone(currentGrid.sockets);
  const existingIds = new Set(sockets.map(s => s.id));

  // --- Job sockets based on level thresholds ---
  const jobLevels = CONFIG.SHARDS?.gridJobSocketLevels ?? [1, 10, 20];
  const jobSocketDefs = [
    { id: "job-1", level: jobLevels[0] ?? 1, pos: { x: 0, y: -1 } },
    { id: "job-2", level: jobLevels[1] ?? 10, pos: { x: 0, y: 1 } },
    { id: "job-3", level: jobLevels[2] ?? 20, pos: { x: 0, y: 3 } }
  ];
  for (const def of jobSocketDefs) {
    if (level >= def.level && !existingIds.has(def.id)) {
      sockets.push({
        id: def.id,
        type: "job",
        parentJobSocketId: "",
        itemId: "",
        position: def.pos
      });
      existingIds.add(def.id);
    }
  }

  // --- Free sockets based on level ---
  const freeTable = CONFIG.SHARDS?.gridFreeSocketsByLevel;
  const targetFreeCount = freeTable ? freeTable(level) : Math.max(1, 1 + Math.floor((level - 1) / 5));
  const currentFreeCount = sockets.filter(s => s.type === "free").length;
  for (let i = currentFreeCount + 1; i <= targetFreeCount; i++) {
    const freeId = `free-${i}`;
    if (!existingIds.has(freeId)) {
      sockets.push({
        id: freeId,
        type: "free",
        parentJobSocketId: "",
        itemId: "",
        position: { x: -2, y: i - 1 }
      });
      existingIds.add(freeId);
    }
  }

  // --- Skill sockets per socketed job based on job rank ---
  const skillsByRank = CONFIG.SHARDS?.gridSkillSocketsByJobRank ?? {
    F: 1, E: 2, D: 2, C: 3, B: 3, A: 4, S: 5
  };

  for (const job of socketedJobs) {
    const targetSkillCount = skillsByRank[job.rank] ?? 1;
    const existingSkillSockets = sockets.filter(
      s => s.type === "skill" && s.parentJobSocketId === job.socketId
    );
    const currentCount = existingSkillSockets.length;

    // Find the parent job socket for positioning
    const parentSocket = sockets.find(s => s.id === job.socketId);
    const baseX = parentSocket?.position?.x ?? 0;
    const baseY = parentSocket?.position?.y ?? 0;

    for (let i = currentCount + 1; i <= targetSkillCount; i++) {
      const skillId = `${job.socketId}-skill-${i}`;
      if (!existingIds.has(skillId)) {
        // Spread skill sockets horizontally from the job socket
        const offsetX = (i % 2 === 1) ? -Math.ceil(i / 2) : Math.ceil(i / 2);
        sockets.push({
          id: skillId,
          type: "skill",
          parentJobSocketId: job.socketId,
          itemId: "",
          position: { x: baseX + offsetX, y: baseY }
        });
        existingIds.add(skillId);
      }
    }
  }

  return { sockets };
}
