import { logger } from "./logger.js";
import { parseAuditLog } from "./parser.js";
import type { PostgresAuditSession, PostgresSessionQuery } from "./types.js";
import { version0_0_1 } from "./types.js"
import {
  newCloudWatchLogsClient,
} from "./client.js";

const client = newCloudWatchLogsClient();

// Maximum response size in bytes (stay well under 6MB Lambda limit)
const MAX_RESPONSE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB to leave headroom for JSON overhead
const CLOUDWATCH_PAGE_LIMIT = 10000;

/**
 * Query CloudWatch Logs for pgAudit session logs matching the criteria.
 * Returns the N most recent events that match the filter criteria.
 */
export async function queryAuditLogs(
  query: PostgresSessionQuery,
  dbIdentifier: string
): Promise<PostgresAuditSession> {
  const logGroupName = `/aws/rds/instance/${dbIdentifier}/postgresql`;

  logger.info(
    {
      logGroupName,
      query,
    },
    "Querying CloudWatch Logs"
  );

  const result = await filterLogEvents(
    logGroupName,
    query
  );

  logger.info(
    {
      eventCount: result.events.length,
      requestId: query.requestId,
    },
    "Collected audit events"
  );

  return result;
}

/**
 * Filter log events from all log streams in the log group.
 * When logStreamNames is not specified, FilterLogEventsCommand searches all log streams.
 * Returns the N most recent events matching the filter pattern.
 */
async function filterLogEvents(
  logGroupName: string,
  query: PostgresSessionQuery,
): Promise<PostgresAuditSession> {
  const { principal, startMillis, endMillis, limit, terms } = query;

  // Build filter pattern with principal and additional terms (AND logic)
  const filterTerms = [principal, ...(terms ?? [])];
  const filterPattern = filterTerms.map(term => `"${term}"`).join(" ");

  logger.debug(
    { principal, terms, filterPattern, startMillis, endMillis, limit },
    "Filtering log events across all streams"
  );

  // Collect events until we have enough or run out
  const events: PostgresAuditSession["events"] = [];
  let nextToken: string | undefined = undefined;
  let estimatedSize = 0;

  do {
    const response = await client.filterLogEvents({
      logGroupName,
      // Omit logStreamNames to search all log streams
      startTime: startMillis,
      endTime: endMillis,
      filterPattern,
      limit: CLOUDWATCH_PAGE_LIMIT,
      nextToken,
    });

    if (response.events) {
      for (const event of response.events) {
        if (event.message) {
          const parsedEvent = parseAuditLog(event.message);
          if (parsedEvent) {
            events.push(parsedEvent);
            // Estimate size based on raw message in parsed event
            // Multiply by two since the raw message itself is also returned
            estimatedSize += parsedEvent.raw.length * 2;

            // Stop if we've reached the size limit
            if (estimatedSize >= MAX_RESPONSE_SIZE_BYTES) {
              logger.warn(
                { eventCount: events.length, estimatedSize },
                "Stopping collection due to size limit"
              );
              break;
            }
          }
        }
      }
    }

    nextToken = response.nextToken;
  } while (nextToken);

  // Events are already sorted by timestamp ascending (chronological order)
  // Take the N most recent events (up to limit)
  const recentEvents = events.slice(Math.max(0, events.length - limit));

  return { events: recentEvents, version: version0_0_1 };
}
