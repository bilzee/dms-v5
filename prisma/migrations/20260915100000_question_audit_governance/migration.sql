-- Question registry governance (P2): make QuestionAuditLog polymorphic so it can
-- audit section mutations too, and capture the actor's reason.
-- Backfill: every pre-P2 row was written by the seed for a question, so
-- entity_type := 'QUESTION' and entity_id := question_id.

-- DropForeignKey
ALTER TABLE "question_audit_logs" DROP CONSTRAINT "question_audit_logs_question_id_fkey";

-- DropIndex
DROP INDEX "question_audit_logs_question_id_acted_at_idx";

-- AlterTable
ALTER TABLE "question_audit_logs"
ADD COLUMN     "entity_type" TEXT NOT NULL DEFAULT 'QUESTION',
ADD COLUMN     "entity_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reason" TEXT;

-- Backfill
UPDATE "question_audit_logs" SET "entity_id" = "question_id";

-- AlterTable
ALTER TABLE "question_audit_logs" DROP COLUMN "question_id";

-- CreateIndex
CREATE INDEX "question_audit_logs_entity_type_entity_id_acted_at_idx" ON "question_audit_logs"("entity_type", "entity_id", "acted_at");
