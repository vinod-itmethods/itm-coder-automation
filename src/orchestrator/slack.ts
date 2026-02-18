import { WebClient } from '@slack/web-api';
import { getSlackBotToken } from '../shared/secrets.js';
import { logger } from '../shared/logger.js';
import type { ParsedIntent } from '../shared/types.js';
import type { StatusNotifier } from './notifier.js';

let _client: WebClient | null = null;

async function getClient(): Promise<WebClient> {
  if (_client) return _client;
  const token = await getSlackBotToken();
  _client = new WebClient(token);
  return _client;
}

export class SlackNotifier implements StatusNotifier {
  private channel: string;
  private threadTs: string;

  constructor(channel: string, threadTs: string) {
    this.channel = channel;
    this.threadTs = threadTs;
  }

  async postStatusMessage(intent: ParsedIntent, traceId: string): Promise<string> {
    const client = await getClient();

    const result = await client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
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
    logger.info('Posted status message to Slack', { channel: this.channel, messageTs });
    return messageTs;
  }

  async updateStatus(handle: string, status: string, emoji: string): Promise<void> {
    const client = await getClient();

    await client.chat.update({
      channel: this.channel,
      ts: handle,
      text: status,
      blocks: undefined,
    });

    await client.chat.postMessage({
      channel: this.channel,
      thread_ts: handle,
      text: `${emoji} ${status}`,
    });

    logger.info('Updated Slack status', { channel: this.channel, status });
  }

  async postCompletion(
    handle: string,
    workspaceUrl: string,
    traceUrl: string,
    durationSec: number
  ): Promise<void> {
    const client = await getClient();

    await client.chat.postMessage({
      channel: this.channel,
      thread_ts: handle,
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

    logger.info('Posted completion to Slack', { channel: this.channel, workspaceUrl, durationSec });
  }

  async postError(
    handle: string | null,
    error: string,
    traceId: string
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
      channel: this.channel,
      thread_ts: handle || this.threadTs,
      text: `Provisioning failed: ${error}`,
      blocks,
    });

    logger.error('Posted error to Slack', { channel: this.channel, error, traceId });
  }

  async postClarification(message: string): Promise<void> {
    const client = await getClient();

    await client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
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

  async postKbAnswer(answer: string): Promise<void> {
    const client = await getClient();

    await client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: answer,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:books: *From the Knowledge Base:*\n\n${answer}`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '_Sourced from Slack channel history and company documents_' },
          ],
        },
      ],
    });

    logger.info('Posted KB answer to Slack', { channel: this.channel, answerLength: answer.length });
  }
}
