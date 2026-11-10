-- OPTIONAL REVIEW ONLY. NOT part of migration.sql or detection-state.sql.
-- Requires explicit owner approval of ONE active center-wide circle.
-- Do not run without separately inspecting any existing SafeZone data.
CREATE UNIQUE INDEX "SafeZone_one_active_center_key" ON "SafeZone"("centerId") WHERE "active" = true;
