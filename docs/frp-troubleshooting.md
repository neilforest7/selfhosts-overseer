# FRP Two-Phase Sync Troubleshooting Guide

## Overview

This guide provides solutions for common issues encountered with the FRP Two-Phase Sync System. It covers diagnosis, resolution, and prevention strategies for various FRP-related problems.

## Quick Diagnosis

### Health Check Commands

```bash
# Quick health check
curl -X GET /api/v1/frp/health

# Detailed validation
npm run validate:frp-topology

# View recent logs
curl -X GET "/api/v1/frp/logs?limit=10"

# Get comprehensive metrics
curl -X GET /api/v1/frp/metrics
```

### Common Status Indicators

| Health % | Status | Action Required |
|----------|--------|-----------------|
| 100% | ✅ Healthy | None |
| 80-99% | ⚠️ Minor Issues | Monitor, consider healing |
| 50-79% | ⚠️ Moderate Issues | Investigate and fix |
| <50% | ❌ Critical Issues | Immediate attention required |

## Common Issues and Solutions

### 1. Orphaned FRPC Proxies

**Symptoms**:
- FRPC proxies with `frpsConfigId: null`
- Health check shows orphaned proxies
- Topology validation reports missing references

**Diagnosis**:
```bash
# Check for orphaned proxies
npm run validate:frp-topology | grep -i orphaned

# Get detailed proxy status
curl -X GET /api/v1/frp/configs | jq '.frpcProxies[] | select(.frpsConfigId == null)'
```

**Root Causes**:
1. FRPS container not discovered yet
2. FRPS configuration file missing or corrupted
3. Network connectivity issues during discovery
4. Host address mismatch between FRPC and FRPS

**Solutions**:

**Option 1: Automatic Resolution**
```bash
# Trigger dependency resolution
curl -X POST /api/v1/frp/resolve-dependencies

# Wait a few seconds, then check status
curl -X GET /api/v1/frp/health
```

**Option 2: Manual Investigation**
```bash
# Check if FRPS host exists
curl -X GET /api/v1/hosts | grep "server_address_from_frpc_config"

# Re-discover FRPS host
curl -X POST /api/v1/frp/sync/frps-host-id

# Resolve dependencies
curl -X POST /api/v1/frp/resolve-dependencies
```

**Option 3: Migration Script**
```bash
# Run migration to fix relationships
npm run migrate:frp-relationships:dry-run
npm run migrate:frp-relationships
```

### 2. Failed FRPC Proxies

**Symptoms**:
- FRPC proxies with `syncStatus: 'failed'`
- Error messages in `linkErrorMessage` field
- Health check shows failed proxies

**Diagnosis**:
```bash
# Check failed proxies
curl -X GET /api/v1/frp/configs | jq '.frpcProxies[] | select(.syncStatus == "failed")'

# Get error details
npm run validate:frp-topology | grep -A 5 "Failed Proxies"
```

**Common Error Messages and Solutions**:

#### "FRPS host not found: 192.168.1.100"
**Cause**: Host with specified address doesn't exist in database

**Solution**:
```bash
# Add missing host
curl -X POST /api/v1/hosts -H "Content-Type: application/json" -d '{
  "name": "FRPS Server",
  "address": "192.168.1.100",
  "sshUser": "root",
  "sshAuthMethod": "privateKey"
}'

# Re-discover the host
curl -X POST /api/v1/containers/discover/new-host-id

# Resolve dependencies
curl -X POST /api/v1/frp/resolve-dependencies
```

#### "FRPS config not found on host with bind_port 7000"
**Cause**: No FRPS configuration with matching bind port

**Solution**:
```bash
# Check FRPS container status
curl -X GET /api/v1/containers?hostId=frps-host-id

# Re-discover FRPS host
curl -X POST /api/v1/frp/sync/frps-host-id

# Check FRPS configuration file
ssh root@frps-host "cat /path/to/frps.ini"
```

#### "Missing server address or port information"
**Cause**: FRPC configuration incomplete or corrupted

**Solution**:
```bash
# Check FRPC configuration file
ssh root@frpc-host "cat /path/to/frpc.ini"

# Verify [common] section has server_addr and server_port
# Re-discover FRPC host after fixing config
curl -X POST /api/v1/frp/sync/frpc-host-id
```

