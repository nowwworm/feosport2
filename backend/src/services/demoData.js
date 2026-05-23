'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = require('../config/db');
const { resolveDocumentsRoot, ensureDir } = require('./uploadConfig');
const { recordAudit } = require('./audit');

const DEMO_NAME = 'Кубок Севастополя 2025';
const DEMO_PREFIX = 'DEMO-SEV-2025';
const DEMO_PASSWORD = 'demo12345';

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0] ? Object.values(rows[0])[0] : null;
}

async function getRoleId(client, name) {
  const id = await scalar(client, 'SELECT id FROM roles WHERE name = $1', [name]);
  if (!id) throw new Error(`role_not_found:${name}`);
  return id;
}

async function getRefId(client, table, code) {
  const id = await scalar(client, `SELECT id FROM ${table} WHERE code = $1`, [code]);
  if (!id) throw new Error(`reference_not_found:${table}.${code}`);
  return id;
}

async function upsertUser(client, { email, role, password = DEMO_PASSWORD }) {
  const roleId = await getRoleId(client, role);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role_id = EXCLUDED.role_id,
           is_active = true,
           updated_at = NOW()
     RETURNING id, email`,
    [email, hash, roleId]
  );
  return rows[0];
}

async function upsertPilot(client, pilot, idx) {
  const { rows } = await client.query(
    `INSERT INTO pilots
       (first_name, last_name, middle_name, birth_date, team, city,
        video_channel, external_id, gender, age_group_id, region,
        registration_number, sport_rank, gto_passed,
        medical_clearance_until, insurance_until, email, phone)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (external_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        middle_name = EXCLUDED.middle_name,
        birth_date = EXCLUDED.birth_date,
        team = EXCLUDED.team,
        city = EXCLUDED.city,
        video_channel = EXCLUDED.video_channel,
        gender = EXCLUDED.gender,
        age_group_id = EXCLUDED.age_group_id,
        region = EXCLUDED.region,
        registration_number = EXCLUDED.registration_number,
        sport_rank = EXCLUDED.sport_rank,
        gto_passed = EXCLUDED.gto_passed,
        medical_clearance_until = EXCLUDED.medical_clearance_until,
        insurance_until = EXCLUDED.insurance_until,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone
     RETURNING id`,
    [
      pilot.first_name,
      pilot.last_name,
      pilot.middle_name || null,
      pilot.birth_date,
      pilot.team,
      pilot.city,
      pilot.video_channel,
      `${DEMO_PREFIX}-P${String(idx + 1).padStart(2, '0')}`,
      pilot.gender,
      pilot.age_group_id,
      pilot.region,
      `SEV-${String(idx + 1).padStart(3, '0')}`,
      pilot.sport_rank,
      pilot.gto_passed,
      pilot.medical_clearance_until,
      pilot.insurance_until,
      pilot.email,
      pilot.phone,
    ]
  );
  return rows[0].id;
}

async function insertTeam(client, team, representativeUserId) {
  const { rows } = await client.query(
    `INSERT INTO teams (name, region, representative_user_id, external_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [team.name, team.region, representativeUserId, team.external_id]
  );
  return rows[0].id;
}

async function insertApplication(client, { competitionId, teamId, contactEmail, decidedBy }) {
  const { rows } = await client.query(
    `INSERT INTO applications
       (competition_id, team_id, stage, status,
        signed_by_representative_at, signed_by_region_fed_at,
        signed_by_authority_at, signed_by_doctor_at,
        entry_fee_paid_at, entry_fee_amount_rub,
        decision, decision_reason, decided_by, decided_at,
        contact_email, contact_phone, notes)
     VALUES
       ($1,$2,'final','approved',
        NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days',
        NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days',
        NOW() - INTERVAL '12 days', 5000,
        'admitted', 'Полный комплект документов и допуск комиссии.', $3, NOW() - INTERVAL '7 days',
        $4, '+7 978 000-25-25', 'Демо-заявка по образцу Приложения 3.')
     RETURNING id`,
    [competitionId, teamId, decidedBy, contactEmail]
  );
  return rows[0].id;
}

async function insertDemoDocument(client, { applicationId, teamId, uploadedBy, docType, fileName, validUntil }) {
  const root = resolveDocumentsRoot();
  const dir = path.join(root, 'demo', 'sevastopol-2025');
  ensureDir(dir);
  const body = [
    '%PDF-1.4',
    '% Demo FeoSport2 document',
    `1 0 obj << /Type /Catalog >> endobj`,
    `2 0 obj << /Type /Info /Title (${fileName}) >> endobj`,
    '%%EOF',
    '',
  ].join('\n');
  const safeName = fileName.replace(/[^\w.-]+/g, '_');
  const absPath = path.join(dir, safeName);
  fs.writeFileSync(absPath, body);
  const relativePath = path.relative(root, absPath);

  await client.query(
    `INSERT INTO documents
       (team_id, application_id, doc_type, file_name, file_path,
        file_size_bytes, file_hash_sha256, mime_type, valid_until, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9)`,
    [
      teamId,
      applicationId,
      docType,
      fileName,
      relativePath,
      Buffer.byteLength(body),
      sha256(body),
      validUntil,
      uploadedBy,
    ]
  );
}

async function insertDrone(client, { teamId, droneClass, name, serial, channelId, inspectedBy, applicationId }) {
  const { rows } = await client.query(
    `INSERT INTO drones
       (team_id, drone_class, name, serial_number, weight_g, diagonal_mm,
        motor_size, motor_kv, propeller_inches, video_channel_id,
        video_power_mw, battery_cells, battery_capacity_mah,
        battery_max_cell_voltage, leds_count, has_prop_guards,
        has_failsafe, control_power_mw, notes)
     VALUES
       ($1,$2,$3,$4,612,210,'2207',1850,5.0,$5,100,6,1300,4.20,48,false,true,50,
        'Демо-дрон класса 200 мм, соответствует таблице 10.')
     RETURNING id`,
    [teamId, droneClass, name, serial, channelId]
  );
  const droneId = rows[0].id;
  await client.query(
    `INSERT INTO equipment_inspections
       (drone_id, application_id, inspected_by, result, violations, notes)
     VALUES ($1,$2,$3,'passed','[]'::jsonb,'Техконтроль пройден: failsafe, светодиоды, видеоканал 5.8 ГГц.')`,
    [droneId, applicationId, inspectedBy]
  );
  return droneId;
}

async function insertStage(client, competitionId, stageType, ordinal, extra = {}) {
  const { rows } = await client.query(
    `INSERT INTO stages
       (competition_id, stage_type, ordinal, status, started_at, completed_at,
        qualification_mode, target_laps, time_limit_seconds)
     VALUES ($1,$2,$3,'completed',NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour',
             $4,$5,$6)
     RETURNING id`,
    [
      competitionId,
      stageType,
      ordinal,
      extra.qualification_mode || null,
      extra.target_laps || null,
      extra.time_limit_seconds || null,
    ]
  );
  return rows[0].id;
}

async function insertGroup(client, stageId, groupNumber) {
  const { rows } = await client.query(
    'INSERT INTO groups (stage_id, group_number) VALUES ($1,$2) RETURNING id',
    [stageId, groupNumber]
  );
  return rows[0].id;
}

async function insertHeat(client, {
  competitionId,
  groupId,
  roundType,
  heatNumber,
  judgeId,
  participants,
  lapSets,
  status = 'locked',
}) {
  const { rows } = await client.query(
    `INSERT INTO heats
       (competition_id, group_id, round_type, heat_number, status,
        judge_id, scheduled_at, started_at, ended_at, locked_at, locked_by,
        lap_limit, notes)
     VALUES
       ($1,$2,$3,$4,$5,$6,NOW() - INTERVAL '90 minutes',
        NOW() - INTERVAL '80 minutes', NOW() - INTERVAL '75 minutes',
        CASE WHEN $5::varchar = 'locked' THEN NOW() - INTERVAL '70 minutes' ELSE NULL END,
        CASE WHEN $5::varchar = 'locked' THEN $6::integer ELSE NULL END,
        3, 'Демо-вылет для презентации заказчику.')
     RETURNING id`,
    [competitionId, groupId, roundType, heatNumber, status, judgeId]
  );
  const heatId = rows[0].id;

  for (const [idx, pilotId] of participants.entries()) {
    await client.query(
      `INSERT INTO heat_participants (heat_id, pilot_id, lane)
       VALUES ($1,$2,$3)`,
      [heatId, pilotId, idx + 1]
    );
  }

  for (const [pilotIdRaw, laps] of Object.entries(lapSets)) {
    const pilotId = Number(pilotIdRaw);
    for (const [idx, duration] of laps.entries()) {
      await client.query(
        `INSERT INTO laps (heat_id, pilot_id, lap_number, duration_ms, valid, recorded_by, notes)
         VALUES ($1,$2,$3,$4,true,$5,'demo lap')`,
        [heatId, pilotId, idx + 1, duration, judgeId]
      );
    }
    const totalMs = laps.reduce((sum, value) => sum + value, 0);
    await client.query(
      `INSERT INTO results
         (heat_id, pilot_id, judge_id, time_seconds, penalty_seconds, dnf, dsq)
       VALUES ($1,$2,$3,$4,0,false,false)`,
      [heatId, pilotId, judgeId, (totalMs / 1000).toFixed(3)]
    );
  }

  return heatId;
}

async function insertProtocol(client, { competitionId, stageId = null, type, signedBy, payload }) {
  const fullPayload = {
    demo: true,
    source: 'Кнопка админки: Сгенерировать тестовые данные',
    ...payload,
  };
  await client.query(
    `INSERT INTO protocols
       (competition_id, stage_id, protocol_type, payload, payload_hash, signed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      competitionId,
      stageId,
      type,
      fullPayload,
      sha256(canonicalize(fullPayload)),
      signedBy,
    ]
  );
}

function buildLapSets(pilotIds, baseMs) {
  return Object.fromEntries(pilotIds.map((pilotId, idx) => [
    pilotId,
    [
      baseMs + idx * 430,
      baseMs + 820 + idx * 390,
      baseMs + 1640 + idx * 410,
    ],
  ]));
}

async function generateDemoData(actorUserId) {
  const client = await pool.connect();
  let competitionId = null;

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM competitions WHERE name = $1', [DEMO_NAME]);
    await client.query('DELETE FROM pilots WHERE external_id LIKE $1', [`${DEMO_PREFIX}-%`]);
    await client.query('DELETE FROM teams WHERE external_id LIKE $1', [`${DEMO_PREFIX}-%`]);
    await client.query('DELETE FROM users WHERE email LIKE $1', ['demo.%@feosport.local']);

    const users = {
      chief: await upsertUser(client, { email: 'demo.chief@feosport.local', role: 'chief_judge' }),
      secretary: await upsertUser(client, { email: 'demo.secretary@feosport.local', role: 'chief_secretary' }),
      judge: await upsertUser(client, { email: 'demo.judge@feosport.local', role: 'judge' }),
      chrono: await upsertUser(client, { email: 'demo.chrono@feosport.local', role: 'chronometer_judge' }),
      tech: await upsertUser(client, { email: 'demo.tech@feosport.local', role: 'tech_control_judge' }),
      pilot: await upsertUser(client, { email: 'demo.pilot@feosport.local', role: 'pilot' }),
    };

    const disciplineId = await getRefId(client, 'disciplines', 'class_200mm_team');
    const raceSystemId = await getRefId(client, 'race_systems', 'two_of_four');
    const raceFormatId = await getRefId(client, 'race_formats', 'offline');
    const ageGroupId = await getRefId(client, 'age_groups', 'adults_14_plus');

    const { rows: [competition] } = await client.query(
      `INSERT INTO competitions
         (name, location, start_date, end_date, status, playoff_size,
          created_by, discipline_id, race_system_id, race_format_id,
          age_group_id, gender, entry_fee_rub, registration_deadline,
          organizer_id, venue_address,
          simulator_software_name, simulator_version,
          simulator_settings_json, simulator_max_attempts, simulator_wait_timeout_seconds)
       VALUES
         ($1,'Севастополь', '2025-06-14', '2025-06-15', 'completed', 16,
          $2,$3,$4,$5,$6,'X',5000,'2025-06-01',
          $2,'Севастополь, спортивный кластер Сапун-гора, трасса FPV Arena',
          'VelociDrone', '1.17',
          '{"server":"sev-demo","track":"Black Sea GP","format":"offline showcase"}'::jsonb,
          2, 180)
       RETURNING id`,
      [DEMO_NAME, actorUserId, disciplineId, raceSystemId, raceFormatId, ageGroupId]
    );
    competitionId = competition.id;

    const teamsInput = [
      { name: 'Севастополь FPV', region: 'Севастополь', external_id: `${DEMO_PREFIX}-T01` },
      { name: 'Черноморские гонщики', region: 'Республика Крым', external_id: `${DEMO_PREFIX}-T02` },
      { name: 'Таврида Air', region: 'Республика Крым', external_id: `${DEMO_PREFIX}-T03` },
      { name: 'Орбита Юг', region: 'Краснодарский край', external_id: `${DEMO_PREFIX}-T04` },
    ];

    const teamIds = [];
    for (const team of teamsInput) {
      teamIds.push(await insertTeam(client, team, users.pilot.id));
    }

    const pilotsInput = [
      ['Александр', 'Ковалёв', 'Севастополь FPV', 'Севастополь', 'КМС', 'M'],
      ['Мария', 'Громова', 'Севастополь FPV', 'Севастополь', '1р', 'F'],
      ['Илья', 'Савельев', 'Севастополь FPV', 'Севастополь', '2р', 'M'],
      ['Денис', 'Шевченко', 'Севастополь FPV', 'Севастополь', '3р', 'M'],
      ['Роман', 'Андреев', 'Черноморские гонщики', 'Ялта', 'КМС', 'M'],
      ['Екатерина', 'Орлова', 'Черноморские гонщики', 'Симферополь', '1р', 'F'],
      ['Тимур', 'Беляев', 'Черноморские гонщики', 'Керчь', '2р', 'M'],
      ['Павел', 'Миронов', 'Черноморские гонщики', 'Евпатория', '3р', 'M'],
      ['Никита', 'Соловьёв', 'Таврида Air', 'Феодосия', 'КМС', 'M'],
      ['Алина', 'Соколова', 'Таврида Air', 'Симферополь', '1р', 'F'],
      ['Глеб', 'Тихонов', 'Таврида Air', 'Бахчисарай', '2р', 'M'],
      ['Арсений', 'Мельников', 'Таврида Air', 'Алушта', '3р', 'M'],
      ['Владислав', 'Романов', 'Орбита Юг', 'Краснодар', 'КМС', 'M'],
      ['Софья', 'Киреева', 'Орбита Юг', 'Анапа', '1р', 'F'],
      ['Марк', 'Фомин', 'Орбита Юг', 'Новороссийск', '2р', 'M'],
      ['Егор', 'Данилов', 'Орбита Юг', 'Геленджик', '3р', 'M'],
    ];

    const pilotIds = [];
    for (const [idx, [firstName, lastName, team, city, rank, gender]] of pilotsInput.entries()) {
      pilotIds.push(await upsertPilot(client, {
        first_name: firstName,
        last_name: lastName,
        birth_date: `${1998 + (idx % 8)}-0${(idx % 8) + 1}-12`,
        team,
        city,
        video_channel: `https://video.example.local/sev-2025/${idx + 1}`,
        gender,
        age_group_id: ageGroupId,
        region: teamsInput[Math.floor(idx / 4)].region,
        sport_rank: rank,
        gto_passed: idx % 3 !== 0,
        medical_clearance_until: '2025-12-31',
        insurance_until: '2025-12-31',
        email: `pilot${idx + 1}@demo.local`,
        phone: `+7 978 100-${String(idx + 1).padStart(2, '0')}-25`,
      }, idx));
    }

    for (let teamIndex = 0; teamIndex < teamIds.length; teamIndex += 1) {
      const teamPilots = pilotIds.slice(teamIndex * 4, teamIndex * 4 + 4);
      for (const [memberIndex, pilotId] of teamPilots.entries()) {
        await client.query(
          `INSERT INTO team_members (team_id, pilot_id, role, is_captain)
           VALUES ($1,$2,$3,$4)`,
          [
            teamIds[teamIndex],
            pilotId,
            memberIndex === 0 ? 'pilot' : memberIndex === 1 ? 'mechanic' : 'reserve',
            memberIndex === 0,
          ]
        );
      }
    }

    const applicationIds = [];
    for (let i = 0; i < teamIds.length; i += 1) {
      const appId = await insertApplication(client, {
        competitionId,
        teamId: teamIds[i],
        contactEmail: `team${i + 1}@demo.local`,
        decidedBy: users.chief.id,
      });
      applicationIds.push(appId);
      await insertDemoDocument(client, {
        applicationId: appId,
        teamId: teamIds[i],
        uploadedBy: users.secretary.id,
        docType: 'medical_clearance',
        fileName: `${teamsInput[i].external_id}-medical.pdf`,
        validUntil: '2025-12-31',
      });
      await insertDemoDocument(client, {
        applicationId: appId,
        teamId: teamIds[i],
        uploadedBy: users.secretary.id,
        docType: 'accident_insurance',
        fileName: `${teamsInput[i].external_id}-insurance.pdf`,
        validUntil: '2025-12-31',
      });
    }

    const { rows: channels } = await client.query(
      `SELECT id, code FROM video_channels WHERE code = ANY($1::text[]) ORDER BY sort_order`,
      [['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']]
    );
    let droneCount = 0;
    for (let i = 0; i < teamIds.length; i += 1) {
      for (let n = 0; n < 3; n += 1) {
        await insertDrone(client, {
          teamId: teamIds[i],
          droneClass: '200mm',
          name: `${teamsInput[i].name} #${n + 1}`,
          serial: `SEV25-${i + 1}${n + 1}`,
          channelId: channels[(i * 2 + n) % channels.length].id,
          inspectedBy: users.tech.id,
          applicationId: applicationIds[i],
        });
        droneCount += 1;
      }
    }

    const qualificationStage = await insertStage(client, competitionId, 'qualification', 1, {
      qualification_mode: 'laps_time',
      target_laps: 3,
    });
    const quarterStage = await insertStage(client, competitionId, 'quarterfinal', 2);
    const semiStage = await insertStage(client, competitionId, 'semifinal', 3);
    const finalStage = await insertStage(client, competitionId, 'final', 4);

    const qualificationGroups = [];
    for (let groupNo = 1; groupNo <= 4; groupNo += 1) {
      const groupId = await insertGroup(client, qualificationStage, groupNo);
      qualificationGroups.push(groupId);
      const groupPilots = pilotIds.slice((groupNo - 1) * 4, groupNo * 4);
      const lapSets = buildLapSets(groupPilots, 14200 + groupNo * 300);
      const heatId = await insertHeat(client, {
        competitionId,
        groupId,
        roundType: 'qualification',
        heatNumber: groupNo,
        judgeId: users.chrono.id,
        participants: groupPilots,
        lapSets,
      });
      for (const [idx, pilotId] of groupPilots.entries()) {
        const laps = lapSets[pilotId];
        const total = laps.reduce((sum, v) => sum + v, 0);
        await client.query(
          `INSERT INTO group_participants
             (group_id, pilot_id, slot, seed, finish_place, points,
              qualification_total_laps, qualification_total_time_ms,
              qualification_best_lap_ms)
           VALUES ($1,$2,$3,$4,$5,$6,3,$7,$8)`,
          [groupId, pilotId, idx + 1, (groupNo - 1) * 4 + idx + 1, idx + 1, Math.max(0, 4 - idx), total, Math.min(...laps)]
        );
      }
      if (groupNo === 2) {
        await client.query(
          `INSERT INTO falsestarts (heat_id, pilot_id, reason, recorded_by)
           VALUES ($1,$2,'Ранний старт до сигнала судьи.', $3)`,
          [heatId, groupPilots[2], users.judge.id]
        );
        await client.query(
          `INSERT INTO reflights (heat_id, group_id, reason, requested_by, status, notes, decided_at)
           VALUES ($1,$2,'falsestart',$3,'approved','Демо: перелёт всей группы по фальстарту.', NOW())`,
          [heatId, groupId, users.chief.id]
        );
      }
    }

    const qfGroups = [
      [pilotIds[0], pilotIds[7], pilotIds[8], pilotIds[15]],
      [pilotIds[1], pilotIds[6], pilotIds[9], pilotIds[14]],
      [pilotIds[2], pilotIds[5], pilotIds[10], pilotIds[13]],
      [pilotIds[3], pilotIds[4], pilotIds[11], pilotIds[12]],
    ];
    for (let i = 0; i < qfGroups.length; i += 1) {
      const groupId = await insertGroup(client, quarterStage, i + 1);
      const heatId = await insertHeat(client, {
        competitionId,
        groupId,
        roundType: 'quarterfinal',
        heatNumber: i + 1,
        judgeId: users.judge.id,
        participants: qfGroups[i],
        lapSets: buildLapSets(qfGroups[i], 13800 + i * 250),
      });
      for (const [idx, pilotId] of qfGroups[i].entries()) {
        await client.query(
          `INSERT INTO group_participants (group_id, pilot_id, slot, seed, finish_place, points)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [groupId, pilotId, idx + 1, idx + 1, idx + 1, idx < 2 ? 2 : 0]
        );
        await client.query(
          `INSERT INTO playoff_brackets
             (competition_id, round_type, bracket_slot, pilot_id, heat_id, advanced, seed)
           VALUES ($1,'quarterfinal',$2,$3,$4,$5,$6)`,
          [competitionId, i * 4 + idx + 1, pilotId, heatId, idx < 2, idx + 1]
        );
      }
    }

    const semiGroups = [
      [pilotIds[0], pilotIds[8], pilotIds[1], pilotIds[9]],
      [pilotIds[2], pilotIds[10], pilotIds[3], pilotIds[11]],
    ];
    for (let i = 0; i < semiGroups.length; i += 1) {
      const groupId = await insertGroup(client, semiStage, i + 1);
      const heatId = await insertHeat(client, {
        competitionId,
        groupId,
        roundType: 'semifinal',
        heatNumber: i + 1,
        judgeId: users.judge.id,
        participants: semiGroups[i],
        lapSets: buildLapSets(semiGroups[i], 13600 + i * 180),
      });
      for (const [idx, pilotId] of semiGroups[i].entries()) {
        await client.query(
          `INSERT INTO group_participants (group_id, pilot_id, slot, seed, finish_place, points)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [groupId, pilotId, idx + 1, idx + 1, idx + 1, idx < 2 ? 3 : 1]
        );
        await client.query(
          `INSERT INTO playoff_brackets
             (competition_id, round_type, bracket_slot, pilot_id, heat_id, advanced, seed)
           VALUES ($1,'semifinal',$2,$3,$4,$5,$6)`,
          [competitionId, i * 4 + idx + 1, pilotId, heatId, idx < 2, idx + 1]
        );
      }
    }

    const finalGroupId = await insertGroup(client, finalStage, 1);
    for (const [idx, teamId] of teamIds.entries()) {
      await client.query(
        `INSERT INTO group_participants (group_id, team_id, slot, seed, finish_place, points)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [finalGroupId, teamId, idx + 1, idx + 1, idx + 1, 4 - idx]
      );
    }
    const finalPilots = [pilotIds[0], pilotIds[4], pilotIds[8], pilotIds[12]];
    const finalHeatId = await insertHeat(client, {
      competitionId,
      groupId: finalGroupId,
      roundType: 'final',
      heatNumber: 1,
      judgeId: users.chrono.id,
      participants: finalPilots,
      lapSets: buildLapSets(finalPilots, 13200),
    });
    for (let i = 0; i < teamIds.length; i += 1) {
      await client.query(
        `INSERT INTO relay_handoffs
           (heat_id, team_id, outgoing_pilot_id, incoming_pilot_id,
            exchange_window_ms, exchange_duration_ms, valid, recorded_by, notes)
         VALUES ($1,$2,$3,$4,15000,$5,$6,$7,$8)`,
        [
          finalHeatId,
          teamIds[i],
          pilotIds[i * 4],
          pilotIds[i * 4 + 1],
          9200 + i * 1300,
          i !== 3,
          users.judge.id,
          i === 3 ? 'Демо-нарушение окна передачи в пит-стопе.' : 'Передача пилот-механик выполнена.',
        ]
      );
    }

    const simulatorHeatId = await insertHeat(client, {
      competitionId,
      groupId: qualificationGroups[0],
      roundType: 'simulator',
      heatNumber: 1,
      judgeId: users.judge.id,
      participants: pilotIds.slice(0, 4),
      lapSets: buildLapSets(pilotIds.slice(0, 4), 15400),
    });
    await client.query(
      `INSERT INTO disconnects (heat_id, pilot_id, scope, reason, recorded_by, notes)
       VALUES ($1,$2,'single','Потеря соединения клиента симулятора.', $3,
               'Демо: рекомендация технического поражения после повторного disconnect.')`,
      [simulatorHeatId, pilotIds[3], users.judge.id]
    );

    await client.query(
      `UPDATE results SET penalty_seconds = 5
        WHERE heat_id = $1 AND pilot_id = $2`,
      [finalHeatId, pilotIds[12]]
    );
    await client.query(
      `INSERT INTO penalties
         (competition_id, heat_id, pilot_id, penalty_type, reason, rules_clause, issued_by)
       VALUES
         ($1,$2,$3,'written_warning','Срез элемента трассы после первого круга.','§5.10', $4),
         ($1,$2,$5,'points_deduction','Нарушено окно передачи в пит-стопе.','§5.5.8, §5.10', $4)`,
      [competitionId, finalHeatId, pilotIds[12], users.chief.id, pilotIds[15]]
    );
    await client.query(
      `INSERT INTO protests
         (competition_id, heat_id, filed_by, subject_team_id, rules_clause,
          description, status, resolution, resolved_by, resolved_at)
       VALUES ($1,$2,$3,$4,'§5.14',
               'Представитель просит пересмотреть штраф за окно передачи.',
               'rejected',
               'Видео и журнал пит-стопа подтверждают превышение окна передачи.',
               $5, NOW())`,
      [competitionId, finalHeatId, users.pilot.id, teamIds[3], users.chief.id]
    );

    await insertProtocol(client, {
      competitionId,
      stageId: qualificationStage,
      type: 'qualification',
      signedBy: users.secretary.id,
      payload: { title: 'Протокол квалификационного этапа', participants: pilotIds.length },
    });
    await insertProtocol(client, {
      competitionId,
      stageId: finalStage,
      type: 'team_relay',
      signedBy: users.chief.id,
      payload: { title: 'Протокол хода командной гонки', heat_id: finalHeatId, teams: teamsInput.map(t => t.name) },
    });
    await insertProtocol(client, {
      competitionId,
      type: 'final_standings',
      signedBy: users.chief.id,
      payload: { title: 'Итоговый протокол соревнования', winner: 'Севастополь FPV' },
    });
    await insertProtocol(client, {
      competitionId,
      type: 'event_report',
      signedBy: users.chief.id,
      payload: {
        title: 'Отчет о проведении соревнования',
        judges_total: 5,
        teams_total: teamIds.length,
        pilots_total: pilotIds.length,
        note: 'Демо-отчет по Приложению 6.',
      },
    });

    await client.query('COMMIT');

    await recordAudit({
      competitionId,
      action: 'demo_data_generated',
      actorUserId,
      targetKind: 'competition',
      targetId: competitionId,
      payload: {
        name: DEMO_NAME,
        teams: teamIds.length,
        pilots: pilotIds.length,
        drones: droneCount,
        documents: teamIds.length * 2,
        source_document: 'Правила вида спорта гонки дронов (БВС)',
      },
    });

    return {
      ok: true,
      competition_id: competitionId,
      competition_name: DEMO_NAME,
      password_for_demo_users: DEMO_PASSWORD,
      summary: {
        users: Object.keys(users).length,
        teams: teamIds.length,
        pilots: pilotIds.length,
        applications: applicationIds.length,
        documents: teamIds.length * 2,
        drones: droneCount,
        stages: 4,
        heats: 12,
        penalties: 2,
        protests: 1,
        protocols: 4,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  DEMO_NAME,
  DEMO_PASSWORD,
  generateDemoData,
};
