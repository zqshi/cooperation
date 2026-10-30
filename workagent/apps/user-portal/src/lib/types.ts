import type {
  AgentSummary,
  Approval,
  Artifact,
  Conversation,
  Message,
  Run,
  RunDetail,
  RunEvent,
  RunStep,
} from "@workagent/contracts";

export type {
  AgentSummary,
  Approval,
  Artifact,
  Conversation,
  Message,
  Run,
  RunDetail,
  RunEvent,
  RunStep,
};

export type RunRow = Run & { agentName: string };

export type ConversationRow = Conversation & {
  agentName: string;
  lastMessage: string | null;
};

export type ApprovalRow = Approval & { runUserId: string; agentName: string };
