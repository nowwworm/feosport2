'use strict';

// Protocol generation (§Приложения 4-5 правил).
//
// Архитектура:
//   1. Чистые шейперы (buildXxxProtocol) собирают полные данные протокола
//      из БД и возвращают канонический JSON. Никакой логики рендеринга.
//   2. signAndStore хэширует payload (SHA-256), сохраняет в protocols
//      с подписью текущего пользователя.
//   3. renderHtml превращает payload в HTML (без зависимостей —
//      template literals + @media print CSS).
//
// Цепочка использования: build → signAndStore → renderHtml.

const crypto = require('crypto');
const pool = require('../config/db');
const { recordAudit } = require('./audit');

const PROTOCOL_TYPES = [
  { key: 'qualification',            title: 'Протокол квалификации',                scope: 'stage' },
  { key: 'stage_results',            title: 'Протокол вылетов этапа',               scope: 'stage' },
  { key: 'final',                    title: 'Протокол финального этапа',            scope: 'stage' },
  { key: 'team_relay',               title: 'Протокол хода командной гонки',        scope: 'stage' },
  { key: 'simulator_qualification',  title: 'Протокол квалификации симулятора',     scope: 'stage' },
  { key: 'simulator_results',        title: 'Протокол хода симулятора',             scope: 'stage' },
  { key: 'final_standings',          title: 'Итоговый протокол соревнования',       scope: 'competition' },
  { key: 'team_summary',             title: 'Командный зачёт',                      scope: 'competition' },
  { key: 'tiebreak',                 title: 'Протокол гонки при равенстве баллов',  scope: 'competition' },
  { key: 'event_report',             title: 'Отчёт о проведении соревнования',      scope: 'competition' },
];

const SUPPORTED_TYPES = new Set(PROTOCOL_TYPES.map(t => t.key));
const STAGE_BOUND_TYPES = new Set(PROTOCOL_TYPES.filter(t => t.scope === 'stage').map(t => t.key));
const PROTOCOL_TITLES = Object.fromEntries(PROTOCOL_TYPES.map(t => [t.key, t.title]));

// Pure: deterministically serialize a JSON value so the hash matches across runs.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(canonicalize(payload)).digest('hex');
}

async function loadCompetitionRow(competitionId) {
  const { rows } = await pool.query(
    `SELECT c.*, d.name_ru AS discipline_name
       FROM competitions c
       LEFT JOIN disciplines d ON d.id = c.discipline_id
      WHERE c.id = $1`,
    [competitionId]
  );
  return rows[0] || null;
}

