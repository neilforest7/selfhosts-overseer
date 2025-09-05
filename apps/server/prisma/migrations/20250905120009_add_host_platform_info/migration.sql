-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "dockerLoginExpiry" TIMESTAMP(3),
ADD COLUMN     "dockerLoginStatus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dockerPlatformArch" TEXT,
ADD COLUMN     "dockerPlatformDetected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dockerPlatformOS" TEXT;
