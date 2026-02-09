import { logger } from '../shared/logger.js';
import { runPipeline } from './pipeline.js';
import type { OrchestratorPayload } from '../shared/types.js';

export async function handler(event: OrchestratorPayload): Promise<void> {
  logger.info('Orchestrator invoked', {
    slackUser: event.slackUserId,
    channel: event.slackChannel,
    textLength: event.messageText.length,
  });

  await runPipeline(event);
}
