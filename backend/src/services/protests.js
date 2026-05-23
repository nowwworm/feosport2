'use strict';

// Protests (§5.14) — workflow подачи и рассмотрения протестов.
//
//   Подача:   представитель команды / пилот в течение 5 минут после
//             окончания вылета (heat.ended_at + PROTEST_WINDOW_MINUTES).
//   Решение:  главный судья — pending → upheld | rejected | withdrawn.
//             Решение окончательно (повторная подача невозможна,
//             валидация на уровне UI/процесса, не схемы).

const pool = require('../config/db');

const PROTEST_WINDOW_MINUTES = 5;
const PROTEST_WINDOW_MS = PROTEST_WINDOW_MINUTES * 60 * 1000;

// Pure: проверяет окно подачи. Возвращает { within, deadline_ms }.
//   heatEndedAt — Date | ISO string | null (если ещё не закрыт — окно не открыто)
//   now         — Date | number  (текущий момент)
function isWithinProtestWindow(heatEndedAt, now = new Date()) {
  if (!heatEndedAt) return { within: false, reason: 'heat_not_ended' };
  const endedAt = heatEndedAt instanceof Date ? heatEndedAt : new Date(heatEndedAt);
  const ts = now instanceof Date ? now.getTime() : Number(now);
  const elapsed = ts - endedAt.getTime();
  if (elapsed < 0) return { within: false, reason: 'heat_not_ended' };
  if (elapsed > PROTEST_WINDOW_MS) {
    return { within: false, reason: 'window_expired', elapsed_ms: elapsed };
  }
  return { within: true, deadline_ms: PROTEST_WINDOW_MS - elapsed };
}

async function fileProtest(io, params, userId) {
  const {
    competition_id,
    heat_id = null,
    subject_pilot_id = null,
    subject_team_id = null,
    rules_clause = null,
    description,
  } = params;

  if (!competition_id) throw new Error('competition_id required');
  if (!description || !description.trim()) throw new Error('description required');

  if (heat_id) {
    const { rows } = await pool.query(
      'SELECT ended_at FROM heats WHERE id = $1',
      [heat_id]
    );
    if (!rows.length) throw new Error('heat not found');
    const check = isWithinProtestWindow(rows[0].ended_at);
    if (!check.within) {
      const err = new Error(`protest_window_${check.reason}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO protests
       (competition_id, heat_id, filed_by, subject_pilot_id, subject_team_id,
        rules_clause, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [competition_id, heat_id, userId, subject_pilot_id, subject_team_id,
     rules_clause, description]
  );
  const protest = rows[0];

  if (io) {
    io.to(`competition:${competition_id}`).emit('protest_filed', { protest });
  }
  return protest;
}

async function resolveProtest(io, protestId, params, userId) {
  const { status, resolution = null } = params;
  if (!['upheld', 'rejected', 'withdrawn'].includes(status)) {
    throw new Error('status must be upheld | rejected | withdrawn');
  }

  const { rows } = await pool.query(
    `UPDATE protests
        SET status = $1,
            resolution = $2,
            resolved_by = $3,
            resolved_at = NOW()
      WHERE id = $4 AND status = 'pending'
      RETURNING *`,
    [status, resolution, userId, protestId]
  );
  if (!rows.length) {
    const err = new Error('protest_not_found_or_already_resolved');
    err.statusCode = 404;
    throw err;
  }
  const protest = rows[0];

  if (io) {
    io.to(`competition:${protest.competition_id}`).emit('protest_resolved', { protest });
  }
  return protest;
}

module.exports = {
  PROTEST_WINDOW_MINUTES,
  PROTEST_WINDOW_MS,
  isWithinProtestWindow,
  fileProtest,
  resolveProtest,
};
