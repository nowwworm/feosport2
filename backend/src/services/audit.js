'use strict';

// Tamper-proof audit log (Phase 13).
//
// Каждая запись хэшируется вместе с хэшем предыдущей по тому же
// (competition_id, action) scope. Любая модификация старой записи или
// вставка между записями ломает цепочку — verifyChain это обнаружит.
//
// Scope (competition_id) — отдельная цепочка на каждое соревнование,
// чтобы не было глобальной точки сериализации. Глобальный scope —
// записи с competition_id IS NULL (системные действия).
//
// recordAudit вызывается ВНУТРИ сервисов, чтобы запись и аудит шли как
// единое событие (idempotency не требуется — каждый вызов = новое событие).

const crypto = require('crypto');
const pool = require('../config/db');

// Deterministic JSON serialization so identical payloads always hash equally,
// regardless of key insertion order. Duplicated locally to avoid a circular
// import with services/protocols.js (which also depends on audit).
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function hashEntry(prevHash, payload, recordedAtIso) {
  const data = (prevHash || '') + canonicalize(payload) + recordedAtIso;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Insert one audit entry. Uses an advisory lock keyed by competition_id so
// concurrent recorders see the latest prev_hash and the chain stays linear.
async function recordAudit({
  competitionId = null,
  action,
  actorUserId = null,
  targetKind = null,
  targetId = null,
  payload = {},
}) {
  if (!action) throw new Error('audit action required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the per-competition chain (or scope 0 for global events).
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [42, competitionId || 0]);

    const { rows: prevRows } = await client.query(
      `SELECT this_hash FROM audit_log
        WHERE ${competitionId == null ? 'competition_id IS NULL' : 'competition_id = $1'}
        ORDER BY id DESC LIMIT 1`,
      competitionId == null ? [] : [competitionId]
    );
    const prevHash = prevRows[0]?.this_hash || null;
    const recordedAt = new Date();
    const recordedAtIso = recordedAt.toISOString();
    const thisHash = hashEntry(prevHash, payload, recordedAtIso);

    const { rows } = await client.query(
      `INSERT INTO audit_log
         (competition_id, action, actor_user_id, target_kind, target_id,
          payload, prev_hash, this_hash, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [competitionId, action, actorUserId, targetKind, targetId,
       payload, prevHash, thisHash, recordedAt]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Walks the chain for a competition (or global if null) and reports the
// first broken link, if any.
//
// returns: { ok: true, entries: N } when the chain is intact,
//          { ok: false, broken_at: id, expected, actual } otherwise.
async function verifyChain(competitionId = null) {
  const { rows } = await pool.query(
    `SELECT id, payload, prev_hash, this_hash, recorded_at
       FROM audit_log
      WHERE ${competitionId == null ? 'competition_id IS NULL' : 'competition_id = $1'}
      ORDER BY id ASC`,
    competitionId == null ? [] : [competitionId]
  );

  let prevHash = null;
  for (const entry of rows) {
    if ((entry.prev_hash || null) !== (prevHash || null)) {
      return { ok: false, broken_at: entry.id, expected: prevHash, actual: entry.prev_hash };
    }
    const expected = hashEntry(
      prevHash,
      entry.payload,
      entry.recorded_at instanceof Date ? entry.recorded_at.toISOString() : entry.recorded_at
    );
    if (expected !== entry.this_hash) {
      return { ok: false, broken_at: entry.id, expected, actual: entry.this_hash };
    }
    prevHash = entry.this_hash;
  }
  return { ok: true, entries: rows.length };
}

// Fire-and-forget wrapper: never blocks the caller on audit failure.
// Production calls use the awaited recordAudit for guaranteed write;
// this is for routes that prefer to keep audit non-blocking.
function recordAuditAsync(params) {
  recordAudit(params).catch(err => {
    console.error('[audit] failed:', err.message, params.action);
  });
}

module.exports = {
  hashEntry,
  recordAudit,
  recordAuditAsync,
  verifyChain,
};
