const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const pool       = require('../config/db');
const { summarizeLaps, shouldRequestWholeGroupReflight } = require('./flightTiming');
const { getQualificationLeaderboard } = require('./tournament');
const { recordHandoff } = require('./teamRelay');
const { JWT_SECRET } = require('../middleware/auth');

/**
 * Attach Socket.io server to an existing HTTP server instance.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // ── JWT authentication handshake ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id: userId, role } = socket.user;
    console.log(`[ws] connected uid=${userId} role=${role} socket=${socket.id}`);

    // Join a competition room so broadcasts are scoped
    socket.on('join_competition', ({ competition_id }) => {
      socket.join(`competition:${competition_id}`);
    });

    // ── submit_score — Judge submits (or overwrites) a result ───────────────
    socket.on('submit_score', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id, pilot_id, time_seconds, penalty_seconds, dnf, dsq } = payload;

        const { rows: heatRows } = await pool.query(
          'SELECT status, competition_id FROM heats WHERE id = $1',
          [heat_id]
        );
        if (!heatRows.length) return ack?.({ error: 'Heat not found' });
        if (heatRows[0].status === 'locked') return ack?.({ error: 'Heat is locked' });

        const competitionId = heatRows[0].competition_id;

        const { rows } = await pool.query(
          `INSERT INTO results
             (heat_id, pilot_id, judge_id, time_seconds, penalty_seconds, dnf, dsq)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (heat_id, pilot_id) DO UPDATE SET
             time_seconds    = EXCLUDED.time_seconds,
             penalty_seconds = EXCLUDED.penalty_seconds,
             dnf             = EXCLUDED.dnf,
             dsq             = EXCLUDED.dsq,
             judge_id        = EXCLUDED.judge_id,
             updated_at      = NOW()
           RETURNING *`,
          [heat_id, pilot_id, userId, time_seconds, penalty_seconds ?? 0, dnf ?? false, dsq ?? false]
        );

        ack?.({ ok: true, result: rows[0] });
        io.to(`competition:${competitionId}`).emit('score_update', { heat_id, pilot_id, result: rows[0] });
        await broadcastLeaderboard(io, competitionId);
      } catch (err) {
        console.error('[ws] submit_score', err);
        ack?.({ error: err.message });
      }
    });

    // ── edit_score — Judge corrects an existing result ──────────────────────
    socket.on('edit_score', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { result_id, time_seconds, penalty_seconds, dnf, dsq, change_reason } = payload;

        const { rows: existing } = await pool.query(
          `SELECT r.*, h.status AS heat_status, h.competition_id
           FROM results r JOIN heats h ON h.id = r.heat_id
           WHERE r.id = $1`,
          [result_id]
        );
        if (!existing.length) return ack?.({ error: 'Result not found' });
        if (existing[0].heat_status === 'locked') return ack?.({ error: 'Heat is locked' });

        const prev = existing[0];

        // Audit trail before mutation
        await pool.query(
          `INSERT INTO result_audit_log
             (result_id, changed_by, old_time_seconds, old_penalty_seconds,
              new_time_seconds, new_penalty_seconds, change_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [result_id, userId, prev.time_seconds, prev.penalty_seconds,
           time_seconds, penalty_seconds ?? 0, change_reason ?? null]
        );

        const { rows } = await pool.query(
          `UPDATE results SET
             time_seconds    = $1,
             penalty_seconds = $2,
             dnf             = $3,
             dsq             = $4,
             judge_id        = $5,
             updated_at      = NOW()
           WHERE id = $6 RETURNING *`,
          [time_seconds, penalty_seconds ?? 0, dnf ?? false, dsq ?? false, userId, result_id]
        );

        ack?.({ ok: true, result: rows[0] });
        io.to(`competition:${prev.competition_id}`).emit('score_update', {
          heat_id:  rows[0].heat_id,
          pilot_id: rows[0].pilot_id,
          result:   rows[0],
        });
        await broadcastLeaderboard(io, prev.competition_id);
      } catch (err) {
        console.error('[ws] edit_score', err);
        ack?.({ error: err.message });
      }
    });

    // ── lock_heat — Chief judge locks a heat (no more edits) ────────────────
    socket.on('lock_heat', async (payload, ack) => {
      if (!['chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id } = payload;
        const { rows } = await pool.query(
          `UPDATE heats SET
             status     = 'locked',
             locked_at  = NOW(),
             locked_by  = $1,
             updated_at = NOW()
           WHERE id = $2 AND status != 'locked'
           RETURNING *`,
          [userId, heat_id]
        );
        if (!rows.length) return ack?.({ error: 'Heat not found or already locked' });

        ack?.({ ok: true, heat: rows[0] });
        io.to(`competition:${rows[0].competition_id}`).emit('heat_status_change', {
          heat_id,
          status: 'locked',
        });
        await broadcastLeaderboard(io, rows[0].competition_id);
      } catch (err) {
        console.error('[ws] lock_heat', err);
        ack?.({ error: err.message });
      }
    });

    // ── flight_start — Chronometer starts an active flight ───────────────────
    socket.on('flight_start', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id } = payload;
        const { rows } = await pool.query(
          `UPDATE heats
              SET status = 'active',
                  started_at = COALESCE(started_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1 AND status != 'locked'
            RETURNING *`,
          [heat_id]
        );
        if (!rows.length) return ack?.({ error: 'Heat not found or locked' });

        ack?.({ ok: true, heat: rows[0] });
        io.to(`competition:${rows[0].competition_id}`).emit('flight_start', {
          heat_id,
          heat: rows[0],
        });
        io.to(`competition:${rows[0].competition_id}`).emit('heat_status_change', {
          heat_id,
          status: 'active',
        });
      } catch (err) {
        console.error('[ws] flight_start', err);
        ack?.({ error: err.message });
      }
    });

    // ── lap_complete — Chronometer records one pilot lap ─────────────────────
    socket.on('lap_complete', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id, pilot_id, lap_number, duration_ms, valid, notes } = payload;
        if (!heat_id || !pilot_id || !lap_number || !duration_ms) {
          return ack?.({ error: 'heat_id, pilot_id, lap_number, duration_ms required' });
        }

        const { rows: heatRows } = await pool.query(
          'SELECT status, competition_id FROM heats WHERE id = $1',
          [heat_id]
        );
        if (!heatRows.length) return ack?.({ error: 'Heat not found' });
        if (heatRows[0].status === 'locked') return ack?.({ error: 'Heat is locked' });

        const { rows } = await pool.query(
          `INSERT INTO laps
             (heat_id, pilot_id, lap_number, duration_ms, valid, recorded_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (heat_id, pilot_id, lap_number)
           DO UPDATE SET
             duration_ms = EXCLUDED.duration_ms,
             valid = EXCLUDED.valid,
             recorded_by = EXCLUDED.recorded_by,
             notes = EXCLUDED.notes,
             completed_at = NOW()
           RETURNING *`,
          [
            heat_id,
            pilot_id,
            lap_number,
            duration_ms,
            valid !== false,
            userId,
            notes || null,
          ]
        );

        const summary = await getPilotLapSummary(heat_id, pilot_id);
        ack?.({ ok: true, lap: rows[0], summary });
        io.to(`competition:${heatRows[0].competition_id}`).emit('lap_complete', {
          heat_id,
          pilot_id,
          lap: rows[0],
          summary,
        });
        broadcastLeaderboard(io, heatRows[0].competition_id);
      } catch (err) {
        console.error('[ws] lap_complete', err);
        ack?.({ error: err.message });
      }
    });

    // ── falsestart — Judge records a false start, reflight recommended ───────
    socket.on('falsestart', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id, pilot_id, reason } = payload;
        const heat = await getHeatForEvent(heat_id);
        if (!heat) return ack?.({ error: 'Heat not found' });
        if (heat.status === 'locked') return ack?.({ error: 'Heat is locked' });

        const { rows } = await pool.query(
          `INSERT INTO falsestarts (heat_id, pilot_id, reason, recorded_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [heat_id, pilot_id || null, reason || null, userId]
        );
        const reflightRecommended = shouldRequestWholeGroupReflight('falsestart');
        ack?.({ ok: true, falsestart: rows[0], reflight_recommended: reflightRecommended });
        io.to(`competition:${heat.competition_id}`).emit('falsestart', {
          heat_id,
          pilot_id: pilot_id || null,
          falsestart: rows[0],
          reflight_recommended: reflightRecommended,
        });
      } catch (err) {
        console.error('[ws] falsestart', err);
        ack?.({ error: err.message });
      }
    });

    // ── reflight_requested — Chief judge requests/approves a reflight ────────
    socket.on('reflight_requested', async (payload, ack) => {
      if (!['chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id, reason, notes, status } = payload;
        if (!reason) return ack?.({ error: 'reason required' });

        const heat = await getHeatForEvent(heat_id);
        if (!heat) return ack?.({ error: 'Heat not found' });

        const { rows } = await pool.query(
          `INSERT INTO reflights (heat_id, group_id, reason, requested_by, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [heat_id, heat.group_id || null, reason, userId, status || 'requested', notes || null]
        );
        ack?.({ ok: true, reflight: rows[0] });
        io.to(`competition:${heat.competition_id}`).emit('reflight_requested', {
          heat_id,
          reflight: rows[0],
        });
      } catch (err) {
        console.error('[ws] reflight_requested', err);
        ack?.({ error: err.message });
      }
    });

    // ── relay_handoff — Judge in the team pit records a relay exchange ───────
    socket.on('relay_handoff', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const result = await recordHandoff(io, payload, userId);
        ack?.({ ok: true, ...result });
        const { rows: heatRows } = await pool.query(
          'SELECT competition_id FROM heats WHERE id = $1',
          [payload.heat_id]
        );
        if (heatRows.length) broadcastLeaderboard(io, heatRows[0].competition_id);
      } catch (err) {
        console.error('[ws] relay_handoff', err);
        ack?.({ error: err.message });
      }
    });

    // ── flight_end — Chronometer closes an active flight ─────────────────────
    socket.on('flight_end', async (payload, ack) => {
      if (!['judge', 'chief_judge', 'admin'].includes(role)) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const { heat_id } = payload;
        const { rows } = await pool.query(
          `UPDATE heats
              SET status = 'completed',
                  ended_at = COALESCE(ended_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1 AND status != 'locked'
            RETURNING *`,
          [heat_id]
        );
        if (!rows.length) return ack?.({ error: 'Heat not found or locked' });

        ack?.({ ok: true, heat: rows[0] });
        io.to(`competition:${rows[0].competition_id}`).emit('flight_end', {
          heat_id,
          heat: rows[0],
        });
        io.to(`competition:${rows[0].competition_id}`).emit('heat_status_change', {
          heat_id,
          status: 'completed',
        });
        await broadcastLeaderboard(io, rows[0].competition_id);
      } catch (err) {
        console.error('[ws] flight_end', err);
        ack?.({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[ws] disconnected socket=${socket.id}`);
    });
  });

  return io;
}

// ─── Leaderboard broadcast (debounced, 500ms per competition) ───────────────
// Спектатор-таблоид обновляется часто (каждый круг), поэтому каждое событие
// (lap_complete / flight_end / score / lock) превращалось бы в отдельный
// emit. Throttle с trailing-edge: первое событие в окне 500ms — сразу,
// последующие коалесцируются в один отложенный emit в конце окна.
const LEADERBOARD_DEBOUNCE_MS = 500;
const _lbLastEmitAt   = new Map();
const _lbTrailing     = new Map();

function _emitLeaderboard(io, competitionId) {
  return getQualificationLeaderboard(competitionId)
    .then((leaderboard) => {
      io.to(`competition:${competitionId}`).emit('leaderboard_update', {
        competition_id: competitionId,
        leaderboard,
        updated_at: new Date().toISOString(),
      });
      _lbLastEmitAt.set(competitionId, Date.now());
    })
    .catch((err) => {
      console.error('[ws] _emitLeaderboard', err);
    });
}

function broadcastLeaderboard(io, competitionId) {
  const now = Date.now();
  const last = _lbLastEmitAt.get(competitionId) || 0;
  const elapsed = now - last;

  if (elapsed >= LEADERBOARD_DEBOUNCE_MS) {
    return _emitLeaderboard(io, competitionId);
  }

  if (_lbTrailing.has(competitionId)) return;

  const delay = LEADERBOARD_DEBOUNCE_MS - elapsed;
  const timer = setTimeout(() => {
    _lbTrailing.delete(competitionId);
    _emitLeaderboard(io, competitionId);
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  _lbTrailing.set(competitionId, timer);
}

// For tests: clear pending trailing timers so the suite can exit cleanly
// and so each test starts from a known state.
function _resetLeaderboardThrottle() {
  for (const t of _lbTrailing.values()) clearTimeout(t);
  _lbTrailing.clear();
  _lbLastEmitAt.clear();
}

async function getHeatForEvent(heatId) {
  const { rows } = await pool.query(
    'SELECT id, competition_id, group_id, status FROM heats WHERE id = $1',
    [heatId]
  );
  return rows[0] || null;
}

async function getPilotLapSummary(heatId, pilotId) {
  const { rows } = await pool.query(
    `SELECT pilot_id, lap_number, duration_ms, valid
       FROM laps
      WHERE heat_id = $1 AND pilot_id = $2
      ORDER BY lap_number`,
    [heatId, pilotId]
  );
  return {
    pilot_id: pilotId,
    ...summarizeLaps(rows),
  };
}

module.exports = { initSocket, _resetLeaderboardThrottle };
