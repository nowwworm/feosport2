'use strict';

// Penalties & protests routes (§5.10 / §5.14).
//
//   POST /api/competitions/:id/penalties — chief_judge issues a penalty
//   GET  /api/competitions/:id/penalties — list penalties for the competition
//   POST /api/competitions/:id/protests  — file a protest (any authenticated)
//   GET  /api/competitions/:id/protests  — list protests
//   PATCH /api/protests/:id              — chief_judge resolves the protest

const router = require('express').Router({ mergeParams: true });
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { recordPenalty } = require('../services/penalties');
const { fileProtest, resolveProtest } = require('../services/protests');

router.post('/competitions/:id/penalties',
  authenticate, authorize('chief_judge', 'admin'),
  async (req, res) => {
    try {
      const competitionId = parseInt(req.params.id, 10);
      const penalty = await recordPenalty(
        req.app.get('io') || null,
        { competition_id: competitionId, ...req.body },
        req.user.id,
      );
      res.status(201).json(penalty);
    } catch (err) {
      const status = /required|invalid|must/.test(err.message) ? 400 : 500;
      (console.error(err), res.status(status).json({ error: 'Internal Server Error' }));
    }
  }
);

router.get('/competitions/:id/penalties',
  authenticate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT pe.*, p.first_name, p.last_name, t.name AS team_name
           FROM penalties pe
           LEFT JOIN pilots p ON p.id = pe.pilot_id
           LEFT JOIN teams  t ON t.id = pe.team_id
          WHERE pe.competition_id = $1
          ORDER BY pe.issued_at ASC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }
  }
);

router.post('/competitions/:id/protests',
  authenticate,
  async (req, res) => {
    try {
      const competitionId = parseInt(req.params.id, 10);
      const protest = await fileProtest(
        req.app.get('io') || null,
        { competition_id: competitionId, ...req.body },
        req.user.id,
      );
      res.status(201).json(protest);
    } catch (err) {
      const status = err.statusCode || (/required|invalid/.test(err.message) ? 400 : 500);
      (console.error(err), res.status(status).json({ error: 'Internal Server Error' }));
    }
  }
);

router.get('/competitions/:id/protests',
  authenticate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT pr.*,
                u.email AS filed_by_email,
                p.first_name  AS subject_pilot_first_name,
                p.last_name   AS subject_pilot_last_name,
                t.name        AS subject_team_name
           FROM protests pr
           LEFT JOIN users  u ON u.id = pr.filed_by
           LEFT JOIN pilots p ON p.id = pr.subject_pilot_id
           LEFT JOIN teams  t ON t.id = pr.subject_team_id
          WHERE pr.competition_id = $1
          ORDER BY pr.filed_at ASC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }
  }
);

router.patch('/protests/:id',
  authenticate, authorize('chief_judge', 'admin'),
  async (req, res) => {
    try {
      const protest = await resolveProtest(
        req.app.get('io') || null,
        parseInt(req.params.id, 10),
        req.body,
        req.user.id,
      );
      res.json(protest);
    } catch (err) {
      const status = err.statusCode || (/must|required/.test(err.message) ? 400 : 500);
      (console.error(err), res.status(status).json({ error: 'Internal Server Error' }));
    }
  }
);

module.exports = router;
