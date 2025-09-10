/*
  Warnings:

  - A unique constraint covering the columns `[hostId,project,workingDir]` on the table `ComposeProject` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PluginType" AS ENUM ('TRIGGER', 'EVENT', 'BOTH');

-- CreateEnum
CREATE TYPE "PluginStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "NotificationTrigger" AS ENUM ('SUCCESS', 'FAILURE', 'ALWAYS', 'WARNING');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('PREREQUISITE', 'CONDITIONAL', 'SEQUENTIAL');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'USER', 'VIEWER');

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastExecutedAt" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "parentRuleId" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "version" TEXT NOT NULL DEFAULT '1.0.0',
ALTER COLUMN "ruleJson" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ComposeProject" ADD COLUMN     "hostId" TEXT;

-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "composeProjectId" TEXT;

-- CreateTable
CREATE TABLE "RuleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "author" TEXT,
    "tags" TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleTrigger" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "pluginId" TEXT NOT NULL,
    "pluginVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultConfig" JSONB NOT NULL,
    "configSchema" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "pluginId" TEXT NOT NULL,
    "pluginVersion" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultParams" JSONB NOT NULL,
    "paramsSchema" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleNotification" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOn" "NotificationTrigger"[],
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'plain',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginMetadata" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "author" TEXT,
    "type" "PluginType" NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "configSchema" JSONB,
    "dependencies" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "status" "PluginStatus" NOT NULL DEFAULT 'ACTIVE',
    "previousVersions" TEXT[],
    "compatibleVersions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginInstallation" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "organizationId" TEXT,
    "version" TEXT NOT NULL,
    "config" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleDependency" (
    "id" TEXT NOT NULL,
    "dependentRuleId" TEXT NOT NULL,
    "requiredRuleId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'PREREQUISITE',
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "triggerData" JSONB,
    "status" "ExecutionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "error" TEXT,
    "errorDetails" JSONB,
    "operationLogId" TEXT,

    CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "shouldTrigger" BOOLEAN NOT NULL,
    "reason" TEXT,
    "triggerData" JSONB,
    "duration" INTEGER,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "result" JSONB,
    "duration" INTEGER,
    "error" TEXT,
    "errorDetails" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleMetrics" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" INTEGER,
    "totalExecutions" INTEGER NOT NULL DEFAULT 0,
    "successfulExecutions" INTEGER NOT NULL DEFAULT 0,
    "failedExecutions" INTEGER NOT NULL DEFAULT 0,
    "avgExecutionTime" DOUBLE PRECISION,
    "minExecutionTime" INTEGER,
    "maxExecutionTime" INTEGER,
    "totalTriggers" INTEGER NOT NULL DEFAULT 0,
    "triggeredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMetrics" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRules" INTEGER NOT NULL,
    "activeRules" INTEGER NOT NULL,
    "totalExecutions" INTEGER NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL,
    "avgRuleExecutionTime" DOUBLE PRECISION NOT NULL,
    "systemLoad" DOUBLE PRECISION,
    "memoryUsage" DOUBLE PRECISION,
    "totalPlugins" INTEGER NOT NULL,
    "activePlugins" INTEGER NOT NULL,

    CONSTRAINT "SystemMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "settings" JSONB,
    "limits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleTemplate_name_key" ON "RuleTemplate"("name");

-- CreateIndex
CREATE INDEX "RuleTemplate_category_idx" ON "RuleTemplate"("category");

-- CreateIndex
CREATE INDEX "RuleTemplate_isPublic_idx" ON "RuleTemplate"("isPublic");

-- CreateIndex
CREATE INDEX "RuleTrigger_ruleId_idx" ON "RuleTrigger"("ruleId");

-- CreateIndex
CREATE INDEX "RuleTrigger_type_idx" ON "RuleTrigger"("type");

-- CreateIndex
CREATE INDEX "RuleTrigger_pluginId_idx" ON "RuleTrigger"("pluginId");

-- CreateIndex
CREATE INDEX "TriggerTemplate_templateId_idx" ON "TriggerTemplate"("templateId");

-- CreateIndex
CREATE INDEX "RuleEvent_ruleId_idx" ON "RuleEvent"("ruleId");

-- CreateIndex
CREATE INDEX "RuleEvent_type_idx" ON "RuleEvent"("type");

-- CreateIndex
CREATE INDEX "RuleEvent_pluginId_idx" ON "RuleEvent"("pluginId");

-- CreateIndex
CREATE INDEX "EventTemplate_templateId_idx" ON "EventTemplate"("templateId");

-- CreateIndex
CREATE INDEX "RuleNotification_ruleId_idx" ON "RuleNotification"("ruleId");

-- CreateIndex
CREATE INDEX "NotificationChannel_notificationId_idx" ON "NotificationChannel"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_type_idx" ON "NotificationTemplate"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PluginMetadata_name_key" ON "PluginMetadata"("name");

-- CreateIndex
CREATE INDEX "PluginMetadata_type_idx" ON "PluginMetadata"("type");

-- CreateIndex
CREATE INDEX "PluginMetadata_isEnabled_idx" ON "PluginMetadata"("isEnabled");

-- CreateIndex
CREATE INDEX "PluginMetadata_status_idx" ON "PluginMetadata"("status");

-- CreateIndex
CREATE INDEX "PluginInstallation_organizationId_idx" ON "PluginInstallation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstallation_pluginId_organizationId_key" ON "PluginInstallation"("pluginId", "organizationId");

-- CreateIndex
CREATE INDEX "RuleDependency_dependentRuleId_idx" ON "RuleDependency"("dependentRuleId");

-- CreateIndex
CREATE INDEX "RuleDependency_requiredRuleId_idx" ON "RuleDependency"("requiredRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleDependency_dependentRuleId_requiredRuleId_key" ON "RuleDependency"("dependentRuleId", "requiredRuleId");

-- CreateIndex
CREATE INDEX "RuleExecution_ruleId_idx" ON "RuleExecution"("ruleId");

-- CreateIndex
CREATE INDEX "RuleExecution_status_idx" ON "RuleExecution"("status");

-- CreateIndex
CREATE INDEX "RuleExecution_startedAt_idx" ON "RuleExecution"("startedAt");

-- CreateIndex
CREATE INDEX "TriggerExecution_executionId_idx" ON "TriggerExecution"("executionId");

-- CreateIndex
CREATE INDEX "TriggerExecution_triggerId_idx" ON "TriggerExecution"("triggerId");

-- CreateIndex
CREATE INDEX "EventExecution_executionId_idx" ON "EventExecution"("executionId");

-- CreateIndex
CREATE INDEX "EventExecution_eventId_idx" ON "EventExecution"("eventId");

-- CreateIndex
CREATE INDEX "EventExecution_status_idx" ON "EventExecution"("status");

-- CreateIndex
CREATE INDEX "RuleMetrics_ruleId_idx" ON "RuleMetrics"("ruleId");

-- CreateIndex
CREATE INDEX "RuleMetrics_date_idx" ON "RuleMetrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RuleMetrics_ruleId_date_hour_key" ON "RuleMetrics"("ruleId", "date", "hour");

-- CreateIndex
CREATE INDEX "SystemMetrics_timestamp_idx" ON "SystemMetrics"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "AutomationRule_isEnabled_priority_idx" ON "AutomationRule"("isEnabled", "priority");

-- CreateIndex
CREATE INDEX "AutomationRule_templateId_idx" ON "AutomationRule"("templateId");

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_idx" ON "AutomationRule"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationRule_category_idx" ON "AutomationRule"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ComposeProject_hostId_project_workingDir_key" ON "ComposeProject"("hostId", "project", "workingDir");

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_composeProjectId_fkey" FOREIGN KEY ("composeProjectId") REFERENCES "ComposeProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RuleTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_parentRuleId_fkey" FOREIGN KEY ("parentRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleTrigger" ADD CONSTRAINT "RuleTrigger_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleTrigger" ADD CONSTRAINT "RuleTrigger_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "PluginMetadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerTemplate" ADD CONSTRAINT "TriggerTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvent" ADD CONSTRAINT "RuleEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvent" ADD CONSTRAINT "RuleEvent_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "PluginMetadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTemplate" ADD CONSTRAINT "EventTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleNotification" ADD CONSTRAINT "RuleNotification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleNotification" ADD CONSTRAINT "RuleNotification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "RuleNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginInstallation" ADD CONSTRAINT "PluginInstallation_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "PluginMetadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginInstallation" ADD CONSTRAINT "PluginInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleDependency" ADD CONSTRAINT "RuleDependency_dependentRuleId_fkey" FOREIGN KEY ("dependentRuleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleDependency" ADD CONSTRAINT "RuleDependency_requiredRuleId_fkey" FOREIGN KEY ("requiredRuleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_operationLogId_fkey" FOREIGN KEY ("operationLogId") REFERENCES "OperationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerExecution" ADD CONSTRAINT "TriggerExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "RuleExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerExecution" ADD CONSTRAINT "TriggerExecution_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "RuleTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventExecution" ADD CONSTRAINT "EventExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "RuleExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventExecution" ADD CONSTRAINT "EventExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RuleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleMetrics" ADD CONSTRAINT "RuleMetrics_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
