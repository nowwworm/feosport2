import React, { useState, useCallback } from 'react';
import { useSocket }      from '../../context/SocketContext';
import { useSocketEvent } from '../../hooks/useSocket';
import Header             from '../../components/Header/Header';
import './JudgePage.scss';

export default function JudgePage() {
  const socket = useSocket();
  const [heatId,   setHeatId]   = useState('');
  const [pilotId,  setPilotId]  = useState('');
  const [time,     setTime]     = useState('');
  const [penalty,  setPenalty]  = useState('0');
  const [dnf,      setDnf]      = useState(false);
  const [dsq,      setDsq]      = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [locked,   setLocked]   = useState(false);

  const handleHeatStatus = useCallback((data) => {
    if (String(data.heat_id) === String(heatId) && data.status === 'locked') {
      setLocked(true);
      setFeedback({ type: 'warning', msg: 'Вылет заблокирован главным судьёй' });
    }
  }, [heatId]);

  useSocketEvent('heat_status_change', handleHeatStatus);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!socket || locked) return;

    socket.emit(
      'submit_score',
      {
        heat_id:         parseInt(heatId,  10),
        pilot_id:        parseInt(pilotId, 10),
        time_seconds:    dnf || dsq ? null : parseFloat(time),
        penalty_seconds: parseFloat(penalty) || 0,
        dnf,
        dsq,
      },
      (res) => {
        if (res.error) {
          setFeedback({ type: 'error', msg: res.error });
        } else {
          setFeedback({ type: 'success', msg: 'Результат сохранён ✓' });
          setTime('');
          setPenalty('0');
          setDnf(false);
          setDsq(false);
        }
      }
    );
  };

  const toggleDnf = (e) => {
    setDnf(e.target.checked);
    if (e.target.checked) setDsq(false);
  };

  const toggleDsq = (e) => {
    setDsq(e.target.checked);
    if (e.target.checked) setDnf(false);
  };

  return (
    <div className="judge-page">
      <Header title="Судейский пульт" />

      <div className="judge-page__content">
        {locked && (
          <div className="judge-page__locked-banner" role="alert">
            Вылет заблокирован — редактирование запрещено
          </div>
        )}

        <form className="judge-page__form" onSubmit={handleSubmit}>
          <div className="judge-page__row">
            <div className="judge-page__field">
              <label htmlFor="heatId">№ Вылета</label>
              <input
                id="heatId"
                type="number"
                inputMode="numeric"
                value={heatId}
                onChange={(e) => { setHeatId(e.target.value); setLocked(false); setFeedback(null); }}
                placeholder="ID вылета"
                required
              />
            </div>
            <div className="judge-page__field">
              <label htmlFor="pilotId">№ Пилота</label>
              <input
                id="pilotId"
                type="number"
                inputMode="numeric"
                value={pilotId}
                onChange={(e) => setPilotId(e.target.value)}
                placeholder="ID пилота"
                required
              />
            </div>
          </div>

          <div className="judge-page__field">
            <label htmlFor="time">Время (сек)</label>
            <input
              id="time"
              type="number"
              inputMode="decimal"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="0.000"
              step="0.001"
              min="0"
              required={!dnf && !dsq}
              disabled={dnf || dsq}
            />
          </div>

          <div className="judge-page__field">
            <label htmlFor="penalty">Штраф (сек)</label>
            <input
              id="penalty"
              type="number"
              inputMode="decimal"
              value={penalty}
              onChange={(e) => setPenalty(e.target.value)}
              placeholder="0"
              step="0.5"
              min="0"
              disabled={dnf || dsq}
            />
          </div>

          <div className="judge-page__flags">
            <label className="judge-page__flag">
              <input type="checkbox" checked={dnf} onChange={toggleDnf} />
              DNF — не финишировал
            </label>
            <label className="judge-page__flag">
              <input type="checkbox" checked={dsq} onChange={toggleDsq} />
              DSQ — дисквалификация
            </label>
          </div>

          {feedback && (
            <div
              className={`judge-page__feedback judge-page__feedback--${feedback.type}`}
              role="status"
            >
              {feedback.msg}
            </div>
          )}

          <button
            className="judge-page__submit"
            type="submit"
            disabled={!socket || locked}
          >
            {locked ? 'Вылет заблокирован' : 'Подтвердить результат'}
          </button>
        </form>
      </div>
    </div>
  );
}
