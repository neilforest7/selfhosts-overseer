# Activity Log System

## Overview

The Activity Log system is a comprehensive tracking and monitoring solution for the selfhost-serv-agent platform. It provides real-time visibility into all system activities, changes, and operations across your infrastructure.

## Features

### 📊 **Comprehensive Activity Tracking**
- **Host Management**: Track host creation, updates, deletion, and connection tests
- **Container Operations**: Monitor container lifecycle, updates, and state changes
- **Docker Compose**: Track compose project operations and service management
- **FRP Configuration**: Monitor FRP tunnel configuration changes
- **Reverse Proxy**: Track NPM route synchronization and management
- **System Operations**: Log system-level activities and maintenance
- **Automation**: Track automation rule executions and changes

### 🔄 **Real-time Updates**
- WebSocket-based live activity streaming
- Automatic UI updates without page refresh
- Host-specific activity filtering
- Connection status indicators

### 🗂️ **Advanced Filtering & Search**
- Filter by category, action, host, resource type
- Date range filtering
- Full-text search across titles, descriptions, and resource names
- Pagination with configurable limits

### 🧹 **Automatic Cleanup & Retention**
- Configurable retention periods (1-365 days)
- Scheduled daily cleanup at 2:00 AM
- Weekly statistics cleanup for very old entries
- Manual cleanup with custom retention periods

### 📈 **Analytics & Statistics**
- Activity statistics by category and action
- Cleanup statistics and storage usage
- Historical trend analysis
- Resource-specific activity history

## Architecture

### Backend Components

```
ActivityLogModule
├── ActivityLogService          # Core service for CRUD operations
├── ActivityLogCleanupService   # Scheduled cleanup and retention
├── ActivityLogController       # REST API endpoints
└── ExecGateway                # WebSocket real-time updates
```

### Frontend Components

```
Activity Log UI
├── ActivityLogSection          # Full activity log page
├── ActivityLogWidget          # Dashboard widget
├── OverviewSection            # Enhanced overview with activity widget
└── useActivityLogSocket       # WebSocket hook for real-time updates
```

### Database Schema

```sql
model ActivityLog {
  id          String   @id @default(cuid())
  timestamp   DateTime @default(now())
  
  -- Event categorization
  category    ActivityCategory
  action      String
  
  -- Resource identification
  resourceType String
  resourceId   String?
  resourceName String?
  
  -- Context information
  hostId      String?
  hostName    String?
  
  -- Event details
  title       String
  description String?
  metadata    Json?
  
  -- Change tracking
  oldValues   Json?
  newValues   Json?
  
  -- Relationships
  host        Host? @relation(fields: [hostId], references: [id])
  
  -- Performance indexes
  @@index([timestamp])
  @@index([category, timestamp])
  @@index([hostId, timestamp])
  @@index([resourceType, timestamp])
}
```

## Integration Points

### Service Integration

Each major service automatically logs activities:

```typescript
// Example: Container lifecycle logging
await this.activityLog.logContainerActivity(
  'restarted',
  container.id,
  container.name,
  container.hostId,
  container.host.name,
  `Container '${container.name}' restarted`,
  'CLI container restarted',
  {
    isComposeManaged: false,
    imageName: container.imageName,
    imageTag: container.imageTag,
  }
);
```

### Event-Driven Architecture

```typescript
// Automatic real-time broadcasting
this.eventEmitter.emit('activity-log.created', activityLog);

// WebSocket gateway handles broadcasting
@OnEvent('activity-log.created')
handleActivityLogCreated(activityLog: any) {
  this.server.to('activity:global').emit('activity.new', activityLog);
  if (activityLog.hostId) {
    this.server.to(`activity:host:${activityLog.hostId}`).emit('activity.new', activityLog);
  }
}
```

## Configuration

### Settings

Configure activity log behavior through the settings API:

```json
{
  "activityLogRetentionDays": 30,
  "activityLogCleanupEnabled": true
}
```

### Environment Variables

```bash
# Database connection (inherited from main app)
DATABASE_URL="postgresql://..."

# WebSocket configuration (inherited from main app)
WEBSOCKET_CORS_ORIGIN="*"
```

## Usage Examples

### Frontend Integration

```typescript
// Using the activity log widget
import { ActivityLogWidget } from '@/app/sections/ActivityLogWidget';

function Dashboard() {
  return (
    <div className="grid gap-6">
      <ActivityLogWidget className="col-span-2" />
    </div>
  );
}

// Using real-time updates
import { useActivityLogSocket } from '@/lib/hooks/useActivityLogSocket';

function ActivityPage() {
  const { isConnected, activities } = useActivityLogSocket({
    onNewActivity: (activity) => {
      toast.success(`New activity: ${activity.title}`);
    },
  });

  return (
    <div>
      <div className="flex items-center gap-2">
        <h1>Activities</h1>
        {isConnected ? <Wifi className="text-green-500" /> : <WifiOff className="text-red-500" />}
      </div>
      {/* Activity list */}
    </div>
  );
}
```

### API Usage

```typescript
// Fetch recent activities
const response = await fetch('/api/v1/activity-logs/recent?limit=10');
const activities = await response.json();

// Filter activities by host
const response = await fetch('/api/v1/activity-logs?hostId=host-123&category=CONTAINER_LIFECYCLE');
const { items, total, hasMore } = await response.json();

// Manual cleanup
const response = await fetch('/api/v1/activity-logs/cleanup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ retentionDays: 7 })
});
const { count, retentionDays } = await response.json();
```

## Performance Considerations

### Database Optimization
- Indexed queries for efficient filtering
- Pagination to limit result sets
- Automatic cleanup to prevent unbounded growth

### Real-time Updates
- Efficient WebSocket room management
- Selective broadcasting based on host filtering
- Client-side activity caching

### Memory Management
- Configurable retention periods
- Scheduled cleanup tasks
- Efficient JSON storage for metadata

## Monitoring & Troubleshooting

### Health Checks
- Monitor cleanup task execution
- Track WebSocket connection health
- Monitor database query performance

### Common Issues
1. **High storage usage**: Reduce retention period or enable cleanup
2. **Slow queries**: Check database indexes and query patterns
3. **Missing activities**: Verify service integration and event emission
4. **WebSocket disconnections**: Check network stability and CORS configuration

## Testing

### Unit Tests
- ActivityLogService: CRUD operations, filtering, statistics
- ActivityLogCleanupService: Scheduled tasks, manual cleanup
- ActivityLogController: API endpoints, parameter validation

### Integration Tests
- End-to-end activity logging flow
- WebSocket real-time updates
- Database cleanup operations

### Performance Tests
- Large dataset queries
- Concurrent activity creation
- WebSocket connection limits

## Future Enhancements

### Planned Features
- Activity log export (CSV, JSON)
- Advanced analytics and reporting
- Activity log archiving to external storage
- Custom activity categories and actions
- Activity log search with Elasticsearch integration

### Scalability Improvements
- Database partitioning by date
- Read replicas for query performance
- Distributed WebSocket handling
- Compressed storage for old entries

## Contributing

When adding new activity logging to services:

1. Import ActivityLogService in your module
2. Inject the service in your constructor
3. Use helper methods for consistent logging:
   - `logHostActivity()` for host-related activities
   - `logContainerActivity()` for container operations
   - `logComposeActivity()` for compose operations
   - `create()` for custom activities

4. Include relevant metadata for debugging and analysis
5. Use descriptive titles and descriptions
6. Add appropriate tests for new activity types
