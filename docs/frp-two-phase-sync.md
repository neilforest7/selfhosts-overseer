# FRP Two-Phase Sync System

## Overview

The FRP (Fast Reverse Proxy) Two-Phase Sync System is a robust solution that ensures proper FRP topology generation regardless of host discovery order. This system addresses the critical issue where FRPC (client) discovery would fail if the corresponding FRPS (server) configuration didn't exist yet.

## Problem Statement

### Original Issue
- **Dependency Problem**: FRPC configs require FRPS configs to exist for proper linking
- **Discovery Order Sensitivity**: System would fail if FRPC hosts were discovered before FRPS hosts
- **Broken Relationships**: Inconsistent topology generation based on discovery timing
- **Manual Intervention**: Required manual re-discovery or complex workarounds

### Impact
- Unreliable FRP topology generation
- Failed container discovery operations
- Inconsistent network mapping
- Poor user experience with unpredictable behavior

## Solution: Two-Phase Sync

### Phase 1: Parse Phase
**Objective**: Parse and store all FRP configurations independently

**Process**:
1. **FRPS Discovery**: Parse FRPS configs and store with complete configuration
2. **FRPC Discovery**: Parse FRPC configs and store with `pending` status
3. **Temporary Storage**: Store server address/port in `pendingServerAddr`/`pendingServerPort` fields
4. **No Dependencies**: No attempt to link FRPC to FRPS during this phase

**Database Changes**:
```sql
-- New fields added to FrpcProxy table
ALTER TABLE "FrpcProxy" ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "FrpcProxy" ADD COLUMN "pendingServerAddr" TEXT;
ALTER TABLE "FrpcProxy" ADD COLUMN "pendingServerPort" INTEGER;
ALTER TABLE "FrpcProxy" ADD COLUMN "lastLinkAttempt" TIMESTAMP(3);
ALTER TABLE "FrpcProxy" ADD COLUMN "linkErrorMessage" TEXT;
ALTER TABLE "FrpcProxy" ALTER COLUMN "frpsConfigId" DROP NOT NULL;
```

### Phase 2: Link Phase
**Objective**: Resolve dependencies and establish proper relationships

**Process**:
1. **Dependency Resolution**: Find all FRPC proxies with `pending` status
2. **Host Matching**: Match `pendingServerAddr` to actual host records
3. **Config Linking**: Link FRPC proxies to corresponding FRPS configs
4. **Status Updates**: Update `syncStatus` to `linked` or `failed` based on results
5. **Error Tracking**: Store detailed error messages for failed links

## Implementation Details

### Service Methods

#### `syncFrpFromHost(hostId: string, phase: 'parse' | 'link')`
Main entry point for FRP synchronization with phase control.

**Parse Phase**:
- Discovers FRP containers on the specified host
- Parses configuration files
- Stores FRPS configs immediately
- Stores FRPC proxies with pending status

**Link Phase** (deprecated in favor of global resolution):
- Originally intended for per-host linking
- Now redirects to global dependency resolution

#### `resolveFrpDependencies()`
Global dependency resolution that processes all pending FRPC proxies.

**Algorithm**:
1. Query all FRPC proxies with `syncStatus = 'pending'`
2. For each proxy:
   - Extract server address and port from pending fields
   - Find corresponding host by address
   - Find FRPS config by host and bind port
   - Link proxy to FRPS config or mark as failed
3. Update proxy status and error messages

#### `validateFrpTopology()`
Health check method that analyzes the current FRP topology.

**Returns**:
- Total counts (FRPS configs, FRPC proxies)
- Status breakdown (linked, pending, failed, orphaned)
- Health percentage
- Detailed issue list
- Recommendations for fixes

#### `healFrpRelationships()`
Automatic healing method that retries failed connections.

**Process**:
1. Find all failed FRPC proxies
2. Reset them to pending status
3. Attempt to link them again
4. Clean up orphaned proxies (invalid FRPS references)
5. Return detailed healing statistics

### Sync Status Values

| Status | Description | Next Action |
|--------|-------------|-------------|
| `pending` | Proxy parsed but not linked to FRPS | Dependency resolution |
| `linked` | Successfully linked to FRPS config | None (healthy) |
| `failed` | Failed to link to FRPS config | Healing or manual fix |

### Error Handling

#### Common Error Scenarios
1. **FRPS Host Not Found**: Server address doesn't match any known host
2. **FRPS Config Not Found**: No FRPS config with matching bind port
3. **Invalid Configuration**: Malformed or incomplete config files
4. **Network Issues**: SSH connection or file read failures

#### Error Recovery
- **Automatic Retry**: Failed proxies can be retried via healing
- **Manual Resolution**: API endpoints for manual dependency resolution
- **Migration Scripts**: Tools to fix existing broken relationships

## API Endpoints

### Core FRP Operations

#### `GET /api/v1/frp/configs`
Retrieve all FRP configurations (FRPS and FRPC).

**Response**:
```json
{
  "frpsConfigs": [...],
  "frpcProxies": [...]
}
```

#### `POST /api/v1/frp/sync/:hostId`
Trigger FRP sync for a specific host (parse phase only).

**Parameters**:
- `hostId`: Host identifier

**Response**:
```json
{
  "message": "FRP sync initiated for host {hostId}"
}
```

### Dependency Management

#### `POST /api/v1/frp/resolve-dependencies`
Manually trigger global FRP dependency resolution.

**Response**:
```json
{
  "message": "FRP dependency resolution initiated"
}
```

