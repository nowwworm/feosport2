-- FeoSport2 — тестовые данные
-- Запускать ПОСЛЕ init.sql
-- Пароли: admin@feosport.local → admin123 | chief/judge → judge123

DO $$
DECLARE
  admin_hash TEXT := '$2a$10$PKRk3ezNIg5rR3RnSoQu.OlfPmE7CFuPZQtUO3EBtXBDg7dBtswC.';
  judge_hash TEXT := '$2a$10$o8Ywy/SljigQxIFmfKlp2.78.zVdSYyM4csHKJ9cdwY3VnXAzkf5S';
  admin_id  INT; cj_id INT;
  p  INT[]; -- pilot ids [1..16]
  cid1 INT; cid2 INT;
  -- heat ids (comp1)
  q1h1 INT; q1h2 INT; q1h3 INT; q1h4 INT;
  qf1h1 INT; qf1h2 INT; qf1h3 INT; qf1h4 INT;
  sf1h1 INT; sf1h2 INT; br1h1 INT; fn1h1 INT;
  -- heat ids (comp2)
  q2h1 INT; q2h2 INT; q2h3 INT; q2h4 INT;
  qf2h1 INT; qf2h2 INT; qf2h3 INT; qf2h4 INT;
  sf2h1 INT; sf2h2 INT; br2h1 INT; fn2h1 INT;
BEGIN

-- ── Проверка: уже засеяно? ─────────────────────────────────────────────────
IF (SELECT COUNT(*) FROM pilots) > 0 THEN
  RAISE NOTICE 'Seed уже применён, пропускаем.';
  RETURN;
END IF;

-- ── Пользователи ──────────────────────────────────────────────────────────
INSERT INTO users (email, password_hash, role_id) VALUES ('admin@feosport.local', admin_hash, 1)
  ON CONFLICT (email) DO UPDATE SET password_hash = admin_hash
  RETURNING id INTO admin_id;

IF admin_id IS NULL THEN
  SELECT id INTO admin_id FROM users WHERE email = 'admin@feosport.local';
END IF;

INSERT INTO users (email, password_hash, role_id) VALUES ('chief@feosport.local', judge_hash, 2)
  ON CONFLICT (email) DO UPDATE SET password_hash = judge_hash
  RETURNING id INTO cj_id;

IF cj_id IS NULL THEN
  SELECT id INTO cj_id FROM users WHERE email = 'chief@feosport.local';
END IF;

INSERT INTO users (email, password_hash, role_id) VALUES ('judge@feosport.local', judge_hash, 3)
  ON CONFLICT (email) DO NOTHING;

INSERT INTO users (email, password_hash, role_id) VALUES ('pilot@feosport.local', judge_hash, 4)
  ON CONFLICT (email) DO NOTHING;

-- ── Пилоты (16 человек, 2 команды) ───────────────────────────────────────
p := ARRAY[]::INT[];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Алексей','Иванов',  'Феодосия FPV') RETURNING id INTO p[1];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Дмитрий','Петров',  'Феодосия FPV') RETURNING id INTO p[2];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Никита', 'Сидоров', 'Феодосия FPV') RETURNING id INTO p[3];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Максим', 'Козлов',  'Феодосия FPV') RETURNING id INTO p[4];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Артём',  'Морозов', 'Феодосия FPV') RETURNING id INTO p[5];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Игорь',  'Новиков', 'Феодосия FPV') RETURNING id INTO p[6];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Сергей', 'Попов',   'Феодосия FPV') RETURNING id INTO p[7];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Кирилл', 'Лебедев', 'Феодосия FPV') RETURNING id INTO p[8];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Виктор', 'Соколов', 'Крым Racing')  RETURNING id INTO p[9];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Андрей', 'Волков',  'Крым Racing')  RETURNING id INTO p[10];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Роман',  'Захаров', 'Крым Racing')  RETURNING id INTO p[11];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Денис',  'Степанов','Крым Racing')  RETURNING id INTO p[12];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Евгений','Орлов',   'Крым Racing')  RETURNING id INTO p[13];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Павел',  'Зайцев',  'Крым Racing')  RETURNING id INTO p[14];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Вадим',  'Медведев','Крым Racing')  RETURNING id INTO p[15];
INSERT INTO pilots (first_name, last_name, team) VALUES ('Илья',   'Фёдоров', 'Крым Racing')  RETURNING id INTO p[16];

