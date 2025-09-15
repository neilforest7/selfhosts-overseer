-- CreateEnum
CREATE TYPE "HostRole" AS ENUM ('local', 'remote');

-- CreateEnum
CREATE TYPE "SshAuthMethod" AS ENUM ('password', 'privateKey');

-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImageUpdateStatus" AS ENUM ('UNKNOWN', 'UP_TO_DATE', 'CONTAINER_OUTDATED', 'IMAGE_OUTDATED', 'BOTH_OUTDATED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'CRON', 'WEBHOOK', 'EVENT', 'SCHEDULE');

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
CREATE TYPE "ActivityCategory" AS ENUM ('HOST_MANAGEMENT', 'CONTAINER_LIFECYCLE', 'CONTAINER_UPDATE', 'COMPOSE_OPERATION', 'FRP_CONFIGURATION', 'REVERSE_PROXY', 'DNS_RESOLUTION', 'SYSTEM_OPERATION', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA');

-- CreateEnum
CREATE TYPE "DnsStatus" AS ENUM ('UNKNOWN', 'RESOLVED', 'FAILED', 'TIMEOUT', 'NO_RECORD');

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AuthSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "sshUser" TEXT NOT NULL,
    "port" INTEGER,
    "tags" TEXT[],
    "sshOptions" JSONB,
    "sshAuthMethod" "SshAuthMethod" NOT NULL DEFAULT 'password',
    "sshPassword" TEXT,
    "sshPrivateKey" TEXT,
    "sshPrivateKeyPassphrase" TEXT,
    "role" "HostRole" NOT NULL DEFAULT 'local',
    "status" "HostStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastOnlineAt" TIMESTAMP(3),
    "lastOfflineAt" TIMESTAMP(3),
    "lastConnectivityCheck" TIMESTAMP(3),
    "dockerPlatformArch" TEXT,
    "dockerPlatformOS" TEXT,
    "dockerPlatformDetected" BOOLEAN NOT NULL DEFAULT false,
    "dockerLoginStatus" BOOLEAN NOT NULL DEFAULT false,
    "dockerLoginExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "source" TEXT,
    "hostId" TEXT,
    "hostLabel" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "status" TEXT,
    "restartCount" INTEGER,
    "imageName" TEXT,
    "imageTag" TEXT,
    "containerImageDigest" TEXT,
    "containerImageId" TEXT,
    "containerImageCreated" TIMESTAMP(3),
    "localImageDigest" TEXT,
    "localImageId" TEXT,
    "localImageCreated" TIMESTAMP(3),
    "repoDigest" TEXT,
    "remoteDigest" TEXT,
    "imageUpdateStatus" "ImageUpdateStatus" NOT NULL DEFAULT 'UNKNOWN',
    "updateAvailable" BOOLEAN NOT NULL DEFAULT false,
    "updateCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "isComposeManaged" BOOLEAN NOT NULL DEFAULT false,
    "composeProject" TEXT,
    "composeService" TEXT,
    "composeWorkingDir" TEXT,
    "composeGroupKey" TEXT,
    "composeFolderName" TEXT,
    "composeConfigFiles" JSONB,
    "composeProjectId" TEXT,
    "runCommand" TEXT,
    "ports" JSONB,
    "mounts" JSONB,
    "networks" JSONB,
    "labels" JSONB,
    "manualPortMapping" JSONB,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReverseProxyRoute" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "forwardHost" TEXT,
    "forwardPort" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "certificateId" TEXT,
    "certExpiresAt" TIMESTAMP(3),
    "sslForced" BOOLEAN NOT NULL DEFAULT false,
    "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hstsSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "http2Support" BOOLEAN NOT NULL DEFAULT false,
    "allowWebsocketUpgrade" BOOLEAN NOT NULL DEFAULT false,
    "blockExploits" BOOLEAN NOT NULL DEFAULT false,
    "cachingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ReverseProxyRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cn" TEXT NOT NULL,
    "sans" TEXT[],
    "issuer" TEXT,
    "notBefore" TIMESTAMP(3),
    "notAfter" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostNpmConfig" (
    "hostId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dbType" TEXT NOT NULL DEFAULT 'sqlite',
    "connectionMode" TEXT NOT NULL DEFAULT 'container-local',
    "containerName" TEXT,
    "sqlitePath" TEXT DEFAULT '/data/database.sqlite',
    "mysqlUseContainerEnv" BOOLEAN DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostNpmConfig_pkey" PRIMARY KEY ("hostId")
);

