'use strict';

// Spectator-facing leaderboard aggregation.
//
// Per Минспорт rules §1.4.2 (квалификация) and §1.4.3 (плей-офф):
//   * laps_time   — приоритет 1: количество завершённых кругов (целевое),
//                   приоритет 2: суммарное время. Лучший круг — тай-брейкер.
//   * max_laps    — приоритет 1: количество завершённых кругов за окно,
//                   приоритет 2: лучший круг.
//
// DNF / DSQ всегда уходят в конец таблицы — сначала DNF, потом DSQ
// (DSQ хуже, потому что это санкция, а не недоезд).

const pool = require('../config/db');

const SUPPORTED_MODES = new Set(['laps_time', 'max_laps']);

function normalizeMode(mode) {
  return SUPPORTED_MODES.has(mode) ? mode : 'laps_time';
}

function statusRank(row) {
  if (row.dsq) return 3;
  if (row.dnf) return 2;
  return 1;
}

function rankHeatParticipants(rows, mode = 'laps_time') {
  const m = normalizeMode(mode);
  const decorated = rows.map(r => ({
    pilot_id:       r.pilot_id ?? null,
    team_id:        r.team_id ?? null,
    first_name:     r.first_name ?? null,
    last_name:      r.last_name ?? null,
    team:           r.team ?? null,
    total_laps:     Number(r.total_laps || 0),
    total_time_ms:  r.total_time_ms == null ? null : Number(r.total_time_ms),
    best_lap_ms:    r.best_lap_ms == null ? null : Number(r.best_lap_ms),
    dnf:            !!r.dnf,
    dsq:            !!r.dsq,
  }));

  decorated.sort((a, b) => {
    const sa = statusRank(a);
    const sb = statusRank(b);
    if (sa !== sb) return sa - sb;

    if (a.total_laps !== b.total_laps) return b.total_laps - a.total_laps;

    if (m === 'max_laps') {
      const aBest = a.best_lap_ms ?? Number.POSITIVE_INFINITY;
      const bBest = b.best_lap_ms ?? Number.POSITIVE_INFINITY;
      if (aBest !== bBest) return aBest - bBest;
    } else {
      const aTotal = a.total_time_ms ?? Number.POSITIVE_INFINITY;
      const bTotal = b.total_time_ms ?? Number.POSITIVE_INFINITY;
      if (aTotal !== bTotal) return aTotal - bTotal;
      const aBest = a.best_lap_ms ?? Number.POSITIVE_INFINITY;
      const bBest = b.best_lap_ms ?? Number.POSITIVE_INFINITY;
      if (aBest !== bBest) return aBest - bBest;
    }

    return 0;
  });

  return decorated.map((row, idx) => ({
    place: row.dnf || row.dsq ? null : idx + 1,
    status: row.dsq ? 'dsq' : row.dnf ? 'dnf' : 'ok',
    ...row,
  }));
}

async function computeHeatLeaderboard(heatId) {
  const heatRes = await pool.query(
    `SELECT h.id, h.competition_id, h.group_id, h.round_type, h.status,
            h.lap_limit, h.time_limit_seconds,
            s.qualification_mode AS stage_mode
       FROM heats h
       LEFT JOIN groups g ON g.id = h.group_id
       LEFT JOIN stages s ON s.id = g.stage_id
      WHERE h.id = $1`,
    [heatId]
  );
  if (!heatRes.rows.length) return null;
  const heat = heatRes.rows[0];

  const mode = heat.stage_mode
    || (heat.time_limit_seconds ? 'max_laps' : 'laps_time');

  const { rows } = await pool.query(
    `SELECT
        p.id                AS pilot_id,
        p.first_name,
        p.last_name,
        p.team,
        COALESCE(la.total_laps, 0)   AS total_laps,
        la.total_time_ms,
        la.best_lap_ms,
        COALESCE(r.dnf, false)       AS dnf,
        COALESCE(r.dsq, false)       AS dsq
       FROM heat_participants hp
       JOIN pilots p ON p.id = hp.pilot_id
       LEFT JOIN (
         SELECT pilot_id,
                COUNT(*)        AS total_laps,
                SUM(duration_ms) AS total_time_ms,
                MIN(duration_ms) AS best_lap_ms
           FROM laps
          WHERE heat_id = $1 AND valid = true
          GROUP BY pilot_id
       ) la ON la.pilot_id = p.id
       LEFT JOIN results r ON r.heat_id = $1 AND r.pilot_id = p.id
      WHERE hp.heat_id = $1`,
    [heatId]
  );

  return {
    heat_id: heat.id,
    competition_id: heat.competition_id,
    group_id: heat.group_id,
    mode,
    standings: rankHeatParticipants(rows, mode),
  };
}

