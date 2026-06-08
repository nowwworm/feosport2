'use strict';

// End-to-end integration test mirroring the "Полный цикл" documentation tab
// (DocsPage → вкладка «Полный цикл»). One competition is driven through all
// 12 documented steps against the real API, in order. Outer state is shared
// between the ordered `test()` blocks; the DB is seeded once and cleaned up
// at the end.
//
// Step map (see /docs):
//   1  login                         POST /api/auth/login
//   2  create + configure comp       POST /api/competitions, PATCH /api/competitions/:id
//   3  import pilots                  POST /api/pilots/import
//   4  import judges                  POST /api/admin/judges/import
//   5  team (team disciplines)        POST /api/teams, POST /api/teams/:id/members
//   6  qualification draw             POST /api/competitions/:id/stages/qualification
//   7  heat lifecycle                 POST /api/heats, /start, /laps, /end, /lock, group-participants
//   8  edge case (channels)           GET  /api/heats/:id/channel-conflicts
//   9  advance the bracket            POST /api/competitions/:id/stages/advance
//   10 penalty + protest              POST /api/competitions/:id/penalties, /protests, PATCH /protests/:id
//   11 standings + leaderboard        GET  /api/competitions/:id/standings, /leaderboard
//   12 protocols                      POST /api/competitions/:id/protocols/:type, GET .../protocols

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_do_not_use_in_production';

