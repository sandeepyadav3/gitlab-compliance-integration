// Type-only imports share API contracts without bundling backend code or configuration.
import type { runView } from '../../src/http/app.ts';
import type { projectReferenceView } from '../../src/comparison/views.ts';
export type Run = ReturnType<typeof runView>;
export type Project = Run['projects'][number];
export type Reference = NonNullable<ReturnType<typeof projectReferenceView>>;
export interface ProjectState { latest: Reference | null; lastComplete: Reference | null; }
export interface Health { status: string; phase: number; tokenConfigured: boolean; }
export interface Selection { projectIds: number[]; updatedAt: string | null; }
