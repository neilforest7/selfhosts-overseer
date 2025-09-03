-- CreateEnum
CREATE TYPE "DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS');

-- CreateEnum
CREATE TYPE "DnsStatus" AS ENUM ('UNKNOWN', 'RESOLVED', 'FAILED', 'TIMEOUT', 'NO_RECORD');

-- AlterEnum
ALTER TYPE "ActivityCategory" ADD VALUE 'DNS_RESOLUTION';

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
ALTER TABLE "DnsRecord" ADD CONSTRAINT "DnsRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "DnsProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsResolution" ADD CONSTRAINT "DnsResolution_dnsRecordId_fkey" FOREIGN KEY ("dnsRecordId") REFERENCES "DnsRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
