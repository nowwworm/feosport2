'use strict';

// Bracket distribution algorithms per Минспорт rules §1.4 (Таблицы 3, 4, 6).
//
// Pure functions. Operate on plain arrays of pilot/team identifiers (numeric).
// The API layer is responsible for translating between DB rows and these
// data structures.
//
// Returned shape from any distribute*/build* function:
//   [{ group_number: 1, slots: [pilotId1, pilotId2, ...] }, ...]
//
// In `slots`, position is the starting slot (1-indexed conceptually, 0-indexed
// in the array). For knockout stages this corresponds to lane assignment.

// ─── DISTRIBUTION TABLES (encoded literally from the regulation) ─────────────

// Table 3 — 1/8 финала, 32 участника (система 2 из 4):
// row: group_number, value: list of qualification seeds.
const TABLE_3_R16 = {
  1: [1,  9, 24, 32],
  2: [8, 16, 17, 25],
  3: [7, 15, 18, 26],
  4: [6, 14, 19, 27],
  5: [5, 13, 20, 28],
  6: [4, 12, 21, 29],
  7: [3, 11, 22, 30],
  8: [2, 10, 23, 31],
};

// Table 4 — 1/4 финала, 16 участников (система 2 из 4):
const TABLE_4_QF_FROM_QUAL = {
  1: [1, 5, 12, 16],
  2: [3, 7, 10, 14],
  3: [2, 6, 11, 15],
  4: [4, 8,  9, 13],
};

// Table 6 — симулятор, 1/4 финала, 32 участника:
const TABLE_6_QF_8PER = {
  1: [1, 5,  9, 13, 17, 21, 25, 29],
  2: [2, 6, 10, 14, 18, 22, 26, 30],
  3: [3, 7, 11, 15, 19, 23, 27, 31],
  4: [4, 8, 12, 16, 20, 24, 28, 32],
};

// Table 6 — симулятор, 1/4 финала, 16 участников (4 пилота в группе):
const TABLE_6_QF_4PER = {
  1: [1, 5,  9, 13],
  2: [2, 6, 10, 14],
  3: [3, 7, 11, 15],
  4: [4, 8, 12, 16],
};

// Advancement maps: [previous_place, previous_group] for each slot.
// Used to build the next knockout stage from the previous one.

// Table 3 — после 1/8, состав 1/4 (16 → 4 группы по 4):
const TABLE_3_QF_FROM_R16 = {
  1: [[1, 1], [1, 5], [2, 6], [2, 2]],
  2: [[1, 7], [1, 3], [2, 8], [2, 4]],
  3: [[1, 8], [1, 4], [2, 7], [2, 3]],
  4: [[1, 6], [1, 2], [2, 1], [2, 5]],
};

// Table 3 — после 1/4, состав 1/2 (8 → 2 группы по 4):
const TABLE_3_SF_FROM_QF = {
  1: [[1, 1], [1, 2], [2, 3], [2, 4]],
  2: [[1, 3], [1, 4], [2, 1], [2, 2]],
};

// Финал (общий для табл. 3, 4, и симулятора 2of4 — все по 4 пилота):
const FINAL_FROM_SF_4PER = {
  1: [[1, 1], [1, 2], [2, 1], [2, 2]],
};

// Table 6 — после 1/4, состав 1/2 для симулятора 4of8 (16 → 2 группы по 8):
const TABLE_6_SF_FROM_QF_8PER = {
  1: [[1, 1], [2, 1], [3, 4], [4, 4], [1, 2], [2, 2], [3, 3], [4, 3]],
  2: [[1, 3], [2, 3], [3, 2], [4, 2], [1, 4], [2, 4], [3, 1], [4, 1]],
};

// Финал для симулятора 4of8 (8 в группе):
const FINAL_FROM_SF_8PER = {
  1: [[1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2]],
};

// Table 6 — после 1/4, состав 1/2 для симулятора 2of4 (8 → 2 группы по 4):
const TABLE_6_SF_FROM_QF_4PER = {
  1: [[1, 1], [1, 2], [2, 3], [2, 4]],
  2: [[1, 3], [1, 4], [2, 1], [2, 2]],
};

// ─── PUBLIC: qualification draw ──────────────────────────────────────────────

function defaultRandom() { return Math.random(); }

// Fisher-Yates shuffle with injectable RNG (for deterministic tests).
function shuffle(arr, random = defaultRandom) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Жеребьёвка квалификации: разбить пилотов на группы по groupSize.
 * Состав групп и стартовая позиция определяются случайно (§1.4.3.1).
 *
 * @param {number[]} ids
 * @param {{ groupSize: 4|8, random?: () => number }} opts
 * @returns {{group_number, slots: number[]}[]}
 */
