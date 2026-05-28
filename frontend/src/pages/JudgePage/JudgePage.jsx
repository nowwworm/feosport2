import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import Header from '../../components/Header/Header';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useSocketEvent } from '../../hooks/useSocket';
import './JudgePage.scss';

const REFLIGHT_REASONS = [
  { value: 'falsestart',                 label: 'Фальстарт' },
  { value: 'start_zone_collision',       label: 'Столкновение в зоне старта' },
  { value: 'post_gate_clean_collision',  label: 'Столкновение после ворот (без вины)' },
  { value: 'post_gate_guilty_collision', label: 'Столкновение после ворот (с виновником)' },
  { value: 'landing_collision',          label: 'Столкновение на посадке' },
  { value: 'video_signal',               label: 'Потеря видеосигнала' },
  { value: 'own_damage',                 label: 'Самоповреждение' },
  { value: 'judge_stop',                 label: 'Остановка ГСК' },
];

function fmtMs(ms) {
  if (ms == null) return '—';
  return `${(Number(ms) / 1000).toFixed(3)} c`;
}

function pilotName(p) {
  if (!p) return 'Пилот';
  return [p.last_name, p.first_name].filter(Boolean).join(' ');
}

export default function JudgePage() {
  const socket = useSocket();
  const { user } = useAuth();
  const isChief = ['chief_judge', 'admin'].includes(user?.role);

  const [competitions, setCompetitions] = useState([]);
  const [competitionId, setCompetitionId] = useState('');
  const [heats, setHeats] = useState([]);
  const [heatId, setHeatId] = useState('');
  const [pilots, setPilots] = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [activity, setActivity] = useState([]);
  const [reflightOpen, setReflightOpen] = useState(false);

  const pilotById = useMemo(
    () => pilots.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}),
    [pilots]
  );

  const selectedHeat = useMemo(
    () => heats.find(h => String(h.id) === String(heatId)) || null,
    [heats, heatId]
  );

  const participants = useMemo(
    () => (selectedHeat?.participants || [])
      .filter(p => p.pilot_id)
      .map(p => ({ ...p, pilot: pilotById[p.pilot_id] })),
    [selectedHeat, pilotById]
  );

  const standingsById = useMemo(() => {
    const map = {};
    for (const s of leaderboard?.standings || []) map[s.pilot_id] = s;
    return map;
  }, [leaderboard]);

  const heatLocked = selectedHeat?.status === 'locked';

  const pushActivity = useCallback((msg) => {
    setActivity(prev => [
      { id: `${Date.now()}-${Math.random()}`, msg, at: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 10));
  }, []);

  // ─── Initial data ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.get('/competitions'), api.get('/pilots')])
      .then(([c, p]) => {
        setCompetitions(c.data);
        setPilots(p.data);
        if (c.data[0]) setCompetitionId(String(c.data[0].id));
      })
      .catch(() => setFeedback({ type: 'error', msg: 'Не удалось загрузить соревнования/пилотов' }));
  }, []);

  useEffect(() => {
    if (!competitionId) return;
    api.get('/heats', { params: { competition_id: competitionId } })
      .then(({ data }) => {
        setHeats(data);
        setHeatId(data[0] ? String(data[0].id) : '');
      })
      .catch(() => setFeedback({ type: 'error', msg: 'Не удалось загрузить вылеты' }));
  }, [competitionId]);

  useEffect(() => {
    if (!socket || !competitionId) return;
    socket.emit('join_competition', { competition_id: Number(competitionId) });
  }, [socket, competitionId]);

  // Whenever selected heat changes, reload its leaderboard + preflight.
  const refreshHeat = useCallback(async () => {
    if (!heatId) {
      setLeaderboard(null); setPreflight(null); return;
    }
    try {
      const [lb, pf] = await Promise.all([
        api.get(`/heats/${heatId}/leaderboard`),
        api.get(`/heats/${heatId}/channel-conflicts`).catch(() => ({ data: null })),
      ]);
      setLeaderboard(lb.data);
      setPreflight(pf.data);
    } catch {
      setLeaderboard(null);
    }
  }, [heatId]);

  useEffect(() => { refreshHeat(); }, [refreshHeat]);

  // ─── Live updates ─────────────────────────────────────────────────────────
  const handleHeatStatus = useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    setHeats(prev => prev.map(h =>
      String(h.id) === String(heatId) ? { ...h, status: data.status } : h
    ));
    pushActivity(`Статус: ${data.status}`);
  }, [heatId, pushActivity]);

  const handleLeaderboardUpdate = useCallback(() => {
    refreshHeat();
  }, [refreshHeat]);

  const handleScoreUpdate = useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    refreshHeat();
    const name = pilotName(pilotById[data.pilot_id]);
    pushActivity(`Результат: ${name} обновлён`);
  }, [heatId, pilotById, pushActivity, refreshHeat]);

  const handleFalsestart = useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    const name = data.pilot_id ? pilotName(pilotById[data.pilot_id]) : 'группа';
    pushActivity(`Фальстарт: ${name}`);
  }, [heatId, pilotById, pushActivity]);

  const handleReflight = useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    pushActivity(`Перелёт запрошен: ${data.reflight?.reason || ''}`);
  }, [heatId, pushActivity]);

  useSocketEvent('heat_status_change', handleHeatStatus);
  useSocketEvent('leaderboard_update', handleLeaderboardUpdate);
  useSocketEvent('score_update',       handleScoreUpdate);
  useSocketEvent('falsestart',         handleFalsestart);
  useSocketEvent('reflight_requested', handleReflight);

  // ─── Flight controls ──────────────────────────────────────────────────────
  const emit = (event, payload, onOk) => {
    if (!socket) return;
    socket.emit(event, payload, (res) => {
      if (res?.error) setFeedback({ type: 'error', msg: res.error });
      else {
        setFeedback({ type: 'success', msg: 'Готово ✓' });
        onOk?.(res);
      }
    });
  };

  const startFlight    = () => emit('flight_start', { heat_id: Number(heatId) });
  const endFlight      = () => emit('flight_end',   { heat_id: Number(heatId) });
  const lockHeat       = () => isChief && emit('lock_heat', { heat_id: Number(heatId) });
  const fireFalsestart = (pilotId) => emit('falsestart', { heat_id: Number(heatId), pilot_id: pilotId || null });

  // ─── Per-pilot score entry ────────────────────────────────────────────────
  const submitScore = (pilotId, fields) => {
    emit('submit_score', {
      heat_id: Number(heatId),
      pilot_id: pilotId,
      ...fields,
    }, refreshHeat);
  };

  return (
    <div className="judge-page">
      <Header title="Судейский пульт" />

      <div className="judge-page__content">
        {/* ── Picker ─────────────────────────────────── */}
        <section className="judge-page__picker">
          <label className="judge-page__field">
            <span>Соревнование</span>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="judge-page__field">
            <span>Вылет</span>
            <select value={heatId} onChange={(e) => setHeatId(e.target.value)} disabled={!heats.length}>
              {heats.map(h => (
                <option key={h.id} value={h.id}>
                  #{h.heat_number} — {h.status}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* ── Status + flight controls ───────────────── */}
        {selectedHeat && (
          <section className="judge-page__status">
            <div className={`judge-page__status-badge judge-page__status-badge--${selectedHeat.status}`}>
              {selectedHeat.status.toUpperCase()}
            </div>
            <div className="judge-page__controls">
              <button onClick={startFlight} disabled={heatLocked || selectedHeat.status === 'active'}>▶ Старт</button>
              <button onClick={endFlight}   disabled={heatLocked || selectedHeat.status !== 'active'}>⏸ Финиш</button>
              {isChief && (
                <button onClick={lockHeat} disabled={heatLocked} className="judge-page__btn-lock">
                  🔒 Закрыть
                </button>
              )}
              {isChief && (
                <button onClick={() => setReflightOpen(true)} disabled={heatLocked}>↻ Перелёт</button>
              )}
            </div>
          </section>
        )}

        {/* ── Preflight: channel conflicts ───────────── */}
        {preflight && (
          <section className="judge-page__preflight">
            {preflight.skipped ? (
              <div className="judge-page__preflight-ok">Симулятор — проверка каналов не требуется</div>
            ) : preflight.conflicts.length === 0 ? (
              <div className="judge-page__preflight-ok">Конфликтов каналов нет ✓</div>
            ) : (
              <div className="judge-page__preflight-warn">
                Конфликт каналов: {preflight.conflicts.map(c => c.video_channel_code).join(', ')}
              </div>
            )}
          </section>
        )}

        {/* ── Feedback ───────────────────────────────── */}
        {feedback && (
          <div
            className={`judge-page__feedback judge-page__feedback--${feedback.type}`}
            role="status"
            onClick={() => setFeedback(null)}
          >
            {feedback.msg}
          </div>
        )}

        {/* ── Participants ───────────────────────────── */}
        {participants.length > 0 && (
          <section className="judge-page__participants">
            <h3>Участники</h3>
            <table>
              <thead>
                <tr>
                  <th>Пилот</th>
                  <th>Кругов</th>
                  <th>Время</th>
                  <th>Лучший круг</th>
                  <th>Место</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {participants.map(({ pilot_id, pilot, lane }) => {
                  const st = standingsById[pilot_id];
                  return (
                    <ParticipantRow
                      key={pilot_id}
                      pilot={pilot}
                      lane={lane}
                      standing={st}
                      disabled={heatLocked}
                      onSubmit={(f) => submitScore(pilot_id, f)}
                      onFalsestart={() => fireFalsestart(pilot_id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Activity feed ──────────────────────────── */}
        {activity.length > 0 && (
          <section className="judge-page__activity">
            <h3>События</h3>
            <ul>
              {activity.map(a => (
                <li key={a.id}><span>{a.at}</span> {a.msg}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {reflightOpen && (
        <ReflightModal
          participants={participants}
          onClose={() => setReflightOpen(false)}
          onSubmit={(payload) => {
            emit('reflight_requested', { heat_id: Number(heatId), ...payload }, () => setReflightOpen(false));
          }}
        />
      )}
    </div>
  );
}

function ParticipantRow({ pilot, lane, standing, disabled, onSubmit, onFalsestart }) {
  const [time, setTime] = useState('');
  const [penalty, setPenalty] = useState('0');
  const [dnf, setDnf] = useState(false);
  const [dsq, setDsq] = useState(false);

  const submit = () => {
    onSubmit({
      time_seconds: dnf || dsq ? null : (parseFloat(time) || null),
      penalty_seconds: parseFloat(penalty) || 0,
      dnf, dsq,
    });
  };

  return (
    <tr className={disabled ? 'judge-page__row--locked' : ''}>
      <td className="judge-page__cell-pilot" data-label="Пилот">
        <strong>{pilotName(pilot)}</strong>
        <span>l{lane}</span>
      </td>
      <td data-label="Кругов">{standing?.total_laps ?? 0}</td>
      <td data-label="Время">{fmtMs(standing?.total_time_ms)}</td>
      <td data-label="Лучший круг">{fmtMs(standing?.best_lap_ms)}</td>
      <td data-label="Место">{standing?.place ?? '—'}</td>
      <td className="judge-page__cell-actions" data-label="Действия">
        <div className="judge-page__inline-form">
          <input
            type="number" inputMode="decimal"
            value={time} onChange={(e) => setTime(e.target.value)}
            placeholder="сек" step="0.001" min="0"
            disabled={disabled || dnf || dsq}
          />
          <input
            type="number" inputMode="decimal"
            value={penalty} onChange={(e) => setPenalty(e.target.value)}
            placeholder="штраф" step="0.5" min="0"
            disabled={disabled || dnf || dsq}
          />
          <label><input type="checkbox" checked={dnf}
            onChange={(e) => { setDnf(e.target.checked); if (e.target.checked) setDsq(false); }}
            disabled={disabled} />DNF</label>
          <label><input type="checkbox" checked={dsq}
            onChange={(e) => { setDsq(e.target.checked); if (e.target.checked) setDnf(false); }}
            disabled={disabled} />DSQ</label>
          <button type="button" onClick={submit} disabled={disabled}>Сохранить</button>
          <button type="button" onClick={onFalsestart} disabled={disabled} className="judge-page__btn-fs">✗ ФС</button>
        </div>
      </td>
    </tr>
  );
}

function ReflightModal({ participants, onClose, onSubmit }) {
  const [reason, setReason] = useState('falsestart');
  const [guiltyPilotId, setGuiltyPilotId] = useState('');
  const [notes, setNotes] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      reason,
      guilty_pilot_id: guiltyPilotId ? Number(guiltyPilotId) : null,
      notes: notes || null,
    });
  };

  return (
    <div className="judge-page__modal" role="dialog" aria-modal="true">
      <form className="judge-page__modal-form" onSubmit={submit}>
        <h3>Запросить перелёт</h3>
        <label className="judge-page__field">
          <span>Причина</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REFLIGHT_REASONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="judge-page__field">
          <span>Виновник (если есть)</span>
          <select value={guiltyPilotId} onChange={(e) => setGuiltyPilotId(e.target.value)}>
            <option value="">—</option>
            {participants.map(({ pilot_id, pilot }) => (
              <option key={pilot_id} value={pilot_id}>{pilotName(pilot)}</option>
            ))}
          </select>
        </label>
        <label className="judge-page__field">
          <span>Заметки</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <div className="judge-page__modal-actions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit">Запросить</button>
        </div>
      </form>
    </div>
  );
}
