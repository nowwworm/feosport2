'use strict';

// Scoring (§5.17) — баллы и итоговые места.
//
// Очки за финиш в группе:
//   4-чел. группа:  место 1 → 3, 2 → 2, 3 → 1, 4+ → 0
//   8-чел. группа:  место 1 → 4, 2 → 3, 3 → 2, 4 → 1, 5+ → 0
//
// Бонус системы "4 из 4" (§1.4.4.4): +1 балл пилоту, который выиграл два
// своих вылета в одном этапе (две первые финишные позиции).
//
// Ничьи: два или больше пилотов с одинаковой суммой баллов — нужен дуэль
// (отдельный вылет). Здесь только детектор; назначение вылета — отдельная
// судейская операция.

const pool = require('../config/db');

function pointsForPlace(place, groupSize) {
  if (place == null || place <= 0) return 0;
  const size = Number(groupSize);
  if (size === 4) {
    if (place === 1) return 3;
    if (place === 2) return 2;
    if (place === 3) return 1;
    return 0;
  }
  if (size === 8) {
    if (place === 1) return 4;
    if (place === 2) return 3;
    if (place === 3) return 2;
    if (place === 4) return 1;
    return 0;
  }
  // Unknown group size — fall back to descending points down to 0.
  if (place > size) return 0;
  return Math.max(0, size - place);
}

// Pure: декорирует список участников группы баллами.
//   participants: [{ pilot_id, team_id, finish_place, ... }]
//   returns:      [{ ..., points }]
function computeGroupScores(participants = [], groupSize) {
  return participants.map(p => ({
    ...p,
    points: pointsForPlace(p.finish_place, groupSize),
  }));
}

// "4 из 4" система: пилоту, выигравшему оба своих вылета в этапе,
// добавляется +1 балл. На входе — массив групповых результатов одного пилота.
//
//   wins: int   — число первых мест в этапе для этого пилота
//   system: '4_of_4' | 'two_of_four' | 'four_of_eight' | string
function winsBonus(wins, system) {
  if (system !== 'four_of_four' && system !== '4_of_4') return 0;
  return wins >= 2 ? 1 : 0;
}

// Pure: складывает баллы за весь этап в разрезе пилота.
//
//   groups:  [{ id, group_number, group_size, participants: [...] }]
//   system:  race_system_code (для определения бонуса)
//
//   returns: [{ pilot_id, team_id, total_points, wins, bonus, breakdown }]
//      breakdown: [{ group_id, group_number, finish_place, points }]
function computeStageStandings(groups = [], system) {
  const byParticipant = new Map(); // key: pilot_id || `team:${team_id}`

  for (const group of groups) {
    const size = group.group_size ?? group.participants.length;
    const scored = computeGroupScores(group.participants, size);
    for (const p of scored) {
      const key = p.pilot_id != null ? `p:${p.pilot_id}` : `t:${p.team_id}`;
      if (!byParticipant.has(key)) {
        byParticipant.set(key, {
          pilot_id: p.pilot_id || null,
          team_id:  p.team_id  || null,
          total_points: 0,
          wins: 0,
          breakdown: [],
        });
      }
      const entry = byParticipant.get(key);
      entry.total_points += p.points;
      if (p.finish_place === 1) entry.wins += 1;
      entry.breakdown.push({
        group_id: group.id,
        group_number: group.group_number,
        finish_place: p.finish_place,
        points: p.points,
      });
    }
  }

  const standings = Array.from(byParticipant.values()).map(entry => {
    const bonus = winsBonus(entry.wins, system);
    return {
      ...entry,
      bonus,
      total_points: entry.total_points + bonus,
    };
  });

  // Sort descending by total_points, then by wins, then by total places (best lower)
  standings.sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aMinPlace = Math.min(...a.breakdown.map(b => b.finish_place || Infinity));
    const bMinPlace = Math.min(...b.breakdown.map(b => b.finish_place || Infinity));
    return aMinPlace - bMinPlace;
  });

  return standings;
}

