-- CreateEnum
CREATE TYPE "SshAuthMethod" AS ENUM ('password', 'privateKey');

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "sans" TEXT[];

-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "composeConfigFiles" JSONB,
ADD COLUMN     "composeWorkingDir" TEXT,
ADD COLUMN     "restartCount" INTEGER;

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "sshAuthMethod" "SshAuthMethod" NOT NULL DEFAULT 'password',
ADD COLUMN     "sshOptions" JSONB,
ADD COLUMN     "sshPassword" TEXT,
ADD COLUMN     "sshPrivateKey" TEXT,
ADD COLUMN     "sshPrivateKeyPassphrase" TEXT;

-- AlterTable
ALTER TABLE "HostNpmConfig" ADD COLUMN     "mysqlUseContainerEnv" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "ReverseProxyRoute" ADD COLUMN     "vpsName" TEXT;

-- AlterTable
ALTER TABLE "TaskRun" ADD COLUMN     "stderrRef" TEXT,
ADD COLUMN     "stdoutRef" TEXT;

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
