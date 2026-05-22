'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_do_not_use_in_production';

const request = require('supertest');
const app = require('../src/app');
const {
  pool,
  cleanupDB,
  seedBaselineData,
  createTestPilot,
  getAllUsers,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

async function referenceId(table, code) {
  const { rows } = await pool.query(`SELECT id FROM ${table} WHERE code = $1`, [code]);
  if (!rows.length) throw new Error(`Missing reference ${table}.${code}`);
  return rows[0].id;
}

async function createConfiguredCompetition({
  name = 'Stage API Competition',
  discipline = 'class_75mm',
  raceSystem = 'two_of_four',
  playoffSize = 16,
} = {}) {
  const disciplineId = await referenceId('disciplines', discipline);
  const raceSystemId = await referenceId('race_systems', raceSystem);
  const { rows } = await pool.query(
    `INSERT INTO competitions
       (name, location, status, discipline_id, race_system_id, playoff_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, 'Test Location', 'qualification', disciplineId, raceSystemId, playoffSize]
  );
  return rows[0];
}

async function createPilots(count) {
  const pilots = [];
  for (let i = 1; i <= count; i++) {
    pilots.push(await createTestPilot(`Pilot${i}`, `Phase4-${i}`));
  }
  return pilots;
}

describe('Stages and groups API', () => {
  let adminUser;
  let judgeUser;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    judgeUser = users.find(u => u.role === 'judge');
  });

  afterEach(async () => {
    await cleanupDB();
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    judgeUser = users.find(u => u.role === 'judge');
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  test('GET /api/competitions/:id/stages requires authentication', async () => {
    const res = await request(app).get('/api/competitions/1/stages');
    expect(res.statusCode).toBe(401);
  });

  test('POST qualification draws admitted pilots into groups', async () => {
    const competition = await createConfiguredCompetition();
    const pilots = await createPilots(8);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/qualification`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        admitted_pilot_ids: pilots.map(p => p.id),
        group_size: 4,
        qualification_mode: 'laps_time',
        target_laps: 3,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage.stage_type).toBe('qualification');
    expect(res.body.stage.qualification_mode).toBe('laps_time');
    expect(res.body.stage.target_laps).toBe(3);
    expect(res.body.groups).toHaveLength(2);
    expect(res.body.groups.every(g => g.slots.length === 4)).toBe(true);

    const stages = await request(app)
      .get(`/api/competitions/${competition.id}/stages`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));

    expect(stages.statusCode).toBe(200);
    expect(stages.body).toHaveLength(1);
    expect(stages.body[0].groups).toHaveLength(2);
    expect(stages.body[0].groups[0].participants).toHaveLength(4);
  });

  test('qualification rejects invalid group size as client input', async () => {
    const competition = await createConfiguredCompetition();
    const pilots = await createPilots(4);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/qualification`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        admitted_pilot_ids: pilots.map(p => p.id),
        group_size: 5,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('group_size_must_be_4_or_8');
  });

  test('qualification supports max-laps mode with a time limit', async () => {
    const competition = await createConfiguredCompetition({
      discipline: 'simulator',
      raceSystem: 'four_of_eight',
      playoffSize: 32,
    });
    const pilots = await createPilots(8);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/qualification`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        admitted_pilot_ids: pilots.map(p => p.id),
        group_size: 8,
        qualification_mode: 'max_laps',
        time_limit_seconds: 120,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage.qualification_mode).toBe('max_laps');
    expect(res.body.stage.time_limit_seconds).toBe(120);
  });

  test('advance from qualification builds the first knockout by regulation table', async () => {
    const competition = await createConfiguredCompetition({ playoffSize: 16 });
    const pilots = await createPilots(16);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        from_stage_type: 'qualification',
        ranked_qualifiers: pilots.map(p => p.id),
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage_type).toBe('quarterfinal');
    expect(res.body.groups).toHaveLength(4);
    expect(res.body.groups[0].slots).toEqual([
      pilots[0].id,
      pilots[4].id,
      pilots[11].id,
      pilots[15].id,
    ]);
  });

  test('advance from qualification can rank from saved laps-time results', async () => {
    const competition = await createConfiguredCompetition({ playoffSize: 16 });
    const pilots = await createPilots(20);

    const qual = await request(app)
      .post(`/api/competitions/${competition.id}/stages/qualification`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        admitted_pilot_ids: pilots.map(p => p.id),
        group_size: 4,
        qualification_mode: 'laps_time',
        target_laps: 3,
      });
    expect(qual.statusCode).toBe(201);

    const stages = await request(app)
      .get(`/api/competitions/${competition.id}/stages`)
      .set('Authorization', authHeader(adminUser.id, 'admin'));
    const qualParticipants = stages.body[0].groups.flatMap(g => g.participants);

    for (const participant of qualParticipants) {
      const rank = pilots.findIndex(p => p.id === participant.pilot_id) + 1;
      await request(app)
        .patch(`/api/group-participants/${participant.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          qualification_total_laps: 3,
          qualification_total_time_ms: rank * 1000,
          qualification_best_lap_ms: rank * 100,
        })
        .expect(200);
    }

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ from_stage_type: 'qualification' });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage_type).toBe('quarterfinal');
    expect(res.body.groups[0].slots).toEqual([
      pilots[0].id,
      pilots[4].id,
      pilots[11].id,
      pilots[15].id,
    ]);
  });

  test('advance rejects final generation when semifinal does not exist', async () => {
    const competition = await createConfiguredCompetition({ playoffSize: 16 });

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ from_stage_type: 'semifinal' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('previous stage semifinal not found');
  });

  test('advance rejects incomplete previous-stage results before building the next stage', async () => {
    const competition = await createConfiguredCompetition({ playoffSize: 16 });
    const pilots = await createPilots(16);

    const qf = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        from_stage_type: 'qualification',
        ranked_qualifiers: pilots.map(p => p.id),
      });
    expect(qf.statusCode).toBe(201);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ from_stage_type: 'quarterfinal' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('previous_stage_results_incomplete');
  });

  test('four-of-eight race system is rejected for physical class disciplines', async () => {
    const competition = await createConfiguredCompetition({
      discipline: 'class_75mm',
      raceSystem: 'four_of_eight',
      playoffSize: 32,
    });
    const pilots = await createPilots(32);

    const res = await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        from_stage_type: 'qualification',
        ranked_qualifiers: pilots.map(p => p.id),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('four_of_eight_only_supported_for_simulator');
  });

  test('replace no-show slot with the next pilot from qualification ranking', async () => {
    const competition = await createConfiguredCompetition({ playoffSize: 16 });
    const pilots = await createPilots(20);

    await request(app)
      .post(`/api/competitions/${competition.id}/stages/qualification`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({
        admitted_pilot_ids: pilots.map(p => p.id),
        group_size: 4,
        qualification_mode: 'laps_time',
        target_laps: 3,
      })
      .expect(201);

    const stagesBefore = await request(app)
      .get(`/api/competitions/${competition.id}/stages`)
      .set('Authorization', authHeader(adminUser.id, 'admin'));
    const qualParticipants = stagesBefore.body[0].groups.flatMap(g => g.participants);

    for (const participant of qualParticipants) {
      const rank = pilots.findIndex(p => p.id === participant.pilot_id) + 1;
      await request(app)
        .patch(`/api/group-participants/${participant.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          qualification_total_laps: 3,
          qualification_total_time_ms: rank * 1000,
        })
        .expect(200);
    }

    await request(app)
      .post(`/api/competitions/${competition.id}/stages/advance`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ from_stage_type: 'qualification' })
      .expect(201);

    const stagesAfter = await request(app)
      .get(`/api/competitions/${competition.id}/stages`)
      .set('Authorization', authHeader(adminUser.id, 'admin'));
    const qf = stagesAfter.body.find(s => s.stage_type === 'quarterfinal');
    const target = qf.groups[0].participants[0];

    const res = await request(app)
      .post(`/api/group-participants/${target.id}/replace`)
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body.attendance_status).toBe('replaced');
    expect(res.body.replaced_pilot_id).toBe(target.pilot_id);
    expect(res.body.pilot_id).toBe(pilots[16].id);
  });
});
