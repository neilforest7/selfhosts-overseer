/*
  Warnings:

  - A unique constraint covering the columns `[hostId,containerId]` on the table `Container` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Container_hostId_containerId_key" ON "Container"("hostId", "containerId");
