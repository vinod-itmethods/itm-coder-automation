import { createHmac, timingSafeEqual } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getConfig } from '../shared/config.js';
import { getSlackSigningSecret } from '../shared/secrets.js';
import { logger } from '../shared/logger.js';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { SlackEventPayload, OrchestratorPayload } from '../shared/types.js';

const lambdaClient = new LambdaClient({});

// ============================================================
// Slack Signature Verification
// ============================================================
async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  const signingSecret = await getSlackSigningSecret();

  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    logger.warn('Slack request timestamp too old', { timestamp, now });
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');
  const computed = `v0=${hmac}`;

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ============================================================
// Async invoke orchestrator
// ============================================================
async function invokeOrchestrator(payload: OrchestratorPayload): Promise<void> {
  const config = getConfig();

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: config.orchestratorFunctionName,
      InvocationType: 'Event', // fire-and-forget
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  logger.info('Orchestrator invoked async', {
    source: payload.source,
    requesterId: payload.requesterId,
  });
}

// ============================================================
// Lambda Handler
// ============================================================
export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  // Health check
  if (event.requestContext.http.method === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ status: 'ok', service: 'onedevops-webhook' }) };
  }

  const body = event.body || '';
  const timestamp = event.headers['x-slack-request-timestamp'] || '';
  const signature = event.headers['x-slack-signature'] || '';

  // Verify Slack signature
  const isValid = await verifySlackSignature(body, timestamp, signature);
  if (!isValid) {
    logger.warn('Invalid Slack signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const payload: SlackEventPayload = JSON.parse(body);

  // Handle Slack URL verification challenge
  if (payload.type === 'url_verification') {
    logger.info('Slack URL verification challenge');
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge }),
    };
  }

  // Handle app_mention and DM (message.im) events
  if (payload.type === 'event_callback') {
    const eventType = payload.event?.type;

    // Process app_mention (channel) and message (DM) events
    if (eventType === 'app_mention' || eventType === 'message') {
      const { user, text, channel, ts } = payload.event!;

      // Ignore bot's own messages to prevent loops
      if (payload.event?.bot_id || payload.event?.subtype) {
        logger.debug('Ignoring bot/subtype message', { bot_id: payload.event?.bot_id, subtype: payload.event?.subtype });
        return { statusCode: 200, body: '' };
      }

      logger.info('Received slack event', { eventType, user, channel, textLength: text.length });

      const orchestratorPayload: OrchestratorPayload = {
        source: 'slack',
        requesterId: user,
        slackChannel: channel,
        messageText: text,
        messageTs: ts,
      };

      await invokeOrchestrator(orchestratorPayload);

      return { statusCode: 200, body: '' };
    }
  }

  // Unknown event type — ack silently
  logger.debug('Unhandled event type', { type: payload.type, eventType: payload.event?.type });
  return { statusCode: 200, body: '' };
}
