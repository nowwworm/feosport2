'use strict';

// Pilot sanction status (Phase 13, §1.6 — антидопинг, §1.5 — противоправное
// влияние). Агрегирует существующие штрафы и явный ban-флаг на пилоте.
//
//   status: 'clear' | 'flagged' | 'banned'
//     clear   — нет санкций
//     flagged — есть штрафы в истории (informational, не блокирует)
//     banned  — pilots.is_banned = true (блокирует регистрацию/допуск)

const pool = require('../config/db');
const { recordAudit } = require('./audit');

async function getPilotSanctionStatus(pilotId) {
  const { rows } = await pool.query(
    `SELECT id, is_banned, ban_reason, ban_imposed_at, ban_lifted_at
       FROM pilots WHERE id = $1`,
    [pilotId]
  );
  if (!rows.length) return null;
  const pilot = rows[0];

  const { rows: penaltyRows } = await pool.query(
    `SELECT penalty_type, COUNT(*)::int AS count
       FROM penalties
      WHERE pilot_id = $1
      GROUP BY penalty_type`,
    [pilotId]
  );

  const penaltyCounts = {};
  let total = 0;
  let dsq = 0;
  for (const r of penaltyRows) {
    penaltyCounts[r.penalty_type] = r.count;
    total += r.count;
    if (r.penalty_type === 'disqualification') dsq += r.count;
  }

  const status = pilot.is_banned ? 'banned' : (total > 0 ? 'flagged' : 'clear');

  return {
    pilot_id: pilot.id,
    status,
    is_banned: pilot.is_banned,
    ban_reason: pilot.ban_reason,
    ban_imposed_at: pilot.ban_imposed_at,
    ban_lifted_at: pilot.ban_lifted_at,
    penalties: { total, dsq, by_type: penaltyCounts },
  };
}

async function setPilotBan(pilotId, { banned, reason }, userId) {
  if (typeof banned !== 'boolean') throw new Error('banned must be boolean');
  if (banned && !reason) throw new Error('reason required when banning');

  const { rows } = await pool.query(
    `UPDATE pilots
        SET is_banned = $1,
            ban_reason = CASE WHEN $1 THEN $2 ELSE NULL END,
            ban_imposed_at = CASE WHEN $1 AND NOT is_banned THEN NOW() ELSE ban_imposed_at END,
            ban_lifted_at  = CASE WHEN NOT $1 AND is_banned THEN NOW() ELSE NULL END
      WHERE id = $3
      RETURNING *`,
    [banned, reason || null, pilotId]
  );
  if (!rows.length) throw new Error('pilot not found');
  const pilot = rows[0];

  await recordAudit({
    competitionId: null,
    action: banned ? 'pilot.banned' : 'pilot.unbanned',
    actorUserId: userId,
    targetKind: 'pilot',
    targetId: pilotId,
    payload: { reason: reason || null },
  });

  return pilot;
}

module.exports = {
  getPilotSanctionStatus,
  setPilotBan,
};
