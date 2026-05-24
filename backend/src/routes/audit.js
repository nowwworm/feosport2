'use strict';

// Audit + sanction endpoints (Phase 13).
//
//   GET  /api/competitions/:id/audit           — chain entries for this competition
//   POST /api/competitions/:id/audit/verify    — walk the chain; report any break
//   GET  /api/pilots/:id/sanction-status       — derived sanction profile
//   PATCH /api/pilots/:id/ban                  — admin sets/lifts ban

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { rolesFor } = require('../services/permissions');
const { verifyChain } = require('../services/audit');
const { getPilotSanctionStatus, setPilotBan } = require('../services/sanctions');

// List audit entries for a competition (chief judge / secretariat).
router.get('/competitions/:id/audit',
  authenticate, authorize(...rolesFor('protocol.sign')),
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
      const { rows } = await pool.query(
        `SELECT a.id, a.action, a.actor_user_id, a.target_kind, a.target_id,
                a.payload, a.prev_hash, a.this_hash, a.recorded_at,
                u.email AS actor_email
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.competition_id = $1
          ORDER BY a.id DESC
          LIMIT $2`,
        [req.params.id, limit]
      );
      res.json(rows);
    } catch (err) {
      (console.error(err), res.status(err.message === 'pilot not found' ? 404 : status).json({ error: status === 400 || status === 404 || status === 409 || err.message === 'pilot not found' ? err.message : 'Internal Server Error' }));
    }
  }
);

router.post('/competitions/:id/audit/verify',
  authenticate, authorize(...rolesFor('protocol.sign')),
  async (req, res) => {
    try {
      const competitionId = parseInt(req.params.id, 10);
      const result = await verifyChain(competitionId);
      res.json(result);
    } catch (err) {
      (console.error(err), res.status(err.message === 'pilot not found' ? 404 : status).json({ error: status === 400 || status === 404 || status === 409 || err.message === 'pilot not found' ? err.message : 'Internal Server Error' }));
    }
  }
);

router.get('/pilots/:id/sanction-status', authenticate, async (req, res) => {
  try {
    const status = await getPilotSanctionStatus(parseInt(req.params.id, 10));
    if (!status) return res.status(404).json({ error: 'pilot not found' });
    res.json(status);
  } catch (err) {
    (console.error(err), res.status(err.message === 'pilot not found' ? 404 : status).json({ error: status === 400 || status === 404 || status === 409 || err.message === 'pilot not found' ? err.message : 'Internal Server Error' }));
  }
});

router.patch('/pilots/:id/ban',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    try {
      const pilot = await setPilotBan(
        parseInt(req.params.id, 10),
        { banned: req.body.banned, reason: req.body.reason },
        req.user.id
      );
      res.json(pilot);
    } catch (err) {
      const status = /required|must|not found/.test(err.message) ? 400 : 500;
      (console.error(err), res.status(err.message === 'pilot not found' ? 404 : status).json({ error: status === 400 || status === 404 || status === 409 || err.message === 'pilot not found' ? err.message : 'Internal Server Error' }));
    }
  }
);

module.exports = router;
