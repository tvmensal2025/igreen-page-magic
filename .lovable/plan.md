# Plan: Bot Conversation Logic Fixes (Pizza/Video/Names)

The user reported issues with the bot's conversation logic, specifically:
1.  **Pizza/Motor messages not responding correctly:** Mentioned leads "Rodrigo" and "Wilton" having issues with the flow.
2.  **Video persists even after removal:** Leads continue to receive video messages even when they were supposedly removed from the flow.
3.  **Name resolution failure:** A lead named "Wilton" was not addressed by name even though the system already had it saved.
4.  **Rodrigo name issue:** The system is sending messages with incorrect names for the superadmin (Rodrigo).

## Proposed Changes

### 1. Fix Name Resolution (`_shared/customer-display-name.ts`)
The current logic in `safeFirstNameForAddress` only considers a source addressable if it's in a hardcoded list. I will ensure `cadence` is included if the name passes the usability check, or ensure that when a name is imported via cadence, the source is marked appropriately.
Actually, the issue with Wilton might be that `name_source` is set to `cadence`, which is in `NON_ADDRESSABLE_NAME_SOURCES`. I will move `cadence` to `ADDRESSABLE_NAME_SOURCES` after adding a verification step to ensure it's not a push-name.

### 2. Fix Video Persistence in Bot Flow (`evolution-webhook` and `whapi-webhook`)
The bot flow handlers for `pos_video` and `checkin_pos_video` might be hardcoded to expect a video or have stale logic. I will update `conversational/index.ts` in both webhooks to properly check if a video is actually configured in the `bot_flow_steps` before attempting to send or transition based on it.

### 3. Fix Superadmin Name Leak (`_shared/render-vars.ts`)
Ensure that the `representante` variable correctly resolves to "Rafael" for the superadmin account, regardless of how the lead was assigned or if there are duplicate Rodrigo records. I'll add a specific guard for the superadmin email/ID.

### 4. Database Cleanup (Action)
I will provide a SQL snippet to merge/cleanup duplicate leads as requested by the user ("analisie pq tem 3 nome igual e nao pode").

## Verification Plan

### Automated Tests
- Run `vitest` on `safeFirstNameForAddress` to ensure Wilton (source=cadence) is now addressable.
- Run `vitest` on `renderTemplateVars` with superadmin context.

### Manual Verification
- Inspect the `bot_flow_steps` for the active flow to confirm no video is linked to the steps reported.
- Verify conversation logs after the fix to ensure the name "Wilton" appears in the greeting.