### 3. Stale Pending Proxies

**Symptoms**:
- FRPC proxies stuck in `pending` status for over 1 hour
- `lastLinkAttempt` timestamp is old
- Health check shows stale pending proxies

**Diagnosis**:
```bash
# Check stale pending proxies
curl -X GET /api/v1/frp/metrics | jq '.performance.stalePendingCount'

# Get details
npm run validate:frp-topology | grep -A 5 "Stale Pending"
```

**Solutions**:

**Option 1: Healing**
```bash
# Trigger automatic healing
curl -X POST /api/v1/frp/heal

# Check results
curl -X GET /api/v1/frp/health
```

**Option 2: Manual Resolution**
```bash
# Force dependency resolution
curl -X POST /api/v1/frp/resolve-dependencies

# Check logs for errors
curl -X GET "/api/v1/frp/logs?limit=20"
```

### 4. Discovery Order Issues

**Symptoms**:
- Inconsistent topology after container discovery
- Some proxies linked, others not
- Discovery results vary between runs

**Diagnosis**:
```bash
# Test discovery order independence
npm run test:frp-discovery-order

# Check discovery logs
curl -X GET "/api/v1/frp/logs?limit=50" | grep -i "discovery"
```

**Solutions**:

**Ensure Two-Phase Sync is Working**:
```bash
# Verify individual host sync only does parse phase
curl -X POST /api/v1/frp/sync/host-id

# Manually trigger dependency resolution
curl -X POST /api/v1/frp/resolve-dependencies
```

**Check Container Discovery Integration**:
```bash
# Verify container discovery triggers dependency resolution
curl -X POST /api/v1/containers/discover

# Monitor logs for "FRP dependency resolution" messages
curl -X GET "/api/v1/frp/logs?limit=20" | grep -i "dependency"
```

### 5. Configuration File Issues

**Symptoms**:
- Sync fails with configuration parsing errors
- Empty or missing FRP configurations
- Invalid configuration format

**Diagnosis**:
```bash
# Check sync logs for parsing errors
curl -X GET "/api/v1/frp/logs?limit=20" | grep -i "parse\|config"

# Manually check configuration files
ssh root@host "cat /etc/frp/frps.ini"
ssh root@host "cat /etc/frp/frpc.ini"
```

**Common Configuration Issues**:

#### Missing [common] Section
**Problem**: Configuration file lacks required [common] section

**Solution**:
```ini
# Add to frps.ini
[common]
bind_port = 7000

# Add to frpc.ini
[common]
server_addr = 192.168.1.100
server_port = 7000
```

#### Invalid Port Numbers
**Problem**: Non-numeric or out-of-range port values

**Solution**:
```ini
# Ensure ports are valid numbers
bind_port = 7000          # Not "7000" or 70000
server_port = 7000        # Valid range: 1-65535
```

#### File Permission Issues
**Problem**: Configuration files not readable by SSH user

**Solution**:
```bash
# Fix file permissions
ssh root@host "chmod 644 /etc/frp/*.ini"
ssh root@host "chown root:root /etc/frp/*.ini"
```

### 6. Network Connectivity Issues

**Symptoms**:
- SSH connection failures during sync
- Timeout errors in logs
- Intermittent sync failures

**Diagnosis**:
```bash
# Test SSH connectivity
ssh -o ConnectTimeout=10 root@host "echo 'Connection test'"

# Check host connectivity status
curl -X GET /api/v1/hosts | jq '.[] | select(.status != "ONLINE")'

# Test host connectivity
curl -X POST /api/v1/hosts/host-id/test-connection
```

**Solutions**:

**SSH Key Issues**:
```bash
# Verify SSH key is properly configured
ssh-keygen -l -f /path/to/private/key

# Test key authentication
ssh -i /path/to/private/key root@host "echo 'Key test'"
```

**Network Timeouts**:
```bash
# Increase SSH timeout in host configuration
curl -X PATCH /api/v1/hosts/host-id -H "Content-Type: application/json" -d '{
  "sshOptions": {
    "ConnectTimeout": "30",
    "ServerAliveInterval": "60"
  }
}'
```

