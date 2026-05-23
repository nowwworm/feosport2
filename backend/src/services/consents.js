'use strict';

const crypto = require('crypto');
const pool = require('../config/db');

const VALID_CONSENT_TYPES = [
  'personal_data_processing',
  'photo_video_publication',
  'medical_data_processing',
  'parental_consent',
  'competition_rules',
];

const VALID_ACTIONS = ['accepted', 'revoked'];

function hashConsentText(text) {
  if (!text || !String(text).trim()) {
    throw new Error('consent_text required');
  }
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function normalizeConsentInput(input = {}) {
  const consent_type = input.consent_type;
  const action = input.action || 'accepted';
  const consent_version = input.consent_version;
  const consentTextHash = input.consent_text_hash_sha256 || (
    input.consent_text ? hashConsentText(input.consent_text) : null
  );

  if (!VALID_CONSENT_TYPES.includes(consent_type)) {
    throw new Error(`consent_type must be one of: ${VALID_CONSENT_TYPES.join(', ')}`);
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`action must be one of: ${VALID_ACTIONS.join(', ')}`);
  }
  if (!consent_version || !String(consent_version).trim()) {
    throw new Error('consent_version required');
  }
  if (!consentTextHash || !/^[a-f0-9]{64}$/.test(consentTextHash)) {
    throw new Error('consent_text or valid consent_text_hash_sha256 required');
  }
  if (!input.pilot_id && !input.team_id && !input.application_id) {
    throw new Error('at least one of pilot_id / team_id / application_id is required');
  }

  return {
    competition_id: input.competition_id || null,
    pilot_id: input.pilot_id || null,
    team_id: input.team_id || null,
    application_id: input.application_id || null,
    user_id: input.user_id || null,
    consent_type,
    action,
    consent_version: String(consent_version).trim(),
    consent_text_hash_sha256: consentTextHash,
    lawful_basis: input.lawful_basis || null,
    source: input.source || 'api',
    ip_address: input.ip_address || null,
    user_agent: input.user_agent || null,
  };
}

async function recordConsent(input) {
  const c = normalizeConsentInput(input);
  const { rows } = await pool.query(
    `INSERT INTO consent_events
       (competition_id, pilot_id, team_id, application_id, user_id,
        consent_type, action, consent_version, consent_text_hash_sha256,
        lawful_basis, source, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      c.competition_id, c.pilot_id, c.team_id, c.application_id, c.user_id,
      c.consent_type, c.action, c.consent_version, c.consent_text_hash_sha256,
      c.lawful_basis, c.source, c.ip_address, c.user_agent,
    ]
  );
  return rows[0];
}

async function listConsents(filters = {}) {
  const where = [];
  const values = [];
  for (const f of ['competition_id', 'pilot_id', 'team_id', 'application_id', 'consent_type']) {
    if (filters[f]) {
      values.push(filters[f]);
      where.push(`${f} = $${values.length}`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT *
       FROM consent_events
       ${whereSql}
      ORDER BY recorded_at DESC, id DESC`,
    values
  );
  return rows;
}

module.exports = {
  VALID_CONSENT_TYPES,
  VALID_ACTIONS,
  hashConsentText,
  normalizeConsentInput,
  recordConsent,
  listConsents,
};
