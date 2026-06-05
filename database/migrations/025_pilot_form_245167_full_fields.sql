-- Complete participant fields from FormDesigner form 245167.
-- Stores class participation switches and free-form registration notes that
-- were previously accepted by import parsers but not persisted in pilots.

ALTER TABLE pilots ADD COLUMN IF NOT EXISTS class_75_team        BOOLEAN;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS class_75_individual  BOOLEAN;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS registration_notes   TEXT;

COMMENT ON COLUMN pilots.class_75_team IS 'Участник заявлен в 75й класс командный из FD-формы 245167';
COMMENT ON COLUMN pilots.class_75_individual IS 'Участник заявлен в 75й класс личный из FD-формы 245167';
COMMENT ON COLUMN pilots.registration_notes IS 'Дополнительная информация из FD-формы 245167';