**Firewall Issues**:
```bash
# Check if SSH port is accessible
telnet host-address 22

# Verify firewall rules on target host
ssh root@host "iptables -L | grep 22"
```

## Performance Issues

### Slow Discovery

**Symptoms**:
- Container discovery takes longer than expected
- FRP sync operations timeout
- High resource usage during sync

**Solutions**:

**Optimize SSH Connections**:
```bash
# Use SSH connection multiplexing
curl -X PATCH /api/v1/hosts/host-id -H "Content-Type: application/json" -d '{
  "sshOptions": {
    "ControlMaster": "auto",
    "ControlPath": "/tmp/ssh-%r@%h:%p",
    "ControlPersist": "10m"
  }
}'
```

**Reduce Concurrent Operations**:
```bash
# Check current settings
curl -X GET /api/v1/settings | grep -i concurrent

# Reduce if needed
curl -X PUT /api/v1/settings -H "Content-Type: application/json" -d '{
  "maxConcurrentDiscovery": 5
}'
```

### Memory Usage

**Symptoms**:
- High memory usage during FRP operations
- Out of memory errors
- System slowdown

**Solutions**:

**Monitor Resource Usage**:
```bash
# Check system resources
docker stats

# Monitor FRP operation logs
curl -X GET "/api/v1/frp/logs?limit=100" | grep -i "memory\|resource"
```

**Optimize Batch Size**:
```bash
# Process hosts in smaller batches
# Instead of discovering all hosts at once, process them in groups
```

## Prevention Strategies

### Regular Health Monitoring

```bash
# Set up automated health checks
*/15 * * * * curl -s /api/v1/frp/health | jq '.isHealthy' | grep -q true || echo "FRP health issue"

# Weekly validation
0 2 * * 0 npm run validate:frp-topology

# Monthly healing
0 3 1 * * curl -s -X POST /api/v1/frp/heal
```

### Configuration Validation

```bash
# Validate FRP configs before deployment
ssh root@host "frps verify -c /etc/frp/frps.ini"
ssh root@host "frpc verify -c /etc/frp/frpc.ini"
```

### Backup and Recovery

```bash
# Regular configuration backups
ssh root@host "tar -czf /backup/frp-configs-$(date +%Y%m%d).tar.gz /etc/frp/"

# Database backups before major changes
pg_dump selfhost_serv_agent > backup-$(date +%Y%m%d).sql
```

## Emergency Procedures

### Complete FRP Reset

If FRP system is completely broken:

```bash
# 1. Stop all FRP containers
ssh root@host "docker stop $(docker ps -q --filter ancestor=*frp*)"

# 2. Clear FRP database records
curl -X DELETE /api/v1/frp/configs/reset  # If endpoint exists

# 3. Re-discover all hosts
curl -X POST /api/v1/containers/discover

# 4. Resolve dependencies
curl -X POST /api/v1/frp/resolve-dependencies
```

### Rollback to Previous State

```bash
# 1. Restore database backup
psql selfhost_serv_agent < backup-previous.sql

# 2. Restart services
docker-compose restart

# 3. Verify system state
npm run validate:frp-topology
```

## Getting Help

### Information to Collect

When reporting issues, provide:

1. **Health Status**:
```bash
curl -X GET /api/v1/frp/health > frp-health.json
```

2. **Validation Report**:
```bash
npm run validate:frp-topology > frp-validation.txt
```

3. **Recent Logs**:
```bash
curl -X GET "/api/v1/frp/logs?limit=50" > frp-logs.json
```

4. **System Configuration**:
```bash
curl -X GET /api/v1/frp/configs > frp-configs.json
```

5. **Host Information**:
```bash
curl -X GET /api/v1/hosts > hosts.json
```

### Log Analysis

**Key Log Patterns to Look For**:
- `FRP sync failed`: Configuration or connectivity issues
- `FRPS config not found`: Missing or misconfigured FRPS
- `dependency resolution`: Linking phase problems
- `SSH connection`: Network or authentication issues

**Log Levels**:
- `error`: Critical issues requiring immediate attention
- `warn`: Potential problems that may need investigation
- `info`: Normal operation information
- `system`: System-level events and status changes
