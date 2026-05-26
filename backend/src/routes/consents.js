'use strict';

// Consent log API (§13.5 GDPR / 152-ФЗ).
//
// POST /api/consents — append immutable consent event.
// GET  /api/consents — list consent events by subject filters.

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
  VALID_CONSENT_TYPES,
  recordConsent,
  listConsents,
} = require('../services/consents');

function requestIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '')
    .toString()
    .split(',')[0]
    .trim() || null;
}

router.post('/', authenticate, async (req, res) => {
  try {
    const event = await recordConsent({
      ...req.body,
      user_id: req.user.id,
      ip_address: requestIp(req),
      user_agent: req.get('user-agent') || null,
      source: req.body.source || 'api',
    });
    res.status(201).json(event);
  } catch (err) {
    const status = /required|must be|valid/.test(err.message) ? 400 : 500;
    (console.error(err), res.status(status).json({ error: status === 400 || status === 404 || status === 409 ? err.message : 'Internal Server Error' }));
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await listConsents(req.query);
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/types', authenticate, (_req, res) => {
  res.json(VALID_CONSENT_TYPES);
});

module.exports = router;
