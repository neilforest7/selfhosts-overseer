# FRP Two-Phase Sync Migration Guide

## Overview

This guide provides step-by-step instructions for migrating from the original FRP sync system to the new Two-Phase Sync System. The migration ensures that existing FRP relationships are preserved and enhanced with the new order-independent discovery capabilities.

## Pre-Migration Checklist

### System Requirements
- [ ] Database backup completed
- [ ] System is running the latest version with migration support
- [ ] All hosts are accessible via SSH
- [ ] No active container discovery operations running

### Verification Steps
- [ ] Check current FRP topology health
- [ ] Document existing FRPS/FRPC relationships
- [ ] Verify all FRP containers are running
- [ ] Confirm SSH connectivity to all hosts

## Migration Process

### Step 1: Backup Current State

#### Database Backup
```bash
# Create a full database backup
pg_dump -h localhost -U postgres -d selfhost_serv_agent > backup_pre_frp_migration.sql

# Or using Docker
docker exec postgres_container pg_dump -U postgres selfhost_serv_agent > backup_pre_frp_migration.sql
```

#### Export Current FRP Configuration
```bash
# Get current FRP configurations for reference
curl -X GET /api/v1/frp/configs > frp_configs_backup.json
```

### Step 2: Apply Database Schema Changes

The database migration should be applied automatically when starting the updated server. If manual application is needed:

```bash
# Navigate to server directory
cd apps/server

# Apply Prisma migration
npx prisma migrate deploy

# Verify migration was applied
npx prisma migrate status
```

**Expected Schema Changes**:
- `FrpcProxy.syncStatus` field added (default: 'pending')
- `FrpcProxy.pendingServerAddr` field added
- `FrpcProxy.pendingServerPort` field added
- `FrpcProxy.lastLinkAttempt` field added
- `FrpcProxy.linkErrorMessage` field added
- `FrpcProxy.frpsConfigId` made nullable

### Step 3: Run Pre-Migration Validation

```bash
# Validate current FRP topology
npm run validate:frp-topology
```

**Expected Output**:
```
FRP TOPOLOGY VALIDATION REPORT
==============================
SUMMARY:
  Total FRPS Configs: 3
  Total FRPC Proxies: 8
  Healthy Proxies: 6
  Unhealthy Proxies: 2
  Health Percentage: 75%

ISSUES:
  1. ❌ [Broken References] 2 FRPC proxies reference non-existent FRPS configs
     - web-proxy -> frps-config-missing-1
     - ssh-proxy -> frps-config-missing-2

RECOMMENDATIONS:
  1. Run the FRP relationship migration script to fix broken relationships
  2. Use: npm run migrate:frp-relationships:dry-run (to preview changes)
  3. Then: npm run migrate:frp-relationships (to apply fixes)
```

### Step 4: Run Migration Script (Dry Run)

```bash
# Preview migration changes without applying them
npm run migrate:frp-relationships:dry-run
```

**Expected Output**:
```
FRP RELATIONSHIP MIGRATION REPORT (DRY RUN)
============================================
Total FRPC Proxies: 8
Already Linked: 6
Orphaned Proxies: 2
Successfully Linked: 2
Failed to Link: 0

✓ Linked proxy web-proxy to FRPS config frps-config-1
✓ Linked proxy ssh-proxy to FRPS config frps-config-1

Success Rate: 100%
============================================

Dry run completed. Use without --dry-run to apply changes.
```

### Step 5: Apply Migration

```bash
# Apply the migration fixes
npm run migrate:frp-relationships
```

**Expected Output**:
```
FRP RELATIONSHIP MIGRATION REPORT
==================================
Total FRPC Proxies: 8
Already Linked: 6
Orphaned Proxies: 2
Successfully Linked: 2
Failed to Link: 0

✓ Linked proxy web-proxy to FRPS config frps-config-1
✓ Linked proxy ssh-proxy to FRPS config frps-config-1

Success Rate: 100%
==================================

Migration completed successfully!
```

### Step 6: Validate Post-Migration State

```bash
# Validate the migrated topology
npm run validate:frp-topology
```

**Expected Output**:
```
FRP TOPOLOGY VALIDATION REPORT
==============================
SUMMARY:
  Total FRPS Configs: 3
  Total FRPC Proxies: 8
  Healthy Proxies: 8
  Unhealthy Proxies: 0
  Health Percentage: 100%

ISSUES:
  1. ℹ️ [Health Status] All FRPC proxies are properly linked to FRPS configs

RECOMMENDATIONS:
  1. FRP topology is healthy - no action required
  2. Consider setting up monitoring for ongoing health checks
```

### Step 7: Test Discovery Order Independence

```bash
# Run discovery order tests to verify the new system
npm run test:frp-discovery-order
```

**Expected Output**:
```
FRP DISCOVERY ORDER TEST SUMMARY
=================================
Total Tests: 5
Passed: 5
Failed: 0
Success Rate: 100%

Detailed Results:
  ✅ normal-order: 2 linked, 0 pending, 0 failed (1250ms)
  ✅ reverse-order: 2 linked, 0 pending, 0 failed (1180ms)
  ✅ mixed-order-1: 2 linked, 0 pending, 0 failed (1220ms)
  ✅ mixed-order-2: 2 linked, 0 pending, 0 failed (1190ms)
  ✅ random-order: 2 linked, 0 pending, 0 failed (1210ms)
=================================

✅ All FRP discovery order tests passed!
```

