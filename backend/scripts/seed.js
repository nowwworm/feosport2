// Run: docker exec feosport2-backend-1 node scripts/seed.js
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'feosport2',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  port:     5432,
});

async function insertHeat(c, competitionId, roundType, heatNumber, judgeId) {
  const { rows: [h] } = await c.query(
    `INSERT INTO heats
       (competition_id, round_type, heat_number, status, judge_id, locked_at, locked_by)
     VALUES ($1,$2,$3,'locked',$4,NOW(),$4) RETURNING id`,
    [competitionId, roundType, heatNumber, judgeId]
  );
  return h.id;
}

async function insertResult(c, heatId, pilotId, judgeId, time, penalty = 0, dnf = false, dsq = false) {
  await c.query(
    `INSERT INTO results (heat_id, pilot_id, judge_id, time_seconds, penalty_seconds, dnf, dsq)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [heatId, pilotId, judgeId, dnf || dsq ? null : time, penalty, dnf, dsq]
  );
}

async function insertBracket(c, competitionId, roundType, slot, pilotId, heatId, advanced, seed) {
  await c.query(
    `INSERT INTO playoff_brackets
       (competition_id, round_type, bracket_slot, pilot_id, heat_id, advanced, seed)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [competitionId, roundType, slot, pilotId, heatId, advanced, seed]
  );
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows: [{ count }] } = await client.query('SELECT COUNT(*) FROM pilots');
    if (parseInt(count) > 0) {
      console.log('Already seeded. Drop tables or truncate to re-seed.');
      return;
    }

    await client.query('BEGIN');

    // ── Users ────────────────────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('admin123', 10);
    const judgeHash = await bcrypt.hash('judge123', 10);

    // admin — upsert (may already exist if created via API)
    await client.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ('admin@feosport.local', $1, 1)
       ON CONFLICT (email) DO UPDATE SET password_hash = $1`,
      [adminHash]
    );

    const { rows: [cj] } = await client.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ('chief@feosport.local', $1, 2)
       ON CONFLICT (email) DO UPDATE SET password_hash = $1
       RETURNING id`,
      [judgeHash]
    );
    await client.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ('judge@feosport.local', $1, 3)
       ON CONFLICT (email) DO NOTHING`,
      [judgeHash]
    );
    const judgeId = cj.id;

    // ── Pilots ───────────────────────────────────────────────────────────────
    const T1 = 'Феодосия FPV';
    const T2 = 'Крым Racing';
    const pilotsInput = [
      ['Алексей', 'Иванов',   T1],
      ['Дмитрий', 'Петров',   T1],
      ['Никита',  'Сидоров',  T1],
      ['Максим',  'Козлов',   T1],
      ['Артём',   'Морозов',  T1],
      ['Игорь',   'Новиков',  T1],
      ['Сергей',  'Попов',    T1],
      ['Кирилл',  'Лебедев',  T1],
      ['Виктор',  'Соколов',  T2],
      ['Андрей',  'Волков',   T2],
      ['Роман',   'Захаров',  T2],
      ['Денис',   'Степанов', T2],
      ['Евгений', 'Орлов',    T2],
      ['Павел',   'Зайцев',   T2],
      ['Вадим',   'Медведев', T2],
      ['Илья',    'Фёдоров',  T2],
    ];
    const pids = [];
    for (const [fn, ln, tm] of pilotsInput) {
      const { rows: [p] } = await client.query(
        `INSERT INTO pilots (first_name, last_name, team) VALUES ($1,$2,$3) RETURNING id`,
        [fn, ln, tm]
      );
      pids.push(p.id);
    }
    // pids[0]=Иванов pids[2]=Сидоров pids[4]=Морозов pids[6]=Попов
    // pids[8]=Соколов pids[10]=Захаров pids[12]=Орлов pids[14]=Медведев

    const adminId = 1;

    // ════════════════════════════════════════════════════════════════════════
    // COMPETITION 1 — Кубок Феодосии 2024
    // ════════════════════════════════════════════════════════════════════════
    const { rows: [c1] } = await client.query(
      `INSERT INTO competitions
         (name, location, start_date, end_date, status, playoff_size, created_by)
       VALUES ($1,$2,$3,$4,'completed',8,$5) RETURNING id`,
      ['Кубок Феодосии 2024', 'Феодосия, ипподром', '2024-06-15', '2024-06-15', adminId]
    );
    const cid1 = c1.id;

    // Qual heats (4 heats, 4 pilots each)
    //   Times chosen so top-8 seeds are pids[0,8,2,10,4,12,6,14]
    const q1h1 = await insertHeat(client, cid1, 'qualification', 1, judgeId);
    await insertResult(client, q1h1, pids[0],  judgeId, 43.521); // Иванов   seed-1
    await insertResult(client, q1h1, pids[1],  judgeId, 57.234); // Петров   DNQ
    await insertResult(client, q1h1, pids[2],  judgeId, 45.100); // Сидоров  seed-3
    await insertResult(client, q1h1, pids[3],  judgeId, 61.450); // Козлов   DNQ

    const q1h2 = await insertHeat(client, cid1, 'qualification', 2, judgeId);
    await insertResult(client, q1h2, pids[4],  judgeId, 47.650); // Морозов  seed-5
    await insertResult(client, q1h2, pids[5],  judgeId, 63.220); // Новиков  DNQ
    await insertResult(client, q1h2, pids[6],  judgeId, 49.830); // Попов    seed-7
    await insertResult(client, q1h2, pids[7],  judgeId, 67.110); // Лебедев  DNQ

    const q1h3 = await insertHeat(client, cid1, 'qualification', 3, judgeId);
    await insertResult(client, q1h3, pids[8],  judgeId, 44.780); // Соколов  seed-2
    await insertResult(client, q1h3, pids[9],  judgeId, 58.650); // Волков   DNQ
    await insertResult(client, q1h3, pids[10], judgeId, 46.320); // Захаров  seed-4
    await insertResult(client, q1h3, pids[11], judgeId, 59.780); // Степанов DNQ

    const q1h4 = await insertHeat(client, cid1, 'qualification', 4, judgeId);
    await insertResult(client, q1h4, pids[12], judgeId, 48.990); // Орлов    seed-6
    await insertResult(client, q1h4, pids[13], judgeId, 65.430); // Зайцев   DNQ
    await insertResult(client, q1h4, pids[14], judgeId, 51.200); // Медведев seed-8
    await insertResult(client, q1h4, pids[15], judgeId, 68.900); // Фёдоров  DNQ

    // Playoff heats comp1
    // QF: seed1vsseed8, seed2vsseed7, seed3vsseed6, seed4vsseed5
    const qf1h1 = await insertHeat(client, cid1, 'quarterfinal', 1, judgeId);
    await insertResult(client, qf1h1, pids[0],  judgeId, 43.100); // Иванов  ✓ advances
    await insertResult(client, qf1h1, pids[14], judgeId, 52.400); // Медведев

    const qf1h2 = await insertHeat(client, cid1, 'quarterfinal', 2, judgeId);
    await insertResult(client, qf1h2, pids[8],  judgeId, 44.200); // Соколов ✓
    await insertResult(client, qf1h2, pids[6],  judgeId, 50.900); // Попов

    const qf1h3 = await insertHeat(client, cid1, 'quarterfinal', 3, judgeId);
    await insertResult(client, qf1h3, pids[2],  judgeId, 45.500); // Сидоров ✓
    await insertResult(client, qf1h3, pids[12], judgeId, 49.200); // Орлов

    const qf1h4 = await insertHeat(client, cid1, 'quarterfinal', 4, judgeId);
    await insertResult(client, qf1h4, pids[10], judgeId, 47.800); // Захаров
    await insertResult(client, qf1h4, pids[4],  judgeId, 47.100); // Морозов ✓ upset

    // SF
    const sf1h1 = await insertHeat(client, cid1, 'semifinal', 1, judgeId);
    await insertResult(client, sf1h1, pids[0],  judgeId, 43.500); // Иванов  ✓
    await insertResult(client, sf1h1, pids[4],  judgeId, 48.200); // Морозов

    const sf1h2 = await insertHeat(client, cid1, 'semifinal', 2, judgeId);
    await insertResult(client, sf1h2, pids[8],  judgeId, 44.900); // Соколов ✓
    await insertResult(client, sf1h2, pids[2],  judgeId, 45.800); // Сидоров

    // Bronze
    const br1h1 = await insertHeat(client, cid1, 'bronze_final', 1, judgeId);
    await insertResult(client, br1h1, pids[4],  judgeId, 47.500); // Морозов
    await insertResult(client, br1h1, pids[2],  judgeId, 46.200); // Сидоров ✓ 🥉

    // Final
    const fn1h1 = await insertHeat(client, cid1, 'final', 1, judgeId);
    await insertResult(client, fn1h1, pids[0],  judgeId, 43.200); // Иванов  ✓ 🏆
    await insertResult(client, fn1h1, pids[8],  judgeId, 44.100); // Соколов 🥈

    // Brackets comp1
    // QF
    await insertBracket(client, cid1, 'quarterfinal', 1, pids[0],  qf1h1, true,  1);
    await insertBracket(client, cid1, 'quarterfinal', 2, pids[14], qf1h1, false, 8);
    await insertBracket(client, cid1, 'quarterfinal', 3, pids[8],  qf1h2, true,  2);
    await insertBracket(client, cid1, 'quarterfinal', 4, pids[6],  qf1h2, false, 7);
    await insertBracket(client, cid1, 'quarterfinal', 5, pids[2],  qf1h3, true,  3);
    await insertBracket(client, cid1, 'quarterfinal', 6, pids[12], qf1h3, false, 6);
    await insertBracket(client, cid1, 'quarterfinal', 7, pids[10], qf1h4, false, 4);
    await insertBracket(client, cid1, 'quarterfinal', 8, pids[4],  qf1h4, true,  5);
    // SF
    await insertBracket(client, cid1, 'semifinal', 1, pids[0], sf1h1, true,  1);
    await insertBracket(client, cid1, 'semifinal', 2, pids[4], sf1h1, false, 5);
    await insertBracket(client, cid1, 'semifinal', 3, pids[8], sf1h2, true,  2);
    await insertBracket(client, cid1, 'semifinal', 4, pids[2], sf1h2, false, 3);
    // Bronze
    await insertBracket(client, cid1, 'bronze_final', 1, pids[4], br1h1, false, 5);
    await insertBracket(client, cid1, 'bronze_final', 2, pids[2], br1h1, true,  3);
    // Final
    await insertBracket(client, cid1, 'final', 1, pids[0], fn1h1, true,  1);
    await insertBracket(client, cid1, 'final', 2, pids[8], fn1h1, false, 2);

    // ════════════════════════════════════════════════════════════════════════
    // COMPETITION 2 — Летний спринт 2024
    // ════════════════════════════════════════════════════════════════════════
    const { rows: [c2] } = await client.query(
      `INSERT INTO competitions
         (name, location, start_date, end_date, status, playoff_size, created_by)
       VALUES ($1,$2,$3,$4,'completed',8,$5) RETURNING id`,
      ['Летний спринт 2024', 'Феодосия, набережная', '2024-08-10', '2024-08-10', adminId]
    );
    const cid2 = c2.id;

    // Qual heats comp2 (Соколов is fastest this time)
    const q2h1 = await insertHeat(client, cid2, 'qualification', 1, judgeId);
    await insertResult(client, q2h1, pids[0],  judgeId, 44.890); // Иванов   seed-2
    await insertResult(client, q2h1, pids[1],  judgeId, 58.120); // Петров   DNQ
    await insertResult(client, q2h1, pids[2],  judgeId, 46.340); // Сидоров  seed-4
    await insertResult(client, q2h1, pids[3],  judgeId, 63.780); // Козлов   DNQ

    const q2h2 = await insertHeat(client, cid2, 'qualification', 2, judgeId);
    await insertResult(client, q2h2, pids[4],  judgeId, 48.110); // Морозов  seed-6
    await insertResult(client, q2h2, pids[5],  judgeId, 65.430); // Новиков  DNQ
    await insertResult(client, q2h2, pids[6],  judgeId, 50.220); // Попов    seed-7
    await insertResult(client, q2h2, pids[7],  judgeId, 70.100); // Лебедев  DNQ

    const q2h3 = await insertHeat(client, cid2, 'qualification', 3, judgeId);
    await insertResult(client, q2h3, pids[8],  judgeId, 43.560); // Соколов  seed-1
    await insertResult(client, q2h3, pids[9],  judgeId, 56.780); // Волков   DNQ
    await insertResult(client, q2h3, pids[10], judgeId, 45.670); // Захаров  seed-3
    await insertResult(client, q2h3, pids[11], judgeId, 60.120); // Степанов DNQ

    const q2h4 = await insertHeat(client, cid2, 'qualification', 4, judgeId);
    await insertResult(client, q2h4, pids[12], judgeId, 47.230); // Орлов    seed-5
    await insertResult(client, q2h4, pids[13], judgeId, 66.540); // Зайцев   DNQ
    await insertResult(client, q2h4, pids[14], judgeId, 52.110); // Медведев seed-8
    await insertResult(client, q2h4, pids[15], judgeId, 69.880); // Фёдоров  DNQ

    // QF comp2: seed1vsseed8, seed2vsseed7, seed3vsseed6, seed4vsseed5
    const qf2h1 = await insertHeat(client, cid2, 'quarterfinal', 1, judgeId);
    await insertResult(client, qf2h1, pids[8],  judgeId, 43.200); // Соколов ✓
    await insertResult(client, qf2h1, pids[14], judgeId, 53.100); // Медведев

    const qf2h2 = await insertHeat(client, cid2, 'quarterfinal', 2, judgeId);
    await insertResult(client, qf2h2, pids[0],  judgeId, 44.300); // Иванов  ✓
    await insertResult(client, qf2h2, pids[6],  judgeId, 51.200); // Попов

    const qf2h3 = await insertHeat(client, cid2, 'quarterfinal', 3, judgeId);
    await insertResult(client, qf2h3, pids[10], judgeId, 45.800); // Захаров ✓
    await insertResult(client, qf2h3, pids[4],  judgeId, 48.700); // Морозов

    const qf2h4 = await insertHeat(client, cid2, 'quarterfinal', 4, judgeId);
    await insertResult(client, qf2h4, pids[2],  judgeId, 47.100); // Сидоров ✓
    await insertResult(client, qf2h4, pids[12], judgeId, 47.500); // Орлов

    // SF comp2
    const sf2h1 = await insertHeat(client, cid2, 'semifinal', 1, judgeId);
    await insertResult(client, sf2h1, pids[8],  judgeId, 43.500); // Соколов ✓
    await insertResult(client, sf2h1, pids[2],  judgeId, 46.200); // Сидоров

    const sf2h2 = await insertHeat(client, cid2, 'semifinal', 2, judgeId);
    await insertResult(client, sf2h2, pids[0],  judgeId, 44.700); // Иванов  ✓
    await insertResult(client, sf2h2, pids[10], judgeId, 45.300); // Захаров

    // Bronze comp2
    const br2h1 = await insertHeat(client, cid2, 'bronze_final', 1, judgeId);
    await insertResult(client, br2h1, pids[2],  judgeId, 47.100); // Сидоров
    await insertResult(client, br2h1, pids[10], judgeId, 46.800); // Захаров ✓ 🥉

    // Final comp2
    const fn2h1 = await insertHeat(client, cid2, 'final', 1, judgeId);
    await insertResult(client, fn2h1, pids[8],  judgeId, 43.100); // Соколов ✓ 🏆
    await insertResult(client, fn2h1, pids[0],  judgeId, 45.200); // Иванов  🥈

    // Brackets comp2
    // QF
    await insertBracket(client, cid2, 'quarterfinal', 1, pids[8],  qf2h1, true,  1);
    await insertBracket(client, cid2, 'quarterfinal', 2, pids[14], qf2h1, false, 8);
    await insertBracket(client, cid2, 'quarterfinal', 3, pids[0],  qf2h2, true,  2);
    await insertBracket(client, cid2, 'quarterfinal', 4, pids[6],  qf2h2, false, 7);
    await insertBracket(client, cid2, 'quarterfinal', 5, pids[10], qf2h3, true,  3);
    await insertBracket(client, cid2, 'quarterfinal', 6, pids[4],  qf2h3, false, 6);
    await insertBracket(client, cid2, 'quarterfinal', 7, pids[2],  qf2h4, true,  4);
    await insertBracket(client, cid2, 'quarterfinal', 8, pids[12], qf2h4, false, 5);
    // SF
    await insertBracket(client, cid2, 'semifinal', 1, pids[8],  sf2h1, true,  1);
    await insertBracket(client, cid2, 'semifinal', 2, pids[2],  sf2h1, false, 4);
    await insertBracket(client, cid2, 'semifinal', 3, pids[0],  sf2h2, true,  2);
    await insertBracket(client, cid2, 'semifinal', 4, pids[10], sf2h2, false, 3);
    // Bronze
    await insertBracket(client, cid2, 'bronze_final', 1, pids[2],  br2h1, false, 4);
    await insertBracket(client, cid2, 'bronze_final', 2, pids[10], br2h1, true,  3);
    // Final
    await insertBracket(client, cid2, 'final', 1, pids[8], fn2h1, true,  1);
    await insertBracket(client, cid2, 'final', 2, pids[0], fn2h1, false, 2);

    await client.query('COMMIT');
    console.log('✅ Seed complete!');
    console.log('Logins: admin@feosport.local / admin123');
    console.log('        chief@feosport.local / judge123');
    console.log('        judge@feosport.local / judge123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
