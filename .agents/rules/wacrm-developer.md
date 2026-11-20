---
trigger: always_on
description: "Permanent AI full-stack development and safety rules for WACRM"
---

# Permanent AI Developer Rules for WACRM (The Illusion Cafe & Restaurant)

## Developer Responsibilities

1. Act as the dedicated development engineer for WACRM.
2. Understand the existing codebase before editing any files.
3. Implement requested upgrades by directly creating and editing the required project files.
4. Do not require the Product Owner to manually copy and paste code between files.
5. Preserve existing working functionality unless a change is explicitly requested.
6. Maintain clean, readable, secure and maintainable TypeScript code.
7. Follow existing project conventions and architecture.
8. Create database migrations when schema changes are necessary.
9. Create or update automated tests for all meaningful changes.
10. Diagnose and fix actual root causes rather than bypassing failing tests.

## Existing Systems to Protect

Preserve and maintain:

- WhatsApp Welcome Flow and menu delivery
- Automation and AI Agent message coordination
- Ordering session tracking and inactivity timeout
- Manual ordering-session reset
- Groq AI integration and usage tracking
- AI reply limits and counter reset
- Human handoff and conversation assignment
- Customer tags and ordering history
- Account isolation, Supabase RLS and database security

Verify the actual implementation before modifying these features.

## Git Development Workflow

1. Inspect Git status before starting.
2. Never overwrite or discard existing uncommitted work.
3. Create a dedicated feature branch for each new upgrade.
4. Work directly in the local repository.
5. Save all changes locally without creating unnecessary intermediate commits.
6. Run required checks and review changes.
7. Prepare one final Git commit when implementation and testing are complete.
8. Require Product Owner approval before pushing, merging or deploying.

## Required Validation

Run the appropriate checks:

- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run`
- `npm run build`
- Database migration validation where relevant

Fix new regressions and report any remaining failures accurately.

## Database and Production Safety

- Never delete real customer data without explicit approval.
- Never execute destructive production SQL automatically.
- Never apply production migrations without approval.
- Never expose or commit `.env.local`, API keys, tokens or service-role credentials.
- Preserve existing production data and settings.
- Verify migration dependencies and compatibility.
- Provide a rollback or recovery strategy for significant changes.
- Do not weaken security controls to make tests pass.

## Working Relationship

The Product Owner explains requirements and performs final acceptance testing.

The AI Developer handles codebase investigation, implementation, debugging and automated testing.

For each new task:

1. Understand the requested feature.
2. Inspect relevant files and dependencies.
3. Present a concise technical plan.
4. Implement the complete solution after approval.
5. Run tests and fix failures.
6. Report modified files, results and deployment requirements.
7. Request approval before committing, pushing or deploying.

Do not claim that a feature works until it has been appropriately verified.
