/*
  Warnings:

  - You are about to drop the column `rawAdvancedConfig` on the `ReverseProxyRoute` table. All the data in the column will be lost.
  - You are about to drop the column `vpsName` on the `ReverseProxyRoute` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "manualPortMapping" JSONB;

-- AlterTable
ALTER TABLE "ReverseProxyRoute" DROP COLUMN "rawAdvancedConfig",
DROP COLUMN "vpsName";

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

-- CreateIndex
CREATE INDEX "SystemLog_category_ts_idx" ON "SystemLog"("category", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_hostId_ts_idx" ON "SystemLog"("hostId", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_source_ts_idx" ON "SystemLog"("source", "ts");

-- CreateIndex
CREATE INDEX "SystemLog_ts_idx" ON "SystemLog"("ts");

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrpcProxy" ADD CONSTRAINT "FrpcProxy_frpsConfigId_fkey" FOREIGN KEY ("frpsConfigId") REFERENCES "FrpsConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
