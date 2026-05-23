'use strict';

// Penalties (§5.10) — лестница санкций главного судьи.

const pool = require('../config/db');
const { recordAudit } = require('./audit');

const PENALTY_TYPES = new Set([
  'oral_warning',
  'written_warning',
  'points_deduction',
  'technical_defeat',
  'disqualification',
]);

function isValidPenaltyType(type) {
  return PENALTY_TYPES.has(type);
}

// Pure: validate the inputs before hitting the DB.
function validatePenaltyInput({ penalty_type, pilot_id, team_id, points }) {
  if (!isValidPenaltyType(penalty_type)) {
    throw new Error('penalty_type invalid');
  }
  const subjects = (pilot_id ? 1 : 0) + (team_id ? 1 : 0);
  if (subjects !== 1) {
    throw new Error('exactly one of pilot_id or team_id required');
  }
  if (penalty_type === 'points_deduction') {
    if (typeof points !== 'number' || points >= 0) {
      throw new Error('points must be negative for points_deduction');
    }
  }
}

async function recordPenalty(io, params, userId) {
  const {
    competition_id,
    heat_id = null,
    pilot_id = null,
    team_id = null,
    penalty_type,
    points = null,
    reason = null,
    rules_clause = null,
  } = params;

  if (!competition_id) throw new Error('competition_id required');
  validatePenaltyInput({ penalty_type, pilot_id, team_id, points });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO penalties
         (competition_id, heat_id, pilot_id, team_id, penalty_type,
          points, reason, rules_clause, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [competition_id, heat_id, pilot_id, team_id, penalty_type,
       points, reason, rules_clause, userId]
    );
    const penalty = rows[0];

    // DSQ side-effect: mark the matching result row dsq=true if it exists.
    if (penalty_type === 'disqualification' && heat_id && pilot_id) {
      await client.query(
        `UPDATE results SET dsq = true, updated_at = NOW()
          WHERE heat_id = $1 AND pilot_id = $2`,
        [heat_id, pilot_id]
      );
    }

    await client.query('COMMIT');

    await recordAudit({
      competitionId: competition_id,
      action: 'penalty.issued',
      actorUserId: userId,
      targetKind: 'penalty',
      targetId: penalty.id,
      payload: {
        penalty_type, pilot_id, team_id, points, reason, rules_clause, heat_id,
      },
    });

    if (io) {
      io.to(`competition:${competition_id}`).emit('penalty_issued', { penalty });
    }
    return penalty;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  PENALTY_TYPES: Array.from(PENALTY_TYPES),
  isValidPenaltyType,
  validatePenaltyInput,
  recordPenalty,
};
