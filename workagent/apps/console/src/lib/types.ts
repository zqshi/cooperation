import type {
  AgentRevision,
  AgentSummary,
  Approval,
  Artifact,
  AuditLog,
  ChannelAccount,
  Connector,
  Conversation,
  DashboardStats,
  Document,
  EvalCase,
  EvalDataset,
  EvalRun,
  KnowledgeSpace,
  Member,
  Message,
  Run,
  RunDetail,
  RunStep,
  Skill,
  UsageSummary,
} from "@workagent/contracts";

export type {
  AgentRevision,
  AgentSummary,
  Approval,
  Artifact,
  AuditLog,
  ChannelAccount,
  Connector,
  Conversation,
  DashboardStats,
  Document,
  EvalCase,
  EvalDataset,
  EvalRun,
  KnowledgeSpace,
  Member,
  Message,
  Run,
  RunDetail,
  RunStep,
  Skill,
  UsageSummary,
};

export type AgentDetail = {
  agent: AgentSummary;
  draft: AgentRevision | null;
  published: AgentRevision | null;
  revisions: AgentRevision[];
};

export type RunRow = Run & { agentName: string };

export type ApprovalRow = Approval & { runUserId: string; agentName: string };

export type DocumentRow = Document;

export type EvalRunRow = EvalRun & { datasetName?: string };

export type UsageResponse = { summary: UsageSummary };

export type DashboardResponse = { stats: DashboardStats };
