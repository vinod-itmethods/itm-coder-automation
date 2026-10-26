import { WebClient } from '@slack/web-api';
import { getSlackBotToken } from '../shared/secrets.js';
import { logger } from '../shared/logger.js';
import { generateAnswer } from './bedrock.js';
import type { SlackNotifier } from './slack.js';

// Option B: answer questions live from Launch Pad channel history — no knowledge
// base, no Bedrock agent, no ingestion. We read the channels on demand and hand
// the recent messages to Claude (via the working InvokeModel path) to summarize.

// Only pull channels whose name marks them as Launch Pad (per the user's rule).
const LP_NAME = /launch/i;
const CHANNEL_PREFIX = 'issue-ps-';
const MAX_MSGS_PER_CHANNEL = 30;
const LOOKBACK_DAYS = 45;
const CONTEXT_CHAR_BUDGET = 140_000; // ~35K tokens, well within Claude's window

function isLaunchPadChannel(name: string | undefined): boolean {
  return !!name && name.startsWith(CHANNEL_PREFIX) && LP_NAME.test(name);
}

async function listLaunchPadChannels(slack: WebClient): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;
  do {
    const r = await slack.conversations.list({
      types: 'public_channel', limit: 200, exclude_archived: true, cursor,
    });
    for (const c of r.channels ?? []) {
      if (c.id && isLaunchPadChannel(c.name)) out.push({ id: c.id, name: c.name! });
    }
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

// Resolve a Slack user id to a display name, cached across the invocation.
async function nameResolver(slack: WebClient) {
  const cache = new Map<string, string>();
  return async (uid: string | undefined): Promise<string> => {
    if (!uid) return 'unknown';
    if (cache.has(uid)) return cache.get(uid)!;
    let name = uid;
    try {
      const r = await slack.users.info({ user: uid });
      name = r.user?.profile?.real_name || r.user?.real_name || r.user?.name || uid;
    } catch { /* bots / deleted users */ }
    cache.set(uid, name);
    return name;
  };
}

async function buildChannelContext(
  slack: WebClient,
  channel: { id: string; name: string },
  resolve: (uid?: string) => Promise<string>,
): Promise<string> {
  const oldest = String(Math.floor((Date.now() - LOOKBACK_DAYS * 86400_000) / 1000));
  let history;
  try {
    history = await slack.conversations.history({
      channel: channel.id, limit: MAX_MSGS_PER_CHANNEL, oldest,
    });
  } catch (err) {
    logger.warn('history fetch failed', { channel: channel.name, error: String(err) });
    return '';
  }
  const msgs = (history.messages ?? [])
    .filter(m => m.type === 'message' && m.subtype !== 'channel_join' && (m.text ?? '').trim())
    .reverse(); // oldest-first for readability
  if (!msgs.length) return '';

  const lines: string[] = [];
  for (const m of msgs) {
    const who = await resolve(m.user || m.bot_id);
    const when = m.ts ? new Date(Number(m.ts) * 1000).toISOString().slice(0, 10) : '';
    const text = (m.text ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`[${when}] ${who}: ${text}`);
  }
  return `## #${channel.name}\n${lines.join('\n')}`;
}

export async function handleKbQuery(
  messageText: string,
  notifier: SlackNotifier,
  requesterId: string,
): Promise<void> {
  const token = await getSlackBotToken();
  const slack = new WebClient(token);

  await notifier.postClarification(':rocket: Reading the Launch Pad channels...');

  try {
    const channels = await listLaunchPadChannels(slack);
    logger.info('Launch Pad channels found', { count: channels.length, requesterId });
    if (!channels.length) {
      await notifier.postClarification('I could not find any Launch Pad channels to read.');
      return;
    }

    const resolve = await nameResolver(slack);
    const blocks: string[] = [];
    let used = 0;
    for (const ch of channels) {
      const ctx = await buildChannelContext(slack, ch, resolve);
      if (!ctx) continue;
      if (used + ctx.length > CONTEXT_CHAR_BUDGET) break;
      blocks.push(ctx);
      used += ctx.length;
    }

    if (!blocks.length) {
      await notifier.postClarification('The Launch Pad channels have no recent messages to summarize.');
      return;
    }

    const system = `You are REIGNdevops, iTmethods' presales assistant. You are given recent message history from the active Launch Pad customer channels in Slack. Answer the user's question using ONLY this context. Be concrete: cite customer/channel names, call out priorities, blockers, deadlines, and next steps. Use Slack mrkdwn (*bold*, • bullets). If the context does not cover something, say so briefly rather than inventing it.`;
    const userPrompt = `User question: ${messageText}\n\n=== Launch Pad channel context (${blocks.length} channels) ===\n\n${blocks.join('\n\n')}`;

    const answer = await generateAnswer(system, userPrompt, 1800);
    if (!answer) {
      await notifier.postClarification(':thinking_face: I could not generate a summary. Try rephrasing your question.');
      return;
    }

    await notifier.postKbAnswer(answer);
    logger.info('Launch Pad query answered', { channels: blocks.length, answerLength: answer.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Launch Pad query failed', { error: msg });
    await notifier.postError(null, `Launch Pad summary failed: ${msg}`, requesterId);
  }
}
