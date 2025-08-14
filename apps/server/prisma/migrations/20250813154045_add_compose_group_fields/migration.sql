-- AlterTable
ALTER TABLE "Container" ADD COLUMN     "composeFolderName" TEXT,
ADD COLUMN     "composeGroupKey" TEXT;

-- CreateIndex
CREATE INDEX "Container_hostId_composeGroupKey_idx" ON "Container"("hostId", "composeGroupKey");
