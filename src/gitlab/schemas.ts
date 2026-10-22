import { z } from 'zod';
const id = z.number().int().positive().safe();
export const projectSchema = z.object({
  id, name: z.string().min(1), web_url: z.url(), visibility: z.string().min(1),
  default_branch: z.string().min(1).nullable(), empty_repo: z.boolean().optional(),
});
export const branchSchema = z.object({ name: z.string().min(1), protected: z.boolean() });
const accessSchema = z.object({
  access_level: z.number().int().nullable().optional(),
  access_level_description: z.string().optional(),
  user_id: id.nullable().optional(), group_id: id.nullable().optional(),
  deploy_key_id: id.nullable().optional(), member_role_id: id.nullable().optional(),
});
export const ruleSchema = z.object({
  id, name: z.string().min(1),
  push_access_levels: z.array(accessSchema), merge_access_levels: z.array(accessSchema),
  unprotect_access_levels: z.array(accessSchema).optional(),
  allow_force_push: z.boolean(), code_owner_approval_required: z.boolean().optional(),
  inherited: z.boolean().optional(),
});
export const rulesSchema = z.array(ruleSchema);

const errorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found_or_inaccessible', 'rate_limited',
    'provider_error', 'timeout', 'network_error', 'invalid_response', 'pagination_limit', 'inconsistent_evidence']),
  message: z.string(), action: z.string(),
});
const sourceSchema = z.object({
  url: z.url(), observedAt: z.iso.datetime(), httpStatus: z.number().int().nullable(),
  attempts: z.number().int().nonnegative(), error: errorSchema.nullable(),
});
function observation<T extends z.ZodType>(value: T) {
  return z.object({ status: z.enum(['collected', 'partial', 'failed', 'not_collected', 'not_applicable']),
    value: value.nullable(), sources: z.array(sourceSchema) });
}
export const projectEvidenceSchema = z.object({
  requestedProjectId: id, startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  outcome: z.enum(['complete', 'partial', 'failed']),
  posture: z.enum(['protected', 'unprotected', 'no_default_branch', 'unknown']),
  project: observation(projectSchema), branch: observation(branchSchema),
  protectionRules: observation(rulesSchema), matchingRules: rulesSchema,
  issues: z.array(errorSchema),
});
