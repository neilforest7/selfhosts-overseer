/*
  Warnings:

  - You are about to drop the column `command` on the `ScheduledTask` table. All the data in the column will be lost.
  - You are about to drop the column `targetHostIds` on the `ScheduledTask` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ScheduledTask" DROP COLUMN "command",
DROP COLUMN "targetHostIds",
ADD COLUMN     "taskPayload" JSONB;
