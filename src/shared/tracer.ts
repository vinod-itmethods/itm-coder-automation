import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import type { TraceEvent, TraceEventType } from './types.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export class OneAgentTracer {
  readonly traceId: string;
  private slackUserId: string;
  private startTimes = new Map<string, number>();

  constructor(traceId: string, slackUserId: string) {
    this.traceId = traceId;
    this.slackUserId = slackUserId;
  }

  async emit(
    eventType: TraceEventType,
    metadata: Record<string, unknown> = {},
    status: TraceEvent['status'] = 'completed'
  ): Promise<void> {
    const now = new Date();

    const startTime = this.startTimes.get(eventType);
    const durationMs = startTime ? now.getTime() - startTime : undefined;
    this.startTimes.delete(eventType);

    // Log to CloudWatch (structured JSON)
    logger.info(`[TRACE] ${eventType}`, {
      traceId: this.traceId,
      eventType,
      status,
      durationMs,
      ...metadata,
    });

    // Write to DynamoDB
    const tableName = getConfig().tracesTableName;
    if (tableName) {
      try {
        await ddbClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              traceId: this.traceId,
              eventKey: `${eventType}#${now.toISOString()}`,
              slackUserId: this.slackUserId,
              timestamp: now.toISOString(),
              eventType,
              status,
              durationMs,
              metadata,
              ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60, // 90 days
            },
          })
        );
      } catch (err) {
        logger.error('Failed to write trace to DynamoDB', {
          error: String(err),
          traceId: this.traceId,
          eventType,
        });
      }
    }
  }

  startTimer(eventType: TraceEventType): void {
    this.startTimes.set(eventType, Date.now());
  }

  async emitError(message: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.emit('error', { message, ...metadata }, 'failed');
  }

  getTraceUrl(): string {
    return `https://oneagent.itm-one.online/traces/${this.traceId}`;
  }
}
