# DNS Management User Guide

## Introduction

The DNS Management feature provides comprehensive monitoring and management of DNS resolution for your domains. This guide will help you set up and use the DNS monitoring system effectively.

## Getting Started

### 1. Accessing DNS Management

Navigate to the DNS Management section in the web interface. You'll see four main tabs:

- **DNS Records**: Manage and monitor individual DNS records
- **Providers**: Configure DNS service providers
- **Resolution History**: View historical resolution data
- **Settings**: Configure global DNS settings

### 2. Setting Up Your First DNS Provider

Before you can monitor DNS records, you need to configure at least one DNS provider:

1. Go to the **Providers** tab
2. Click **Add Provider**
3. Choose a provider type (Cloudflare recommended)
4. Enter your API credentials:
   - For Cloudflare: API Key and Email
   - For DNS over HTTPS: Endpoint URL
5. Test the connection to ensure it works
6. Save the provider configuration

### 3. Adding DNS Records to Monitor

Once you have a provider configured:

1. Go to the **DNS Records** tab
2. Click **Add Record**
3. Fill in the record details:
   - **Domain**: The domain to monitor (e.g., api.example.com)
   - **Record Type**: Usually 'A' for IPv4 addresses
   - **Provider**: Select your configured provider
   - **Check Interval**: How often to check (default: 300 seconds)
   - **Description**: Optional description for the record
   - **Tags**: Optional tags for organization
4. Enable monitoring and save

## Understanding DNS Status

DNS records can have several status values:

- **🟢 Resolved**: DNS resolution successful
- **🔴 Failed**: DNS resolution failed
- **🟡 Timeout**: DNS query timed out
- **🟠 No Record**: No DNS record found
- **⚪ Unknown**: Status not yet determined

## Monitoring and Alerts

### Automatic Monitoring

The system automatically:

- Checks DNS records based on their configured intervals
- Tracks resolution history and performance metrics
- Generates alerts for persistent failures
- Maintains health statistics

### Health Monitoring

The system performs health checks every 5 minutes and will alert you when:

- Success rate drops below 90%
- Records have been failing for more than 1 hour
- System-wide issues are detected

### Viewing Resolution History

In the **Resolution History** tab, you can:

- View recent DNS resolution attempts
- Filter by time range (1 hour to 1 week)
- See detailed error messages for failed resolutions
- Track response times and performance trends

## Network Topology Integration

DNS data is automatically integrated into the network topology visualization:

- **External IP Nodes**: Show resolved IP addresses
- **DNS Provider Nodes**: Display configured providers
- **Resolution Edges**: Connect domains to their resolved IPs
- **Management Edges**: Show which provider manages which IPs

## Best Practices

### 1. Provider Configuration

- **Use Multiple Providers**: Configure multiple DNS providers for redundancy
- **Test Connections**: Always test provider connections after configuration
- **Monitor Rate Limits**: Be aware of provider API rate limits

### 2. Record Management

- **Appropriate Intervals**: Set check intervals based on criticality
  - Critical services: 60-300 seconds
  - Standard services: 300-900 seconds
  - Non-critical services: 900+ seconds
- **Use Tags**: Organize records with meaningful tags
- **Descriptive Names**: Use clear descriptions for easy identification

### 3. Monitoring Strategy

- **Start Small**: Begin with your most critical domains
- **Monitor Trends**: Watch for patterns in resolution failures
- **Regular Cleanup**: Periodically review and remove unused records

## Troubleshooting

### Common Issues

**DNS Provider Connection Fails**
- Verify API credentials are correct
- Check if API key has necessary permissions
- Ensure network connectivity to provider

**Records Not Resolving**
- Verify domain name is correct
- Check if DNS record actually exists
- Confirm provider can access the domain

**High Failure Rates**
- Check provider status and rate limits
- Verify network connectivity
- Review DNS record configurations

### Getting Help

Check the following for troubleshooting:

1. **Activity Logs**: View detailed operation logs
2. **Resolution History**: Check specific error messages
3. **Provider Status**: Verify provider connections
4. **System Health**: Review overall system status

## Advanced Features

### Batch Operations

You can perform batch operations on multiple DNS records:

- **Batch Resolution**: Trigger resolution for multiple records
- **Bulk Updates**: Update multiple records simultaneously
- **Mass Import**: Import records from external sources

### API Integration

The DNS system provides a comprehensive REST API for:

- Automated record management
- Integration with external monitoring systems
- Custom alerting and notification systems
- Data export and reporting

### Automation Integration

DNS events can trigger automation rules:

- Restart services when DNS changes
- Send notifications for persistent failures
- Update load balancer configurations
- Trigger health checks

## Maintenance

### Regular Tasks

- **Review Resolution History**: Check for patterns or issues
- **Update Provider Credentials**: Rotate API keys as needed
- **Clean Up Old Records**: Remove unused or obsolete records
- **Monitor System Health**: Review overall DNS system status

### Data Retention

- Resolution history is kept for 30 days by default
- Old records are automatically cleaned up
- You can manually trigger cleanup operations
- Export data before cleanup if needed for long-term storage

## Security Considerations

- **API Keys**: Store provider API keys securely
- **Access Control**: Limit access to DNS management features
- **Audit Logs**: Monitor who makes changes to DNS configuration
- **Network Security**: Ensure secure communication with DNS providers

## Performance Optimization

- **Batch Processing**: Use batch operations for multiple records
- **Appropriate Intervals**: Don't over-monitor with too frequent checks
- **Provider Selection**: Choose providers with good performance in your region
- **Resource Monitoring**: Monitor system resource usage during peak times
