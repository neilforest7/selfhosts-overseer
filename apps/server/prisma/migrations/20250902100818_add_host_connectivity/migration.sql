-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('HOST_MANAGEMENT', 'CONTAINER_LIFECYCLE', 'CONTAINER_UPDATE', 'COMPOSE_OPERATION', 'FRP_CONFIGURATION', 'REVERSE_PROXY', 'SYSTEM_OPERATION', 'AUTOMATION');

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "lastConnectivityCheck" TIMESTAMP(3),
ADD COLUMN     "lastOfflineAt" TIMESTAMP(3),
ADD COLUMN     "lastOnlineAt" TIMESTAMP(3),
ADD COLUMN     "status" "HostStatus" NOT NULL DEFAULT 'UNKNOWN';

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

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostConnectivityCheck" ADD CONSTRAINT "HostConnectivityCheck_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
