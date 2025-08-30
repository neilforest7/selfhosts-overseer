# Refactoring Plan: Centralized Logging Gateway

This document outlines the detailed plan to refactor the application's logging mechanism from a decentralized, multi-service implementation to a centralized, event-driven Logging Gateway. The goal is to improve code clarity, reduce boilerplate, enhance robustness, and create a single point of control for all operational logging.

## Phase 1: Core Infrastructure - Context Propagation

The biggest challenge is robustly passing the `operationLogId` (`opId`) through the entire call stack without manual prop-drilling. We will use Node.js's `AsyncLocalStorage` for this.

- [ ] **1.1. Create a Context Service**:
    - Create a new file `apps/server/src/context/context.service.ts`.
    - This service will encapsulate an `AsyncLocalStorage` instance.
    - It will provide two main methods: `run(opId, callback)` to establish a new context, and `getOpId()` to retrieve the current `opId` from anywhere within the async call stack.

- [ ] **1.2. Create a NestJS Middleware**:
    - Create a new file `apps/server/src/context/context.middleware.ts`.
    - This middleware will intercept all incoming API requests.
    - For requests that initiate an operation (e.g., `POST /api/v1/containers/discover`), it will create an `OperationLog` and then use `ContextService.run()` to wrap the rest of the request handling within a context that contains the new `opId`. For other requests, it will run with a `null` or `undefined` `opId`.

- [ ] **1.3. Register Middleware Globally**:
    - In `apps/server/src/app.module.ts`, apply the `ContextMiddleware` to all relevant routes.

## Phase 2: Refactoring the Logging Service into a Gateway

Transform `OperationLogService` into the central hub for logging.

- [ ] **2.1. Introduce EventEmitter**:
    - In `apps/server/src/operation-log/operation-log.module.ts`, register `EventEmitterModule.forRoot()` to make the event emitter available for dependency injection.

- [ ] **2.2. Implement Listener Logic in `OperationLogService`**:
    - Inject `EventEmitter2` and `ContextService` into `OperationLogService`.
    - Create a new private method `handleLogEvent(payload)`. This method will contain the logic for persisting the log to the database (`prisma.operationLogEntry.create`) and broadcasting it via the `ExecGateway`.
    - In the `onModuleInit` lifecycle hook, subscribe to a global log event (e.g., `'log.entry'`) and bind it to the `handleLogEvent` method.

- [ ] **2.3. Create a Public `log` Method for Emitting Events**:
    - The existing `log` method will be refactored. It will now be a simple, non-async method.
    - It will use `ContextService.getOpId()` to automatically retrieve the current `opId`.
    - Its sole responsibility will be to `emit` the `'log.entry'` event with the log payload. It will no longer contain any database or WebSocket logic.

## Phase 3: Refactoring Core Services

Update all services that currently handle logging to use the new gateway.

- [ ] **3.1. Refactor `SshService`**:
    - Remove the `OperationLogService` dependency.
    - Inject the new `LoggingGateway` (or `OperationLogService` acting as the gateway).
    - In `execWithStreaming` and `executeCapture`, replace the direct call to `operationLogService.log()` with a call to `loggingGateway.log()`. The new method will automatically handle the `opId`.

- [ ] **3.2. Refactor `DockerService`**:
    - Remove the `OperationLogService` dependency.
    - Inject the `LoggingGateway`.
    - Update all methods that currently pass `opId` down to `SshService` to instead just call the command. The logging will be handled automatically by the lower layers.

- [ ] **3.3. Refactor High-Level Business Services**:
    - **Target Files**: `containers.service.ts`, `frp.service.ts`, `reverse-proxy.service.ts`.
    - Remove the `OperationLogService` dependency from these files.
    - Inject the `LoggingGateway`.
    - Replace all instances of the local `log` helper function with direct calls to `loggingGateway.log()`. For example: `log('info', 'Message')` becomes `this.loggingGateway.log('info', 'Message')`.

## Phase 4: Cleanup and Verification

Finalize the refactoring and ensure everything works as expected.

- [ ] **4.1. Remove `opId` Prop-Drilling**:
    - Go through all modified methods (from `Controller` down to `Service` down to `DockerService`) and remove the `opId` parameter from their signatures, as it is no longer needed.
- [ ] **4.2. Code Review**:
    - Review all changed files to ensure consistency and that no old logging logic remains.
- [ ] **4.3. Manual Testing**:
    - Manually trigger a "Discover Containers" operation from the frontend.
    - Verify that the real-time logs appear correctly in the task drawer.
    - After the operation is complete, refresh the page and verify that all logs (both high-level business steps and low-level command output) have been correctly persisted in the database and are displayed.
    - Trigger an automation rule and verify its logs are also captured correctly.

## Phase 5: Deprecate and Remove `addLogEntry`

The legacy `addLogEntry` method is an `async` operation that directly writes to the database. This conflicts with the new fire-and-forget, event-driven `log` method, causing race conditions and duplicate log entries. It must be completely removed.

- [x] **5.1. Refactor Frontend UI Log Handling**:
    - **Target Files**: `apps/web/components/TaskDrawer.tsx`, `apps/web/lib/stores/task-drawer-store.ts`.
    - The frontend currently uses `addLogEntry` to optimistically update the UI.
    - Modify the frontend stores and components to rely solely on WebSocket events (`log-stream`) for real-time log updates. Remove any direct API calls to `addLogEntry`.

- [x] **5.2. Remove Backend Usage in Deprecated Modules**:
    - **Target File**: `apps/server/src/actions/actions.service.ts`.
    - The deprecated `actions` module still uses `addLogEntry`.
    - Since this module is deprecated, remove the calls to `addLogEntry` entirely. The new `automations` module should be used instead, which will use the proper logging gateway.

- [x] **5.3. Remove `addLogEntry` from `OperationLogService`**:
    - **Target File**: `apps/server/src/operation-log/operation-log.service.ts`.
    - Delete the `addLogEntry` method from the service.
    - Remove the corresponding DTO and any related types.

- [x] **5.4. Remove `addLogEntry` from Controller and API Route**:
    - **Target File**: `apps/server/src/operation-log/operation-log.controller.ts`.
    - Remove the `addLogEntry` endpoint (`POST /api/v1/operation-log/entry`).

- [x] **5.5. Final Verification**:
    - Manually run an operation that previously caused duplicate logs (e.g., "Discover Containers").
    - Verify in the UI and the database that logs are no longer duplicated.
    - Confirm that real-time log streaming still functions correctly.
