-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HostRole" AS ENUM ('local', 'remote');

-- CreateEnum
CREATE TYPE "SshAuthMethod" AS ENUM ('password', 'privateKey');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('CRON', 'WEBHOOK', 'EVENT', 'HOST_OFFLINE', 'CONTAINER_OFFLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('EXEC_COMMAND', 'DISCOVER_CONTAINERS', 'CHECK_HOST_HEALTH', 'SYNC_FRP', 'SYNC_REVERSE_PROXY');

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "sshUser" TEXT NOT NULL,
    "port" INTEGER,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sshAuthMethod" "SshAuthMethod" NOT NULL DEFAULT 'password',
    "sshOptions" JSONB,
    "sshPassword" TEXT,
    "sshPrivateKey" TEXT,
    "sshPrivateKeyPassphrase" TEXT,
    "role" "HostRole" NOT NULL DEFAULT 'local',
    "status" "HostStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),

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
    "imageName" TEXT,
    "imageTag" TEXT,
    "repoDigest" TEXT,
    "remoteDigest" TEXT,
    "updateAvailable" BOOLEAN NOT NULL DEFAULT false,
    "updateCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "isComposeManaged" BOOLEAN NOT NULL DEFAULT false,
    "composeProject" TEXT,
    "composeService" TEXT,
    "runCommand" TEXT,
    "ports" JSONB,
    "mounts" JSONB,
    "networks" JSONB,
    "labels" JSONB,
    "composeConfigFiles" JSONB,
    "composeWorkingDir" TEXT,
    "restartCount" INTEGER,
    "composeFolderName" TEXT,
    "composeGroupKey" TEXT,
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
    "lastSyncedAt" TIMESTAMP(3),
    "sslForced" BOOLEAN NOT NULL DEFAULT false,
    "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hstsSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "http2Support" BOOLEAN NOT NULL DEFAULT false,
    "allowWebsocketUpgrade" BOOLEAN NOT NULL DEFAULT false,
    "blockExploits" BOOLEAN NOT NULL DEFAULT false,
    "cachingEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReverseProxyRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cn" TEXT NOT NULL,
    "issuer" TEXT,
    "notBefore" TIMESTAMP(3),
    "notAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "sans" TEXT[],

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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mysqlUseContainerEnv" BOOLEAN DEFAULT false,

    CONSTRAINT "HostNpmConfig_pkey" PRIMARY KEY ("hostId")
);

-- CreateTable
CREATE TABLE "ComposeProject" (
    "id" TEXT NOT NULL,
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
    "frpsConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "localIp" TEXT NOT NULL,
    "localPort" INTEGER NOT NULL,
    "remotePort" INTEGER NOT NULL,
    "subdomain" TEXT,
    "customDomains" TEXT[],
    "rawConfig" JSONB,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "FrpcProxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "context" JSONB,
    "triggerContext" JSONB,
    "triggerType" "TriggerType" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
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
    "triggerType" "TriggerType" NOT NULL,
    "triggerConfig" JSONB,
    "actionType" "ActionType" NOT NULL,
    "actionPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "Container_hostId_containerId_key" ON "Container"("hostId", "containerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReverseProxyRoute_hostId_domain_key" ON "ReverseProxyRoute"("hostId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_name_key" ON "AutomationRule"("name");

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrpcProxy" ADD CONSTRAINT "FrpcProxy_frpsConfigId_fkey" FOREIGN KEY ("frpsConfigId") REFERENCES "FrpsConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLogEntry" ADD CONSTRAINT "OperationLogEntry_operationLogId_fkey" FOREIGN KEY ("operationLogId") REFERENCES "OperationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

