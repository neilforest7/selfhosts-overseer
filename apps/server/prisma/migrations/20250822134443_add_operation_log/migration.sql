-- CreateEnum
CREATE TYPE "OpStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "ExecType" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "OpStatus" NOT NULL DEFAULT 'RUNNING',
    "executionType" "ExecType" NOT NULL DEFAULT 'MANUAL',
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "logs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);
