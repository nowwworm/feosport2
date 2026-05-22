'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestPilot,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Drones & Equipment Inspections', () => {
  let adminUser, chiefJudgeUser, judgeUser;
  let pilot;
  let channelR1;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser      = users.find(u => u.role === 'admin');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');

    const { rows } = await pool.query(`SELECT * FROM video_channels WHERE code = 'R1'`);
    channelR1 = rows[0];
  });

  beforeEach(async () => {
    pilot = await createTestPilot('Test_Drone', 'Owner');
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM equipment_inspections WHERE drone_id IN (SELECT id FROM drones WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_Drone%'))`);
    await pool.query(`DELETE FROM drones WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_Drone%')`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_Drone%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  function validBody75() {
    return {
      pilot_id: pilot.id,
      drone_class: '75mm',
      name: 'Tiny Whoop',
      serial_number: 'SN-001',
      weight_g: 48,
      diagonal_mm: 70,
      battery_cells: 1,
      battery_capacity_mah: 500,
      battery_max_cell_voltage: 4.35,
      has_failsafe: true,
      has_prop_guards: true,
      video_channel_id: channelR1.id,
      video_power_mw: 25,
      control_power_mw: 25,
    };
  }

  describe('POST /api/drones', () => {
    test('creates drone for pilot', async () => {
      const res = await request(app)
        .post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send(validBody75());

      expect(res.statusCode).toBe(201);
      expect(res.body.drone_class).toBe('75mm');
      expect(res.body.pilot_id).toBe(pilot.id);
    });

    test('rejects invalid drone_class', async () => {
      const res = await request(app)
        .post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), drone_class: '500mm' });

      expect(res.statusCode).toBe(400);
    });

    test('rejects when both pilot_id and team_id provided', async () => {
      const { rows: teamRows } = await pool.query(
        `INSERT INTO teams (name) VALUES ('Test_Drone_Team_Both') RETURNING *`
      );
      const res = await request(app)
        .post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), team_id: teamRows[0].id });

      expect(res.statusCode).toBe(400);
      await pool.query(`DELETE FROM teams WHERE id = $1`, [teamRows[0].id]);
    });
  });

  describe('GET /api/drones', () => {
    test('filter by pilot_id', async () => {
      await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin')).send(validBody75());

      const res = await request(app)
        .get(`/api/drones?pilot_id=${pilot.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].video_channel_code).toBe('R1');
      expect(res.body[0].latest_inspection).toBeNull();
    });
  });

  describe('GET /api/drones/:id/validate (dry-run)', () => {
    test('valid drone — would_pass true, no errors', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin')).send(validBody75());

      const res = await request(app)
        .get(`/api/drones/${created.body.id}/validate`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.would_pass).toBe(true);
      expect(res.body.errors).toEqual([]);
    });

    test('overweight 75mm — would_pass false', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), weight_g: 80 });

      const res = await request(app)
        .get(`/api/drones/${created.body.id}/validate`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.would_pass).toBe(false);
      expect(res.body.errors[0].rule).toBe('max_takeoff_weight_g');
    });
  });

  describe('POST /api/drones/:id/inspect', () => {
    test('judge (without chief) cannot inspect', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin')).send(validBody75());

      const res = await request(app)
        .post(`/api/drones/${created.body.id}/inspect`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({});

      expect(res.statusCode).toBe(403);
    });

    test('chief_judge inspects compliant drone — auto-passed', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin')).send(validBody75());

      const res = await request(app)
        .post(`/api/drones/${created.body.id}/inspect`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({});

      expect(res.statusCode).toBe(201);
      expect(res.body.result).toBe('passed');
      expect(res.body.violations).toEqual([]);
    });

    test('non-compliant drone — auto-rejected with violations', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), weight_g: 80, has_failsafe: false });

      const res = await request(app)
        .post(`/api/drones/${created.body.id}/inspect`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ notes: 'Превышение веса + нет файл-сейфа' });

      expect(res.statusCode).toBe(201);
      expect(res.body.result).toBe('rejected');
      expect(res.body.violations.length).toBeGreaterThanOrEqual(2);
      expect(res.body.violations.map(v => v.rule)).toEqual(
        expect.arrayContaining(['max_takeoff_weight_g', 'requires_failsafe'])
      );
    });

    test('chief_judge cannot force-pass a non-compliant drone without force=true', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), weight_g: 80 });

      const res = await request(app)
        .post(`/api/drones/${created.body.id}/inspect`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ result: 'passed' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/force=true/);
    });

    test('chief_judge can override with force=true', async () => {
      const created = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), weight_g: 80 });

      const res = await request(app)
        .post(`/api/drones/${created.body.id}/inspect`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ result: 'passed', force: true, notes: 'Согласовано индивидуально' });

      expect(res.statusCode).toBe(201);
      expect(res.body.result).toBe('passed');
      // violations recorded anyway as audit trail
      expect(res.body.violations.length).toBeGreaterThan(0);
    });
  });

  describe('admission-status integration', () => {
    let comp, application;

    beforeEach(async () => {
      const { rows: discRows } = await pool.query(
        `SELECT id FROM disciplines WHERE code = 'class_75mm'`
      );
      const { rows: agRows } = await pool.query(
        `SELECT id FROM age_groups WHERE code = 'adults_14_plus'`
      );
      const { rows: compRows } = await pool.query(
        `INSERT INTO competitions
          (name, location, start_date, end_date, status, playoff_size,
           discipline_id, age_group_id, gender)
         VALUES ('Test_Drone_Cup', 'Locale', '2026-09-01', '2026-09-02',
                 'registration', 16, $1, $2, 'X')
         RETURNING *`,
        [discRows[0].id, agRows[0].id]
      );
      comp = compRows[0];

      // Pilot meets all docs / age.
      await pool.query(
        `UPDATE pilots
            SET birth_date = '2000-01-01',
                gender = 'M',
                medical_clearance_until = '2027-01-01',
                insurance_until = '2027-01-01'
          WHERE id = $1`,
        [pilot.id]
      );

      const { rows: appRows } = await pool.query(
        `INSERT INTO applications
           (competition_id, pilot_id, stage, status)
         VALUES ($1, $2, 'final', 'approved') RETURNING *`,
        [comp.id, pilot.id]
      );
      application = appRows[0];
    });

    afterEach(async () => {
      await pool.query(`DELETE FROM applications WHERE id = $1`, [application.id]);
      await pool.query(`DELETE FROM competitions WHERE id = $1`, [comp.id]);
    });

    test('approved app + 0 drones — not fully admitted (need 2)', async () => {
      const res = await request(app)
        .get(`/api/applications/${application.id}/admission-status`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.drones_required).toBe(2);
      expect(res.body.drones_registered).toBe(0);
      expect(res.body.fully_admitted).toBe(false);
      expect(res.body.blockers).toEqual(
        expect.arrayContaining([expect.stringMatching(/not_enough_drones/)])
      );
    });

    test('approved app + 2 passed drones — fully admitted', async () => {
      const d1 = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin')).send(validBody75());
      const d2 = await request(app).post('/api/drones')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ ...validBody75(), name: 'Backup' });

      for (const d of [d1.body, d2.body]) {
        await request(app)
          .post(`/api/drones/${d.id}/inspect`)
          .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
          .send({});
      }

      const res = await request(app)
        .get(`/api/applications/${application.id}/admission-status`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.drones_passed).toBe(2);
      expect(res.body.fully_admitted).toBe(true);
      expect(res.body.blockers).toEqual([]);
    });

    test('app rejected → not fully admitted even with drones passed', async () => {
      await pool.query(
        `UPDATE applications SET status = 'rejected' WHERE id = $1`,
        [application.id]
      );

      const res = await request(app)
        .get(`/api/applications/${application.id}/admission-status`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      expect(res.body.fully_admitted).toBe(false);
      expect(res.body.blockers).toEqual(
        expect.arrayContaining([expect.stringMatching(/application_not_approved/)])
      );
    });
  });
});