#### `POST /api/v1/frp/heal`
Trigger FRP relationship healing for failed proxies.

**Response**:
```json
{
  "message": "FRP relationship healing initiated"
}
```

### Monitoring and Health

#### `GET /api/v1/frp/health`
Get FRP topology health status.

**Response**:
```json
{
  "totalFrpcProxies": 10,
  "linkedProxies": 8,
  "pendingProxies": 1,
  "failedProxies": 1,
  "orphanedProxies": 0,
  "issues": [
    "1 FRPC proxies failed to link to FRPS configs"
  ],
  "isHealthy": false
}
```

#### `GET /api/v1/frp/metrics`
Get comprehensive FRP sync metrics and statistics.

**Response**:
```json
{
  "overview": {
    "totalFrpsConfigs": 3,
    "totalFrpcProxies": 10,
    "healthyProxies": 8,
    "unhealthyProxies": 2,
    "healthPercentage": 80
  },
  "syncStatus": {
    "linked": 8,
    "pending": 1,
    "failed": 1
  },
  "recentActivity": {
    "lastSyncTime": "2024-01-15T10:30:00Z",
    "syncFrequency": "On container discovery",
    "recentErrors": [...]
  },
  "performance": {
    "successRate": 89,
    "stalePendingCount": 0
  }
}
```

#### `GET /api/v1/frp/logs?limit=50`
Get detailed FRP sync logs for debugging.

**Parameters**:
- `limit`: Number of log entries to return (default: 50)

**Response**:
```json
[
  {
    "id": "log-1",
    "title": "FRP Sync from host-1",
    "status": "COMPLETED",
    "createdAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:30:05Z",
    "duration": 5000,
    "entries": [...]
  }
]
```

## Integration with Container Discovery

### Modified Discovery Flow

1. **Individual Host Discovery**: Each host runs FRP sync in parse phase only
2. **Batch Processing**: After all hosts are processed, dependency resolution runs
3. **Topology Generation**: Network topology is generated with complete relationships

### TasksService Integration

The `TasksService.exec()` method has been enhanced to include FRP dependency resolution:

```typescript
// After all container discovery tasks complete
if (allTasksCompleted) {
  // Phase 2: Resolve FRP dependencies
  await this.frpService.resolveFrpDependencies();
}
```

## Migration and Maintenance

### Data Migration Script

**Purpose**: Fix existing broken FRP relationships

**Usage**:
```bash
# Preview changes
npm run migrate:frp-relationships:dry-run

# Apply fixes
npm run migrate:frp-relationships
```

**Process**:
1. Identify orphaned FRPC proxies
2. Extract server information from configs
3. Attempt to link to existing FRPS configs
4. Report success/failure statistics

### Validation Script

**Purpose**: Validate FRP topology health

**Usage**:
```bash
npm run validate:frp-topology
```

**Output**:
- Comprehensive health report
- Issue identification
- Recommendations for fixes

### Discovery Order Testing

**Purpose**: Verify order independence

**Usage**:
```bash
npm run test:frp-discovery-order
```

**Tests**:
- Normal order (FRPS first)
- Reverse order (FRPC first)
- Mixed orders
- Error scenarios

## Best Practices

### For Developers

1. **Always Use Parse Phase**: Individual host discovery should only use parse phase
2. **Global Resolution**: Use `resolveFrpDependencies()` after batch operations
3. **Error Handling**: Check sync status and handle failed proxies appropriately
4. **Health Monitoring**: Regularly check FRP topology health

### For Operations

1. **Migration First**: Run migration script before upgrading to new system
2. **Health Checks**: Monitor FRP health endpoints
3. **Healing**: Use healing endpoints for automatic recovery
4. **Validation**: Run validation scripts after major changes

### For Troubleshooting

1. **Check Logs**: Use `/api/v1/frp/logs` for detailed debugging
2. **Validate Topology**: Run validation script to identify issues
3. **Manual Resolution**: Use dependency resolution endpoint for manual fixes
4. **Healing**: Try healing endpoint before manual intervention

## Performance Considerations

### Scalability
- **Batch Processing**: Dependency resolution scales with number of pending proxies
- **Efficient Queries**: Database queries optimized for large datasets
- **Async Operations**: All operations are asynchronous and non-blocking

### Resource Usage
- **Memory**: Minimal additional memory overhead
- **Database**: New fields add minimal storage overhead
- **Network**: No additional network calls during parse phase

### Monitoring
- **Health Percentage**: Quick indicator of system health
- **Success Rate**: Track dependency resolution success over time
- **Stale Pending**: Monitor proxies stuck in pending state

## Future Enhancements

### Planned Features
1. **Real-time Healing**: Automatic healing on configuration changes
2. **Advanced Metrics**: More detailed performance and health metrics
3. **Webhook Integration**: Notifications for topology changes
4. **Configuration Validation**: Pre-validation of FRP configs before sync

### Potential Improvements
1. **Incremental Sync**: Only sync changed configurations
2. **Conflict Resolution**: Handle conflicting FRPS configurations
3. **Multi-tenant Support**: Isolation for different environments
4. **Configuration Templates**: Standardized FRP configuration patterns

## Related Documentation

- [FRP API Specification](./frp-api-spec.md) - Detailed API documentation
- [Migration Guide](./frp-migration-guide.md) - Step-by-step migration instructions
- [Troubleshooting Guide](./frp-troubleshooting.md) - Common issues and solutions
