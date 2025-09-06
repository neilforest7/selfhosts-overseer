-- CreateEnum
CREATE TYPE "ImageUpdateStatus" AS ENUM ('UNKNOWN', 'UP_TO_DATE', 'CONTAINER_OUTDATED', 'IMAGE_OUTDATED', 'BOTH_OUTDATED');

-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "containerImageCreated" TIMESTAMP(3),
ADD COLUMN     "containerImageDigest" TEXT,
ADD COLUMN     "containerImageId" TEXT,
ADD COLUMN     "imageUpdateStatus" "ImageUpdateStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "localImageCreated" TIMESTAMP(3),
ADD COLUMN     "localImageDigest" TEXT,
ADD COLUMN     "localImageId" TEXT;

-- CreateIndex
CREATE INDEX "Container_imageUpdateStatus_idx" ON "Container"("imageUpdateStatus");
