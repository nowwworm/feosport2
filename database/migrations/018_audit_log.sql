-- Migration 018: tamper-proof audit log + pilot sanction state (Phase 13).
--
-- Хэш-цепочка: каждая запись содержит хэш предыдущей. Любая модификация
-- посередине ломает цепочку — verifyChain() это обнаружит.
--
-- payload — каноничный JSON действия (без зависимости от порядка ключей).
-- this_hash = SHA-256(prev_hash || canonicalize(payload) || recorded_at_iso).

CREATE TABLE IF NOT EXISTS audit_log (
    id              SERIAL       PRIMARY KEY,
    competition_id  INTEGER      REFERENCES competitions(id) ON DELETE SET NULL,
    action          VARCHAR(64)  NOT NULL,
    actor_user_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    target_kind     VARCHAR(32),
    target_id       INTEGER,
    payload         JSONB        NOT NULL,
    prev_hash       CHAR(64),
    this_hash       CHAR(64)     NOT NULL,
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_competition ON audit_log(competition_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action      ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_recorded_at ON audit_log(recorded_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor       ON audit_log(actor_user_id);

-- Pilot ban / sanction state (раздел 1.6 — антидопинг и санкционные истории).
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS is_banned       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS ban_reason      TEXT;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS ban_imposed_at  TIMESTAMPTZ;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS ban_lifted_at   TIMESTAMPTZ;