-- CreateTable
CREATE TABLE "ComposeProject" (
    "id" TEXT NOT NULL,
    "hostId" TEXT,
    "project" TEXT NOT NULL,
    "workingDir" TEXT NOT NULL,
    "configFiles" TEXT[],
    "effectiveConfigHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ComposeProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrpsConfig" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "bindPort" INTEGER,
    "vhostHttpPort" INTEGER,
    "vhostHttpsPort" INTEGER,
    "subdomainHost" TEXT,
    "rawConfig" JSONB,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FrpsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrpcProxy" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "frpsConfigId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "localIp" TEXT NOT NULL,
    "localPort" INTEGER NOT NULL,
    "remotePort" INTEGER NOT NULL,
    "subdomain" TEXT,
    "customDomains" TEXT[],
    "rawConfig" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "pendingServerAddr" TEXT,
    "pendingServerPort" INTEGER,
    "lastLinkAttempt" TIMESTAMP(3),
    "linkErrorMessage" TEXT,

    CONSTRAINT "FrpcProxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "triggerType" "TriggerType" NOT NULL DEFAULT 'MANUAL',
    "triggerContext" JSONB,
    "context" JSONB,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "automationRuleId" TEXT,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "parentRuleId" TEXT,
    "tags" TEXT[],
    "category" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastExecutedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "ActivityCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "hostId" TEXT,
    "hostName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "oldValues" JSONB,
    "newValues" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostConnectivityCheck" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "HostStatus" NOT NULL,
    "responseTime" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostConnectivityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "apiConfig" JSONB NOT NULL,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsRecord" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "recordType" "DnsRecordType" NOT NULL DEFAULT 'A',
    "providerId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInterval" INTEGER NOT NULL DEFAULT 300,
    "currentIp" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastChangeAt" TIMESTAMP(3),
    "status" "DnsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "errorMessage" TEXT,
    "cloudflareRecordId" TEXT,
    "cloudflareZoneId" TEXT,
    "cloudflareZoneName" TEXT,
    "ttl" INTEGER,
    "proxied" BOOLEAN,
    "content" TEXT,
    "priority" INTEGER,
    "comment" TEXT,
    "isDiscovered" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "providerCreatedAt" TIMESTAMP(3),
    "providerModifiedAt" TIMESTAMP(3),
    "description" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsResolution" (
    "id" TEXT NOT NULL,
    "dnsRecordId" TEXT NOT NULL,
    "resolvedIp" TEXT,
    "responseTime" INTEGER,
    "status" "DnsStatus" NOT NULL,
    "errorMessage" TEXT,
    "geoLocation" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DnsResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "SystemLog_category_ts_idx" ON "SystemLog"("category", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_hostId_ts_idx" ON "SystemLog"("hostId", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_source_ts_idx" ON "SystemLog"("source", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_ts_idx" ON "SystemLog"("ts");

-- CreateIndex
CREATE INDEX "Container_hostId_composeGroupKey_idx" ON "Container"("hostId", "composeGroupKey");

-- CreateIndex
CREATE INDEX "Container_imageUpdateStatus_idx" ON "Container"("imageUpdateStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Container_hostId_containerId_key" ON "Container"("hostId", "containerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReverseProxyRoute_hostId_domain_key" ON "ReverseProxyRoute"("hostId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "ComposeProject_hostId_project_workingDir_key" ON "ComposeProject"("hostId", "project", "workingDir");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_name_key" ON "AutomationRule"("name");

-- CreateIndex
CREATE INDEX "AutomationRule_isEnabled_priority_idx" ON "AutomationRule"("isEnabled", "priority");

-- CreateIndex
CREATE INDEX "AutomationRule_templateId_idx" ON "AutomationRule"("templateId");

-- CreateIndex
CREATE INDEX "AutomationRule_category_idx" ON "AutomationRule"("category");

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
CREATE UNIQUE INDEX "PluginInstallation_pluginId_key" ON "PluginInstallation"("pluginId");

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
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_category_timestamp_idx" ON "ActivityLog"("category", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_hostId_timestamp_idx" ON "ActivityLog"("hostId", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_resourceType_timestamp_idx" ON "ActivityLog"("resourceType", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_resourceType_resourceId_idx" ON "ActivityLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "HostConnectivityCheck_hostId_checkedAt_idx" ON "HostConnectivityCheck"("hostId", "checkedAt");

-- CreateIndex
CREATE INDEX "HostConnectivityCheck_status_checkedAt_idx" ON "HostConnectivityCheck"("status", "checkedAt");

-- CreateIndex
CREATE INDEX "HostConnectivityCheck_checkedAt_idx" ON "HostConnectivityCheck"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DnsProvider_name_key" ON "DnsProvider"("name");

-- CreateIndex
CREATE INDEX "DnsProvider_isEnabled_idx" ON "DnsProvider"("isEnabled");

-- CreateIndex
CREATE INDEX "DnsRecord_isEnabled_status_idx" ON "DnsRecord"("isEnabled", "status");

-- CreateIndex
CREATE INDEX "DnsRecord_domain_idx" ON "DnsRecord"("domain");

-- CreateIndex
CREATE INDEX "DnsRecord_providerId_idx" ON "DnsRecord"("providerId");

-- CreateIndex
CREATE INDEX "DnsRecord_cloudflareRecordId_idx" ON "DnsRecord"("cloudflareRecordId");

-- CreateIndex
CREATE INDEX "DnsRecord_cloudflareZoneId_idx" ON "DnsRecord"("cloudflareZoneId");

-- CreateIndex
CREATE INDEX "DnsRecord_isDiscovered_idx" ON "DnsRecord"("isDiscovered");

-- CreateIndex
CREATE UNIQUE INDEX "DnsRecord_domain_providerId_key" ON "DnsRecord"("domain", "providerId");

-- CreateIndex
CREATE INDEX "DnsResolution_dnsRecordId_checkedAt_idx" ON "DnsResolution"("dnsRecordId", "checkedAt");

-- CreateIndex
CREATE INDEX "DnsResolution_checkedAt_idx" ON "DnsResolution"("checkedAt");

-- CreateIndex
CREATE INDEX "DnsResolution_status_checkedAt_idx" ON "DnsResolution"("status", "checkedAt");

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_composeProjectId_fkey" FOREIGN KEY ("composeProjectId") REFERENCES "ComposeProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrpcProxy" ADD CONSTRAINT "FrpcProxy_frpsConfigId_fkey" FOREIGN KEY ("frpsConfigId") REFERENCES "FrpsConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_operationLogId_fkey" FOREIGN KEY ("operationLogId") REFERENCES "OperationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RuleTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_parentRuleId_fkey" FOREIGN KEY ("parentRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostConnectivityCheck" ADD CONSTRAINT "HostConnectivityCheck_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecord" ADD CONSTRAINT "DnsRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "DnsProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsResolution" ADD CONSTRAINT "DnsResolution_dnsRecordId_fkey" FOREIGN KEY ("dnsRecordId") REFERENCES "DnsRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