function drawQualificationGroups(ids, { groupSize, random = defaultRandom } = {}) {
  if (![4, 8].includes(groupSize)) {
    throw new Error(`groupSize must be 4 or 8, got ${groupSize}`);
  }
  if (ids.length === 0) return [];
  const shuffled = shuffle(ids, random);
  const groups = [];
  let groupNumber = 1;
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push({
      group_number: groupNumber++,
      slots: shuffled.slice(i, i + groupSize),
    });
  }
  return groups;
}

// ─── PUBLIC: first knockout stage from qualification ─────────────────────────

/**
 * Построить первый плей-офф этап (1/8 или 1/4) из результатов квалификации.
 *
 * @param {object} args
 * @param {number[]}   args.rankedQualifiers — id-шники по местам в квалификации (idx 0 = 1-е место).
 * @param {'two_of_four'|'four_of_eight'} args.system
 * @param {16|32}      args.playoffSize
 * @param {'class'|'simulator'} args.category — дисциплина
 * @returns {{ stage_type: 'round_of_16'|'quarterfinal', groups: [...] }}
 */
function buildFirstKnockout({ rankedQualifiers, system, playoffSize, category }) {
  if (![16, 32].includes(playoffSize)) {
    throw new Error(`playoffSize must be 16 or 32, got ${playoffSize}`);
  }
  if (rankedQualifiers.length < playoffSize) {
    throw new Error(
      `not enough qualifiers: have ${rankedQualifiers.length}, need ${playoffSize}`
    );
  }
  // Take the top N by qual result.
  const seeded = rankedQualifiers.slice(0, playoffSize);
  // seed-by-seed mapping: seed N → seeded[N-1]
  const ofSeed = (n) => seeded[n - 1];

  let tableName, table, stageType;
  if (category === 'class') {
    if (playoffSize === 32) {
      tableName = 'TABLE_3_R16'; table = TABLE_3_R16;        stageType = 'round_of_16';
    } else {
      tableName = 'TABLE_4_QF';  table = TABLE_4_QF_FROM_QUAL; stageType = 'quarterfinal';
    }
  } else if (category === 'simulator') {
    if (system === 'four_of_eight') {
      // 4 of 8 starts at quarterfinal (4 groups × 8) when 32; OR (4 groups × 4)
      // when 16 — but the regulation has 32 paths only for 4/8.
      // We still allow the explicit groupSize for 16 via 4-per layout for tests.
      tableName = 'TABLE_6_QF_8PER'; table = TABLE_6_QF_8PER; stageType = 'quarterfinal';
      if (playoffSize === 16) {
        tableName = 'TABLE_6_QF_4PER'; table = TABLE_6_QF_4PER;
      }
    } else { // two_of_four simulator
      tableName = 'TABLE_6_QF_4PER'; table = TABLE_6_QF_4PER; stageType = 'quarterfinal';
    }
  } else {
    throw new Error(`unknown category: ${category}`);
  }

  const groupNumbers = Object.keys(table).map(Number).sort((a, b) => a - b);
  const groups = groupNumbers.map((gn) => ({
    group_number: gn,
    _seeds: table[gn].slice(),
    slots: table[gn].map(seed => {
      const id = ofSeed(seed);
      if (id == null) {
        throw new Error(`seed ${seed} out of range for ${tableName}`);
      }
      return id;
    }),
  }));

  return { stage_type: stageType, groups, _source_table: tableName };
}

// ─── PUBLIC: next knockout stage from previous results ───────────────────────

/**
 * Построить следующий плей-офф этап из мест предыдущего.
 *
 * @param {object} args
 * @param {Array<{ group_number, placements: Array<{ place, pilot_id }> }>} args.prevGroups
 *   `place` — место в группе (1, 2, 3, 4 [или 5..8]). Только продвигающиеся слоты.
 * @param {string} args.prevStageType — 'round_of_16' | 'quarterfinal' | 'semifinal'
 * @param {'two_of_four'|'four_of_eight'} args.system
 * @param {'class'|'simulator'} args.category
 * @returns {{ stage_type, groups }}
 */
