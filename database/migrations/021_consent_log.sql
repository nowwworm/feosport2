-- Migration 021: GDPR / 152-FZ consent log (§13.5).
--
-- Immutable event log: store consent action, version, and SHA-256 of the legal
-- text instead of storing the full text in every event.

CREATE TABLE IF NOT EXISTS consent_events (
    id                  SERIAL       PRIMARY KEY,
    competition_id      INTEGER      REFERENCES competitions(id)   ON DELETE SET NULL,
    pilot_id            INTEGER      REFERENCES pilots(id)         ON DELETE SET NULL,
    team_id             INTEGER      REFERENCES teams(id)          ON DELETE SET NULL,
    application_id      INTEGER      REFERENCES applications(id)   ON DELETE SET NULL,
    user_id             INTEGER      REFERENCES users(id)          ON DELETE SET NULL,

    consent_type        VARCHAR(64)  NOT NULL,
    action              VARCHAR(16)  NOT NULL,
    consent_version     VARCHAR(64)  NOT NULL,
    consent_text_hash_sha256 CHAR(64) NOT NULL,
    lawful_basis        VARCHAR(64),
    source              VARCHAR(32)  NOT NULL DEFAULT 'api',
    ip_address          INET,
    user_agent          TEXT,
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT consent_events_action_chk
        CHECK (action IN ('accepted', 'revoked')),
    CONSTRAINT consent_events_subject_chk
        CHECK (
            (pilot_id IS NOT NULL)::int +
            (team_id IS NOT NULL)::int +
            (application_id IS NOT NULL)::int >= 1
        ),
    CONSTRAINT consent_events_hash_chk
        CHECK (consent_text_hash_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_consent_events_competition ON consent_events(competition_id);
CREATE INDEX IF NOT EXISTS idx_consent_events_pilot       ON consent_events(pilot_id);
CREATE INDEX IF NOT EXISTS idx_consent_events_team        ON consent_events(team_id);
CREATE INDEX IF NOT EXISTS idx_consent_events_application ON consent_events(application_id);
CREATE INDEX IF NOT EXISTS idx_consent_events_type        ON consent_events(consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_events_recorded_at ON consent_events(recorded_at DESC);
