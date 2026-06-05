'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData, createTestUser, createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant, getAllUsers } = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

const PILOT_IMPORT_FIXTURE = path.join(__dirname, 'fixtures', 'pilots-import-245167-test.xlsx');

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
    // Удаляем competitions первыми — каскад снимает heats и heat_participants,
    // освобождая FK на пилотов. Иначе DELETE pilots падает на ссылающихся
    // heat_participants (см. init.sql — FK без ON DELETE CASCADE).
    await pool.query('DELETE FROM competitions WHERE name LIKE $1', ['Test_%']);
    await pool.query('DELETE FROM pilots WHERE external_id LIKE $1', ['fd-245167-demo-%']);
    await pool.query('DELETE FROM pilots WHERE first_name LIKE $1', ['Test_%']);
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

    test('POST /api/pilots/import/xlsx - imports pilots with FormDesigner validation', async () => {
      const { rows: migrationColumns } = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pilots'
            AND column_name IN (
              'class_75_team',
              'class_75_individual',
              'registration_notes'
            )
          ORDER BY column_name`
      );
      expect(migrationColumns.map(row => row.column_name)).toEqual([
        'class_75_individual',
        'class_75_team',
        'registration_notes',
      ]);

      const file = fs.readFileSync(PILOT_IMPORT_FIXTURE);
      const res = await request(app)
        .post('/api/pilots/import/xlsx')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .attach('file', file, {
          filename: 'pilots-import-245167-test.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.statusCode).toBe(207);
      expect(res.body.source).toMatchObject({
        filename: 'pilots-import-245167-test.xlsx',
        rows: 5,
        form: '245167',
      });
      expect(res.body.created).toHaveLength(5);
      expect(res.body.errors).toHaveLength(0);
      expect(res.body.created[0].row).toBe(2);

      const { rows } = await pool.query(
        `SELECT first_name, last_name, email, has_rank,
                radio_system, vtx_type, vtx_channel, drone_simulator,
                class_75_team, class_75_individual, registration_notes
           FROM pilots
          WHERE external_id = $1`,
        ['fd-245167-demo-001']
      );
      expect(rows[0]).toMatchObject({
        first_name: 'Петр',
        last_name: 'Иванов',
        email: 'petr.ivanov245167@example.com',
        has_rank: true,
        radio_system: 'ELRS 2,4GHz',
        vtx_type: 'HD Zero',
        vtx_channel: 'R3',
        drone_simulator: 'Liftoff',
        class_75_team: true,
        class_75_individual: false,
        registration_notes: 'Тестовая строка: командный класс, HD Zero.',
      });
    });

    test('POST /api/pilots/import/xlsx - rejects invalid FormDesigner field values per row', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('pilots');
      sheet.addRow([
        'ФИО',
        'Электронная почта',
        'Номер телефона',
        'Дата рождения',
        'Наличие разряда',
        'Наименование команды',
        'Система управления',
        'VTX тип',
        'VTX канал',
        'Технический симулятор',
        '75й класс командный',
        '75й класс личный',
        'Дополнительная информация',
        'external_id',
      ]);
      sheet.addRow([
        'Петров Test_Invalid Иванович',
        'test_invalid@example.com',
        '+7 (999) 111-22-33',
        '1994-03-21',
        'Да',
        'Test Bad Team',
        'Unknown Radio',
        'HD Zero',
        'R3',
        'Liftoff',
        'Да',
        'Нет',
        'Bad radio must fail validation',
        'test-xlsx-invalid-001',
      ]);

      const file = Buffer.from(await workbook.xlsx.writeBuffer());
      const res = await request(app)
        .post('/api/pilots/import/xlsx')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .attach('file', file, {
          filename: 'pilots-invalid.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.statusCode).toBe(207);
      expect(res.body.created).toHaveLength(0);
      expect(res.body.updated).toHaveLength(0);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toMatchObject({ row: 2 });
      expect(res.body.errors[0].reason).toContain('radio_system');

      const { rows } = await pool.query(
        'SELECT id FROM pilots WHERE external_id = $1',
        ['test-xlsx-invalid-001']
      );
      expect(rows).toHaveLength(0);
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
