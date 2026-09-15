-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('BOOLEAN', 'NUMBER', 'SINGLE_CHOICE', 'MULTI_SELECT', 'TEXT_LONG');

-- CreateEnum
CREATE TYPE "QuestionCategory" AS ENUM ('GAP', 'CONTEXT');

-- DropForeignKey
ALTER TABLE "public"."food_assessments" DROP CONSTRAINT "food_assessments_rapidAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."gap_field_severities" DROP CONSTRAINT "gap_field_severities_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."gap_field_severities" DROP CONSTRAINT "gap_field_severities_updated_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."health_assessments" DROP CONSTRAINT "health_assessments_rapidAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."population_assessments" DROP CONSTRAINT "population_assessments_rapidAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."security_assessments" DROP CONSTRAINT "security_assessments_rapidAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."shelter_assessments" DROP CONSTRAINT "shelter_assessments_rapidAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."wash_assessments" DROP CONSTRAINT "wash_assessments_rapidAssessmentId_fkey";

-- AlterTable
ALTER TABLE "rapid_assessments" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "questionSnapshot" JSONB,
ADD COLUMN     "structureVersion" INTEGER,
ADD COLUMN     "contentVersion" INTEGER;

-- DropTable
DROP TABLE "public"."food_assessments";

-- DropTable
DROP TABLE "public"."gap_field_severities";

-- DropTable
DROP TABLE "public"."health_assessments";

-- DropTable
DROP TABLE "public"."population_assessments";

-- DropTable
DROP TABLE "public"."security_assessments";

-- DropTable
DROP TABLE "public"."shelter_assessments";

-- DropTable
DROP TABLE "public"."wash_assessments";

-- CreateTable
CREATE TABLE "question_sections" (
    "id" TEXT NOT NULL,
    "assessment_type" "AssessmentType" NOT NULL,
    "section_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "QuestionCategory" NOT NULL,
    "order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "assessment_type" "AssessmentType" NOT NULL,
    "section_id" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "helper_text" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "category" "QuestionCategory" NOT NULL,
    "inverted" BOOLEAN NOT NULL DEFAULT false,
    "gap_label" TEXT,
    "gap_meaning" TEXT,
    "recommendation" TEXT,
    "severity" "Priority" NOT NULL DEFAULT 'LOW',
    "number_min" INTEGER,
    "number_max" INTEGER,
    "order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_audit_logs" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "previous" JSONB,
    "actor_id" TEXT,
    "acted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_sections_assessment_type_order_idx" ON "question_sections"("assessment_type", "order");

-- CreateIndex
CREATE UNIQUE INDEX "question_sections_assessment_type_section_key_key" ON "question_sections"("assessment_type", "section_key");

-- CreateIndex
CREATE INDEX "questions_section_id_order_idx" ON "questions"("section_id", "order");

-- CreateIndex
CREATE INDEX "questions_assessment_type_is_active_idx" ON "questions"("assessment_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "questions_assessment_type_question_key_key" ON "questions"("assessment_type", "question_key");

-- CreateIndex
CREATE INDEX "question_audit_logs_question_id_acted_at_idx" ON "question_audit_logs"("question_id", "acted_at");

-- CreateIndex
CREATE INDEX "rapid_assessments_rapidAssessmentType_structureVersion_idx" ON "rapid_assessments"("rapidAssessmentType", "structureVersion");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "question_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_audit_logs" ADD CONSTRAINT "question_audit_logs_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_audit_logs" ADD CONSTRAINT "question_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

