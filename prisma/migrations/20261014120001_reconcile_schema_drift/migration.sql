-- Reconcile schema drift: DQR-era model changes that were applied via
-- `prisma db push` in development but never captured as migrations
-- (generated with `prisma migrate diff --from-migrations --to-schema-datamodel`,
-- with the action_signals column change written as a data-preserving RENAME).

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PLANNED', 'DELIVERED');

-- DropForeignKey
ALTER TABLE "public"."action_signals" DROP CONSTRAINT "action_signals_incident_id_fkey";

-- DropIndex
DROP INDEX "public"."action_signals_user_id_entity_id_incident_id_type_signal_reason";

-- DropIndex
DROP INDEX "public"."rapid_assessments_status_priority_idx";

-- AlterTable
-- Rename (not drop+add) so existing signal rows keep their reason value.
ALTER TABLE "action_signals" RENAME COLUMN "signal_reason" TO "signalReason";

-- AlterTable
ALTER TABLE "donor_commitments" ADD COLUMN     "sourcePlanId" TEXT,
ADD COLUMN     "type" "ResponseType" DEFAULT 'LOGISTICS';

-- AlterTable
ALTER TABLE "donors" ADD COLUMN     "achievementBadges" JSONB;

-- AlterTable
ALTER TABLE "incidents" ALTER COLUMN "severity" SET DEFAULT 'UNCLASSIFIED';

-- AlterTable
ALTER TABLE "question_audit_logs" ALTER COLUMN "entity_type" DROP DEFAULT,
ALTER COLUMN "entity_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rapid_assessments" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "rapid_responses" DROP COLUMN "status",
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "sourceCommitmentId" TEXT;

-- DropEnum
DROP TYPE "public"."AssessmentStatus";

-- DropEnum
DROP TYPE "public"."ResponseStatus";

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "recipients" JSONB NOT NULL,
    "filters" JSONB,
    "defaultDateRange" JSONB NOT NULL,
    "options" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_field_rules" (
    "id" TEXT NOT NULL,
    "assessment_type" "AssessmentType" NOT NULL,
    "rule_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "when" JSONB,
    "expression" JSONB NOT NULL,
    "reference_keys" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_field_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reports_userId_idx" ON "scheduled_reports"("userId");

-- CreateIndex
CREATE INDEX "scheduled_reports_isActive_nextRunAt_idx" ON "scheduled_reports"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "cross_field_rules_assessment_type_is_active_idx" ON "cross_field_rules"("assessment_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "cross_field_rules_assessment_type_rule_key_key" ON "cross_field_rules"("assessment_type", "rule_key");

-- CreateIndex
CREATE UNIQUE INDEX "action_signals_user_id_entity_id_incident_id_type_signalRea_key" ON "action_signals"("user_id", "entity_id", "incident_id", "type", "signalReason");

-- CreateIndex
CREATE INDEX "rapid_assessments_verificationStatus_priority_idx" ON "rapid_assessments"("verificationStatus", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "rapid_responses_sourceCommitmentId_key" ON "rapid_responses"("sourceCommitmentId");

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rapid_responses" ADD CONSTRAINT "rapid_responses_sourceCommitmentId_fkey" FOREIGN KEY ("sourceCommitmentId") REFERENCES "donor_commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_signals" ADD CONSTRAINT "action_signals_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
