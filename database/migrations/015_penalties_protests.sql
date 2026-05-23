-- Migration 015: penalties and protests (§5.10, §5.14).
--
-- Лестница санкций (§5.10):
--   oral_warning       — устное замечание
--   written_warning    — письменное предупреждение
--   points_deduction   — лишение баллов (значение в `points` < 0)
--   technical_defeat   — техническое поражение в текущем вылете
--   disqualification   — дисквалификация (полное снятие)
--
-- Дисквалификация дополнительно проставляет dsq=true в существующем results
-- по соответствующему heat × pilot (см. сервис penalties.applyDisqualification).

CREATE TABLE IF NOT EXISTS penalties (
    id              SERIAL       PRIMARY KEY,
    competition_id  INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    heat_id         INTEGER      REFERENCES heats(id)  ON DELETE SET NULL,
    pilot_id        INTEGER      REFERENCES pilots(id) ON DELETE CASCADE,
    team_id         INTEGER      REFERENCES teams(id)  ON DELETE CASCADE,
    penalty_type    VARCHAR(32)  NOT NULL,
    points          INTEGER,
    reason          TEXT,
    rules_clause    TEXT,
    issued_by       INTEGER      REFERENCES users(id),
    issued_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT penalties_type_chk
        CHECK (penalty_type IN
            ('oral_warning', 'written_warning', 'points_deduction',
             'technical_defeat', 'disqualification')),
    CONSTRAINT penalties_subject_chk
        CHECK ((pilot_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_penalties_competition ON penalties(competition_id);
CREATE INDEX IF NOT EXISTS idx_penalties_heat        ON penalties(heat_id);
CREATE INDEX IF NOT EXISTS idx_penalties_pilot       ON penalties(pilot_id);
CREATE INDEX IF NOT EXISTS idx_penalties_team        ON penalties(team_id);

CREATE TABLE IF NOT EXISTS protests (
    id                SERIAL       PRIMARY KEY,
    competition_id    INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    heat_id           INTEGER      REFERENCES heats(id)  ON DELETE SET NULL,
    filed_by          INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subject_pilot_id  INTEGER      REFERENCES pilots(id) ON DELETE SET NULL,
    subject_team_id   INTEGER      REFERENCES teams(id)  ON DELETE SET NULL,
    rules_clause      TEXT,
    description       TEXT         NOT NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'pending',
    resolution        TEXT,
    resolved_by       INTEGER      REFERENCES users(id),
    filed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ,

    CONSTRAINT protests_status_chk
        CHECK (status IN ('pending', 'upheld', 'rejected', 'withdrawn'))
);
CREATE INDEX IF NOT EXISTS idx_protests_competition ON protests(competition_id);
CREATE INDEX IF NOT EXISTS idx_protests_heat        ON protests(heat_id);
CREATE INDEX IF NOT EXISTS idx_protests_status      ON protests(status);
