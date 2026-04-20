import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readAgentScopedProjectId(metadata: Record<string, unknown> | null | undefined): string | null {
  return readNonEmptyString(metadata?.projectId);
}

export function assertAgentProjectAssignment(input: {
  scopedProjectId: string | null;
  targetProjectId: string | null | undefined;
}) {
  if (!input.scopedProjectId) return;
  if (!input.targetProjectId) {
    throw unprocessable("Assignee project-scoped agent requires a project");
  }
  if (input.targetProjectId !== input.scopedProjectId) {
    throw unprocessable("Assignee agent must belong to the selected project");
  }
}

export async function assertAssignableAgent(input: {
  db: Db;
  companyId: string;
  agentId: string | null | undefined;
  targetProjectId?: string | null;
  pendingApprovalMessage: string;
  terminatedMessage: string;
}) {
  if (!input.agentId) return;

  const agent = await input.db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      status: agents.status,
      metadata: agents.metadata,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .then((rows) => rows[0] ?? null);

  if (!agent) throw notFound("Assignee agent not found");
  if (agent.companyId !== input.companyId) {
    throw unprocessable("Assignee must belong to same company");
  }
  if (agent.status === "pending_approval") {
    throw conflict(input.pendingApprovalMessage);
  }
  if (agent.status === "terminated") {
    throw conflict(input.terminatedMessage);
  }

  assertAgentProjectAssignment({
    scopedProjectId: readAgentScopedProjectId(agent.metadata),
    targetProjectId: input.targetProjectId,
  });
}
