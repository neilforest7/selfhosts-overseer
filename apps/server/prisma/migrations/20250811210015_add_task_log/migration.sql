-- CreateTable
CREATE TABLE "TaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stream" TEXT NOT NULL,
    "hostLabel" TEXT,
    "content" TEXT NOT NULL,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskLog_taskId_ts_idx" ON "TaskLog"("taskId", "ts");

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
