export type ErrorCode = 'unauthorized' | 'forbidden' | 'not_found_or_inaccessible'
  | 'rate_limited' | 'provider_error' | 'timeout' | 'network_error'
  | 'invalid_response' | 'pagination_limit' | 'inconsistent_evidence';
export interface CollectionError {
  code: ErrorCode;
  message: string;
  action: string;
}
export interface Source {
  url: string;
  observedAt: string;
  httpStatus: number | null;
  attempts: number;
  error: CollectionError | null;
}
export interface Observation<T> {
  status: 'collected' | 'partial' | 'failed' | 'not_collected' | 'not_applicable';
  value: T | null;
  sources: Source[];
}
export type Project = import('zod').infer<typeof import('./schemas.ts').projectSchema>;
export type Branch = import('zod').infer<typeof import('./schemas.ts').branchSchema>;
export type ProtectionRule = import('zod').infer<typeof import('./schemas.ts').ruleSchema>;
export interface ProjectEvidence {
  requestedProjectId: number;
  startedAt: string;
  finishedAt: string;
  outcome: 'complete' | 'partial' | 'failed';
  posture: 'protected' | 'unprotected' | 'no_default_branch' | 'unknown';
  project: Observation<Project>;
  branch: Observation<Branch>;
  protectionRules: Observation<ProtectionRule[]>;
  matchingRules: ProtectionRule[];
  issues: CollectionError[];
}
