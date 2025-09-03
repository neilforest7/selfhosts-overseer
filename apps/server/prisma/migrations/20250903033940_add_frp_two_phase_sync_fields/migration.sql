-- AlterTable
ALTER TABLE "FrpcProxy" ADD COLUMN     "lastLinkAttempt" TIMESTAMP(3),
ADD COLUMN     "linkErrorMessage" TEXT,
ADD COLUMN     "pendingServerAddr" TEXT,
ADD COLUMN     "pendingServerPort" INTEGER,
ADD COLUMN     "syncStatus" TEXT NOT NULL DEFAULT 'pending',
ALTER COLUMN "frpsConfigId" DROP NOT NULL;
