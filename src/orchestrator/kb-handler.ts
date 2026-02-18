import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { SlackNotifier } from './slack.js';

export async function handleKbQuery(
  messageText: string,
  notifier: SlackNotifier,
  requesterId: string
): Promise<void> {
  const config = getConfig();

  if (!config.kbAgentId || !config.kbAgentAliasId) {
    logger.error('KB agent not configured', { kbAgentId: config.kbAgentId });
    await notifier.postClarification(
      'The knowledge base is not configured yet. Please contact your administrator to set `KB_AGENT_ID` and `KB_AGENT_ALIAS_ID`.'
    );
    return;
  }

  const client = new BedrockAgentRuntimeClient({ region: config.bedrockRegion });
  const sessionId = randomUUID();

  logger.info('Invoking KB agent', {
    agentId: config.kbAgentId,
    aliasId: config.kbAgentAliasId,
    sessionId,
    requesterId,
  });

  await notifier.postClarification(':mag: Searching the knowledge base...');

  try {
    const res = await client.send(
      new InvokeAgentCommand({
        agentId: config.kbAgentId,
        agentAliasId: config.kbAgentAliasId,
        sessionId,
        inputText: messageText,
      })
    );

    const chunks: string[] = [];
    if (res.completion) {
      for await (const event of res.completion) {
        if (event.chunk?.bytes) {
          chunks.push(new TextDecoder().decode(event.chunk.bytes));
        }
      }
    }

    const answer = chunks.join('').trim();

    if (!answer) {
      await notifier.postClarification(
        ':thinking_face: The knowledge base returned an empty response. Try rephrasing your question.'
      );
      return;
    }

    await notifier.postKbAnswer(answer);

    logger.info('KB query answered', { sessionId, answerLength: answer.length });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('KB agent invocation failed', { sessionId, error: errorMessage });
    await notifier.postError(null, `Knowledge base search failed: ${errorMessage}`, sessionId);
  }
}