async function loadStageRow(stageId) {
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS competition_name
       FROM stages s
       JOIN competitions c ON c.id = s.competition_id
      WHERE s.id = $1`,
    [stageId]
  );
  return rows[0] || null;
}

// ─── Shapers (each returns canonical payload ready for hashing) ─────────────

async function buildQualificationProtocol(stageId) {
  const stage = await loadStageRow(stageId);
  if (!stage) throw new Error('stage_not_found');
  const competition = await loadCompetitionRow(stage.competition_id);

  const { rows: participants } = await pool.query(
    `SELECT
        p.id            AS pilot_id,
        p.last_name,
        p.first_name,
        p.team,
        g.group_number,
        gp.slot,
        gp.qualification_total_laps,
        gp.qualification_total_time_ms,
        gp.qualification_best_lap_ms,
        gp.finish_place
       FROM groups g
       JOIN group_participants gp ON gp.group_id = g.id
       JOIN pilots p ON p.id = gp.pilot_id
      WHERE g.stage_id = $1
      ORDER BY g.group_number, gp.slot`,
    [stageId]
  );

  return {
    protocol_type: 'qualification',
    competition: {
      id: competition.id,
      name: competition.name,
      discipline: competition.discipline_name || null,
      venue: competition.venue_address || null,
    },
    stage: {
      id: stage.id,
      type: stage.stage_type,
      ordinal: stage.ordinal,
      qualification_mode: stage.qualification_mode,
      target_laps: stage.target_laps,
      time_limit_seconds: stage.time_limit_seconds,
    },
    participants,
    generated_at: new Date().toISOString(),
  };
}

async function buildStageResultsProtocol(stageId) {
  const stage = await loadStageRow(stageId);
  if (!stage) throw new Error('stage_not_found');
  const competition = await loadCompetitionRow(stage.competition_id);

  const { rows: groups } = await pool.query(
    `SELECT g.id, g.group_number,
            json_agg(json_build_object(
              'pilot_id', gp.pilot_id,
              'pilot_name', p.last_name || ' ' || p.first_name,
              'team', p.team,
              'slot', gp.slot,
              'finish_place', gp.finish_place,
              'points', gp.points
            ) ORDER BY gp.finish_place NULLS LAST) AS results
       FROM groups g
       JOIN group_participants gp ON gp.group_id = g.id
       JOIN pilots p ON p.id = gp.pilot_id
      WHERE g.stage_id = $1
      GROUP BY g.id, g.group_number
      ORDER BY g.group_number`,
    [stageId]
  );

  return {
    protocol_type: 'stage_results',
    competition: { id: competition.id, name: competition.name },
    stage: { id: stage.id, type: stage.stage_type, ordinal: stage.ordinal },
    groups,
    generated_at: new Date().toISOString(),
  };
}

async function buildFinalStandingsProtocol(competitionId) {
  const competition = await loadCompetitionRow(competitionId);
  if (!competition) throw new Error('competition_not_found');

  const { computeCompetitionStandings } = require('./scoring');
  const aggregated = await computeCompetitionStandings(competitionId);

  const { rows: pilotsRows } = await pool.query(
    `SELECT id, last_name, first_name, team FROM pilots
      WHERE id = ANY($1::int[])`,
    [aggregated.standings.map(s => s.pilot_id).filter(Boolean)]
  );
  const pilotById = new Map(pilotsRows.map(p => [p.id, p]));

  const standings = aggregated.standings.map((s, idx) => {
    const p = s.pilot_id ? pilotById.get(s.pilot_id) : null;
    return {
      place: idx + 1,
      pilot_id: s.pilot_id,
      team_id: s.team_id,
      pilot_name: p ? `${p.last_name} ${p.first_name}` : null,
      team: p?.team || null,
      total_points: s.total_points,
      stages: s.stages,
    };
  });

  return {
    protocol_type: 'final_standings',
    competition: {
      id: competition.id,
      name: competition.name,
      discipline: competition.discipline_name || null,
    },
    standings,
    ties: aggregated.ties,
    generated_at: new Date().toISOString(),
  };
}

async function buildTeamSummaryProtocol(competitionId) {
  const competition = await loadCompetitionRow(competitionId);
  if (!competition) throw new Error('competition_not_found');

  // Team scoring is currently per-heat (см. teamRelay). MVP: агрегируем
  // суммарные баллы команд по participants stage_summary.
  const { computeCompetitionStandings } = require('./scoring');
  const aggregated = await computeCompetitionStandings(competitionId);

  const teamRows = aggregated.standings.filter(s => s.team_id);
  const teamIds = teamRows.map(s => s.team_id);
  const { rows: teamsRowsMeta } = teamIds.length
    ? await pool.query(`SELECT id, name FROM teams WHERE id = ANY($1::int[])`, [teamIds])
    : { rows: [] };
  const nameById = new Map(teamsRowsMeta.map(t => [t.id, t.name]));

  const standings = teamRows.map((s, idx) => ({
    place: idx + 1,
    team_id: s.team_id,
    team_name: nameById.get(s.team_id) || null,
    total_points: s.total_points,
    stages: s.stages,
  }));

  return {
    protocol_type: 'team_summary',
    competition: { id: competition.id, name: competition.name },
    standings,
    generated_at: new Date().toISOString(),
  };
}

async function buildTeamRelayProtocol(stageId) {
  const stage = await loadStageRow(stageId);
  if (!stage) throw new Error('stage_not_found');
  const competition = await loadCompetitionRow(stage.competition_id);

  const { rows: groups } = await pool.query(
    `SELECT g.id, g.group_number,
            json_agg(json_build_object(
              'team_id', gp.team_id,
              'team_name', t.name,
              'slot', gp.slot,
              'finish_place', gp.finish_place,
              'points', gp.points
            ) ORDER BY gp.slot) FILTER (WHERE gp.team_id IS NOT NULL) AS teams
       FROM groups g
       LEFT JOIN group_participants gp ON gp.group_id = g.id
       LEFT JOIN teams t ON t.id = gp.team_id
      WHERE g.stage_id = $1
      GROUP BY g.id, g.group_number
      ORDER BY g.group_number`,
    [stageId]
  );

  const { rows: handoffs } = await pool.query(
    `SELECT h.id AS heat_id, h.heat_number, g.group_number,
            rh.team_id, t.name AS team_name,
            rh.outgoing_pilot_id, outp.last_name || ' ' || outp.first_name AS outgoing_pilot_name,
            rh.incoming_pilot_id, inp.last_name || ' ' || inp.first_name AS incoming_pilot_name,
            rh.exchange_window_ms, rh.exchange_duration_ms, rh.valid,
            rh.recorded_at, rh.notes
       FROM heats h
       JOIN groups g ON g.id = h.group_id
       JOIN relay_handoffs rh ON rh.heat_id = h.id
       JOIN teams t ON t.id = rh.team_id
       LEFT JOIN pilots outp ON outp.id = rh.outgoing_pilot_id
       LEFT JOIN pilots inp ON inp.id = rh.incoming_pilot_id
      WHERE g.stage_id = $1
      ORDER BY g.group_number, h.heat_number, rh.recorded_at`,
    [stageId]
  );

  return {
    protocol_type: 'team_relay',
    competition: { id: competition.id, name: competition.name, discipline: competition.discipline_name || null },
    stage: { id: stage.id, type: stage.stage_type, ordinal: stage.ordinal },
    groups: groups.map(g => ({ ...g, teams: g.teams || [] })),
    handoffs,
    generated_at: new Date().toISOString(),
  };
}

async function buildSimulatorQualificationProtocol(stageId) {
  const payload = await buildQualificationProtocol(stageId);
  return {
    ...payload,
    protocol_type: 'simulator_qualification',
    simulator: await loadSimulatorConfig(payload.competition.id),
  };
}

async function buildSimulatorResultsProtocol(stageId) {
  const payload = await buildStageResultsProtocol(stageId);
  return {
    ...payload,
    protocol_type: 'simulator_results',
    simulator: await loadSimulatorConfig(payload.competition.id),
    disconnects: await loadStageDisconnects(stageId),
  };
}

async function loadSimulatorConfig(competitionId) {
  const { rows } = await pool.query(
    `SELECT simulator_software_name, simulator_version, simulator_settings_json,
            simulator_max_attempts, simulator_wait_timeout_seconds
       FROM competitions
      WHERE id = $1`,
    [competitionId]
  );
  return rows[0] || {};
}

async function loadStageDisconnects(stageId) {
  const { rows } = await pool.query(
    `SELECT h.id AS heat_id, h.heat_number, g.group_number,
            d.scope, d.reason, d.occurred_at, d.notes,
            p.last_name || ' ' || p.first_name AS pilot_name
       FROM heats h
       JOIN groups g ON g.id = h.group_id
       JOIN disconnects d ON d.heat_id = h.id
       LEFT JOIN pilots p ON p.id = d.pilot_id
      WHERE g.stage_id = $1
      ORDER BY g.group_number, h.heat_number, d.occurred_at`,
    [stageId]
  );
  return rows;
}

async function buildTiebreakProtocol(competitionId) {
  const payload = await buildFinalStandingsProtocol(competitionId);
  return {
    protocol_type: 'tiebreak',
    competition: payload.competition,
    ties: payload.ties,
    standings: payload.standings,
    generated_at: new Date().toISOString(),
  };
}

async function buildEventReportProtocol(competitionId) {
  const competition = await loadCompetitionRow(competitionId);
  if (!competition) throw new Error('competition_not_found');

  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM pilots) AS pilots_total,
       (SELECT COUNT(*)::int FROM teams) AS teams_total,
       (SELECT COUNT(*)::int FROM stages WHERE competition_id = $1) AS stages_total,
       (SELECT COUNT(*)::int FROM heats WHERE competition_id = $1) AS heats_total,
       (SELECT COUNT(*)::int FROM protocols WHERE competition_id = $1) AS protocols_total,
       (SELECT COUNT(*)::int FROM penalties WHERE competition_id = $1) AS penalties_total,
       (SELECT COUNT(*)::int FROM protests WHERE competition_id = $1) AS protests_total`,
    [competitionId]
  );

  const { rows: stages } = await pool.query(
    `SELECT stage_type, ordinal, status, started_at, completed_at
       FROM stages
      WHERE competition_id = $1
      ORDER BY ordinal`,
    [competitionId]
  );

  const finalStandings = await buildFinalStandingsProtocol(competitionId);

  return {
    protocol_type: 'event_report',
    competition: {
      id: competition.id,
      name: competition.name,
      discipline: competition.discipline_name || null,
      venue: competition.venue_address || competition.location || null,
      start_date: competition.start_date,
      end_date: competition.end_date,
      status: competition.status,
    },
    counts: counts[0],
    stages,
    standings: finalStandings.standings,
    ties: finalStandings.ties,
    generated_at: new Date().toISOString(),
  };
}

