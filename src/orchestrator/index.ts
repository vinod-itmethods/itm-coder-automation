import { logger } from '../shared/logger.js';
import { routeMessage } from './pipeline.js';
import type { OrchestratorPayload } from '../shared/types.js';

export async function handler(event: OrchestratorPayload): Promise<void> {
  logger.info('Orchestrator invoked', {
    source: event.source,
    requesterId: event.requesterId,
    textLength: event.messageText.length,
    ...(event.source === 'slack' ? { channel: event.slackChannel } : { issueKey: event.issueKey }),
  });

  await routeMessage(event);
}