## Post-Migration Verification

### Health Check API

```bash
# Check FRP health via API
curl -X GET /api/v1/frp/health
```

**Expected Response**:
```json
{
  "totalFrpcProxies": 8,
  "linkedProxies": 8,
  "pendingProxies": 0,
  "failedProxies": 0,
  "orphanedProxies": 0,
  "issues": [],
  "isHealthy": true
}
```

### Metrics Verification

```bash
# Get comprehensive metrics
curl -X GET /api/v1/frp/metrics
```

**Expected Response**:
```json
{
  "overview": {
    "totalFrpsConfigs": 3,
    "totalFrpcProxies": 8,
    "healthyProxies": 8,
    "unhealthyProxies": 0,
    "healthPercentage": 100
  },
  "syncStatus": {
    "linked": 8,
    "pending": 0,
    "failed": 0
  },
  "performance": {
    "successRate": 100,
    "stalePendingCount": 0
  }
}
```

### Container Discovery Test

```bash
# Test container discovery to ensure it works with new system
curl -X POST /api/v1/containers/discover
```

Verify that:
- All hosts are discovered successfully
- FRP relationships are maintained
- No dependency errors occur

## Troubleshooting

### Common Issues

#### Issue 1: Migration Script Fails

**Symptoms**:
```
❌ Failed to link proxy web-proxy: FRPS host not found: 192.168.1.100
```

**Solution**:
1. Verify the host exists in the database
2. Check the host address matches the FRPC configuration
3. Ensure SSH connectivity to the host

```bash
# Check if host exists
curl -X GET /api/v1/hosts | grep "192.168.1.100"

# Test SSH connectivity
ssh root@192.168.1.100 "echo 'Connection test'"
```

#### Issue 2: Orphaned Proxies After Migration

**Symptoms**:
```
⚠️ [Orphaned Proxies] 2 FRPC proxies have no FRPS config reference
```

**Solution**:
1. Check if FRPS containers are running
2. Verify FRPS configuration files are accessible
3. Re-run container discovery for FRPS hosts

```bash
# Re-discover FRPS host
curl -X POST /api/v1/frp/sync/frps-host-id

# Resolve dependencies
curl -X POST /api/v1/frp/resolve-dependencies
```

#### Issue 3: Stale Pending Proxies

**Symptoms**:
```
⚠️ [Stale Pending] 1 FRPC proxies have been pending for over 1 hour
```

**Solution**:
1. Run healing to retry failed connections
2. Check for configuration issues

```bash
# Trigger healing
curl -X POST /api/v1/frp/heal

# Check logs for details
curl -X GET "/api/v1/frp/logs?limit=20"
```

### Recovery Procedures

#### Full System Recovery

If migration fails completely:

1. **Restore Database Backup**:
```bash
# Stop the application
docker-compose down

# Restore database
psql -h localhost -U postgres -d selfhost_serv_agent < backup_pre_frp_migration.sql

# Restart application
docker-compose up -d
```

2. **Re-run Migration**:
```bash
# Apply schema migration again
npx prisma migrate deploy

# Run migration script
npm run migrate:frp-relationships
```

#### Partial Recovery

If some proxies fail to migrate:

1. **Manual Linking**:
```bash
# Get failed proxy details
npm run validate:frp-topology

# Manually resolve dependencies
curl -X POST /api/v1/frp/resolve-dependencies

# Heal broken relationships
curl -X POST /api/v1/frp/heal
```

## Monitoring and Maintenance

### Ongoing Health Monitoring

Set up regular health checks:

```bash
# Add to cron job (every 15 minutes)
*/15 * * * * curl -s /api/v1/frp/health | jq '.isHealthy' | grep -q true || echo "FRP health issue detected"
```

### Periodic Validation

Run validation monthly:

```bash
# Monthly validation
0 0 1 * * /path/to/npm run validate:frp-topology
```

### Automatic Healing

Set up automatic healing for failed proxies:

```bash
# Daily healing (if needed)
0 2 * * * curl -s -X POST /api/v1/frp/heal
```

## Rollback Plan

If the new system causes issues:

### Immediate Rollback

1. **Restore Database**:
```bash
psql -h localhost -U postgres -d selfhost_serv_agent < backup_pre_frp_migration.sql
```

2. **Deploy Previous Version**:
```bash
git checkout previous-stable-tag
docker-compose up -d --build
```

### Gradual Rollback

1. **Disable New Features**:
   - Stop using dependency resolution endpoints
   - Revert to individual host sync only

2. **Monitor System**:
   - Check for discovery order issues
   - Document any problems for future migration attempts

## Success Criteria

Migration is considered successful when:

- [ ] All existing FRP relationships are preserved
- [ ] FRP topology health is 100%
- [ ] Discovery order tests pass
- [ ] Container discovery works normally
- [ ] No broken references exist
- [ ] All API endpoints respond correctly

## Support

If you encounter issues during migration:

1. **Check Logs**: Review FRP sync logs for detailed error information
2. **Run Validation**: Use validation script to identify specific issues
3. **Use Healing**: Try automatic healing before manual intervention
4. **Documentation**: Refer to troubleshooting guide for common solutions

For additional support, provide:
- Migration script output
- Validation report
- System logs
- Current FRP configuration export
