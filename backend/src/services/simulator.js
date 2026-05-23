'use strict';

// Simulator disconnect classification (§5.5.9 / §1.4.4).
//
// На основе истории дисконнектов в вылете решаем что делать дальше:
//   * `scope='all'`           → вся группа отвалилась — переигровка
//   * `scope='single'` × N    → один пилот отвалился N раз — техн. поражение
//   * иначе                    → продолжаем (без действий)
//
// Решение принимает ГСК (chief judge), но классификатор даёт рекомендацию.

const pool = require('../config/db');
const { recordAudit } = require('./audit');

const DEFAULT_MAX_ATTEMPTS = 3;

// Pure: takes the recorded disconnect rows + thresholds, returns the verdict.
//
//   disconnects: [{ scope, pilot_id }]
//   thresholds:  { maxAttempts?: number }
//
//   returns: { verdict, repeat_offender_pilot_id?, last_event? }
//     verdicts:
//       'replay_group'     — вся группа отвалилась (any all-scope event)
//       'technical_defeat' — один пилот превысил maxAttempts
//       'continue'         — пока ничего критичного
function classifyDisconnect(disconnects = [], thresholds = {}) {
  const maxAttempts = Math.max(1, Number(thresholds.maxAttempts || DEFAULT_MAX_ATTEMPTS));
  if (!Array.isArray(disconnects) || !disconnects.length) {
    return { verdict: 'continue' };
  }

  for (const d of disconnects) {
    if (d.scope === 'all') return { verdict: 'replay_group', last_event: d };
  }

  const perPilot = new Map();
  for (const d of disconnects) {
    if (d.scope !== 'single' || d.pilot_id == null) continue;
    perPilot.set(d.pilot_id, (perPilot.get(d.pilot_id) || 0) + 1);
  }

  for (const [pilotId, count] of perPilot) {
    if (count >= maxAttempts) {
      return {
        verdict: 'technical_defeat',
        repeat_offender_pilot_id: pilotId,
        attempts: count,
      };
    }
  }

  return { verdict: 'continue' };
}

async function recordDisconnect(io, params, userId) {
  const {
    heat_id,
    pilot_id = null,
    scope,
    reason = null,
    notes = null,
  } = params;

  if (!heat_id || !scope) {
    throw new Error('heat_id, scope required');
  }
  if (!['single', 'all'].includes(scope)) {
    throw new Error('scope must be "single" or "all"');
  }
  if (scope === 'single' && !pilot_id) {
    throw new Error('pilot_id required for scope=single');
  }

  const { rows } = await pool.query(
    `INSERT INTO disconnects (heat_id, pilot_id, scope, reason, recorded_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [heat_id, pilot_id, scope, reason, userId, notes]
  );

  const event = rows[0];

  const { rows: heatCtx } = await pool.query(
    `SELECT h.competition_id, c.simulator_max_attempts
       FROM heats h
       JOIN competitions c ON c.id = h.competition_id
      WHERE h.id = $1`,
    [heat_id]
  );

  let verdict = { verdict: 'continue' };
  let competitionId = null;
  if (heatCtx.length) {
    competitionId = heatCtx[0].competition_id;
    const { rows: history } = await pool.query(
      `SELECT scope, pilot_id FROM disconnects WHERE heat_id = $1`,
      [heat_id]
    );
    verdict = classifyDisconnect(history, {
      maxAttempts: heatCtx[0].simulator_max_attempts,
    });
  }

  if (competitionId && (verdict.verdict === 'technical_defeat' || verdict.verdict === 'replay_group')) {
    await recordAudit({
      competitionId,
      action: 'simulator.disconnect_verdict',
      actorUserId: userId,
      targetKind: 'heat',
      targetId: heat_id,
      payload: { scope, pilot_id, verdict },
    });
  }

  if (io && competitionId) {
    io.to(`competition:${competitionId}`).emit('simulator_disconnect', {
      heat_id,
      disconnect: event,
      verdict,
    });
  }

  return { disconnect: event, verdict };
}

module.exports = {
  classifyDisconnect,
  recordDisconnect,
};