// Pure: groups entries that share the same total_points so chief judge
// knows where a tiebreaker (дуэль) is needed.
//
//   returns: [{ points, entries: [...] }]   — only ties (entries.length ≥ 2)
function detectTiesAtSamePoints(standings = []) {
  const buckets = new Map();
  for (const s of standings) {
    if (!buckets.has(s.total_points)) buckets.set(s.total_points, []);
    buckets.get(s.total_points).push(s);
  }
  return Array.from(buckets.entries())
    .filter(([, entries]) => entries.length >= 2)
    .map(([points, entries]) => ({ points, entries }));
}

// ─── DB-aware aggregators ────────────────────────────────────────────────────

// Returns the stage with all groups + group_participants needed for
// computeStageStandings. Pure database read; doesn't mutate anything.
async function loadStageWithGroups(stageId) {
  const { rows: stageRows } = await pool.query(
    `SELECT s.id, s.competition_id, s.stage_type, s.qualification_mode,
            rs.code AS race_system_code, rs.group_size AS race_group_size
       FROM stages s
       JOIN competitions c ON c.id = s.competition_id
       LEFT JOIN race_systems rs ON rs.id = c.race_system_id
      WHERE s.id = $1`,
    [stageId]
  );
  if (!stageRows.length) return null;
  const stage = stageRows[0];

  const { rows: groupRows } = await pool.query(
    `SELECT g.id, g.group_number,
            (SELECT COUNT(*) FROM group_participants gp WHERE gp.group_id = g.id) AS group_size
       FROM groups g
      WHERE g.stage_id = $1
      ORDER BY g.group_number`,
    [stageId]
  );

  for (const g of groupRows) {
    const { rows: parts } = await pool.query(
      `SELECT pilot_id, team_id, finish_place
         FROM group_participants
        WHERE group_id = $1`,
      [g.id]
    );
    g.participants = parts;
    g.group_size = Number(g.group_size);
  }

  return { stage, groups: groupRows };
}

async function computeStageScores(stageId) {
  const loaded = await loadStageWithGroups(stageId);
  if (!loaded) return null;

  const standings = computeStageStandings(loaded.groups, loaded.stage.race_system_code);
  return {
    stage_id: loaded.stage.id,
    competition_id: loaded.stage.competition_id,
    stage_type: loaded.stage.stage_type,
    race_system_code: loaded.stage.race_system_code,
    standings,
    ties: detectTiesAtSamePoints(standings),
  };
}

// Aggregate all stages of a competition: sums per-pilot points across stages
// to produce the final competition standings.
async function computeCompetitionStandings(competitionId) {
  const { rows: stageRows } = await pool.query(
    `SELECT id FROM stages WHERE competition_id = $1 ORDER BY ordinal ASC`,
    [competitionId]
  );

  const byParticipant = new Map();
  for (const sRow of stageRows) {
    const scored = await computeStageScores(sRow.id);
    if (!scored) continue;
    for (const entry of scored.standings) {
      const key = entry.pilot_id != null ? `p:${entry.pilot_id}` : `t:${entry.team_id}`;
      if (!byParticipant.has(key)) {
        byParticipant.set(key, {
          pilot_id: entry.pilot_id,
          team_id: entry.team_id,
          total_points: 0,
          stages: [],
        });
      }
      const e = byParticipant.get(key);
      e.total_points += entry.total_points;
      e.stages.push({
        stage_id: sRow.id,
        stage_type: scored.stage_type,
        points: entry.total_points,
        wins: entry.wins,
      });
    }
  }

  const standings = Array.from(byParticipant.values()).sort(
    (a, b) => b.total_points - a.total_points
  );

  return {
    competition_id: competitionId,
    standings,
    ties: detectTiesAtSamePoints(standings),
  };
}

module.exports = {
  pointsForPlace,
  computeGroupScores,
  winsBonus,
  computeStageStandings,
  detectTiesAtSamePoints,
  computeStageScores,
  computeCompetitionStandings,
};
