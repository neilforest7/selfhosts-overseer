# Database Migration State Handling Reference

## Quick Reference Guide

### Database State Detection Logic
```typescript
detectDatabaseState(dbHealth: DatabaseHealth) {
  // 1. Check if fresh database (no tables)
  if (dbHealth.tables.length === 0) return 'fresh';
  
  // 2. Check if migrations table exists
  if (!dbHealth.migrationsTableExists) return 'partial';
  
  // 3. Check _prisma_migrations table (PRIORITY CHANGE)
  if (dbHealth.appliedMigrations.length > 0) {
    const completeness = await this.verifyMigrationHistoryCompleteness();
    return completeness.isComplete ? 'complete' : 'partial';
  }
  
  return 'partial';
}
```

### Migration Strategy Selection
- **Fresh Database**: `executeBaselineMigration()` → `migrate deploy`
- **Partial Database**: `executeStandardMigration()` → `migrate deploy` + validation
- **Complete Database**: Skip migration, run validation only

### Key Methods Enhanced
- `verifyMigrationHistoryCompleteness()` - Validates migration state
- `executeBaselineMigration()` - Fresh database initialization
- `executeStandardMigration()` - Existing database migration
- Removed: Custom database_initialized status methods

### _prisma_migrations Table Usage
✅ **Primary Truth Source**: Always check this table first
✅ **Migration History**: Track all applied migrations
✅ **Validation**: Verify completeness and consistency
✅ **Recovery**: Use for determining appropriate repair strategies

## Critical Changes from Previous Version
1. **Priority**: _prisma_migrations table checked before custom state
2. **Commands**: Unified to use `migrate deploy` as primary strategy
3. **Validation**: Added comprehensive migration history verification
4. **Removed Conflicts**: Eliminated custom initialization status
5. **Enhanced Recovery**: Multiple fallback mechanisms for robustness