-- ════════════════════════════════════════════════════════════════════════════
-- СОРЕВНОВАНИЕ 1 — Кубок Феодосии 2024
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO competitions (name,location,start_date,end_date,status,playoff_size,created_by)
  VALUES ('Кубок Феодосии 2024','Феодосия, ипподром','2024-06-15','2024-06-15','completed',8,admin_id)
  RETURNING id INTO cid1;

-- Квалификация
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'qualification',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q1h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q1h1,p[1], cj_id,43.521,0,false,false),(q1h1,p[2], cj_id,57.234,0,false,false),
  (q1h1,p[3], cj_id,45.100,0,false,false),(q1h1,p[4], cj_id,61.450,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'qualification',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q1h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q1h2,p[5], cj_id,47.650,0,false,false),(q1h2,p[6], cj_id,63.220,0,false,false),
  (q1h2,p[7], cj_id,49.830,0,false,false),(q1h2,p[8], cj_id,67.110,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'qualification',3,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q1h3;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q1h3,p[9], cj_id,44.780,0,false,false),(q1h3,p[10],cj_id,58.650,0,false,false),
  (q1h3,p[11],cj_id,46.320,0,false,false),(q1h3,p[12],cj_id,59.780,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'qualification',4,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q1h4;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q1h4,p[13],cj_id,48.990,0,false,false),(q1h4,p[14],cj_id,65.430,0,false,false),
  (q1h4,p[15],cj_id,51.200,0,false,false),(q1h4,p[16],cj_id,68.900,0,false,false);

-- Плей-офф (ЧФ)
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'quarterfinal',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf1h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf1h1,p[1],cj_id,43.100,0,false,false),(qf1h1,p[15],cj_id,52.400,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'quarterfinal',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf1h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf1h2,p[9],cj_id,44.200,0,false,false),(qf1h2,p[7],cj_id,50.900,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'quarterfinal',3,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf1h3;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf1h3,p[3],cj_id,45.500,0,false,false),(qf1h3,p[13],cj_id,49.200,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'quarterfinal',4,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf1h4;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf1h4,p[11],cj_id,47.800,0,false,false),(qf1h4,p[5],cj_id,47.100,0,false,false);

-- Полуфинал
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'semifinal',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO sf1h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (sf1h1,p[1],cj_id,43.500,0,false,false),(sf1h1,p[5],cj_id,48.200,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'semifinal',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO sf1h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (sf1h2,p[9],cj_id,44.900,0,false,false),(sf1h2,p[3],cj_id,45.800,0,false,false);

-- Бронза / Финал
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'bronze_final',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO br1h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (br1h1,p[5],cj_id,47.500,0,false,false),(br1h1,p[3],cj_id,46.200,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid1,'final',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO fn1h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (fn1h1,p[1],cj_id,43.200,0,false,false),(fn1h1,p[9],cj_id,44.100,0,false,false);

-- Сетка плей-офф (comp1)
INSERT INTO playoff_brackets (competition_id,round_type,bracket_slot,pilot_id,heat_id,advanced,seed) VALUES
  (cid1,'quarterfinal',1,p[1], qf1h1,true, 1),(cid1,'quarterfinal',2,p[15],qf1h1,false,8),
  (cid1,'quarterfinal',3,p[9], qf1h2,true, 2),(cid1,'quarterfinal',4,p[7], qf1h2,false,7),
  (cid1,'quarterfinal',5,p[3], qf1h3,true, 3),(cid1,'quarterfinal',6,p[13],qf1h3,false,6),
  (cid1,'quarterfinal',7,p[11],qf1h4,false,4),(cid1,'quarterfinal',8,p[5], qf1h4,true, 5),
  (cid1,'semifinal',1,p[1],sf1h1,true, 1),(cid1,'semifinal',2,p[5], sf1h1,false,5),
  (cid1,'semifinal',3,p[9],sf1h2,true, 2),(cid1,'semifinal',4,p[3], sf1h2,false,3),
  (cid1,'bronze_final',1,p[5],br1h1,false,5),(cid1,'bronze_final',2,p[3],br1h1,true,3),
  (cid1,'final',1,p[1],fn1h1,true,1),(cid1,'final',2,p[9],fn1h1,false,2);

-- ════════════════════════════════════════════════════════════════════════════
-- СОРЕВНОВАНИЕ 2 — Летний спринт 2024
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO competitions (name,location,start_date,end_date,status,playoff_size,created_by)
  VALUES ('Летний спринт 2024','Феодосия, набережная','2024-08-10','2024-08-10','completed',8,admin_id)
  RETURNING id INTO cid2;

-- Квалификация
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'qualification',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q2h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q2h1,p[1],cj_id,44.890,0,false,false),(q2h1,p[2],cj_id,58.120,0,false,false),
  (q2h1,p[3],cj_id,46.340,0,false,false),(q2h1,p[4],cj_id,63.780,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'qualification',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q2h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q2h2,p[5],cj_id,48.110,0,false,false),(q2h2,p[6],cj_id,65.430,0,false,false),
  (q2h2,p[7],cj_id,50.220,0,false,false),(q2h2,p[8],cj_id,70.100,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'qualification',3,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q2h3;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q2h3,p[9], cj_id,43.560,0,false,false),(q2h3,p[10],cj_id,56.780,0,false,false),
  (q2h3,p[11],cj_id,45.670,0,false,false),(q2h3,p[12],cj_id,60.120,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'qualification',4,'locked',cj_id,NOW(),cj_id) RETURNING id INTO q2h4;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES
  (q2h4,p[13],cj_id,47.230,0,false,false),(q2h4,p[14],cj_id,66.540,0,false,false),
  (q2h4,p[15],cj_id,52.110,0,false,false),(q2h4,p[16],cj_id,69.880,0,false,false);

-- Плей-офф (ЧФ2)
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'quarterfinal',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf2h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf2h1,p[9], cj_id,43.200,0,false,false),(qf2h1,p[15],cj_id,53.100,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'quarterfinal',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf2h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf2h2,p[1],cj_id,44.300,0,false,false),(qf2h2,p[7],cj_id,51.200,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'quarterfinal',3,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf2h3;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf2h3,p[11],cj_id,45.800,0,false,false),(qf2h3,p[5],cj_id,48.700,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'quarterfinal',4,'locked',cj_id,NOW(),cj_id) RETURNING id INTO qf2h4;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (qf2h4,p[3],cj_id,47.100,0,false,false),(qf2h4,p[13],cj_id,47.500,0,false,false);