const request = require('supertest');
const app = require('../src/app');
const {
  pool,
  cleanupDB,
  seedBaselineData,
  getAllUsers,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

async function referenceId(table, code) {
  const { rows } = await pool.query(`SELECT id FROM ${table} WHERE code = $1`, [code]);
  if (!rows.length) throw new Error(`Missing reference ${table}.${code}`);
  return rows[0].id;
}

describe('Полный цикл соревнования (docs steps 1-12)', () => {
  let admin, chief, judge, pilot;
  let adminAuth, chiefAuth, judgeAuth, pilotAuth;

  let competitionId;
  let disciplineId, raceSystemId;
  let pilotIds = [];
  let qualStageId;
  let firstGroup;

  const PILOT_COUNT = 16;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    admin = users.find(u => u.role === 'admin');
    chief = users.find(u => u.role === 'chief_judge');
    judge = users.find(u => u.role === 'judge');
    pilot = users.find(u => u.role === 'pilot');
    adminAuth = authHeader(admin.id, 'admin');
    chiefAuth = authHeader(chief.id, 'chief_judge');
    judgeAuth = authHeader(judge.id, 'judge');
    pilotAuth = authHeader(pilot.id, 'pilot');

    disciplineId = await referenceId('disciplines', 'class_75mm');
    raceSystemId = await referenceId('race_systems', 'two_of_four');
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  // Проставить finish_place всем участникам каждой группы этапа (1..N по порядку),
  // чтобы advance прошёл проверку полноты результатов и посчитал очки.
  async function completeKnockoutStage(stageType, compId = competitionId) {
    const stages = await request(app)
      .get(`/api/competitions/${compId}/stages`)
      .set('Authorization', adminAuth);
    const stage = stages.body.find(s => s.stage_type === stageType);
    expect(stage).toBeTruthy();
    for (const group of stage.groups) {
      for (let i = 0; i < group.participants.length; i++) {
        await request(app)
          .patch(`/api/group-participants/${group.participants[i].id}`)
          .set('Authorization', chiefAuth)
          .send({ finish_place: i + 1 })
          .expect(200);
      }
    }
    return stage;
  }

  // ── Шаг 1. Вход администратора ───────────────────────────────────────────
  test('Шаг 1: вход администратора возвращает токен', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@feosport.local', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.role).toBe('admin');
  });

  // ── Шаг 2. Создать и настроить соревнование ──────────────────────────────
  test('Шаг 2: создание и настройка соревнования', async () => {
    const created = await request(app)
      .post('/api/competitions')
      .set('Authorization', adminAuth)
      .send({
        name: 'Cycle Cup 2026',
        location: 'Тестодром',
        start_date: '2026-07-01',
        end_date: '2026-07-02',
        playoff_size: 16,
      });
    expect(created.statusCode).toBe(201);
    competitionId = created.body.id;

    const configured = await request(app)
      .patch(`/api/competitions/${competitionId}`)
      .set('Authorization', adminAuth)
      .send({
        discipline_id: disciplineId,
        race_system_id: raceSystemId,
        status: 'qualification',
      });
    expect(configured.statusCode).toBe(200);
    expect(configured.body.discipline_id).toBe(disciplineId);
    expect(configured.body.race_system_id).toBe(raceSystemId);
  });

  // ── Шаг 3. Импорт пилотов ────────────────────────────────────────────────
  test('Шаг 3: импорт пилотов', async () => {
    const entries = Array.from({ length: PILOT_COUNT }, (_, i) => ({
      fio: `Пилот${i + 1} Тестовый`,
      external_id: `cycle-pilot-${i + 1}`,
    }));

    const res = await request(app)
      .post('/api/pilots/import')
      .set('Authorization', adminAuth)
      .send({ entries });

    expect(res.statusCode).toBe(207);
    expect(res.body.created).toHaveLength(PILOT_COUNT);
    expect(res.body.errors).toHaveLength(0);
    pilotIds = res.body.created.map(c => c.pilot_id);
    expect(pilotIds).toHaveLength(PILOT_COUNT);
  });

  // ── Шаг 4. Импорт судей ──────────────────────────────────────────────────
  test('Шаг 4: импорт судей', async () => {
    const res = await request(app)
      .post('/api/admin/judges/import')
      .set('Authorization', adminAuth)
      .send({
        entries: [
          { email: 'cycle.judge1@example.com', region: 'Центральный', judge_category: 'Национальная', external_id: 'cycle-judge-1' },
          { email: 'cycle.judge2@example.com', region: 'Южный', judge_category: 'Региональная', external_id: 'cycle-judge-2' },
        ],
      });

    expect(res.statusCode).toBe(207);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.errors).toHaveLength(0);
  });

  // ── Шаг 5. Команда (для командных дисциплин) ─────────────────────────────
  test('Шаг 5: создание команды и добавление участника', async () => {
    const team = await request(app)
      .post('/api/teams')
      .set('Authorization', adminAuth)
      .send({ name: 'Cycle Team', region: 'Центральный', external_id: 'cycle-team-1' });
    expect(team.statusCode).toBe(201);

    const member = await request(app)
      .post(`/api/teams/${team.body.id}/members`)
      .set('Authorization', adminAuth)
      .send({ pilot_id: pilotIds[0], role: 'pilot' });
    expect([200, 201]).toContain(member.statusCode);
  });

  // ── Шаг 6. Квалификация — жеребьёвка групп ───────────────────────────────
  test('Шаг 6: жеребьёвка квалификационных групп', async () => {
    const res = await request(app)
      .post(`/api/competitions/${competitionId}/stages/qualification`)
      .set('Authorization', adminAuth)
      .send({
        admitted_pilot_ids: pilotIds,
        group_size: 4,
        qualification_mode: 'laps_time',
        target_laps: 3,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage.stage_type).toBe('qualification');
    expect(res.body.groups).toHaveLength(4);
    qualStageId = res.body.stage.id;
  });

  // ── Шаг 7. Проведение вылета квалификации (полный жизненный цикл) ─────────
  test('Шаг 7: жизненный цикл вылета — старт, круги, финиш, блокировка', async () => {
    const stages = await request(app)
      .get(`/api/competitions/${competitionId}/stages`)
      .set('Authorization', adminAuth);
    expect(stages.statusCode).toBe(200);
    firstGroup = stages.body[0].groups[0];
    const participants = firstGroup.participants;
    expect(participants).toHaveLength(4);

    const heat = await request(app)
      .post('/api/heats')
      .set('Authorization', chiefAuth)
      .send({
        competition_id: competitionId,
        round_type: 'qualification',
        heat_number: 1,
        group_id: firstGroup.id,
        lap_limit: 3,
        time_limit_seconds: 120,
        participants: participants.map((p, i) => ({ pilot_id: p.pilot_id, lane: i + 1 })),
      });
    expect(heat.statusCode).toBe(201);
    const heatId = heat.body.id;

    const started = await request(app)
      .patch(`/api/heats/${heatId}/start`)
      .set('Authorization', judgeAuth);
    expect(started.statusCode).toBe(200);
    expect(started.body.status).toBe('active');

    for (const p of participants) {
      for (let lap = 1; lap <= 3; lap++) {
        const lapRes = await request(app)
          .post(`/api/heats/${heatId}/laps`)
          .set('Authorization', judgeAuth)
          .send({ pilot_id: p.pilot_id, lap_number: lap, duration_ms: 12000 + lap * 100, valid: true });
        expect(lapRes.statusCode).toBe(201);
      }
    }

    const summary = await request(app)
      .get(`/api/heats/${heatId}/lap-summary`)
      .set('Authorization', judgeAuth);
    expect(summary.statusCode).toBe(200);

    const ended = await request(app)
      .patch(`/api/heats/${heatId}/end`)
      .set('Authorization', judgeAuth);
    expect(ended.statusCode).toBe(200);
    expect(ended.body.status).toBe('completed');

    const locked = await request(app)
      .patch(`/api/heats/${heatId}/lock`)
      .set('Authorization', chiefAuth);
    expect(locked.statusCode).toBe(200);
    expect(locked.body.status).toBe('locked');

    // Зафиксировать квалификационные результаты группы (ввод итогов вылета).
    for (let i = 0; i < participants.length; i++) {
      const gp = participants[i];
      const patched = await request(app)
        .patch(`/api/group-participants/${gp.id}`)
        .set('Authorization', adminAuth)
        .send({
          qualification_total_laps: 3,
          qualification_total_time_ms: (i + 1) * 1000,
          qualification_best_lap_ms: (i + 1) * 100,
        });
      expect(patched.statusCode).toBe(200);
    }
  });

  // ── Шаг 8. Особые ситуации: проверка конфликтов видеоканалов ─────────────
  test('Шаг 8: проверка конфликтов видеоканалов в вылете', async () => {
    const heat = await request(app)
      .post('/api/heats')
      .set('Authorization', chiefAuth)
      .send({
        competition_id: competitionId,
        round_type: 'qualification',
        heat_number: 2,
        group_id: firstGroup.id,
        participants: firstGroup.participants.map((p, i) => ({ pilot_id: p.pilot_id, lane: i + 1 })),
      });
    expect(heat.statusCode).toBe(201);

    const res = await request(app)
      .get(`/api/heats/${heat.body.id}/channel-conflicts`)
      .set('Authorization', judgeAuth);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.conflicts)).toBe(true);
  });

  // ── Шаг 9. Переход по сетке ──────────────────────────────────────────────
  test('Шаг 9: переход из квалификации в плей-офф', async () => {
    const res = await request(app)
      .post(`/api/competitions/${competitionId}/stages/advance`)
      .set('Authorization', adminAuth)
      .send({
        from_stage_type: 'qualification',
        ranked_qualifiers: pilotIds,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.stage_type).toBe('quarterfinal');
    expect(res.body.groups).toHaveLength(4);
  });

  // ── Шаг 9b. Полный проход плей-офф: 1/4 → 1/2 → финал ────────────────────
  test('Шаг 9b: полный проход 1/4 → 1/2 → финал с простановкой мест', async () => {
    // 1/4 финала: проставляем места и переходим в 1/2.
    await completeKnockoutStage('quarterfinal');
    const semi = await request(app)
      .post(`/api/competitions/${competitionId}/stages/advance`)
      .set('Authorization', adminAuth)
      .send({ from_stage_type: 'quarterfinal' });
    expect(semi.statusCode).toBe(201);
    expect(semi.body.stage_type).toBe('semifinal');
    expect(semi.body.groups).toHaveLength(2);

    // 1/2 финала: проставляем места и переходим в финал.
    await completeKnockoutStage('semifinal');
    const final = await request(app)
      .post(`/api/competitions/${competitionId}/stages/advance`)
      .set('Authorization', adminAuth)
      .send({ from_stage_type: 'semifinal' });
    expect(final.statusCode).toBe(201);
    expect(final.body.stage_type).toBe('final');
    expect(final.body.groups).toHaveLength(1);

    // Финал: проставляем итоговые места группы.
    const finalStage = await completeKnockoutStage('final');
    const places = finalStage.groups[0].participants.length;
    expect(places).toBe(4);
  });

  // ── Шаг 10. Штрафы и протесты ────────────────────────────────────────────
  test('Шаг 10: штраф, протест и решение ГСК', async () => {
    // Завершённый вылет в 5-минутном окне для подачи протеста.
    const heat = await request(app)
      .post('/api/heats')
      .set('Authorization', chiefAuth)
      .send({
        competition_id: competitionId,
        round_type: 'qualification',
        heat_number: 99,
        participants: [{ pilot_id: pilotIds[0], lane: 1 }],
      });
    expect(heat.statusCode).toBe(201);
    await request(app).patch(`/api/heats/${heat.body.id}/end`).set('Authorization', judgeAuth).expect(200);

    const penalty = await request(app)
      .post(`/api/competitions/${competitionId}/penalties`)
      .set('Authorization', chiefAuth)
      .send({ penalty_type: 'oral_warning', pilot_id: pilotIds[0], reason: 'unsafe takeoff' });
    expect(penalty.statusCode).toBe(201);
    expect(penalty.body.penalty_type).toBe('oral_warning');

    const protest = await request(app)
      .post(`/api/competitions/${competitionId}/protests`)
      .set('Authorization', pilotAuth)
      .send({
        heat_id: heat.body.id,
        subject_pilot_id: pilotIds[0],
        rules_clause: '5.14.3',
        description: 'Контакт в стартовой зоне — запрос перелёта.',
      });
    expect(protest.statusCode).toBe(201);
    expect(protest.body.status).toBe('pending');

    const resolved = await request(app)
      .patch(`/api/protests/${protest.body.id}`)
      .set('Authorization', chiefAuth)
      .send({ status: 'rejected', resolution: 'Контакт не подтверждён повтором.' });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.body.status).toBe('rejected');
  });

  // ── Шаг 11. Итоговые места и зачёт ───────────────────────────────────────
  test('Шаг 11: итоговые места и live-табло', async () => {
    const standings = await request(app)
      .get(`/api/competitions/${competitionId}/standings`)
      .set('Authorization', adminAuth);
    expect(standings.statusCode).toBe(200);
    expect(Array.isArray(standings.body.standings)).toBe(true);
    expect(standings.body.standings.length).toBeGreaterThan(0);
    // После плей-офф проставлены finish_place → набраны очки, и список отсортирован по убыванию.
    expect(standings.body.standings[0].total_points).toBeGreaterThan(0);

    const leaderboard = await request(app)
      .get(`/api/competitions/${competitionId}/leaderboard`)
      .set('Authorization', adminAuth);
    expect(leaderboard.statusCode).toBe(200);
  });

  // ── Шаг 12. Протоколы ────────────────────────────────────────────────────
  test('Шаг 12: генерация протоколов', async () => {
    const qual = await request(app)
      .post(`/api/competitions/${competitionId}/protocols/qualification`)
      .set('Authorization', chiefAuth)
      .send({ stage_id: qualStageId });
    expect(qual.statusCode).toBe(201);
    expect(qual.body.protocol_type).toBe('qualification');
    expect(qual.body.payload_hash).toMatch(/^[a-f0-9]{64}$/);

    const finalStandings = await request(app)
      .post(`/api/competitions/${competitionId}/protocols/final_standings`)
      .set('Authorization', chiefAuth)
      .send({});
    expect(finalStandings.statusCode).toBe(201);
    expect(finalStandings.body.protocol_type).toBe('final_standings');

    const history = await request(app)
      .get(`/api/competitions/${competitionId}/protocols`)
      .set('Authorization', adminAuth);
    expect(history.statusCode).toBe(200);
    expect(history.body.length).toBeGreaterThanOrEqual(2);
  });

  // ── Негативные кейсы ─────────────────────────────────────────────────────
  describe('Негативные кейсы', () => {
    test('протест вне 5-минутного окна отклоняется (400)', async () => {
      const heat = await request(app)
        .post('/api/heats')
        .set('Authorization', chiefAuth)
        .send({
          competition_id: competitionId,
          round_type: 'qualification',
          heat_number: 500,
          participants: [{ pilot_id: pilotIds[0], lane: 1 }],
        });
      expect(heat.statusCode).toBe(201);

      // Завершаем вылет «6 минут назад» — окно подачи протеста уже закрыто.
      await pool.query(
        `UPDATE heats SET status = 'completed', ended_at = $1 WHERE id = $2`,
        [new Date(Date.now() - 6 * 60 * 1000), heat.body.id]
      );

      const res = await request(app)
        .post(`/api/competitions/${competitionId}/protests`)
        .set('Authorization', pilotAuth)
        .send({ heat_id: heat.body.id, subject_pilot_id: pilotIds[0], description: 'too late' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/window_expired/);
    });

    test('advance при неполных результатах этапа отклоняется (400)', async () => {
      // Отдельное соревнование, чтобы не трогать основной цикл.
      const comp = await request(app)
        .post('/api/competitions')
        .set('Authorization', adminAuth)
        .send({ name: 'Cycle Negative', location: 'X', playoff_size: 16 });
      await request(app)
        .patch(`/api/competitions/${comp.body.id}`)
        .set('Authorization', adminAuth)
        .send({ discipline_id: disciplineId, race_system_id: raceSystemId })
        .expect(200);

      // qualification → quarterfinal по явному ranked_qualifiers (без результатов).
      await request(app)
        .post(`/api/competitions/${comp.body.id}/stages/advance`)
        .set('Authorization', adminAuth)
        .send({ from_stage_type: 'qualification', ranked_qualifiers: pilotIds })
        .expect(201);

      // Попытка перейти из 1/4 без проставленных мест.
      const res = await request(app)
        .post(`/api/competitions/${comp.body.id}/stages/advance`)
        .set('Authorization', adminAuth)
        .send({ from_stage_type: 'quarterfinal' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('previous_stage_results_incomplete');
    });
  });
});
