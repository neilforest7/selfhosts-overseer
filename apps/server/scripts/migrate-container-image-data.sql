-- 数据迁移脚本：为现有容器填充新的镜像跟踪字段
-- 执行方式：psql -d selfhost -f migrate-container-image-data.sql

BEGIN;

-- 1. 将现有的 repoDigest 复制到 localImageDigest（如果 repoDigest 存在且 localImageDigest 为空）
UPDATE "Container" 
SET "localImageDigest" = "repoDigest"
WHERE "repoDigest" IS NOT NULL 
  AND "localImageDigest" IS NULL;

-- 2. 统计更新结果
SELECT 
  'Migration Summary' as info,
  COUNT(*) as total_containers,
  COUNT("localImageDigest") as containers_with_local_digest,
  COUNT("containerImageDigest") as containers_with_container_digest,
  COUNT("remoteDigest") as containers_with_remote_digest
FROM "Container";

-- 3. 按更新状态统计
SELECT 
  "imageUpdateStatus",
  COUNT(*) as count
FROM "Container"
GROUP BY "imageUpdateStatus"
ORDER BY count DESC;

-- 4. 显示需要进一步处理的容器统计
SELECT 
  'Containers needing attention' as info,
  COUNT(*) as containers_without_image_info
FROM "Container"
WHERE "imageName" IS NULL OR "imageTag" IS NULL;

-- 5. 显示迁移前后对比
SELECT 
  'Field population status' as info,
  COUNT(CASE WHEN "repoDigest" IS NOT NULL THEN 1 END) as repo_digest_count,
  COUNT(CASE WHEN "localImageDigest" IS NOT NULL THEN 1 END) as local_digest_count,
  COUNT(CASE WHEN "containerImageDigest" IS NOT NULL THEN 1 END) as container_digest_count,
  COUNT(CASE WHEN "remoteDigest" IS NOT NULL THEN 1 END) as remote_digest_count
FROM "Container";

COMMIT;

-- 输出迁移完成信息
\echo '数据迁移完成！'
\echo '建议接下来执行以下操作：'
\echo '1. 运行容器发现以填充 containerImageDigest 等字段'
\echo '2. 运行容器更新检查以更新 imageUpdateStatus'
