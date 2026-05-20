import React, { useState, useCallback } from 'react';
import { useSocketEvent } from '../../hooks/useSocket';
import { useSocket }      from '../../context/SocketContext';
import Header             from '../../components/Header/Header';
import './LeaderboardPage.scss';

export default function LeaderboardPage() {
  const socket = useSocket();
  const [leaderboard, setLeaderboard] = useState([]);
  const [updatedAt,   setUpdatedAt]   = useState(null);

  const handleUpdate = useCallback((data) => {
    setLeaderboard(data.leaderboard);
    setUpdatedAt(data.updated_at);
  }, []);

  useSocketEvent('leaderboard_update', handleUpdate);

  return (
    <div className="leaderboard-page">
      <Header title="Таблица пилотов" />

      <div className="leaderboard-page__content">
        <div className="leaderboard-page__status">
          <span className={`leaderboard-page__dot leaderboard-page__dot--${socket ? 'online' : 'offline'}`} />
          <span>{socket ? 'Live' : 'Нет соединения'}</span>
          {updatedAt && (
            <span className="leaderboard-page__ts">
              {new Date(updatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {leaderboard.length === 0 ? (
          <div className="leaderboard-page__empty">
            <p>Ожидание результатов…</p>
          </div>
        ) : (
          <ol className="leaderboard-page__list">
            {leaderboard.map((row, idx) => (
              <li
                key={row.pilot_id}
                className={`leaderboard-page__row${idx < 3 ? ' leaderboard-page__row--podium' : ''}`}
              >
                <span className="rank">{idx + 1}</span>
                <div className="pilot-info">
                  <span className="name">{row.last_name} {row.first_name}</span>
                  <span className="team">{row.team}</span>
                </div>
                <span className="time">
                  {row.best_time ? `${parseFloat(row.best_time).toFixed(3)}с` : '—'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
