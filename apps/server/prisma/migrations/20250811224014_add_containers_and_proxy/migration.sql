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
    "rawAdvancedConfig" TEXT,
    "lastSyncedAt" TIMESTAMP(3),

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

    CONSTRAINT "HostNpmConfig_pkey" PRIMARY KEY ("hostId")
);