function buildNextKnockout({ prevGroups, prevStageType, system, category }) {
  const placementOf = (place, groupNumber) => {
    const g = prevGroups.find(x => x.group_number === groupNumber);
    if (!g) throw new Error(`group ${groupNumber} missing from prevGroups`);
    const slot = g.placements.find(p => p.place === place);
    if (!slot) throw new Error(`no placement (place ${place}, group ${groupNumber})`);
    return slot.pilot_id;
  };

  let nextStageType, table;
  if (prevStageType === 'round_of_16') {
    nextStageType = 'quarterfinal'; table = TABLE_3_QF_FROM_R16;
  } else if (prevStageType === 'quarterfinal') {
    nextStageType = 'semifinal';
    if (category === 'simulator' && system === 'four_of_eight') {
      table = TABLE_6_SF_FROM_QF_8PER;
    } else if (category === 'simulator' && system === 'two_of_four') {
      table = TABLE_6_SF_FROM_QF_4PER;
    } else {
      table = TABLE_3_SF_FROM_QF;
    }
  } else if (prevStageType === 'semifinal') {
    nextStageType = 'final';
    table = (category === 'simulator' && system === 'four_of_eight')
      ? FINAL_FROM_SF_8PER
      : FINAL_FROM_SF_4PER;
  } else {
    throw new Error(`cannot build next stage from ${prevStageType}`);
  }

  const groupNumbers = Object.keys(table).map(Number).sort((a, b) => a - b);
  const groups = groupNumbers.map((gn) => ({
    group_number: gn,
    slots: table[gn].map(([place, prevGroup]) => placementOf(place, prevGroup)),
  }));
  return { stage_type: nextStageType, groups };
}

// ─── Helpers: scoring (§1.4.4.4, §1.4.3.3) ───────────────────────────────────

/**
 * Баллы за один вылет финального/группового этапа.
 * Для группы из 4 (классы — §1.4.3.3): 3/2/1/0; +1 за две победы (на уровне сводки).
 * Для группы из 4 (симулятор — §1.4.4.4): 4/3/2/1/0 if DNF.
 * Для группы из 8 (симулятор): 4/3/2/1, 5-8: 0.
 *
 * @param {number} place      — 1..8 or null for DNF
 * @param {object} opts       — { groupSize, category }
 *                              category='class' uses the §1.4.3.3 table,
 *                              category='simulator' uses §1.4.4.4.
 * @returns {number}
 */
function pointsForFlight(place, { groupSize, category }) {
  if (place == null) return 0; // DNF / не финишировал
  if (category === 'class' && groupSize === 4) {
    return [3, 2, 1, 0][place - 1] ?? 0;
  }
  if (category === 'simulator' && groupSize === 4) {
    return [4, 3, 2, 1][place - 1] ?? 0;
  }
  if (category === 'simulator' && groupSize === 8) {
    return [4, 3, 2, 1, 0, 0, 0, 0][place - 1] ?? 0;
  }
  throw new Error(`unsupported scoring config: groupSize=${groupSize}, category=${category}`);
}

function normalizeNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rankQualificationParticipants(rows, stage) {
  const mode = stage?.qualification_mode;
  if (!['laps_time', 'max_laps'].includes(mode)) {
    throw new Error('qualification_mode_required');
  }

  const targetLaps = normalizeNumber(stage.target_laps);
  const ranked = rows
    .map((row) => ({
      ...row,
      subject_id: row.pilot_id ?? row.team_id,
      total_laps: normalizeNumber(row.qualification_total_laps),
      total_time_ms: normalizeNumber(row.qualification_total_time_ms),
      best_lap_ms: normalizeNumber(row.qualification_best_lap_ms),
      attendance_status: row.attendance_status || 'present',
    }))
    .filter(row => row.subject_id != null && row.attendance_status !== 'no_show')
    .filter((row) => {
      if (mode === 'laps_time') {
        return targetLaps != null &&
          row.total_laps >= targetLaps &&
          row.total_time_ms != null;
      }
      return row.total_laps != null && row.total_time_ms != null;
    })
    .sort((a, b) => {
      if (mode === 'laps_time') {
        return a.total_time_ms - b.total_time_ms ||
          (a.best_lap_ms ?? Number.MAX_SAFE_INTEGER) - (b.best_lap_ms ?? Number.MAX_SAFE_INTEGER) ||
          a.slot - b.slot;
      }
      return b.total_laps - a.total_laps ||
        a.total_time_ms - b.total_time_ms ||
        (a.best_lap_ms ?? Number.MAX_SAFE_INTEGER) - (b.best_lap_ms ?? Number.MAX_SAFE_INTEGER) ||
        a.slot - b.slot;
    });

  return ranked.map(row => row.subject_id);
}

module.exports = {
  drawQualificationGroups,
  buildFirstKnockout,
  buildNextKnockout,
  pointsForFlight,
  rankQualificationParticipants,
  shuffle,
  // exported for unit-test introspection
  _tables: {
    TABLE_3_R16, TABLE_3_QF_FROM_R16, TABLE_3_SF_FROM_QF,
    TABLE_4_QF_FROM_QUAL,
    TABLE_6_QF_8PER, TABLE_6_QF_4PER,
    TABLE_6_SF_FROM_QF_8PER, TABLE_6_SF_FROM_QF_4PER,
    FINAL_FROM_SF_4PER, FINAL_FROM_SF_8PER,
  },
};
