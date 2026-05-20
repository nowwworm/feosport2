const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const pool       = require('../config/db');
const { getQualificationLeaderboard } = require('./tournament');
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

    socket.on('disconnect', () => {
      console.log(`[ws] disconnected socket=${socket.id}`);
    });
  });

  return io;
}

async function broadcastLeaderboard(io, competitionId) {
  try {
    const leaderboard = await getQualificationLeaderboard(competitionId);
    io.to(`competition:${competitionId}`).emit('leaderboard_update', {
      competition_id: competitionId,
      leaderboard,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ws] broadcastLeaderboard', err);
  }
}

module.exports = { initSocket };
