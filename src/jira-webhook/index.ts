import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getConfig } from '../shared/config.js';
import { getJiraWebhookSecret } from '../shared/secrets.js';
import { logger } from '../shared/logger.js';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { JiraWebhookEvent, OrchestratorPayload } from '../shared/types.js';

const lambdaClient = new LambdaClient({});

const TRIGGER_KEYWORD = 'ONEdevops';

async function invokeOrchestrator(payload: OrchestratorPayload): Promise<void> {
  const config = getConfig();

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: config.orchestratorFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  logger.info('Orchestrator invoked async from Jira', {
    issueKey: payload.source === 'jira' ? payload.issueKey : undefined,
    requesterId: payload.requesterId,
  });
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  // Health check / Jira URL validation (GET)
  if (event.requestContext.http.method === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ status: 'ok', service: 'onedevops-jira-webhook' }) };
  }

  // Verify webhook secret from query string
  const secret = event.queryStringParameters?.secret;
  if (!secret) {
    logger.warn('Missing webhook secret in query string');
    return { statusCode: 401, body: 'Missing secret' };
  }

  let expectedSecret: string;
  try {
    expectedSecret = await getJiraWebhookSecret();
  } catch (err) {
    logger.error('Failed to fetch Jira webhook secret', { error: String(err) });
    return { statusCode: 500, body: 'Internal error' };
  }

  if (secret !== expectedSecret) {
    logger.warn('Invalid Jira webhook secret');
    return { statusCode: 401, body: 'Invalid secret' };
  }

  const body = event.body;
  if (!body) {
    return { statusCode: 400, body: 'Empty body' };
  }

  let webhookEvent: JiraWebhookEvent;
  try {
    webhookEvent = JSON.parse(body);
  } catch {
    logger.warn('Invalid JSON in Jira webhook body');
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only process comment_created events
  if (webhookEvent.webhookEvent !== 'comment_created') {
    logger.debug('Ignoring non-comment event', { event: webhookEvent.webhookEvent });
    return { statusCode: 200, body: '' };
  }

  // Check if comment contains trigger keyword
  const commentBody = webhookEvent.comment?.body || '';
  if (!commentBody.includes(TRIGGER_KEYWORD)) {
    logger.debug('Comment does not contain trigger keyword', {
      issueKey: webhookEvent.issue?.key,
    });
    return { statusCode: 200, body: '' };
  }

  // Ignore our own bot replies to prevent feedback loops
  if (commentBody.includes('[ONEdevops]')) {
    logger.debug('Ignoring ONEdevops bot reply', { issueKey: webhookEvent.issue?.key });
    return { statusCode: 200, body: '' };
  }

  const issueKey = webhookEvent.issue.key;
  const projectKey = webhookEvent.issue.fields.project.key;
  const author = webhookEvent.comment.author;

  logger.info('Jira ONEdevops trigger detected', {
    issueKey,
    projectKey,
    author: author.displayName,
    commentLength: commentBody.length,
  });

  const orchestratorPayload: OrchestratorPayload = {
    source: 'jira',
    requesterId: author.accountId,
    messageText: commentBody,
    issueKey,
    issueId: webhookEvent.issue.id,
    projectKey,
    commentAuthor: author.displayName,
  };

  await invokeOrchestrator(orchestratorPayload);

  return { statusCode: 200, body: '' };
}
