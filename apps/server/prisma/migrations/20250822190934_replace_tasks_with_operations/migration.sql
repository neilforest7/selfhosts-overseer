/*
  Warnings:

  - You are about to drop the column `executionType` on the `OperationLog` table. All the data in the column will be lost.
  - You are about to drop the column `logs` on the `OperationLog` table. All the data in the column will be lost.
  - The `status` column on the `OperationLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `TaskLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TaskRun` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('USER', 'SCHEDULE', 'WEBHOOK', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "TaskLog" DROP CONSTRAINT "TaskLog_taskId_fkey";

-- AlterTable
ALTER TABLE "OperationLog" DROP COLUMN "executionType",
DROP COLUMN "logs",
ADD COLUMN     "context" JSONB,
ADD COLUMN     "triggerContext" JSONB,
ADD COLUMN     "triggerType" "TriggerType" NOT NULL DEFAULT 'USER',
DROP COLUMN "status",
ADD COLUMN     "status" "OperationStatus" NOT NULL DEFAULT 'PENDING';

-- DropTable
DROP TABLE "TaskLog";

-- DropTable
DROP TABLE "TaskRun";

-- DropEnum
DROP TYPE "ExecType";

-- DropEnum
DROP TYPE "OpStatus";

-- CreateTable
CREATE TABLE "OperationLogEntry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stream" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "operationLogId" TEXT NOT NULL,
    "hostId" TEXT,

    CONSTRAINT "OperationLogEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_operationLogId_fkey" FOREIGN KEY ("operationLogId") REFERENCES "OperationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
