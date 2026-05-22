import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import Header from '../../components/Header/Header';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useSocketEvent } from '../../hooks/useSocket';
import './ChronometerPage.scss';

const DEFAULT_LAP_MS = '45000';

function formatMs(ms) {
  if (!ms) return '—';
  return `${(Number(ms) / 1000).toFixed(3)} c`;
}

function pilotName(pilot) {
  if (!pilot) return 'Пилот';
  return [pilot.last_name, pilot.first_name, pilot.middle_name].filter(Boolean).join(' ');
}

export default function ChronometerPage() {
  const socket = useSocket();
  const { user } = useAuth();
  const [competitions, setCompetitions] = useState([]);
  const [competitionId, setCompetitionId] = useState('');
  const [heats, setHeats] = useState([]);
  const [heatId, setHeatId] = useState('');
  const [pilots, setPilots] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [lapForms, setLapForms] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [events, setEvents] = useState([]);

  const selectedHeat = useMemo(
    () => heats.find((heat) => String(heat.id) === String(heatId)),
    [heats, heatId]
  );

  const pilotById = useMemo(() => {
    return pilots.reduce((acc, pilot) => {
      acc[pilot.id] = pilot;
      return acc;
    }, {});
  }, [pilots]);

  const participants = useMemo(() => {
    return selectedHeat?.participants
      ?.map((slot) => ({
        ...slot,
        pilot: pilotById[slot.pilot_id],
      }))
      .filter((slot) => slot.pilot_id) || [];
  }, [selectedHeat, pilotById]);

  const canRequestReflight = ['admin', 'chief_judge'].includes(user?.role);

  const pushEvent = useCallback((message) => {
    setEvents((current) => [
      { id: `${Date.now()}-${Math.random()}`, message, time: new Date().toLocaleTimeString() },
      ...current,
    ].slice(0, 8));
  }, []);

  useEffect(() => {
    Promise.all([api.get('/competitions'), api.get('/pilots')])
      .then(([competitionsRes, pilotsRes]) => {
        setCompetitions(competitionsRes.data);
        setPilots(pilotsRes.data);
        if (competitionsRes.data[0]) setCompetitionId(String(competitionsRes.data[0].id));
      })
      .catch(() => setFeedback({ type: 'error', msg: 'Не удалось загрузить данные для пульта' }));
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

  useEffect(() => {
    if (!heatId) return;
    api.get(`/heats/${heatId}/lap-summary`)
      .then(({ data }) => {
        const next = data.reduce((acc, row) => {
          acc[row.pilot_id] = row;
          return acc;
        }, {});
        setSummaries(next);
      })
      .catch(() => setSummaries({}));
  }, [heatId]);

  useEffect(() => {
    const nextForms = {};
    participants.forEach((slot) => {
      const summary = summaries[slot.pilot_id];
      nextForms[slot.pilot_id] = {
        lap_number: String((summary?.total_laps || 0) + 1),
        duration_ms: DEFAULT_LAP_MS,
        valid: true,
      };
    });
    setLapForms(nextForms);
  }, [participants, summaries]);

  useSocketEvent('flight_start', useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    setHeats((current) => current.map((heat) => (
      String(heat.id) === String(data.heat_id) ? { ...heat, ...data.heat } : heat
    )));
    pushEvent('Вылет стартовал');
  }, [heatId, pushEvent]));

  useSocketEvent('lap_complete', useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    setSummaries((current) => ({ ...current, [data.pilot_id]: data.summary }));
    pushEvent(`Круг принят: ${pilotName(pilotById[data.pilot_id])}`);
  }, [heatId, pilotById, pushEvent]));

  useSocketEvent('falsestart', useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    pushEvent(`Фальстарт: ${data.pilot_id ? pilotName(pilotById[data.pilot_id]) : 'группа'}`);
  }, [heatId, pilotById, pushEvent]));

  useSocketEvent('reflight_requested', useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    pushEvent('Запрошен перелёт группы');
  }, [heatId, pushEvent]));

  useSocketEvent('flight_end', useCallback((data) => {
    if (String(data.heat_id) !== String(heatId)) return;
    setHeats((current) => current.map((heat) => (
      String(heat.id) === String(data.heat_id) ? { ...heat, ...data.heat } : heat
    )));
    pushEvent('Вылет завершён');
  }, [heatId, pushEvent]));

  const emitFlightEvent = (event, payload, successMessage) => {
    if (!socket) {
      setFeedback({ type: 'error', msg: 'Нет WebSocket-соединения' });
      return;
    }
    socket.emit(event, payload, (res) => {
      if (res?.error) {
        setFeedback({ type: 'error', msg: res.error });
        return;
      }
      setFeedback({ type: 'success', msg: successMessage });
    });
  };

  const updateLapForm = (pilotId, patch) => {
    setLapForms((current) => ({
      ...current,
      [pilotId]: { ...current[pilotId], ...patch },
    }));
  };

  const recordLap = (pilotId) => {
    const form = lapForms[pilotId];
    emitFlightEvent(
      'lap_complete',
      {
        heat_id: Number(heatId),
        pilot_id: Number(pilotId),
        lap_number: Number(form?.lap_number),
        duration_ms: Number(form?.duration_ms),
        valid: form?.valid !== false,
      },
      'Круг сохранён'
    );
  };

  return (
    <div className="chronometer-page">
      <Header title="Пульт хронометриста" />

      <div className="chronometer-page__content">
        <section className="chronometer-page__toolbar">
          <label>
            <span>Соревнование</span>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>{competition.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Вылет</span>
            <select value={heatId} onChange={(e) => setHeatId(e.target.value)}>
              {heats.map((heat) => (
                <option key={heat.id} value={heat.id}>
                  #{heat.id} · {heat.round_type} · {heat.status}
                </option>
              ))}
            </select>
          </label>
        </section>

        {feedback && (
          <div className={`chronometer-page__feedback chronometer-page__feedback--${feedback.type}`}>
            {feedback.msg}
          </div>
        )}

        <section className="chronometer-page__flight">
          <div className="chronometer-page__flight-meta">
            <span className={`chronometer-page__dot chronometer-page__dot--${socket ? 'online' : 'offline'}`} />
            <span>{socket ? 'Live' : 'Нет соединения'}</span>
            {selectedHeat && <strong>Статус: {selectedHeat.status}</strong>}
          </div>

          <div className="chronometer-page__actions">
            <button
              type="button"
              onClick={() => emitFlightEvent('flight_start', { heat_id: Number(heatId) }, 'Вылет запущен')}
              disabled={!socket || !heatId}
            >
              Старт
            </button>
            <button
              type="button"
              onClick={() => emitFlightEvent('flight_end', { heat_id: Number(heatId) }, 'Вылет завершён')}
              disabled={!socket || !heatId}
            >
              Финиш
            </button>
            <button
              type="button"
              className="chronometer-page__danger"
              onClick={() => emitFlightEvent('falsestart', { heat_id: Number(heatId), reason: 'manual' }, 'Фальстарт зафиксирован')}
              disabled={!socket || !heatId}
            >
              Фальстарт
            </button>
            <button
              type="button"
              onClick={() => emitFlightEvent('reflight_requested', { heat_id: Number(heatId), reason: 'falsestart' }, 'Перелёт запрошен')}
              disabled={!socket || !heatId || !canRequestReflight}
            >
              Перелёт
            </button>
          </div>
        </section>

        <section className="chronometer-page__lanes">
          {participants.length === 0 ? (
            <div className="chronometer-page__empty">В выбранном вылете нет участников</div>
          ) : participants.map((slot) => {
            const summary = summaries[slot.pilot_id] || {};
            const form = lapForms[slot.pilot_id] || {};
            return (
              <article key={slot.pilot_id} className="chronometer-page__lane">
                <div className="chronometer-page__lane-head">
                  <span className="chronometer-page__lane-num">Дорожка {slot.lane || '—'}</span>
                  <strong>{pilotName(slot.pilot)}</strong>
                  <small>#{slot.pilot_id}</small>
                </div>

                <div className="chronometer-page__stats">
                  <span>Кругов: <strong>{summary.total_laps || 0}</strong></span>
                  <span>Сумма: <strong>{formatMs(summary.total_time_ms)}</strong></span>
                  <span>Лучший: <strong>{formatMs(summary.best_lap_ms)}</strong></span>
                </div>

                <div className="chronometer-page__lap-form">
                  <label>
                    <span>Круг</span>
                    <input
                      type="number"
                      min="1"
                      value={form.lap_number || '1'}
                      onChange={(e) => updateLapForm(slot.pilot_id, { lap_number: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>мс</span>
                    <input
                      type="number"
                      min="1"
                      value={form.duration_ms || DEFAULT_LAP_MS}
                      onChange={(e) => updateLapForm(slot.pilot_id, { duration_ms: e.target.value })}
                    />
                  </label>
                  <label className="chronometer-page__check">
                    <input
                      type="checkbox"
                      checked={form.valid !== false}
                      onChange={(e) => updateLapForm(slot.pilot_id, { valid: e.target.checked })}
                    />
                    Зачёт
                  </label>
                  <button type="button" onClick={() => recordLap(slot.pilot_id)} disabled={!socket || !heatId}>
                    Круг
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="chronometer-page__events">
          <h2>Журнал</h2>
          {events.length === 0 ? (
            <p>События появятся после старта вылета</p>
          ) : events.map((event) => (
            <div key={event.id} className="chronometer-page__event">
              <span>{event.time}</span>
              <strong>{event.message}</strong>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
