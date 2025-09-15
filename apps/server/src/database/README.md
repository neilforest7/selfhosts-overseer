# Enhanced Database Migration Service

## Overview

This enhanced `DatabaseMigrationService` provides robust, production-ready database schema management with automatic migration capabilities, comprehensive health monitoring, and extensive API endpoints for manual control.

## Key Features

### 🔄 **Automated Migration**
- **Smart Detection**: Automatically detects when database schema needs updates
- **Retry Logic**: Configurable retry attempts with exponential backoff
- **Fallback Strategy**: Automatic fallback from `prisma migrate deploy` to `prisma db push`
- **Concurrency Control**: Prevents multiple migrations from running simultaneously

### 📊 **Comprehensive Monitoring**
- **Health Checks**: Real-time database connectivity and schema validation
- **Migration Statistics**: Track success/failure rates and timing metrics
- **Performance Metrics**: Duration tracking and database size monitoring
- **Detailed Logging**: Configurable verbosity for development and production

### 🛡️ **Robust Error Handling**
- **Graceful Degradation**: Application continues to start even if migration fails
- **Timeout Protection**: Configurable timeouts for migration operations
- **Verification Steps**: Post-migration validation ensures schema integrity
- **Error Classification**: Specific error types with detailed reporting

### 🎛️ **REST API Endpoints**
- **Health Monitoring**: `/api/v1/database/health`
- **Migration Control**: Manual trigger and force migration endpoints
- **Status Tracking**: Real-time migration status and statistics
- **Comprehensive Info**: Single endpoint for complete database state

## Configuration

### Environment Variables

```bash
# Enable/disable auto migration (default: enabled)
DISABLE_AUTO_MIGRATION=false

# Migration timeout in milliseconds (default: 60000)
DB_MIGRATION_TIMEOUT=60000

# Maximum retry attempts (default: 3)
DB_MIGRATION_MAX_RETRIES=3

# Retry delay in milliseconds (default: 5000)
DB_MIGRATION_RETRY_DELAY=5000
```

### MigrationConfig Interface

```typescript
interface MigrationConfig {
  timeoutMs?: number;           // Custom timeout override
  retryAttempts?: number;        // Custom retry count
  retryDelayMs?: number;         // Custom retry delay
  useTransactions?: boolean;     // Enable transaction-based migrations
  verboseLogging?: boolean;      // Enable detailed logging
  healthCheckIntervalMs?: number; // Health check interval
  enabled?: boolean;             // Enable/disable migration
}
```

## API Usage

### Health Check
```bash
GET /api/v1/database/health
```

### Migration Status
```bash
GET /api/v1/database/migration/status
```

### Run Migration
```bash
POST /api/v1/database/migration/run
Content-Type: application/json

{
  "timeoutMs": 120000,
  "retryAttempts": 5
}
```

### Force Migration
```bash
POST /api/v1/database/migration/force
```

### Comprehensive Database Info
```bash
GET /api/v1/database/info
```

## Migration Flow

### 1. Application Startup
```
onModuleInit()
  ↓
Check if auto-migration enabled
  ↓
Run migration (don't throw on failure)
```

### 2. Migration Process
```
Check database connection
  ↓
Get database health state
  ↓
Determine if migration needed
  ↓
Execute migration with retry logic
  ↓
Verify migration success
  ↓
Update statistics
```

### 3. Error Handling
```
Try prisma migrate deploy
  ↓
If failed → Try prisma db push
  ↓
If failed → Log error, don't crash application
```

## Monitoring and Observability

### Log Levels
- **INFO**: Migration progress, health checks
- **WARN**: Retry attempts, fallback strategies
- **ERROR**: Migration failures, connection issues
- **DEBUG**: Detailed command output (development only)

### Metrics Tracked
- Total migrations executed
- Success/failure rates
- Average migration duration
- Database size and table count
- Connection pool metrics

### Health Check Endpoints
- Database connectivity status
- Schema validation results
- Migration table existence
- Applied migrations tracking

## Best Practices

### Production Deployment
1. **Monitor Migration Results**: Check `/api/v1/database/migration/last` after deployments
2. **Set Appropriate Timeouts**: Adjust `DB_MIGRATION_TIMEOUT` based on database size
3. **Enable Health Checks**: Use `/api/v1/database/health` for load balancer health checks
4. **Configure Alerts**: Monitor migration failures and database connectivity issues

### Development Workflow
1. **Enable Verbose Logging**: Set `NODE_ENV=development` for detailed migration output
2. **Use Force Migration**: Leverage `/api/v1/database/migration/force` for schema updates
3. **Monitor Statistics**: Check `/api/v1/database/migration/status` for development insights

### Database Maintenance
1. **Regular Health Checks**: Automate health check endpoint monitoring
2. **Migration History**: Track migration results for audit purposes
3. **Performance Monitoring**: Monitor migration duration trends
4. **Capacity Planning**: Use database size metrics for capacity planning

## Troubleshooting

### Common Issues

**Migration Timeout**
```
Error: Command timed out after 60000ms
```
Solution: Increase `DB_MIGRATION_TIMEOUT` environment variable

**Connection Failure**
```
Error: Database connection failed
```
Solution: Verify `DATABASE_URL` and database connectivity

**Permission Errors**
```
Error: Command failed with code 1
```
Solution: Ensure Prisma CLI is installed and accessible

### Manual Recovery
```bash
# Check current database state
curl http://localhost:3001/api/v1/database/health

# Force migration with custom config
curl -X POST http://localhost:3001/api/v1/database/migration/force \
  -H "Content-Type: application/json" \
  -d '{"timeoutMs": 180000, "retryAttempts": 5}'

# Get detailed migration status
curl http://localhost:3001/api/v1/database/info
```

## Integration Examples

### Health Check Integration
```typescript
// In your health check service
async checkDatabaseHealth() {
  const health = await this.databaseMigrationService.checkHealth();
  return {
    status: health.connected ? 'healthy' : 'unhealthy',
    details: health
  };
}
```

### Deployment Hooks
```typescript
// In your deployment service
async beforeDeploy() {
  const result = await this.databaseMigrationService.runMigrations({
    timeoutMs: 180000 // Extended timeout for deployment
  });

  if (!result.success) {
    throw new Error(`Migration failed: ${result.error}`);
  }
}
```

### Monitoring Integration
```typescript
// In your monitoring service
async getMigrationMetrics() {
  const stats = await this.databaseMigrationService.getMigrationStats();
  return {
    migration_success_rate: stats.successfulMigrations / stats.totalMigrations,
    last_migration_duration: stats.lastMigrationTime,
    database_size: stats.databaseHealth.databaseSize
  };
}
```

## Security Considerations

### Access Control
- Migration endpoints should be protected with authentication
- Consider IP-based restrictions for production environments
- Implement rate limiting for migration endpoints

### Data Safety
- Always backup database before major migrations
- Test migrations in staging environment first
- Monitor migration results for unexpected behavior

### Audit Trail
- Log all migration attempts and results
- Track who triggered migrations and when
- Maintain migration history for compliance purposes

This enhanced service provides enterprise-grade database migration capabilities with comprehensive monitoring, robust error handling, and extensive API coverage for production environments.