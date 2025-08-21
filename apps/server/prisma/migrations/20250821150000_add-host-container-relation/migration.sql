-- AlterTable
ALTER TABLE "Container" DROP COLUMN "containerCreatedAt",
DROP COLUMN "imageVersionTag",
ALTER COLUMN "updateAvailable" SET NOT NULL;

-- AlterTable
ALTER TABLE "ReverseProxyRoute" DROP COLUMN "rawAdvancedConfig",
DROP COLUMN "vpsName";

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

