-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'SCHEDULE';

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "cron" TEXT;

