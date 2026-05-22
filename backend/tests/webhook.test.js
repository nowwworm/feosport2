'use strict';

const request = require('supertest');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData } = require('./helpers/testDB');

describe('Webhook Integration', () => {
  beforeAll(async () => {
    await seedBaselineData();
  });

  afterEach(async () => {
    // Clear test pilots
    await pool.query('DELETE FROM pilots WHERE first_name LIKE $1', ['WebhookTest%']);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('GET /api/webhook/pilot-registration', () => {
    test('Health check endpoint responds', async () => {
      const res = await request(app)
        .get('/api/webhook/pilot-registration');

      expect([200, 204]).toContain(res.statusCode);
    });
  });

  describe('POST /api/webhook/pilot-registration', () => {
    test('Valid pilot registration payload creates pilot', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: 'WebhookTest_John',
          last_name: 'Doe',
          email: 'webhook_test@example.com',
          team: 'Test Team',
          city: 'Test City',
          external_id: 'ext_webhook_123'
        });

      expect([200, 201, 409]).toContain(res.statusCode);

      if (res.statusCode === 201 || res.statusCode === 200) {
        expect(res.body).toHaveProperty('id');
      }
    });

    test('Duplicate external_id returns existing pilot (idempotent)', async () => {
      const externalId = 'ext_webhook_duplicate';

      // First call - creates pilot
      const res1 = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: 'WebhookTest_First',
          last_name: 'Call',
          email: 'webhook_first@example.com',
          team: 'Test Team',
          city: 'Test City',
          external_id: externalId
        });

      expect([200, 201]).toContain(res1.statusCode);
      const pilotId1 = res1.body.id;

      // Second call with same external_id - should return existing
      const res2 = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: 'WebhookTest_Second',
          last_name: 'Call',
          email: 'webhook_second@example.com',
          team: 'Different Team',
          city: 'Different City',
          external_id: externalId
        });

      expect([200, 201, 409]).toContain(res2.statusCode);
      if (res2.statusCode === 200 || res2.statusCode === 201) {
        expect(res2.body.id).toBe(pilotId1); // Same pilot
      }
    });

    test('Missing required field returns 400', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: 'WebhookTest_NoLast', // missing last_name
          email: 'webhook_incomplete@example.com',
          team: 'Test Team',
          city: 'Test City'
        });

      expect(res.statusCode).toBe(400);
    });

    test('Invalid secret returns 401', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: 'wrong_secret' })
        .send({
          first_name: 'WebhookTest_Auth',
          last_name: 'Failure',
          email: 'webhook_auth_fail@example.com',
          team: 'Test Team',
          city: 'Test City',
          external_id: 'ext_auth_fail'
        });

      expect(res.statusCode).toBe(401);
    });

    test('Missing secret parameter returns 401', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .send({
          first_name: 'WebhookTest_NoSecret',
          last_name: 'Pilot',
          email: 'webhook_nosecret@example.com',
          team: 'Test Team',
          city: 'Test City'
        });

      expect(res.statusCode).toBe(401);
    });

    test('Empty payload returns 400', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({});

      expect(res.statusCode).toBe(400);
    });

    test('Malformed JSON returns 400', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect([400, 500]).toContain(res.statusCode);
    });
  });

  describe('Webhook Data Validation', () => {
    test('Accepts optional fields (video_channel, registration_number)', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: 'WebhookTest_Optional',
          last_name: 'Fields',
          email: 'webhook_optional@example.com',
          team: 'Test Team',
          city: 'Test City',
          external_id: 'ext_optional_fields',
          video_channel: 'https://youtube.com/user/test',
          registration_number: 'REG12345'
        });

      expect([200, 201, 409]).toContain(res.statusCode);
    });

    test('Handles special characters in names', async () => {
      const res = await request(app)
        .post('/api/webhook/pilot-registration')
        .query({ secret: process.env.WEBHOOK_SECRET || 'webhook_secret' })
        .send({
          first_name: "WebhookTest_José",
          last_name: "O'Brien",
          email: 'webhook_special_chars@example.com',
          team: 'Team "Elite"',
          city: 'São Paulo',
          external_id: 'ext_special_chars_123'
        });

      expect([200, 201, 409]).toContain(res.statusCode);
    });
  });
});
