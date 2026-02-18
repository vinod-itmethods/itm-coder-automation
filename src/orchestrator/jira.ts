import { logger } from '../shared/logger.js';
import { getJiraCredentials } from '../shared/secrets.js';
import type { ParsedIntent } from '../shared/types.js';
import type { StatusNotifier } from './notifier.js';

interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

let _credentials: JiraCredentials | null = null;

async function getCredentials(): Promise<JiraCredentials> {
  if (_credentials) return _credentials;
  _credentials = await getJiraCredentials();
  return _credentials;
}

async function postComment(issueKey: string, body: string): Promise<string> {
  const creds = await getCredentials();
  const url = `${creds.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');

  // Jira Cloud REST API v3 requires ADF (Atlassian Document Format)
  const adfBody = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: body }],
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ body: adfBody }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira API error ${response.status}: ${text}`);
  }

  const result = await response.json() as { id: string };
  return result.id;
}

export class JiraNotifier implements StatusNotifier {
  private issueKey: string;

  constructor(issueKey: string) {
    this.issueKey = issueKey;
  }

  async postStatusMessage(intent: ParsedIntent, traceId: string): Promise<string> {
    const lines = [
      `[ONEdevops] Provisioning workspace "${intent.workspace.name}"`,
      '',
      `Template: ${intent.workspace.templateName}`,
      `Repository: ${intent.repository.url || 'None specified'}`,
      `Branch: ${intent.repository.branch}`,
      '',
      `Plan:`,
      ...intent.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      `Status: Queued for provisioning...`,
      `Trace: ${traceId}`,
    ];

    const commentId = await postComment(this.issueKey, lines.join('\n'));
    logger.info('Posted status to Jira', { issueKey: this.issueKey, commentId });
    return commentId;
  }

  async updateStatus(_handle: string, status: string, _emoji: string): Promise<void> {
    // No-op: Jira doesn't support editing comments in-place like Slack.
    // Only post initial plan + final result to keep the ticket clean.
    logger.info('Jira status update (suppressed)', { issueKey: this.issueKey, status });
  }

  async postCompletion(
    _handle: string,
    workspaceUrl: string,
    traceUrl: string,
    durationSec: number
  ): Promise<void> {
    const lines = [
      `[ONEdevops] Workspace Ready!`,
      '',
      `Workspace: ${workspaceUrl}`,
      `Trace: ${traceUrl}`,
      `Completed in ${durationSec}s`,
    ];

    await postComment(this.issueKey, lines.join('\n'));
    logger.info('Posted completion to Jira', { issueKey: this.issueKey, workspaceUrl, durationSec });
  }

  async postError(
    _handle: string | null,
    error: string,
    traceId: string
  ): Promise<void> {
    const lines = [
      `[ONEdevops] Provisioning Failed`,
      '',
      error,
      '',
      `Trace: ${traceId}`,
    ];

    await postComment(this.issueKey, lines.join('\n'));
    logger.error('Posted error to Jira', { issueKey: this.issueKey, error, traceId });
  }

  async postClarification(message: string): Promise<void> {
    await postComment(this.issueKey, `[ONEdevops] ${message}`);
  }
}
