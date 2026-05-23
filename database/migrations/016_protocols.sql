-- Migration 016: official competition protocols (§Приложения 4-5 правил).
--
-- Поддерживаемые типы (MVP — расширяемый список):
--   qualification     — протокол квалификации этапа
--   stage_results     — протокол вылетов этапа (1/8, 1/4, 1/2)
--   final             — протокол финального этапа
--   final_standings   — итоговый протокол соревнования
--   team_summary      — командный зачёт
--
-- Подпись: хэш SHA-256 от канонизированного payload + ссылка на подписавшего
-- (главсудья / главсекретарь). Хэш позволяет валидировать неизменность данных
-- без хранения шаблона PDF.

CREATE TABLE IF NOT EXISTS protocols (
    id              SERIAL       PRIMARY KEY,
    competition_id  INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    stage_id        INTEGER      REFERENCES stages(id) ON DELETE SET NULL,
    protocol_type   VARCHAR(32)  NOT NULL,
    payload         JSONB        NOT NULL,
    payload_hash    CHAR(64)     NOT NULL,
    signed_by       INTEGER      REFERENCES users(id),
    signed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT protocols_type_chk
        CHECK (protocol_type IN
            ('qualification', 'stage_results', 'final', 'final_standings', 'team_summary'))
);
CREATE INDEX IF NOT EXISTS idx_protocols_competition ON protocols(competition_id);
CREATE INDEX IF NOT EXISTS idx_protocols_stage       ON protocols(stage_id);
CREATE INDEX IF NOT EXISTS idx_protocols_type        ON protocols(protocol_type);
