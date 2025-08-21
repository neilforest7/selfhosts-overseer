-- CreateEnum
CREATE TYPE "HostRole" AS ENUM ('local', 'remote');

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "role" "HostRole" NOT NULL DEFAULT 'local';
