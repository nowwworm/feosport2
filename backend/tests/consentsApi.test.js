'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Consents API', () => {
  let adminUser, pilotUser;
  let competition, pilot;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    pilotUser = users.find(u => u.role === 'pilot');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_Consent', 'registration');
    pilot = await createTestPilot('Test_Consent', 'Pilot');
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM consent_events WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_Consent%')`);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Consent'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_Consent%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  test('POST /api/consents records accepted event with text hash', async () => {
    const res = await request(app)
      .post('/api/consents')
      .set('Authorization', authHeader(pilotUser.id, 'pilot'))
      .set('User-Agent', 'jest-consent-agent')
      .send({
        competition_id: competition.id,
        pilot_id: pilot.id,
        consent_type: 'personal_data_processing',
        consent_version: 'pd-v1',
        consent_text: 'Я согласен на обработку персональных данных.',
        lawful_basis: 'consent',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.action).toBe('accepted');
    expect(res.body.user_id).toBe(pilotUser.id);
    expect(res.body.consent_text_hash_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body).not.toHaveProperty('consent_text');
    expect(res.body.user_agent).toContain('jest-consent-agent');
  });

  test('POST /api/consents records revoke event with precomputed hash', async () => {
    const hash = 'a'.repeat(64);
    const res = await request(app)
      .post('/api/consents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        competition_id: competition.id,
        pilot_id: pilot.id,
        consent_type: 'photo_video_publication',
        action: 'revoked',
        consent_version: 'photo-v1',
        consent_text_hash_sha256: hash,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.action).toBe('revoked');
    expect(res.body.consent_text_hash_sha256).toBe(hash);
  });

  test('GET /api/consents filters by pilot and type', async () => {
    await request(app)
      .post('/api/consents')
      .set('Authorization', authHeader(pilotUser.id, 'pilot'))
      .send({
        competition_id: competition.id,
        pilot_id: pilot.id,
        consent_type: 'competition_rules',
        consent_version: 'rules-v1',
        consent_text: 'rules',
      });

    const res = await request(app)
      .get(`/api/consents?pilot_id=${pilot.id}&consent_type=competition_rules`)
      .set('Authorization', authHeader(adminUser.id, 'admin'));

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].pilot_id).toBe(pilot.id);
  });

  test('POST /api/consents validates required subject', async () => {
    const res = await request(app)
      .post('/api/consents')
      .set('Authorization', authHeader(pilotUser.id, 'pilot'))
      .send({
        consent_type: 'personal_data_processing',
        consent_version: 'pd-v1',
        consent_text: 'legal text',
      });

    expect(res.statusCode).toBe(400);
  });
});