async function computeStageLeaderboard(stageId) {
  const stageRes = await pool.query(
    `SELECT id, competition_id, stage_type, qualification_mode
       FROM stages WHERE id = $1`,
    [stageId]
  );
  if (!stageRes.rows.length) return null;
  const stage = stageRes.rows[0];
  const mode = normalizeMode(stage.qualification_mode);

  const { rows } = await pool.query(
    `SELECT
        p.id            AS pilot_id,
        p.first_name,
        p.last_name,
        p.team,
        g.id            AS group_id,
        g.group_number,
        COALESCE(la.total_laps, gp.qualification_total_laps, 0) AS total_laps,
        COALESCE(la.total_time_ms, gp.qualification_total_time_ms) AS total_time_ms,
        COALESCE(la.best_lap_ms, gp.qualification_best_lap_ms) AS best_lap_ms,
        gp.finish_place,
        gp.attendance_status
       FROM groups g
       JOIN group_participants gp ON gp.group_id = g.id
       JOIN pilots p ON p.id = gp.pilot_id
       LEFT JOIN (
         SELECT h.group_id, l.pilot_id,
                COUNT(*) AS total_laps,
                SUM(l.duration_ms) AS total_time_ms,
                MIN(l.duration_ms) AS best_lap_ms
           FROM laps l
           JOIN heats h ON h.id = l.heat_id
          WHERE l.valid = true AND h.group_id IN (SELECT id FROM groups WHERE stage_id = $1)
          GROUP BY h.group_id, l.pilot_id
       ) la ON la.group_id = g.id AND la.pilot_id = p.id
      WHERE g.stage_id = $1
        AND (gp.attendance_status IS NULL OR gp.attendance_status <> 'no_show')`,
    [stageId]
  );

  const rankable = rows.map(r => ({
    ...r,
    dnf: false,
    dsq: false,
  }));

  return {
    stage_id: stage.id,
    competition_id: stage.competition_id,
    stage_type: stage.stage_type,
    mode,
    standings: rankHeatParticipants(rankable, mode),
  };
}

async function computeCompetitionLeaderboard(competitionId, { limit = null } = {}) {
  const stageRes = await pool.query(
    `SELECT id FROM stages
      WHERE competition_id = $1
        AND stage_type = 'qualification'
      ORDER BY ordinal ASC
      LIMIT 1`,
    [competitionId]
  );

  if (stageRes.rows.length) {
    const stage = await computeStageLeaderboard(stageRes.rows[0].id);
    if (stage) {
      const standings = limit ? stage.standings.slice(0, limit) : stage.standings;
      return {
        competition_id: competitionId,
        source: 'stage',
        stage_id: stage.stage_id,
        mode: stage.mode,
        standings,
      };
    }
  }

  // Fallback: legacy heat/results aggregation (heats without stage linkage).
  const { rows } = await pool.query(
    `SELECT
        p.id                                   AS pilot_id,
        p.first_name,
        p.last_name,
        p.team,
        COUNT(r.id)                            AS runs,
        MIN(r.total_time)                      AS best_time,
        SUM(CASE WHEN r.dnf THEN 1 ELSE 0 END) AS dnf_count,
        SUM(CASE WHEN r.dsq THEN 1 ELSE 0 END) AS dsq_count
       FROM pilots p
       JOIN heat_participants hp ON hp.pilot_id = p.id
       JOIN heats h              ON h.id = hp.heat_id
       LEFT JOIN results r       ON r.heat_id = h.id AND r.pilot_id = p.id
      WHERE h.competition_id = $1
        AND h.round_type     = 'qualification'
        AND h.status         = 'locked'
      GROUP BY p.id, p.first_name, p.last_name, p.team
      ORDER BY best_time ASC NULLS LAST`,
    [competitionId]
  );

  const standings = limit ? rows.slice(0, limit) : rows;
  return {
    competition_id: competitionId,
    source: 'legacy',
    mode: 'laps_time',
    standings,
  };
}

module.exports = {
  rankHeatParticipants,
  computeHeatLeaderboard,
  computeStageLeaderboard,
  computeCompetitionLeaderboard,
};
