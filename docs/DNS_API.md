# DNS Management API Documentation

## Overview

The DNS Management API provides comprehensive functionality for monitoring and managing DNS resolution across multiple DNS providers. This system allows you to:

- Configure multiple DNS providers (Cloudflare, DNS over HTTPS, etc.)
- Monitor DNS record resolution status
- Track resolution history and performance metrics
- Integrate DNS data into network topology visualization
- Set up automated monitoring and alerting

## Base URL

All API endpoints are prefixed with `/api/v1/dns`

## Authentication

The API uses the same authentication mechanism as the main application (single-user token-based authentication).

## DNS Providers

### List DNS Providers

```http
GET /api/v1/dns/providers
```

Returns a list of all configured DNS providers.

**Response:**
```json
[
  {
    "id": "provider-1",
    "name": "cloudflare",
    "displayName": "Cloudflare",
    "isEnabled": true,
    "rateLimitPerMinute": 1200,
    "timeoutSeconds": 30,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Get Available Provider Types

```http
GET /api/v1/dns/providers/available
```

Returns a list of available DNS provider types that can be configured.

### Create DNS Provider

```http
POST /api/v1/dns/providers
```

**Request Body:**
```json
{
  "name": "cloudflare",
  "displayName": "Cloudflare DNS",
  "isEnabled": true,
  "apiConfig": {
    "apiKey": "your-api-key",
    "email": "your-email@example.com"
  },
  "rateLimitPerMinute": 1200,
  "timeoutSeconds": 30
}
```

### Test Provider Connection

```http
POST /api/v1/dns/providers/{id}/test
```

Tests the connection to a DNS provider.

**Response:**
```json
{
  "connected": true
}
```

## DNS Records

### List DNS Records

```http
GET /api/v1/dns/records
```

**Query Parameters:**
- `providerId` (optional): Filter by provider ID
- `isEnabled` (optional): Filter by enabled status (true/false)
- `status` (optional): Filter by resolution status (RESOLVED, FAILED, TIMEOUT, etc.)

**Response:**
```json
[
  {
    "id": "record-1",
    "domain": "api.example.com",
    "recordType": "A",
    "currentIp": "192.168.1.100",
    "status": "RESOLVED",
    "lastCheckAt": "2024-01-01T12:00:00Z",
    "lastChangeAt": "2024-01-01T10:00:00Z",
    "isEnabled": true,
    "checkInterval": 300,
    "provider": {
      "id": "provider-1",
      "displayName": "Cloudflare"
    }
  }
]
```

### Create DNS Record

```http
POST /api/v1/dns/records
```

**Request Body:**
```json
{
  "domain": "api.example.com",
  "recordType": "A",
  "providerId": "provider-1",
  "isEnabled": true,
  "checkInterval": 300,
  "description": "API server DNS record",
  "tags": ["production", "api"]
}
```

### Trigger Manual Resolution

```http
POST /api/v1/dns/records/{id}/resolve
```

Manually triggers DNS resolution for a specific record.

**Response:**
```json
{
  "message": "DNS resolution triggered"
}
```

### Batch Resolution

```http
POST /api/v1/dns/records/batch-resolve
```

**Request Body:**
```json
{
  "recordIds": ["record-1", "record-2", "record-3"],
  "batchSize": 10
}
```

## Resolution History

### Get Record Resolution History

```http
GET /api/v1/dns/records/{id}/resolutions
```

**Query Parameters:**
- `limit` (optional): Maximum number of results (default: 100)

**Response:**
```json
[
  {
    "id": "resolution-1",
    "resolvedIp": "192.168.1.100",
    "responseTime": 45,
    "status": "RESOLVED",
    "checkedAt": "2024-01-01T12:00:00Z",
    "geoLocation": {
      "country": "US",
      "city": "San Francisco"
    }
  }
]
```

### Get Recent Resolutions

```http
GET /api/v1/dns/resolutions
```

**Query Parameters:**
- `hours` (optional): Time range in hours (default: 24)

## Statistics and Monitoring

### Get DNS Statistics

```http
GET /api/v1/dns/stats
```

**Response:**
```json
{
  "totalRecords": 25,
  "enabledRecords": 20,
  "statusDistribution": {
    "RESOLVED": 18,
    "FAILED": 2
  },
  "providerDistribution": [
    {
      "providerId": "provider-1",
      "_count": 15
    }
  ],
  "recentResolutions": 150,
  "last24HourSuccess": 145,
  "last24HourFailures": 5
}
```

### Health Check

```http
GET /api/v1/dns/health
```

**Response:**
```json
{
  "status": "healthy",
  "totalRecords": 25,
  "enabledRecords": 20,
  "recordsDue": 3,
  "last24HourSuccess": 145,
  "last24HourFailures": 5,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Maintenance

### Cleanup Old Records

```http
POST /api/v1/dns/cleanup
```

**Query Parameters:**
- `retentionDays` (optional): Number of days to retain (default: 30)

**Response:**
```json
{
  "deletedCount": 1500,
  "message": "Cleaned up 1500 old resolution records"
}
```

## Error Responses

All endpoints return standard HTTP status codes. Error responses include:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

Common status codes:
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `404`: Not Found
- `500`: Internal Server Error

## Rate Limiting

API calls are subject to rate limiting based on the configured DNS provider limits. The system automatically manages rate limiting to prevent exceeding provider quotas.

## Monitoring Integration

The DNS system integrates with the existing monitoring infrastructure:

- **Activity Logs**: All DNS operations are logged in the activity log system
- **Operation Logs**: Scheduled tasks and batch operations are tracked
- **Topology Integration**: DNS data is automatically included in network topology visualization
- **Alerting**: Automatic alerts for failed resolutions and low success rates
