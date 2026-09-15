-- DQR P1 DB prepare: make the dev database exactly "pre-DQR-migration" state
-- for 20260915000000_dqr_question_registry, so the frozen (edited) migration
-- applies cleanly. Idempotent. Preserves all unrelated dev data.
BEGIN;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260915000000_dqr_question_registry';
DELETE FROM "system_settings" WHERE section = 'QUESTION_REGISTRY';
DROP INDEX IF EXISTS "rapid_assessments_rapidAssessmentType_questionVersion_idx";
DROP INDEX IF EXISTS "rapid_assessments_rapidAssessmentType_structureVersion_idx";
ALTER TABLE "rapid_assessments" DROP COLUMN IF EXISTS "answers";
ALTER TABLE "rapid_assessments" DROP COLUMN IF EXISTS "questionSnapshot";
ALTER TABLE "rapid_assessments" DROP COLUMN IF EXISTS "questionVersion";
ALTER TABLE "rapid_assessments" DROP COLUMN IF EXISTS "structureVersion";
ALTER TABLE "rapid_assessments" DROP COLUMN IF EXISTS "contentVersion";
DROP TABLE IF EXISTS "question_audit_logs";
DROP TABLE IF EXISTS "questions";
DROP TABLE IF EXISTS "question_sections";
DROP TABLE IF EXISTS public.food_assessments;
DROP TABLE IF EXISTS public.gap_field_severities;
DROP TABLE IF EXISTS public.health_assessments;
DROP TABLE IF EXISTS public.population_assessments;
DROP TABLE IF EXISTS public.security_assessments;
DROP TABLE IF EXISTS public.shelter_assessments;
DROP TABLE IF EXISTS public.wash_assessments;
-- Types only after their dependent tables are gone.
DROP TYPE IF EXISTS "QuestionType";
DROP TYPE IF EXISTS "QuestionCategory";
DROP TYPE IF EXISTS "QuestionStatus";
-- Bare stubs carrying the named FK constraints the frozen migration drops.
CREATE TABLE public.food_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.food_assessments ADD CONSTRAINT "food_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.health_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.health_assessments ADD CONSTRAINT "health_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.population_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.population_assessments ADD CONSTRAINT "population_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.security_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.security_assessments ADD CONSTRAINT "security_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.shelter_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.shelter_assessments ADD CONSTRAINT "shelter_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.wash_assessments (id TEXT, "rapidAssessmentId" TEXT);
ALTER TABLE public.wash_assessments ADD CONSTRAINT "wash_assessments_rapidAssessmentId_fkey" FOREIGN KEY ("rapidAssessmentId") REFERENCES "rapid_assessments"("id");
CREATE TABLE public.gap_field_severities (id TEXT, created_by TEXT, updated_by TEXT);
ALTER TABLE public.gap_field_severities ADD CONSTRAINT "gap_field_severities_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "users"("id");
ALTER TABLE public.gap_field_severities ADD CONSTRAINT "gap_field_severities_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES "users"("id");
COMMIT;
