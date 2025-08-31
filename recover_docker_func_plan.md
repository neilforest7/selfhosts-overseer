# Plan to Recover Accidentally Deleted Docker Functions

Based on an analysis of the git history for `apps/server/src/containers/containers.service.ts` and `apps/server/src/containers/docker.service.ts`, several functions were identified as having been removed or having their core logic replaced with placeholders during recent refactoring.

## File: `apps/server/src/containers/containers.service.ts`

The implementations for the following functions were removed or replaced with placeholders, primarily in commits `b4f696eafbd820b721ce7ccaf409f3d7647b8317` and `e8c32d15c09a90d23e5063de3eb41275b44ea4e7`. The original logic should be restored from the git history prior to these commits.

-   `checkUpdatesAny`
-   `updateOne`
-   `restartOne`
-   `startOne`
-   `stopOne`
-   `composeOperate`
-   `refreshStatus`
-   `cleanupDuplicates`
-   `purgeContainers`
-   `checkComposeProjectUpdates`
-   `refreshRunningStatusAllHosts` (This function was completely removed).

## File: `apps/server/src/containers/docker.service.ts`

The following function was completely removed during a refactoring effort.

-   **Function Name:** `checkImageUpdate`
-   **Deleted in Commit:** `8d282b5ab1e2c9290e413e2069a7e41e12f36137`
