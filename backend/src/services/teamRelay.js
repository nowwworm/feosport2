'use strict';

// Team relay race helpers (§5.5.8.x).
//
// Каждая команда летит последовательно — один пилот в воздухе. Передача
// происходит в окне `exchange_window_ms` (правило соревнования / разряд).
// Здесь: валидатор окна передачи, агрегатор круговых данных по команде.

const pool = require('../config/db');
const { rankHeatParticipants } = require('./leaderboard');

// Pure: returns annotated handoff with `is_valid` set.
// Передача считается валидной, если exchange_duration_ms ≤ exchange_window_ms.
// Когда окно или замер не указаны, проверка не блокирующая (валидно по умолчанию).
function validateExchangeWindow(handoff) {
  const window = handoff.exchange_window_ms;
  const duration = handoff.exchange_duration_ms;
  if (window == null || duration == null) {
    return { ...handoff, is_valid: true, violation_ms: null };
  }
  const ok = duration <= window;
  return {
    ...handoff,
    is_valid: ok,
    violation_ms: ok ? null : duration - window,
  };
}

// Aggregate raw lap rows (per pilot) into team rows for ranking.
//   laps:     [{ pilot_id, duration_ms }]   — only `valid = true` laps already filtered
//   members:  [{ team_id, pilot_id }]
//   teams:    [{ team_id, name }]
//
// returns:   [{ team_id, name, total_laps, total_time_ms, best_lap_ms }]
function aggregateLapsByTeam(laps, members, teams) {
  const teamByPilot = new Map();
  for (const m of members) teamByPilot.set(m.pilot_id, m.team_id);

  const buckets = new Map();
  for (const t of teams) {
    buckets.set(t.team_id, {
      team_id: t.team_id,
      name: t.name,
      total_laps: 0,
      total_time_ms: 0,
      best_lap_ms: null,
    });
  }

  for (const lap of laps) {
    const teamId = teamByPilot.get(lap.pilot_id);
    if (teamId == null) continue;
    const bucket = buckets.get(teamId);
    if (!bucket) continue;
    bucket.total_laps += 1;
    bucket.total_time_ms += Number(lap.duration_ms) || 0;
    if (bucket.best_lap_ms == null || lap.duration_ms < bucket.best_lap_ms) {
      bucket.best_lap_ms = Number(lap.duration_ms);
    }
  }

  return Array.from(buckets.values()).map(b => ({
    ...b,
    total_time_ms: b.total_laps > 0 ? b.total_time_ms : null,
  }));
}

async function computeTeamHeatLeaderboard(heatId) {
  const heatRes = await pool.query(
    `SELECT h.id, h.competition_id, h.group_id, h.lap_limit, h.time_limit_seconds,
            s.qualification_mode AS stage_mode
       FROM heats h
       LEFT JOIN groups g ON g.id = h.group_id
       LEFT JOIN stages s ON s.id = g.stage_id
      WHERE h.id = $1`,
    [heatId]
  );
  if (!heatRes.rows.length) return null;
  const heat = heatRes.rows[0];

  if (!heat.group_id) {
    return {
      heat_id: heat.id,
      competition_id: heat.competition_id,
      group_id: null,
      mode: heat.stage_mode || 'laps_time',
      standings: [],
      teams: [],
    };
  }

  const { rows: teams } = await pool.query(
    `SELECT t.id AS team_id, t.name
       FROM group_participants gp
       JOIN teams t ON t.id = gp.team_id
      WHERE gp.group_id = $1 AND gp.team_id IS NOT NULL`,
    [heat.group_id]
  );

  if (!teams.length) {
    return {
      heat_id: heat.id,
      competition_id: heat.competition_id,
      group_id: heat.group_id,
      mode: heat.stage_mode || 'laps_time',
      standings: [],
      teams: [],
    };
  }

  const teamIds = teams.map(t => t.team_id);

  const { rows: members } = await pool.query(
    `SELECT team_id, pilot_id FROM team_members WHERE team_id = ANY($1::int[])`,
    [teamIds]
  );

  const { rows: laps } = await pool.query(
    `SELECT pilot_id, duration_ms FROM laps WHERE heat_id = $1 AND valid = true`,
    [heatId]
  );

  const aggregated = aggregateLapsByTeam(laps, members, teams);
  const mode = heat.stage_mode || (heat.time_limit_seconds ? 'max_laps' : 'laps_time');

  // Decorate with dnf/dsq=false so the existing ranker handles them.
  const rankable = aggregated.map(t => ({
    team_id: t.team_id,
    pilot_id: null,
    first_name: null,
    last_name: null,
    team: t.name,
    total_laps: t.total_laps,
    total_time_ms: t.total_time_ms,
    best_lap_ms: t.best_lap_ms,
    dnf: false,
    dsq: false,
  }));

  return {
    heat_id: heat.id,
    competition_id: heat.competition_id,
    group_id: heat.group_id,
    mode,
    standings: rankHeatParticipants(rankable, mode),
    teams,
  };
}

async function recordHandoff(io, params, userId) {
  const {
    heat_id,
    team_id,
    outgoing_pilot_id = null,
    incoming_pilot_id,
    exchange_window_ms = null,
    exchange_duration_ms = null,
    notes = null,
  } = params;

  if (!heat_id || !team_id || !incoming_pilot_id) {
    throw new Error('heat_id, team_id, incoming_pilot_id required');
  }

  const annotated = validateExchangeWindow({
    exchange_window_ms,
    exchange_duration_ms,
  });

  const { rows } = await pool.query(
    `INSERT INTO relay_handoffs
       (heat_id, team_id, outgoing_pilot_id, incoming_pilot_id,
        exchange_window_ms, exchange_duration_ms, valid, recorded_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      heat_id, team_id, outgoing_pilot_id, incoming_pilot_id,
      exchange_window_ms, exchange_duration_ms, annotated.is_valid, userId, notes,
    ]
  );

  const handoff = rows[0];
  if (io) {
    const { rows: heatRows } = await pool.query(
      'SELECT competition_id FROM heats WHERE id = $1',
      [heat_id]
    );
    if (heatRows.length) {
      io.to(`competition:${heatRows[0].competition_id}`).emit('relay_handoff', {
        heat_id,
        handoff,
        violation_ms: annotated.violation_ms,
      });
    }
  }

  return { handoff, violation_ms: annotated.violation_ms };
}

module.exports = {
  validateExchangeWindow,
  aggregateLapsByTeam,
  computeTeamHeatLeaderboard,
  recordHandoff,
};
