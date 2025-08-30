# Plan: Adding Scheduled Triggers and Logging Actions

This document outlines the plan to add a new scheduled (CRON-based) trigger and a new "Log a Message" action to the Automation Center. This will allow users to execute actions on a recurring schedule and provide a simple way to test that the trigger mechanism is working correctly.

The implementation will follow the architecture described in Sections VI and VII of the `PROJECT_SPEC.md`, which defines separate `Action`, `Trigger`, and `Notification` entities.

## Phase 1: Backend Implementation (`apps/server`)

### 1.1. Update Data Model (`prisma/schema.prisma`)

- [x] **Modify `Trigger` Model**:
    - [x] Add `SCHEDULE` to the `TriggerType` enum.
    - [x] Add a new optional field `cron` of type `String` to store the CRON expression.

- [ ] **Modify `Action` Model**:
    - [ ] Add `LOG_MESSAGE` to the `ActionType` enum (or equivalent if it's a string field).
    - [ ] The `taskPayload` JSON will be structured to hold a message, e.g., `{ "message": "Container check executed." }`.

### 1.2. Update Shared Types (`packages/shared`)

- [x] Propagate the enum and type changes from the Prisma schema to the shared TypeScript types in `packages/shared/src/index.ts` to ensure consistency between the frontend and backend.

### 1.3. Implement Core Logic (`src/automations`)

- [x] **`automations.service.ts`**:
    - [x] **Trigger Management**:
        - [x] Update the `createTrigger` and `updateTrigger` methods to handle the `SCHEDULE` type.
        - [x] Add validation for the `cron` field to ensure it's a valid CRON expression (using a library like `cron-parser`).
        - [x] Integrate with **BullMQ**:
            - [x] When a `SCHEDULE` trigger is created or enabled, create a **repeatable job** in BullMQ using the provided `cron` expression. The job payload should contain the `actionId`.
            - [x] When a `SCHEDULE` trigger is updated, remove the old repeatable job and create a new one with the updated `cron` expression.
            - [x] When a `SCHEDULE` trigger is disabled or deleted, remove the corresponding repeatable job from BullMQ.
    - [x] **Action Management**:
        - [x] Update `createAction` and `updateAction` to handle the `LOG_MESSAGE` task type and validate its `taskPayload`.

- [x] **`automations.processor.ts` (BullMQ Job Processor)**:
    - [x] This processor will receive the jobs scheduled by the `automations.service`.
    - [x] When a job is processed, it will retrieve the `actionId` from the job payload.
    - [x] It will then fetch the `Action` details from the database.
    - [x] Implement a new case in the processor to handle the `LOG_MESSAGE` `taskType`. This logic will use the standard NestJS `Logger` to print the `message` from the `taskPayload` to the server's console/log file.

### 1.4. Update API Layer (`src/automations/automations.controller.ts`)

- [x] Update the DTOs (Data Transfer Objects) for creating and updating triggers to include the optional `cron` field.
- [x] Update the DTOs for creating and updating actions to correctly handle the `taskPayload` for the `LOG_MESSAGE` type.

## Phase 2: Frontend Implementation (`apps/web`)

### 2.1. Update UI Components (`app/sections/CreateEditAutomation...`)

- [x] **Trigger Form**:
    - [x] Add a "Scheduled" option to the trigger type selection dropdown.
    - [x] When "Scheduled" is selected, conditionally render a text input field for the user to enter the CR- [x] N expression.
    - [x] Provide helper text and possibly a link to a CR- [x] N syntax guide (e.g., crontab.guru) to assist the user.

- [x] **Action Form**:
    - [x] Add a "Log a Message" option to the action type selection dropdown.
    - [x] When "Log a Message" is selected, conditionally render a text area for the user to input the message they want to be logged.

### 2.2. Update State Management and API Calls

- [x] Modify the frontend state management (e.g., React Query, Zustand) to handle the new `cron` and `message` fields.
- [x] Update the API client/service functions responsible for creating/updating actions and triggers to send the new data fields to the backend.

## Phase 3: Testing and Verification

### 3.1. Backend Testing

- [x] **Unit Tests**:
    - [x] Write a unit test for the CRON expression validation logic in `automations.service.ts`.
- [x] **Integration Tests**:
    - [x] Test the BullMQ job scheduling logic:
        - [x] Verify that creating a `SCHEDULE` trigger adds a repeatable job.
        - [x] Verify that deleting the trigger removes the job.
        - [x] Verify that updating the `cron` string updates the job's repeat pattern.

### 3.2. End-to-End (E2E) Testing

- [ ] **Create Action**: Use the UI to create a new action with the type "Log a Message" and a specific message (e.g., "AUTOMATION TEST: Trigger fired successfully").
- [ ] **Create Trigger**: Create a new "Scheduled" trigger associated with the action above. Set the CRON expression to `* * * * *` (to run every minute).
- [ ] **Verify Execution**: Monitor the backend server logs (e.g., `tail -f server.log`).
- [ ] **Confirm**: Confirm that the test message is logged every minute.
- [ ] **Cleanup**: Use the UI to delete the trigger and confirm that the log messages stop appearing.