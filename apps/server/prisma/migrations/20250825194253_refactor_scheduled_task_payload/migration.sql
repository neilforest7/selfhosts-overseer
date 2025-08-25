/*
  Warnings:

  - You are about to drop the column `taskPayload` on the `ScheduledTask` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ScheduledTask" DROP COLUMN "taskPayload",
ADD COLUMN     "command" TEXT,
ADD COLUMN     "targetHostIds" TEXT[];
