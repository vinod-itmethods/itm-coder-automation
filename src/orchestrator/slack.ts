import { WebClient } from '@slack/web-api';
import { getSlackBotToken } from '../shared/secrets.js';
import { logger } from '../shared/logger.js';
import type { ParsedIntent } from '../shared/types.js';

let _client: WebClient | null = null;

async function getClient(): Promise<WebClient> {
  if (_client) return _client;
  const token = await getSlackBotToken();
  _client = new WebClient(token);
  return _client;
}

// ============================================================
// Post provisioning status (initial message)
// ============================================================
export async function postStatusMessage(
  channel: string,
  intent: ParsedIntent,
  traceId: string,
  threadTs?: string
): Promise<string> {
  const client = await getClient();

  const result = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Provisioning workspace "${intent.workspace.name}"...`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'ONEdevops Workspace Provisioning', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Template:* ${intent.workspace.templateName}`,
            `*Repository:* ${intent.repository.url || 'None specified'}`,
            `*Branch:* ${intent.repository.branch}`,
            `*Workspace:* ${intent.workspace.name}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Plan:*\n${intent.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `:hourglass_flowing_sand: *Status:* Queued for provisioning...` },
          { type: 'mrkdwn', text: `Trace: \`${traceId}\`` },
        ],
      },
    ],
  });

  const messageTs = result.ts!;
  logger.info('Posted status message to Slack', { channel, messageTs });
  return messageTs;
}

// ============================================================
// Update status in-place
// ============================================================
export async function updateStatus(
  channel: string,
  messageTs: string,
  status: string,
  emoji: string
): Promise<void> {
  const client = await getClient();

  await client.chat.update({
    channel,
    ts: messageTs,
    text: status,
    blocks: undefined, // keep existing blocks, just update the last context block
  });

  // Post a thread reply with the status update for visibility
  await client.chat.postMessage({
    channel,
    thread_ts: messageTs,
    text: `${emoji} ${status}`,
  });

  logger.info('Updated Slack status', { channel, status });
}

// ============================================================
// Post completion message
// ============================================================
export async function postCompletion(
  channel: string,
  messageTs: string,
  workspaceUrl: string,
  traceUrl: string,
  durationSec: number
): Promise<void> {
  const client = await getClient();

  await client.chat.postMessage({
    channel,
    thread_ts: messageTs,
    text: `Workspace ready! ${workspaceUrl}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            ':white_check_mark: *Workspace Ready!*',
            '',
            `:link: <${workspaceUrl}|Open Workspace>`,
            `:clipboard: <${traceUrl}|View Trace>`,
            `:stopwatch: Completed in ${durationSec}s`,
          ].join('\n'),
        },
      },
    ],
  });

  logger.info('Posted completion to Slack', { channel, workspaceUrl, durationSec });
}

// ============================================================
// Post error message
// ============================================================
export async function postError(
  channel: string,
  messageTs: string | null,
  error: string,
  traceId: string,
  threadTs?: string
): Promise<void> {
  const client = await getClient();

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:x: *Provisioning Failed*\n\n${error}\n\nTrace: \`${traceId}\``,
      },
    },
  ];

  await client.chat.postMessage({
    channel,
    thread_ts: messageTs || threadTs,
    text: `Provisioning failed: ${error}`,
    blocks,
  });

  logger.error('Posted error to Slack', { channel, error, traceId });
}

// ============================================================
// Post clarification (low confidence)
// ============================================================
export async function postClarification(
  channel: string,
  message: string,
  threadTs?: string
): Promise<void> {
  const client = await getClient();

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: message,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:thinking_face: *I need a bit more info*\n\n${message}`,
        },
      },
    ],
  });
}
