-- Migration 013: relay handoffs for team races (§5.5.8.x).
--
-- Командная эстафета: пилоты команды летают последовательно, передача
-- происходит в окне `exchange_window_ms` после касания дрона земли в зоне
-- пит-стопа. Каждое событие передачи фиксирует судья в зоне команды.

CREATE TABLE IF NOT EXISTS relay_handoffs (
    id                   SERIAL       PRIMARY KEY,
    heat_id              INTEGER      NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    team_id              INTEGER      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    outgoing_pilot_id    INTEGER      REFERENCES pilots(id) ON DELETE SET NULL,
    incoming_pilot_id    INTEGER      NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    exchange_window_ms   INTEGER,
    exchange_duration_ms INTEGER,
    valid                BOOLEAN      NOT NULL DEFAULT true,
    recorded_by          INTEGER      REFERENCES users(id),
    recorded_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    notes                TEXT,

    CONSTRAINT relay_handoffs_duration_chk
        CHECK (exchange_duration_ms IS NULL OR exchange_duration_ms >= 0),
    CONSTRAINT relay_handoffs_window_chk
        CHECK (exchange_window_ms IS NULL OR exchange_window_ms > 0),
    CONSTRAINT relay_handoffs_distinct_pilots_chk
        CHECK (outgoing_pilot_id IS NULL OR outgoing_pilot_id <> incoming_pilot_id)
);
CREATE INDEX IF NOT EXISTS idx_relay_handoffs_heat ON relay_handoffs(heat_id);
CREATE INDEX IF NOT EXISTS idx_relay_handoffs_team ON relay_handoffs(team_id);
