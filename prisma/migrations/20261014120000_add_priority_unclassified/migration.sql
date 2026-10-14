-- AlterEnum
-- Standalone transaction: Postgres forbids using a newly added enum value
-- (e.g. the incidents.severity default below) within the same transaction.
ALTER TYPE "Priority" ADD VALUE 'UNCLASSIFIED';
