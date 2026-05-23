import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import { useSocketEvent } from '../../hooks/useSocket';
import Header from '../../components/Header/Header';
import './LeaderboardPage.scss';

const VIEWS = [
  { key: 'competition', label: 'Соревнование' },
  { key: 'stage',       label: 'Этап' },
  { key: 'heat',        label: 'Вылет' },
  { key: 'team',        label: 'Команды' },
];

function fmtMs(ms) {
  if (ms == null) return '—';
  return `${(Number(ms) / 1000).toFixed(3)} c`;
}

function pilotName(row) {
  return [row.last_name, row.first_name].filter(Boolean).join(' ') || `#${row.pilot_id}`;
}

export default function LeaderboardPage() {
  const socket = useSocket();
  const [params, setParams] = useSearchParams();
  const kiosk = params.get('kiosk') === '1';

  const [competitions, setCompetitions] = useState([]);
  const [competitionId, setCompetitionId] = useState(params.get('competition') || '');
  const [stages, setStages] = useState([]);
  const [stageId, setStageId] = useState('');
  const [heats, setHeats] = useState([]);
  const [heatId, setHeatId] = useState('');
  const [view, setView] = useState(params.get('view') || 'competition');

  const [board, setBoard] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(false);

  // ─── Initial: load competitions ───────────────────────────────────────────
  useEffect(() => {
    api.get('/competitions').then(({ data }) => {
      setCompetitions(data);
      if (!competitionId && data[0]) {
        setCompetitionId(String(data[0].id));
      }
    }).catch(() => {});
  }, []);

  // ─── On competition change: load stages + heats + join WS room ────────────
  useEffect(() => {
    if (!competitionId) return;
    Promise.all([
      api.get('/competitions/' + competitionId + '/stages').catch(() => ({ data: [] })),
      api.get('/heats', { params: { competition_id: competitionId } }).catch(() => ({ data: [] })),
    ]).then(([s, h]) => {
      const stageList = s.data || [];
      const heatList  = h.data || [];
      setStages(stageList);
      setHeats(heatList);
      if (stageList[0]) setStageId(String(stageList[0].id));
      if (heatList[0])  setHeatId(String(heatList[0].id));
    });
  }, [competitionId]);

  useEffect(() => {
    if (!socket || !competitionId) return;
    socket.emit('join_competition', { competition_id: Number(competitionId) });
  }, [socket, competitionId]);

  // ─── Fetch the active board ───────────────────────────────────────────────
  const fetchBoard = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true);
    try {
      let res;
      if (view === 'competition') {
        res = await api.get('/competitions/' + competitionId + '/leaderboard');
      } else if (view === 'stage' && stageId) {
        res = await api.get('/stages/' + stageId + '/leaderboard');
      } else if (view === 'heat' && heatId) {
        res = await api.get('/heats/' + heatId + '/leaderboard');
      } else if (view === 'team' && heatId) {
        res = await api.get('/heats/' + heatId + '/team-leaderboard');
      } else {
        setBoard(null);
        setLoading(false);
        return;
      }
      setBoard(res.data);
      setUpdatedAt(new Date().toISOString());
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [competitionId, stageId, heatId, view]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  useSocketEvent('leaderboard_update', fetchBoard);
  useSocketEvent('score_update',       fetchBoard);
  useSocketEvent('lap_complete',       fetchBoard);
  useSocketEvent('heat_status_change', fetchBoard);

  // ─── Sync URL params for shareable / kiosk links ──────────────────────────
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (competitionId) next.set('competition', competitionId); else next.delete('competition');
    next.set('view', view);
    setParams(next, { replace: true });
  }, [competitionId, view]);

  const rows = useMemo(() => {
    if (!board) return [];
    return board.standings || board.leaderboard || [];
  }, [board]);

  return (
    <div className={`leaderboard-page${kiosk ? ' leaderboard-page--kiosk' : ''}`}>
      {!kiosk && <Header title="Таблица" />}

      <div className="leaderboard-page__content">
        {!kiosk && (
          <div className="leaderboard-page__controls">
            <label className="leaderboard-page__field">
              <span>Соревнование</span>
              <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
                {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <div className="leaderboard-page__tabs" role="tablist">
              {VIEWS.map(v => (
                <button
                  key={v.key}
                  role="tab"
                  aria-selected={view === v.key}
                  className={`leaderboard-page__tab${view === v.key ? ' leaderboard-page__tab--active' : ''}`}
                  onClick={() => setView(v.key)}
                  disabled={
                    (v.key === 'stage' && stages.length === 0) ||
                    ((v.key === 'heat' || v.key === 'team') && heats.length === 0)
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === 'stage' && stages.length > 0 && (
              <label className="leaderboard-page__field">
                <span>Этап</span>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.stage_type}</option>)}
                </select>
              </label>
            )}

            {(view === 'heat' || view === 'team') && heats.length > 0 && (
              <label className="leaderboard-page__field">
                <span>Вылет</span>
                <select value={heatId} onChange={(e) => setHeatId(e.target.value)}>
                  {heats.map(h => (
                    <option key={h.id} value={h.id}>#{h.heat_number} — {h.status}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <div className="leaderboard-page__status">
          <span className={`leaderboard-page__dot leaderboard-page__dot--${socket ? 'online' : 'offline'}`} />
          <span>{socket ? 'Live' : 'Нет соединения'}</span>
          {board?.mode && <span className="leaderboard-page__mode">{board.mode}</span>}
          {updatedAt && (
            <span className="leaderboard-page__ts">{new Date(updatedAt).toLocaleTimeString()}</span>
          )}
        </div>

        {loading && !rows.length ? (
          <div className="leaderboard-page__empty"><p>Загрузка…</p></div>
        ) : rows.length === 0 ? (
          <div className="leaderboard-page__empty"><p>Ожидание результатов…</p></div>
        ) : view === 'team' ? (
          <TeamList rows={rows} />
        ) : view === 'heat' || view === 'stage' ? (
          <PilotLapList rows={rows} />
        ) : (
          <PilotTimeList rows={rows} />
        )}
      </div>
    </div>
  );
}

function PilotTimeList({ rows }) {
  return (
    <ol className="leaderboard-page__list">
      {rows.map((row, idx) => {
        const place = idx + 1;
        return (
          <li
            key={row.pilot_id || `t:${row.team_id}` || idx}
            className={`leaderboard-page__row${place <= 3 ? ' leaderboard-page__row--podium' : ''}`}
          >
            <span className="rank">{place}</span>
            <div className="pilot-info">
              <span className="name">{pilotName(row)}</span>
              {row.team && <span className="team">{row.team}</span>}
            </div>
            <span className="time">
              {row.best_time ? `${parseFloat(row.best_time).toFixed(3)} c`
                : fmtMs(row.total_time_ms)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PilotLapList({ rows }) {
  return (
    <ol className="leaderboard-page__list">
      {rows.map((row, idx) => {
        const place = row.place ?? idx + 1;
        return (
          <li
            key={row.pilot_id || idx}
            className={`leaderboard-page__row${place <= 3 ? ' leaderboard-page__row--podium' : ''}${row.status && row.status !== 'ok' ? ' leaderboard-page__row--out' : ''}`}
          >
            <span className="rank">{row.status === 'dnf' ? 'DNF' : row.status === 'dsq' ? 'DSQ' : place}</span>
            <div className="pilot-info">
              <span className="name">{pilotName(row)}</span>
              {row.team && <span className="team">{row.team}</span>}
            </div>
            <span className="laps">{row.total_laps} кр.</span>
            <span className="time">{fmtMs(row.total_time_ms)}</span>
            <span className="best">{fmtMs(row.best_lap_ms)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TeamList({ rows }) {
  return (
    <ol className="leaderboard-page__list">
      {rows.map((row, idx) => {
        const place = row.place ?? idx + 1;
        return (
          <li
            key={`t:${row.team_id || idx}`}
            className={`leaderboard-page__row${place <= 3 ? ' leaderboard-page__row--podium' : ''}`}
          >
            <span className="rank">{place}</span>
            <div className="pilot-info">
              <span className="name">{row.team || `Команда ${row.team_id}`}</span>
            </div>
            <span className="laps">{row.total_laps} кр.</span>
            <span className="time">{fmtMs(row.total_time_ms)}</span>
            <span className="best">{fmtMs(row.best_lap_ms)}</span>
          </li>
        );
      })}
    </ol>
  );
}
