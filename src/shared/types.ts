// ============================================================
// Parsed Intent (output of Bedrock)
// ============================================================
export interface ParsedIntent {
  action: 'create_workspace' | 'list_templates' | 'workspace_status' | 'help';
  confidence: number;
  workspace: {
    name: string;
    templateId: string;
    templateName: string;
  };
  repository: {
    url: string;
    branch: string;
    cloneDepth: number;
  };
  developer: {
    slackUserId: string;
    gitName: string;
    gitEmail: string;
  };
  environment: Record<string, string>;
  secretRefs: string[];
  steps: string[];
}

// ============================================================
// ONEagent Trace Events
// ============================================================
export type TraceEventType =
  | 'received_slack_message'
  | 'received_jira_comment'
  | 'parsed_intent'
  | 'bedrock_plan_created'
  | 'coder_template_selected'
  | 'coder_workspace_created'
  | 'repo_cloned'
  | 'secrets_injected'
  | 'workspace_ready'
  | 'error';

export interface TraceEvent {
  traceId: string;
  eventType: TraceEventType;
  timestamp: string;
  durationMs?: number;
  status: 'started' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
}

export interface Trace {
  traceId: string;
  slackUserId: string;
  slackChannel: string;
  events: TraceEvent[];
  startedAt: string;
  completedAt?: string;
  status: 'in_progress' | 'completed' | 'failed';
}

// ============================================================
// Slack Types
// ============================================================
export interface SlackEventPayload {
  type: string;
  token?: string;
  challenge?: string;
  event?: {
    type: string;
    user: string;
    text: string;
    channel: string;
    ts: string;
    event_ts: string;
    bot_id?: string;
    subtype?: string;
    channel_type?: string;
  };
}

// ============================================================
// Orchestrator Payload (webhook → orchestrator)
// ============================================================
interface BasePayload {
  messageText: string;
  requesterId: string;
}

export interface SlackPayload extends BasePayload {
  source: 'slack';
  slackChannel: string;
  messageTs: string;
}

export interface JiraPayload extends BasePayload {
  source: 'jira';
  issueKey: string;
  issueId: string;
  projectKey: string;
  commentAuthor: string;
}

export type OrchestratorPayload = SlackPayload | JiraPayload;

// ============================================================
// Jira Webhook Types
// ============================================================
export interface JiraWebhookEvent {
  webhookEvent: string;
  issue: {
    id: string;
    key: string;
    fields: {
      project: {
        key: string;
        name: string;
      };
      summary: string;
    };
  };
  comment: {
    id: string;
    body: string;
    author: {
      accountId: string;
      displayName: string;
      emailAddress?: string;
    };
    created: string;
  };
}

// ============================================================
// Coder Types
// ============================================================
export interface CoderTemplate {
  id: string;
  name: string;
  display_name: string;
  description: string;
  active_version_id: string;
}

export interface CoderWorkspace {
  id: string;
  name: string;
  owner_name: string;
  template_name: string;
  latest_build: {
    id: string;
    status: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'canceling' | 'canceled' | 'deleting' | 'deleted';
    build_number: number;
  };
  access_url?: string;
}

export interface CreateWorkspaceParams {
  name: string;
  template_id: string;
  template_version_id: string;
  rich_parameter_values?: Array<{ name: string; value: string }>;
}
