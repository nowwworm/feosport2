'use strict';

// Protocols routes (§Приложения 4-5):
//   GET  /api/competitions/:id/protocols                  — list issued protocols
//   POST /api/competitions/:id/protocols/:type            — generate + sign + store
//        type ∈ services/protocols.SUPPORTED_TYPES
//        body for stage-bound types: { stage_id }
//   GET  /api/protocols/:id                               — full record (JSON)
//   GET  /api/protocols/:id/html                          — printable HTML view

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  SUPPORTED_TYPES,
  STAGE_BOUND_TYPES,
  buildQualificationProtocol,
  buildStageResultsProtocol,
  buildFinalStandingsProtocol,
  buildTeamSummaryProtocol,
  buildTeamRelayProtocol,
  buildSimulatorQualificationProtocol,
  buildSimulatorResultsProtocol,
  buildTiebreakProtocol,
  buildEventReportProtocol,
  signAndStore,
  renderHtml,
} = require('../services/protocols');

router.get('/competitions/:id/protocols', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.id, pr.protocol_type, pr.stage_id, pr.payload_hash,
              pr.signed_at, u.email AS signed_by_email
         FROM protocols pr
         LEFT JOIN users u ON u.id = pr.signed_by
        WHERE pr.competition_id = $1
        ORDER BY pr.signed_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.post('/competitions/:id/protocols/:type',
  authenticate, authorize('chief_judge', 'admin'),
  async (req, res) => {
    const competitionId = parseInt(req.params.id, 10);
    const type = req.params.type;
    if (!SUPPORTED_TYPES.includes(type)) {
      return res.status(400).json({ error: `unsupported_type:${type}` });
    }

    try {
      let payload;
      let stageId = req.body?.stage_id ? Number(req.body.stage_id) : null;
      const needsStage = STAGE_BOUND_TYPES.includes(type);
      if (needsStage && !stageId) {
        return res.status(400).json({ error: 'stage_id required' });
      }

      switch (type) {
        case 'qualification':
          payload = await buildQualificationProtocol(stageId);
          break;
        case 'stage_results':
        case 'final':
          payload = await buildStageResultsProtocol(stageId);
          break;
        case 'team_relay':
          payload = await buildTeamRelayProtocol(stageId);
          break;
        case 'simulator_qualification':
          payload = await buildSimulatorQualificationProtocol(stageId);
          break;
        case 'simulator_results':
          payload = await buildSimulatorResultsProtocol(stageId);
          break;
        case 'final_standings':
          payload = await buildFinalStandingsProtocol(competitionId);
          stageId = null;
          break;
        case 'team_summary':
          payload = await buildTeamSummaryProtocol(competitionId);
          stageId = null;
          break;
        case 'tiebreak':
          payload = await buildTiebreakProtocol(competitionId);
          stageId = null;
          break;
        case 'event_report':
          payload = await buildEventReportProtocol(competitionId);
          stageId = null;
          break;
      }

      const protocol = await signAndStore(
        { competitionId, stageId, type, payload },
        req.user.id
      );
      res.status(201).json(protocol);
    } catch (err) {
      const status = /not_found|required/.test(err.message) ? 400 : 500;
      (console.error(err), res.status(status).json({ error: status === 400 || status === 404 || status === 409 ? err.message : 'Internal Server Error' }));
    }
  }
);

router.get('/protocols/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, u.email AS signed_by_email
         FROM protocols pr
         LEFT JOIN users u ON u.id = pr.signed_by
        WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/protocols/:id/html', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, u.email AS signed_by_email
         FROM protocols pr
         LEFT JOIN users u ON u.id = pr.signed_by
        WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderHtml(rows[0], { signedBy: rows[0].signed_by_email }));
  } catch (err) {
    (console.error(err), res.status(500).send('Internal Server Error'));
  }
});

module.exports = router;
