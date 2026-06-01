-- Pilot registration fields from FormDesigner form 245167.
-- Columns store validated dropdown values; see
-- backend/src/constants/pilotRegistration.js for the source-of-truth lists
-- and backend/src/schemas/pilotRegistration.js for the Zod validator.
--
-- Before this migration sync-formdesigner.js was dumping all FD entry
-- attributes (email, phone, rank, radio, vtx, vtx_ch, sim, notes) as a JSON
-- string into pilots.video_channel. From now on dedicated columns are used.

ALTER TABLE pilots ADD COLUMN IF NOT EXISTS radio_system     VARCHAR(64);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS vtx_type         VARCHAR(64);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS vtx_channel      VARCHAR(16);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS drone_simulator  VARCHAR(64);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS has_rank         BOOLEAN;

COMMENT ON COLUMN pilots.radio_system    IS 'Радиосистема пилота (TBS Tracer 2,4GHz, ELRS 2,4GHz, FrSky, ...)';
COMMENT ON COLUMN pilots.vtx_type        IS 'VTX (видео-передатчик): Аналог 5,8GHz, HD Zero, DJI Air Unit';
COMMENT ON COLUMN pilots.vtx_channel     IS 'Предпочитаемый VTX канал: R1, R3, R6, R7';
COMMENT ON COLUMN pilots.drone_simulator IS 'Технический симулятор для тренировок';
COMMENT ON COLUMN pilots.has_rank        IS 'Имеет ли пилот спортивный разряд (Да/Нет из FD-формы 245167)';

-- Idempotent unique index on external_id. Previously created lazily by
-- sync-formdesigner.js at runtime — moved here so a fresh Railway DB has
-- it from the start.
CREATE UNIQUE INDEX IF NOT EXISTS pilots_external_id_uq
  ON pilots (external_id);
