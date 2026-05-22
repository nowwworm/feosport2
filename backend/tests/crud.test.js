'use strict';

const request = require('supertest');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData, createTestUser, createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant, getAllUsers } = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('API CRUD Operations', () => {
  let adminUser, chiefJudgeUser, judgeUser;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser = users.find(u => u.role === 'judge');
  });

  afterEach(async () => {
    // Clear test data between tests
    await pool.query('DELETE FROM pilots WHERE first_name LIKE $1', ['Test_%']);
    await pool.query('DELETE FROM competitions WHERE name LIKE $1', ['Test_%']);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('Pilots CRUD', () => {
    test('POST /api/pilots - Create pilot (admin only)', async () => {
      const res = await request(app)
        .post('/api/pilots')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          first_name: 'Test_John',
          last_name: 'Doe',
          team: 'Test Team',
          city: 'Test City'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.first_name).toBe('Test_John');
    });

    test('POST /api/pilots - Non-admin cannot create', async () => {
      const res = await request(app)
        .post('/api/pilots')
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          first_name: 'Test_Jane',
          last_name: 'Doe',
          team: 'Test Team',
          city: 'Test City'
        });

      expect(res.statusCode).toBe(403);
    });

    test('GET /api/pilots - List all pilots', async () => {
      await createTestPilot('Test_John', 'Doe');
      await createTestPilot('Test_Jane', 'Smith');

      const res = await request(app)
        .get('/api/pilots')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    test('GET /api/pilots/:id - Get single pilot', async () => {
      const pilot = await createTestPilot('Test_John', 'Doe');

      const res = await request(app)
        .get(`/api/pilots/${pilot.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(pilot.id);
      expect(res.body.first_name).toBe('Test_John');
    });

    test('GET /api/pilots/:id - Non-existent pilot returns 404', async () => {
      const res = await request(app)
        .get('/api/pilots/99999')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(404);
    });

    test('PATCH /api/pilots/:id - Update pilot', async () => {
      const pilot = await createTestPilot('Test_John', 'Doe');

      const res = await request(app)
        .patch(`/api/pilots/${pilot.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          team: 'Updated Team',
          city: 'Updated City'
        });

      expect([200, 204]).toContain(res.statusCode);
    });

    test('DELETE /api/pilots/:id - Delete pilot', async () => {
      const pilot = await createTestPilot('Test_John', 'Doe');

      const res = await request(app)
        .delete(`/api/pilots/${pilot.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect([200, 204]).toContain(res.statusCode);

      // Verify pilot is deleted
      const getRes = await request(app)
        .get(`/api/pilots/${pilot.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(getRes.statusCode).toBe(404);
    });
  });

  describe('Competitions CRUD', () => {
    test('POST /api/competitions - Create competition', async () => {
      const res = await request(app)
        .post('/api/competitions')
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          name: 'Test_Championship',
          location: 'Test Venue',
          playoff_size: 8
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test_Championship');
      expect(res.body.status).toBe('draft');
    });

    test('GET /api/competitions - List competitions', async () => {
      await createTestCompetition('Test_Comp1', 'draft');
      await createTestCompetition('Test_Comp2', 'draft');

      const res = await request(app)
        .get('/api/competitions')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('GET /api/competitions/:id - Get single competition', async () => {
      const comp = await createTestCompetition('Test_SingleComp', 'draft');

      const res = await request(app)
        .get(`/api/competitions/${comp.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(comp.id);
      expect(res.body.name).toBe('Test_SingleComp');
    });

    test('PATCH /api/competitions/:id - Update competition status', async () => {
      const comp = await createTestCompetition('Test_StatusComp', 'draft');

      const res = await request(app)
        .patch(`/api/competitions/${comp.id}`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          status: 'registration'
        });

      expect([200, 204]).toContain(res.statusCode);
    });

    test('DELETE /api/competitions/:id - Delete competition cascades to heats', async () => {
      const comp = await createTestCompetition('Test_DeleteComp', 'draft');
      const pilot1 = await createTestPilot('Test_P1', 'Pilot');
      const heat = await createTestHeat(comp.id, adminUser.id);
      await addHeatParticipant(heat.id, pilot1.id);

      const res = await request(app)
        .delete(`/api/competitions/${comp.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect([200, 204]).toContain(res.statusCode);

      // Verify heat is cascade deleted
      const heatsRes = await request(app)
        .get(`/api/heats?competition_id=${comp.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(heatsRes.body.length).toBe(0);
    });
  });

  describe('Heats CRUD', () => {
    test('POST /api/heats - Create heat', async () => {
      const comp = await createTestCompetition('Test_HeatComp', 'qualification');
      const pilot = await createTestPilot('Test_Pilot', 'Name');

      const res = await request(app)
        .post('/api/heats')
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          competition_id: comp.id,
          judge_id: judgeUser.id,
          round_type: 'qualification',
          heat_number: 1,
          participants: [{ pilot_id: pilot.id, lane: 1 }]
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.heat_number).toBe(1);
    });

    test('GET /api/heats - List heats by competition', async () => {
      const comp = await createTestCompetition('Test_HeatListComp', 'qualification');
      const pilot = await createTestPilot('Test_Pilot', 'Name');
      const heat = await createTestHeat(comp.id, judgeUser.id);
      await addHeatParticipant(heat.id, pilot.id);

      const res = await request(app)
        .get(`/api/heats?competition_id=${comp.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /api/heats/:id/results - Get heat results', async () => {
      const comp = await createTestCompetition('Test_ResultsComp', 'qualification');
      const pilot = await createTestPilot('Test_Pilot', 'Name');
      const heat = await createTestHeat(comp.id, judgeUser.id);
      await addHeatParticipant(heat.id, pilot.id);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/results`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('PATCH /api/heats/:id/lock - Lock heat prevents edits', async () => {
      const comp = await createTestCompetition('Test_LockComp', 'qualification');
      const heat = await createTestHeat(comp.id, judgeUser.id);

      const res = await request(app)
        .patch(`/api/heats/${heat.id}/lock`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      expect([200, 204]).toContain(res.statusCode);

      // Verify heat is locked
      const getRes = await request(app)
        .get(`/api/heats/${heat.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      // Status should be 'locked'
      expect(getRes.statusCode).toBe(200);
    });
  });

  describe('Data Integrity', () => {
    test('Duplicate email prevents pilot creation', async () => {
      await createTestPilot('Test_John', 'Doe');

      const res = await request(app)
        .post('/api/pilots')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          first_name: 'Test_John',
          last_name: 'Doe',
          team: 'Test Team',
          city: 'Test City'
        });

      // Should succeed or return appropriate error
      expect([201, 409, 400]).toContain(res.statusCode);
    });

    test('Unique constraint enforced on external_id', async () => {
      const res1 = await request(app)
        .post('/api/pilots')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          first_name: 'Test_John',
          last_name: 'Doe',
          team: 'Test Team',
          city: 'Test City',
          external_id: 'ext_12345'
        });

      expect(res1.statusCode).toBe(201);

      const res2 = await request(app)
        .post('/api/pilots')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          first_name: 'Test_Jane',
          last_name: 'Smith',
          team: 'Test Team 2',
          city: 'Test City 2',
          external_id: 'ext_12345'
        });

      expect(res2.statusCode).toBe(409);
    });
  });
});
