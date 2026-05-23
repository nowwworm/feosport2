'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestPilot, createTestCompetition,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Applications API', () => {
  let adminUser, chiefJudgeUser, judgeUser;
  let discAdults14, ageGroup14p;
  // Competition tied to "adults 14+" / class 75mm for happy-path final submission.
  let comp;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser      = users.find(u => u.role === 'admin');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');

    const { rows: discRows } = await pool.query(
      `SELECT id FROM disciplines WHERE code = 'class_75mm'`
    );
    discAdults14 = discRows[0];

    const { rows: agRows } = await pool.query(
      `SELECT id, code FROM age_groups WHERE code = 'adults_14_plus'`
    );
    ageGroup14p = agRows[0];

    // Comp starts 2026-09-01.
    const { rows: compRows } = await pool.query(
      `INSERT INTO competitions
        (name, location, start_date, end_date, status, playoff_size,
         discipline_id, age_group_id, gender)
       VALUES ('Test_Cup_Phase2', 'Локация', '2026-09-01', '2026-09-02',
               'registration', 16, $1, $2, 'X')
       RETURNING *`,
      [discAdults14.id, ageGroup14p.id]
    );
    comp = compRows[0];
  });

  afterEach(async () => {
    if (!comp?.id) return; // beforeAll bailed — let its real error surface
    await pool.query(`DELETE FROM applications WHERE competition_id = $1`, [comp.id]);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_App_%'`);
  });

  afterAll(async () => {
    if (comp?.id) {
      await pool.query(`DELETE FROM competitions WHERE id = $1`, [comp.id]);
    }
    await cleanupDB();
    await pool.end();
  });

  async function createValidPilot({ birth_date = '2005-05-15', gender = 'M' } = {}) {
    // Adult: 21 in 2026 → eligible for 14+.
    const p = await createTestPilot('Test_App_John', 'Doe');
    await pool.query(
      `UPDATE pilots
          SET birth_date = $1, gender = $2,
              medical_clearance_until = '2027-01-01',
              insurance_until         = '2027-01-01'
        WHERE id = $3`,
      [birth_date, gender, p.id]
    );
    return p;
  }

  test('POST /api/applications — creates draft for pilot', async () => {
    const pilot = await createValidPilot();
    const res = await request(app)
      .post('/api/applications')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        competition_id: comp.id,
        pilot_id: pilot.id,
        stage: 'preliminary',
        contact_email: 'pilot@example.com',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.stage).toBe('preliminary');
  });

  test('POST /api/applications — both pilot_id and team_id → 400', async () => {
    const pilot = await createValidPilot();
    const { rows: teamRows } = await pool.query(
      `INSERT INTO teams (name) VALUES ('Test_App_Team') RETURNING *`
    );
    const res = await request(app)
      .post('/api/applications')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        competition_id: comp.id,
        pilot_id: pilot.id,
        team_id: teamRows[0].id,
        stage: 'preliminary',
      });
    expect(res.statusCode).toBe(400);

    await pool.query(`DELETE FROM teams WHERE id = $1`, [teamRows[0].id]);
  });

  test('POST /api/applications — invalid stage → 400', async () => {
    const pilot = await createValidPilot();
    const res = await request(app)
      .post('/api/applications')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'middle' });
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/applications — duplicate (same pilot + stage) → 409', async () => {
    const pilot = await createValidPilot();
    const a = await request(app)
      .post('/api/applications')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });
    expect(a.statusCode).toBe(201);

    const dup = await request(app)
      .post('/api/applications')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });
    expect(dup.statusCode).toBe(409);
  });

  describe('submit final application', () => {
    test('valid pilot → submitted', async () => {
      const pilot = await createValidPilot();
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'final' });

      const submit = await request(app)
        .post(`/api/applications/${draft.body.id}/submit`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(submit.statusCode).toBe(200);
      expect(submit.body.status).toBe('submitted');
    });

    test('pilot below min age → 400 with reason', async () => {
      // Born 2014 → calendar year age = 12 → below 14.
      const pilot = await createValidPilot({ birth_date: '2014-05-15' });
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'final' });

      const submit = await request(app)
        .post(`/api/applications/${draft.body.id}/submit`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(submit.statusCode).toBe(400);
      expect(submit.body.error).toMatch(/age_group_mismatch/);
    });

    test('expired medical clearance → 400', async () => {
      const pilot = await createValidPilot();
      await pool.query(
        `UPDATE pilots SET medical_clearance_until = '2020-01-01' WHERE id = $1`,
        [pilot.id]
      );
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'final' });

      const submit = await request(app)
        .post(`/api/applications/${draft.body.id}/submit`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(submit.statusCode).toBe(400);
      expect(submit.body.error).toBe('medical_clearance_expired_or_missing');
    });

    test('missing insurance → 400', async () => {
      const pilot = await createValidPilot();
      await pool.query(
        `UPDATE pilots SET insurance_until = NULL WHERE id = $1`,
        [pilot.id]
      );
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'final' });

      const submit = await request(app)
        .post(`/api/applications/${draft.body.id}/submit`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(submit.statusCode).toBe(400);
      expect(submit.body.error).toBe('insurance_expired_or_missing');
    });

    test('preliminary stage skips medical/age validation', async () => {
      // Underage pilot — should still be able to submit preliminary.
      const pilot = await createValidPilot({ birth_date: '2014-05-15' });
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });

      const submit = await request(app)
        .post(`/api/applications/${draft.body.id}/submit`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(submit.statusCode).toBe(200);
    });
  });

  describe('decide', () => {
    test('chief_judge can admit', async () => {
      const pilot = await createValidPilot();
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });

      const decide = await request(app)
        .post(`/api/applications/${draft.body.id}/decide`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ decision: 'admitted' });

      expect(decide.statusCode).toBe(200);
      expect(decide.body.status).toBe('approved');
      expect(decide.body.decision).toBe('admitted');
    });

    test('judge cannot decide', async () => {
      const pilot = await createValidPilot();
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });

      const decide = await request(app)
        .post(`/api/applications/${draft.body.id}/decide`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({ decision: 'admitted' });

      expect(decide.statusCode).toBe(403);
    });

    test('reject with reason', async () => {
      const pilot = await createValidPilot();
      const draft = await request(app)
        .post('/api/applications')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ competition_id: comp.id, pilot_id: pilot.id, stage: 'preliminary' });

      const decide = await request(app)
        .post(`/api/applications/${draft.body.id}/decide`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ decision: 'rejected', reason: 'Документы недействительны' });

      expect(decide.statusCode).toBe(200);
      expect(decide.body.status).toBe('rejected');
      expect(decide.body.decision_reason).toBe('Документы недействительны');
    });
  });
});
