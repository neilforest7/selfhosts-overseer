# SSH Bug Fix Implementation Plan

## High-Priority Fix Required

The SSH command failure showing "successful" toast notifications is a critical user experience issue that needs immediate attention.

## Recommended Implementation Strategy

### Phase 1: Immediate Frontend Fix (1-2 hours)
1. **Update executeTaskOperation function** in `apps/web/app/sections/ContainersSection.tsx`
2. **Integrate existing monitoring pattern** - leverage the existing `monitorOperationStatus()` function
3. **Add proper success/failure handling** - wait for task completion before showing toast
4. **Test all SSH operations** - container updates, restarts, status refreshes

### Phase 2: System-Wide Pattern Review (2-3 hours)
1. **Identify all similar patterns** across the codebase where success toast is premature
2. **Create reusable solution** - abstract the monitoring pattern into a hook or utility
3. **Update all affected components** - HostsSection, other sections with similar operations
4. **Document the pattern** - add to project documentation for future reference

### Phase 3: Enhanced Error Handling (1-2 hours)
1. **Add more granular error types** - distinguish between SSH auth failures, connection failures, command failures
2. **Improve error messages** - provide more actionable error information
3. **Add retry logic** - for certain types of SSH failures
4. **Enhanced logging** - better debugging information for SSH failures

## Implementation Code Template

### Frontend Fix Pattern
```typescript
// Replace immediate success toast with monitored execution
const executeTaskOperation = useCallback(async (
  title: string,
  apiCall: () => Promise<ApiResponse>,
  onSuccess?: (result: any) => void,
  onError?: (error: Error) => void
) => {
  try {
    const response = await apiCall();
    if (!response.success) {
      throw new Error(response.error || '操作失败');
    }
    const result = response.data as { taskId?: string };
    
    if (result?.taskId) {
      // Add to TaskDrawer for monitoring
      const tempTask = {
        id: result.taskId!,
        title,
        status: 'RUNNING' as const,
        triggerType: 'MANUAL' as const,
        startTime: new Date().toISOString(),
        endTime: null,
        entries: []
      };
      addTaskAndOpen(tempTask);
      
      // Monitor completion before showing success
      await monitorOperationStatus(result.taskId!, title, onSuccess);
    } else {
      // No taskId - immediate success
      toast.success(`${title}已启动`);
      if (onSuccess) onSuccess(result);
    }
  } catch (error) {
    console.error(`Task operation failed: ${title}`, error);
    if (onError) onError(error as Error);
    toast.error(`操作失败: ${title}`);
  }
}, [addTaskAndOpen]);
```

### Enhanced Monitoring Function
```typescript
const monitorOperationStatus = async (taskId: string, operationName: string, onSuccess?: (result: any) => void) => {
  const maxAttempts = 60; // 1 minute timeout
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await apiClient.get(`/api/v1/operations/${taskId}`);
      if (!response.success) break;

      const operation = response.data as { status: string };

      if (operation?.status === 'COMPLETED') {
        toast.success(`${operationName}完成`);
        if (onSuccess) onSuccess(operation);
        return;
      } else if (operation?.status === 'ERROR') {
        toast.error(`${operationName}失败`);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    } catch (error) {
      console.error('Failed to check operation status:', error);
      break;
    }
  }

  toast.warning(`${operationName}超时，请查看任务详情`);
};
```

## Files to Update

### Primary Files
1. `apps/web/app/sections/ContainersSection.tsx` - Main container operations
2. `apps/web/app/sections/HostsSection.tsx` - Host connection testing
3. `apps/web/components/TaskDrawer.tsx` - Task monitoring interface

### Secondary Files
1. `apps/web/lib/utils.ts` - Add reusable monitoring utility
2. `apps/web/lib/hooks/` - Create custom hook for task monitoring
3. `apps/web/components/ui/` - Update any other components with similar patterns

## Testing Strategy

### Manual Testing
1. **Test SSH failures** - Disconnect network, wrong credentials, invalid commands
2. **Test timeout scenarios** - Long-running commands, unreachable hosts
3. **Test success cases** - Ensure normal operations still work correctly
4. **Test UI flow** - Verify toast timing and TaskDrawer integration

### Automated Testing
1. **Integration tests** - Mock SSH service responses
2. **Component tests** - Test the updated executeTaskOperation function
3. **E2E tests** - Test complete user workflow from button click to final status

## Risk Assessment

### Low Risk
- **Existing patterns** - Leveraging already working monitoring infrastructure
- **Frontend-only changes** - No backend modifications required
- **Backward compatible** - Maintains existing TaskDrawer functionality

### Medium Risk
- **Timeout handling** - Need to ensure appropriate timeout values
- **Error edge cases** - Handle various SSH failure scenarios gracefully
- **User experience** - Ensure the new delay doesn't feel slow for successful operations

## Success Criteria

1. **Accurate toast notifications** - Success only when operation actually succeeds
2. **Clear error communication** - Error toasts for actual failures
3. **Maintained functionality** - All existing features continue to work
4. **Improved user experience** - Users can trust the toast notifications
5. **No performance regression** - Operations complete in same time frame

## Next Steps

1. **Implement Phase 1 fix** - Update ContainersSection.tsx with monitoring
2. **Test thoroughly** - Verify all SSH operations work correctly
3. **Deploy to staging** - Test in production-like environment
4. **Gather user feedback** - Ensure the fix addresses the issue
5. **Proceed to Phase 2** - Address other similar patterns in the codebase