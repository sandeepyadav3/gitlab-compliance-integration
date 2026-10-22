# Implementation checkpoints

1. **Backend/API foundation:** implemented. User's Phase 2 live rerun confirmed all
   three scenarios, including the empty repository with configured main.
2. **SQLite evidence/history:** implemented. The user confirmed collection output and
   history return the same completed run. Immutable snapshots and baseline references
   are preserved by the additive Phase 3 migration.
3. **Asynchronous collection/recovery:** implemented. Durable 202 acceptance, bounded
   worker, progress API, single active run, SQLite ownership lease, cancellation, and
   startup interruption recovery.
4. **Semantic comparison:** implemented. Fixed baseline references, canonicalized
   restrictions, unknown/partial coverage, explicit branch-scope transitions, separate
   metadata changes, and deterministic API/CLI comparisons. The user confirmed live
   force-push changes in both directions; a submission demo still needs recording.
5. **React/TypeScript analyst UI:** implemented. Saved selection, progress/reconnection,
   evidence/source detail, fixed-baseline comparisons, history, stale/partial states,
   and bounded polling. Built assets are served by the existing Node server. The user
   confirmed all three live project details and correct per-run changes.
6. **Demos:** implemented. Interactive isolated partial-403/recovery demo, executable
   assertions and clearly synthetic JSON evidence, plus a live recording walkthrough.
   Automated browser checks cover success, failure and recovery. Sanitized live media
   must still be captured by the user before submission; it is not included here.
7. **Delivery verification:** complete. Clean-install checks, final README, architecture
   and production considerations, AI-use statement and submission checklist. The user
   will add the Loom link and push/share the application repository.

Remain within one local user and one server token; no OAuth, cloud hosting, scheduling,
compliance scoring, or multi-tenancy.
