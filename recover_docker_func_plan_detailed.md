# Detailed & Optimized Plan for Recovering Container Service Functions

## 1. Overview & Architectural Principles

The goal is to restore the functionality of several methods in `ContainersService` and `DockerService`. The restored code will be adapted to the current architecture, which relies on `ContextService` for managing operation context (`opId`) and `OperationLogService` for centralized, stream-based logging.

### Core Architectural Principles for Recovery:

1.  **Operation Context:** Any user-initiated operation (e.g., restarting a container) must create an `OperationLog`. The entire logic of that operation is then wrapped in `contextService.run(opLog.id, async () => { ... })`.
2.  **Contextual Logging:** Inside the `contextService.run` block, logging is performed using `this.operationLogService.log(...)`. This service automatically retrieves the current `opId` from the context.
3.  **Status Updates:** The operation must conclude by calling `this.operationLogService.updateStatus(opLog.id, 'COMPLETED' | 'ERROR')` within a `finally` block.
4.  **API Response:** Functions that initiate an operation should return `{ taskId: opLog.id }` to the caller.

## 2. Optimization Strategy: CLI vs. Compose

To improve maintainability, we will clearly separate the logic for CLI-managed and Compose-managed containers.

-   **Private Helpers:** We will create dedicated private methods for core operations, e.g., `_updateCliContainer` and `_updateComposeService`. The public methods (`updateOne`) will act as dispatchers based on the `container.isComposeManaged` flag.
-   **Unified Compose Method:** All Compose-related actions (`up`, `start`, `stop`, `restart`) will be funneled through the `composeOperate` method. This centralizes command execution and logging for Compose projects.
-   **Robust CLI Updates:** The update process for CLI containers will be enhanced with a health check. After a container is recreated, the system will verify it is running correctly before removing the backup. If the check fails, it will automatically roll back.

## 3. Step-by-Step Implementation Plan

### Step 1: Restore Utility Function in `docker.service.ts`

1.  **File:** `apps/server/src/containers/docker.service.ts`
2.  **Action:** Add the `checkImageUpdate` function back into the `DockerService` class.
3.  **Source:** The code can be copied from commit `b9f0c5ec94d440cde708b83d25f506838dd97da2`.

```typescript
// To be added back to docker.service.ts
async checkImageUpdate(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, imageRef: string, currentDigest?: string | null, platform?: { architecture?: string; os?: string }): Promise<{ updateAvailable: boolean; remoteDigest?: string; error?: string }> {
  const manifestResult = await this.inspectRemoteManifest(host, imageRef, platform);
  
  if (manifestResult.error) {
    return { updateAvailable: false, error: manifestResult.error };
  }

  const remoteDigest = manifestResult.digest;
  if (!remoteDigest) {
    return { updateAvailable: false, error: '无法获取远程镜像 digest' };
  }

  let localDigest = currentDigest;
  if (!localDigest) {
    const localDigests = await this.inspectImageRepoDigests(host, imageRef);
    localDigest = localDigests[0] || null;
  }

  const updateAvailable = Boolean(localDigest && remoteDigest && localDigest !== remoteDigest);
  
  return {
    updateAvailable,
    remoteDigest,
    error: undefined
  };
}
```

### Step 2: Restore and Refactor `containers.service.ts`

#### A. Restore `updateOne` with Dispatcher Logic

1.  **File:** `apps/server/src/containers/containers.service.ts`
2.  **Action:** Implement the public `updateOne` method. This method will fetch the container, create an `OperationLog`, and then call the appropriate private helper (`_updateCliContainer` or `_updateComposeService`).
3.  **Implement `_updateComposeService`:** This private method will simply call `this.composeOperate` for `pull` and then `up`.
4.  **Implement `_updateCliContainer`:** This private method will contain the full backup-and-restore logic from commit `b9f0c5ec94d4`, enhanced with a health check. All logging calls will be converted to `this.operationLogService.log`.

#### B. Restore `startOne`, `stopOne`, `restartOne`

1.  **File:** `apps/server/src/containers/containers.service.ts`
2.  **Action:** For each method (`startOne`, `stopOne`, `restartOne`):
    -   Restore the original logic from commit `b9f0c5ec94d4`.
    -   Wrap the logic in the `create`/`run`/`updateStatus` pattern.
    -   For Compose-managed containers, delegate the action to `this.composeOperate`.
    -   For CLI-managed containers, use the appropriate `docker` command (`start`, `stop`, `restart`).
    -   Convert all logging to use `this.operationLogService.log`.

#### C. Restore Administrative and Status Functions

1.  **File:** `apps/server/src/containers/containers.service.ts`
2.  **Action:** Restore the following functions:
    -   `refreshStatus` (from commit `556ed02`): This is a utility and should use the existing context for logging.
    -   `refreshRunningStatusAllHosts` (from commit `556ed02`): This is a system task and should create its own `OperationLog`.
    -   `cleanupDuplicates` (from commit `556ed02`): Wrap in the `create`/`run`/`updateStatus` pattern.
    -   `purgeContainers` (from commit `556ed02`): Wrap in the `create`/`run`/`updateStatus` pattern.

#### D. Restore `checkComposeProjectUpdates`

1.  **File:** `apps/server/src/containers/containers.service.ts`
2.  **Action:** Restore the non-diun implementation from commit `f13569c`.
3.  **Adaptation:**
    -   Wrap the entire method in the `create`/`run`/`updateStatus` pattern.
    -   Ensure the inner loop correctly calls the newly restored `docker.checkImageUpdate`.
    -   Convert all logging to use `this.operationLogService.log`.

This step-by-step process ensures that all functionality is restored in a way that is consistent with the current, more robust architecture.
