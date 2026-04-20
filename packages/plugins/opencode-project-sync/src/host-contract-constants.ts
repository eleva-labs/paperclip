export const OPENCODE_PROJECT_HOST_MUTATION_TRANSPORT = "paperclip_rest_api_v1" as const;
export const OPENCODE_PROJECT_HOST_MUTATION_SURFACE = "ui_same_origin_or_worker_http" as const;
export const OPENCODE_PROJECT_HOST_API_BASE_PATH = "/api" as const;

export const OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS = {
  createAgent: "/companies/:companyId/agents",
  updateAgent: "/agents/:agentId",
  syncAgentSkills: "/agents/:agentId/skills/sync?companyId=:companyId",
  createCompanySkill: "/companies/:companyId/skills",
  updateCompanySkillFile: "/companies/:companyId/skills/:skillId/files",
} as const;
