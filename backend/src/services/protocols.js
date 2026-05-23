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

const SUPPORTED_TYPES = new Set([
  'qualification', 'stage_results', 'final', 'final_standings', 'team_summary',
]);

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
  return rows[0];
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

const PROTOCOL_TITLES = {
  qualification:   'Протокол квалификации',
  stage_results:   'Протокол вылетов этапа',
  final:           'Протокол финального этапа',
  final_standings: 'Итоговый протокол соревнования',
  team_summary:    'Командный зачёт',
};

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

function renderHtml(protocol, { signedBy = null } = {}) {
  const payload = protocol.payload;
  const title = PROTOCOL_TITLES[protocol.protocol_type] || protocol.protocol_type;

  let body;
  switch (protocol.protocol_type) {
    case 'qualification':   body = renderQualification(payload);   break;
    case 'stage_results':   body = renderStageResults(payload);    break;
    case 'final':           body = renderStageResults(payload);    break;  // final ≈ stage_results
    case 'final_standings': body = renderFinalStandings(payload);  break;
    case 'team_summary':    body = renderTeamSummary(payload);     break;
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
  SUPPORTED_TYPES: Array.from(SUPPORTED_TYPES),
  hashPayload,
  canonicalize,
  buildQualificationProtocol,
  buildStageResultsProtocol,
  buildFinalStandingsProtocol,
  buildTeamSummaryProtocol,
  signAndStore,
  renderHtml,
};