-- Полуфинал
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'semifinal',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO sf2h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (sf2h1,p[9],cj_id,43.500,0,false,false),(sf2h1,p[3],cj_id,46.200,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'semifinal',2,'locked',cj_id,NOW(),cj_id) RETURNING id INTO sf2h2;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (sf2h2,p[1],cj_id,44.700,0,false,false),(sf2h2,p[11],cj_id,45.300,0,false,false);

-- Бронза / Финал
INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'bronze_final',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO br2h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (br2h1,p[3],cj_id,47.100,0,false,false),(br2h1,p[11],cj_id,46.800,0,false,false);

INSERT INTO heats (competition_id,round_type,heat_number,status,judge_id,locked_at,locked_by) VALUES (cid2,'final',1,'locked',cj_id,NOW(),cj_id) RETURNING id INTO fn2h1;
INSERT INTO results (heat_id,pilot_id,judge_id,time_seconds,penalty_seconds,dnf,dsq) VALUES (fn2h1,p[9],cj_id,43.100,0,false,false),(fn2h1,p[1],cj_id,45.200,0,false,false);

-- Сетка плей-офф (comp2)
INSERT INTO playoff_brackets (competition_id,round_type,bracket_slot,pilot_id,heat_id,advanced,seed) VALUES
  (cid2,'quarterfinal',1,p[9], qf2h1,true, 1),(cid2,'quarterfinal',2,p[15],qf2h1,false,8),
  (cid2,'quarterfinal',3,p[1], qf2h2,true, 2),(cid2,'quarterfinal',4,p[7], qf2h2,false,7),
  (cid2,'quarterfinal',5,p[11],qf2h3,true, 3),(cid2,'quarterfinal',6,p[5], qf2h3,false,6),
  (cid2,'quarterfinal',7,p[3], qf2h4,true, 4),(cid2,'quarterfinal',8,p[13],qf2h4,false,5),
  (cid2,'semifinal',1,p[9], sf2h1,true, 1),(cid2,'semifinal',2,p[3], sf2h1,false,4),
  (cid2,'semifinal',3,p[1], sf2h2,true, 2),(cid2,'semifinal',4,p[11],sf2h2,false,3),
  (cid2,'bronze_final',1,p[3], br2h1,false,4),(cid2,'bronze_final',2,p[11],br2h1,true,3),
  (cid2,'final',1,p[9],fn2h1,true,1),(cid2,'final',2,p[1],fn2h1,false,2);

RAISE NOTICE 'Seed завершён: 4 пользователя, 16 пилотов, 2 соревнования.';
END $$;