// ─── Persistence + signing ──────────────────────────────────────────────────

async function signAndStore({ competitionId, stageId = null, type, payload }, userId) {
  if (!SUPPORTED_TYPES.has(type)) throw new Error(`unsupported_protocol_type:${type}`);
  const hash = hashPayload(payload);

  const { rows } = await pool.query(
    `INSERT INTO protocols
       (competition_id, stage_id, protocol_type, payload, payload_hash, signed_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [competitionId, stageId, type, payload, hash, userId]
  );
  const protocol = rows[0];

  await recordAudit({
    competitionId,
    action: 'protocol.signed',
    actorUserId: userId,
    targetKind: 'protocol',
    targetId: protocol.id,
    payload: { type, stage_id: stageId, payload_hash: hash },
  });

  return protocol;
}

// ─── HTML rendering (template literals + print CSS) ─────────────────────────

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return (Number(ms) / 1000).toFixed(3) + ' c';
}

function baseHtml({ title, body, hash, signedAt, signedBy }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: 'Times New Roman', serif; color: #000; background: #fff; margin: 24px; }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 12px 0; }
  h2 { font-size: 14pt; margin: 16px 0 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11pt; margin-bottom: 12pt; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .meta { font-size: 10pt; margin-bottom: 12pt; color: #333; }
  .signatures { margin-top: 32pt; }
  .signatures table { font-size: 10pt; border: none; }
  .signatures td { border: none; padding: 4px 0; }
  .hash { font-family: 'Courier New', monospace; font-size: 8pt; color: #555; word-break: break-all; margin-top: 6pt; }
  @page { size: A4; margin: 18mm 14mm; }
  @media print {
    body { margin: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
<div class="signatures">
  <table>
    <tr><td style="width: 50%;">Главный судья: ____________________</td><td>Главный секретарь: ____________________</td></tr>
    <tr><td>Подписал: ${esc(signedBy || '—')}</td><td>Дата подписи: ${esc(signedAt || '—')}</td></tr>
  </table>
  <div class="hash">Хэш протокола (SHA-256): ${esc(hash)}</div>
</div>
<div class="no-print" style="margin-top: 24pt; text-align: center;">
  <button onclick="window.print()" style="padding: 8px 16px; font-size: 12pt;">Печать / Сохранить PDF</button>
</div>
</body></html>`;
}

function renderQualification(p) {
  const rows = p.participants.map(r => `
    <tr>
      <td>${esc(r.group_number)}</td>
      <td>${esc(r.slot)}</td>
      <td>${esc((r.last_name || '') + ' ' + (r.first_name || ''))}</td>
      <td>${esc(r.team || '')}</td>
      <td>${esc(r.qualification_total_laps ?? '—')}</td>
      <td>${esc(fmtMs(r.qualification_total_time_ms))}</td>
      <td>${esc(fmtMs(r.qualification_best_lap_ms))}</td>
      <td>${esc(r.finish_place ?? '—')}</td>
    </tr>`).join('');

  return `
    <div class="meta">
      Соревнование: <b>${esc(p.competition.name)}</b><br/>
      Дисциплина: ${esc(p.competition.discipline || '—')}<br/>
      Этап: ${esc(p.stage.type)} (порядок ${esc(p.stage.ordinal)})<br/>
      Режим: ${esc(p.stage.qualification_mode || '—')}
    </div>
    <table>
      <thead><tr>
        <th>Группа</th><th>Слот</th><th>Пилот</th><th>Команда</th>
        <th>Кругов</th><th>Время</th><th>Лучший круг</th><th>Место</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderStageResults(p) {
  const groupBlocks = p.groups.map(g => {
    const rows = (g.results || []).map(r => `
      <tr>
        <td>${esc(r.finish_place ?? '—')}</td>
        <td>${esc(r.pilot_name)}</td>
        <td>${esc(r.team || '')}</td>
        <td>${esc(r.slot)}</td>
        <td>${esc(r.points ?? '—')}</td>
      </tr>`).join('');
    return `
      <h2>Группа ${esc(g.group_number)}</h2>
      <table>
        <thead><tr>
          <th>Место</th><th>Пилот</th><th>Команда</th><th>Слот</th><th>Баллы</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return `
    <div class="meta">
      Соревнование: <b>${esc(p.competition.name)}</b><br/>
      Этап: ${esc(p.stage.type)} (порядок ${esc(p.stage.ordinal)})
    </div>
    ${groupBlocks}`;
}

function renderFinalStandings(p) {
  const rows = p.standings.map(r => `
    <tr>
      <td>${esc(r.place)}</td>
      <td>${esc(r.pilot_name || r.team)}</td>
      <td>${esc(r.team || '')}</td>
      <td>${esc(r.total_points)}</td>
    </tr>`).join('');

  const tieNote = (p.ties || []).length
    ? `<p style="color: #b00;">Внимание: есть позиции с равными баллами — требуется дуэль:
       ${p.ties.map(t => `<b>${t.points}</b> б. (${t.entries.length} участ.)`).join(', ')}.</p>`
    : '';

  return `
    <div class="meta">
      Соревнование: <b>${esc(p.competition.name)}</b><br/>
      Дисциплина: ${esc(p.competition.discipline || '—')}
    </div>
    ${tieNote}
    <table>
      <thead><tr>
        <th>Место</th><th>Пилот</th><th>Команда</th><th>Баллы</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTeamSummary(p) {
  const rows = p.standings.map(r => `
    <tr>
      <td>${esc(r.place)}</td>
      <td>${esc(r.team_name)}</td>
      <td>${esc(r.total_points)}</td>
    </tr>`).join('');

  return `
    <div class="meta">Соревнование: <b>${esc(p.competition.name)}</b></div>
    <table>
      <thead><tr><th>Место</th><th>Команда</th><th>Баллы</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRelay(p) {
  const groupBlocks = (p.groups || []).map(g => {
    const rows = (g.teams || []).map(t => `
      <tr>
        <td>${esc(t.slot)}</td>
        <td>${esc(t.team_name || '—')}</td>
        <td>${esc(t.finish_place ?? '—')}</td>
        <td>${esc(t.points ?? '—')}</td>
      </tr>`).join('');
    return `
      <h2>Группа ${esc(g.group_number)}</h2>
      <table>
        <thead><tr><th>Слот</th><th>Команда</th><th>Место</th><th>Баллы</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  const handoffRows = (p.handoffs || []).map(h => `
    <tr>
      <td>${esc(h.group_number)}</td>
      <td>${esc(h.heat_number)}</td>
      <td>${esc(h.team_name)}</td>
      <td>${esc(h.outgoing_pilot_name || '—')}</td>
      <td>${esc(h.incoming_pilot_name || '—')}</td>
      <td>${esc(h.exchange_duration_ms ?? '—')}</td>
      <td>${h.valid ? 'Да' : 'Нет'}</td>
    </tr>`).join('');

  return `
    <div class="meta">
      Соревнование: <b>${esc(p.competition.name)}</b><br/>
      Этап: ${esc(p.stage.type)} (порядок ${esc(p.stage.ordinal)})
    </div>
    ${groupBlocks}
    <h2>Передачи эстафеты</h2>
    <table>
      <thead><tr>
        <th>Группа</th><th>Вылет</th><th>Команда</th><th>Выходящий</th>
        <th>Входящий</th><th>Время передачи, мс</th><th>Зачтена</th>
      </tr></thead>
      <tbody>${handoffRows}</tbody>
    </table>`;
}

function renderSimulatorResults(p) {
  const base = renderStageResults(p);
  const s = p.simulator || {};
  const disconnectRows = (p.disconnects || []).map(d => `
    <tr>
      <td>${esc(d.group_number)}</td>
      <td>${esc(d.heat_number)}</td>
      <td>${esc(d.scope)}</td>
      <td>${esc(d.pilot_name || '—')}</td>
      <td>${esc(d.reason || '—')}</td>
    </tr>`).join('');

  return `
    <div class="meta">
      Симулятор: ${esc(s.simulator_software_name || '—')}
      ${s.simulator_version ? ` / ${esc(s.simulator_version)}` : ''}<br/>
      Макс. попыток: ${esc(s.simulator_max_attempts ?? '—')};
      ожидание: ${esc(s.simulator_wait_timeout_seconds ?? '—')} c
    </div>
    ${base}
    <h2>Разрывы соединения</h2>
    <table>
      <thead><tr><th>Группа</th><th>Вылет</th><th>Scope</th><th>Пилот</th><th>Причина</th></tr></thead>
      <tbody>${disconnectRows}</tbody>
    </table>`;
}

function renderTiebreak(p) {
  const tieBlocks = (p.ties || []).map(t => {
    const rows = (t.entries || []).map(e => `
      <tr>
        <td>${esc(e.pilot_id || e.team_id || '—')}</td>
        <td>${esc(e.total_points)}</td>
        <td>${esc((e.stages || []).map(s => `${s.stage_type}: ${s.points}`).join(', '))}</td>
      </tr>`).join('');
    return `
      <h2>Равенство: ${esc(t.points)} баллов</h2>
      <table>
        <thead><tr><th>Участник</th><th>Баллы</th><th>Этапы</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('') || '<p>Равенства баллов не обнаружены.</p>';

  return `
    <div class="meta">Соревнование: <b>${esc(p.competition.name)}</b></div>
    ${tieBlocks}`;
}

function renderEventReport(p) {
  const c = p.counts || {};
  const stageRows = (p.stages || []).map(s => `
    <tr>
      <td>${esc(s.ordinal)}</td>
      <td>${esc(s.stage_type)}</td>
      <td>${esc(s.status)}</td>
      <td>${esc(s.started_at || '—')}</td>
      <td>${esc(s.completed_at || '—')}</td>
    </tr>`).join('');

  return `
    <div class="meta">
      Соревнование: <b>${esc(p.competition.name)}</b><br/>
      Дисциплина: ${esc(p.competition.discipline || '—')}<br/>
      Место проведения: ${esc(p.competition.venue || '—')}<br/>
      Статус: ${esc(p.competition.status || '—')}
    </div>
    <table>
      <tbody>
        <tr><th>Участников</th><td>${esc(c.pilots_total ?? 0)}</td></tr>
        <tr><th>Команд</th><td>${esc(c.teams_total ?? 0)}</td></tr>
        <tr><th>Этапов</th><td>${esc(c.stages_total ?? 0)}</td></tr>
        <tr><th>Вылетов</th><td>${esc(c.heats_total ?? 0)}</td></tr>
        <tr><th>Выпущено протоколов</th><td>${esc(c.protocols_total ?? 0)}</td></tr>
        <tr><th>Штрафов</th><td>${esc(c.penalties_total ?? 0)}</td></tr>
        <tr><th>Протестов</th><td>${esc(c.protests_total ?? 0)}</td></tr>
      </tbody>
    </table>
    <h2>Этапы</h2>
    <table>
      <thead><tr><th>#</th><th>Тип</th><th>Статус</th><th>Начат</th><th>Завершён</th></tr></thead>
      <tbody>${stageRows}</tbody>
    </table>
    ${renderFinalStandings({ competition: p.competition, standings: p.standings || [], ties: p.ties || [] })}`;
}

function renderHtml(protocol, { signedBy = null } = {}) {
  const payload = protocol.payload;
  const title = PROTOCOL_TITLES[protocol.protocol_type] || protocol.protocol_type;

  let body;
  switch (protocol.protocol_type) {
    case 'qualification':   body = renderQualification(payload);   break;
    case 'stage_results':   body = renderStageResults(payload);    break;
    case 'final':           body = renderStageResults(payload);    break;  // final ≈ stage_results
    case 'team_relay':      body = renderRelay(payload);           break;
    case 'simulator_qualification':
      body = renderQualification(payload);                         break;
    case 'simulator_results':
      body = renderSimulatorResults(payload);                      break;
    case 'final_standings': body = renderFinalStandings(payload);  break;
    case 'team_summary':    body = renderTeamSummary(payload);     break;
    case 'tiebreak':        body = renderTiebreak(payload);        break;
    case 'event_report':    body = renderEventReport(payload);     break;
    default:                body = '<p>Неизвестный тип протокола.</p>';
  }

  return baseHtml({
    title,
    body,
    hash: protocol.payload_hash,
    signedAt: protocol.signed_at ? new Date(protocol.signed_at).toLocaleString('ru-RU') : null,
    signedBy,
  });
}

module.exports = {
  PROTOCOL_TYPES,
  SUPPORTED_TYPES: Array.from(SUPPORTED_TYPES),
  STAGE_BOUND_TYPES: Array.from(STAGE_BOUND_TYPES),
  hashPayload,
  canonicalize,
  buildQualificationProtocol,
  buildStageResultsProtocol,
  buildFinalStandingsProtocol,
  buildTeamSummaryProtocol,
  buildTeamRelayProtocol,
  buildSimulatorQualificationProtocol,
  buildSimulatorResultsProtocol,
  buildTiebreakProtocol,
  buildEventReportProtocol,
  signAndStore,
  renderHtml,
};
