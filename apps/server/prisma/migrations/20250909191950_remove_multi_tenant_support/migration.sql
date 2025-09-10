/*
  Warnings:

  - You are about to drop the column `createdBy` on the `AutomationRule` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `AutomationRule` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `PluginInstallation` table. All the data in the column will be lost.
  - You are about to drop the `Organization` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[pluginId]` on the table `PluginInstallation` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "AutomationRule" DROP CONSTRAINT "AutomationRule_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "PluginInstallation" DROP CONSTRAINT "PluginInstallation_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";

-- DropIndex
DROP INDEX "AutomationRule_organizationId_idx";

-- DropIndex
DROP INDEX "PluginInstallation_organizationId_idx";

-- DropIndex
DROP INDEX "PluginInstallation_pluginId_organizationId_key";

-- AlterTable
ALTER TABLE "AutomationRule" DROP COLUMN "createdBy",
DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "PluginInstallation" DROP COLUMN "organizationId";

-- DropTable
DROP TABLE "Organization";

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "UserRole";

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstallation_pluginId_key" ON "PluginInstallation"("pluginId");
