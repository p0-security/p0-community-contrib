import type { Handler } from "aws-lambda";
import { logger } from "./logger.js";
import { queryAuditLogs } from "./query.js";
import type { PostgresAuditSession, PostgresSessionQuery } from "./types.js";

/**
 * Serverless function handler for CloudWatch logs auditing.
 *
 * This function serves as the entry point for serverless execution,
 * being passed input data as an event object. The entry point function
 * can live anywhere in the codebase, and is pointed to by the serverless
 * platform configuration.
 *
 * Serverless functions stay provisioned with the runtime intact for
 * some time after invocation, with state and memory intact. It's good
 * practice to leverage this to avoid repeated work, such as API clients
 * and fetching static data.
 */
export const handler: Handler<PostgresSessionQuery, PostgresAuditSession> = async (
  event,
  context
) => {
  logger.info({ event, requestId: context.awsRequestId }, "Function invoked");

  const dbIdentifier = process.env.DB_IDENTIFIER;
  if (!dbIdentifier) {
    throw new Error("DB_IDENTIFIER environment variable is required");
  }

  // Validate required parameters
  validateSessionQuery(event);

  const session = await queryAuditLogs(event, dbIdentifier);

  logger.info(
    { eventCount: session.events.length, requestId: context.awsRequestId },
    "Function completed successfully"
  );
  return session;
};

/**
 * Validate that all required parameters are present in SessionQuery.
 * @throws Error if validation fails
 */
function validateSessionQuery(query: unknown): asserts query is PostgresSessionQuery {
  const errors: string[] = [];

  if (!query || typeof query !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const q = query as Record<string, unknown>;

  // Validate requestId
  if (!q.requestId || typeof q.requestId !== "string" || q.requestId.trim() === "") {
    errors.push("requestId is required and must be a non-empty string");
  }

  // Validate principal
  if (!q.principal || typeof q.principal !== "string" || q.principal.trim() === "") {
    errors.push("principal is required and must be a non-empty string");
  }

  // Validate startMillis
  if (q.startMillis === undefined || q.startMillis === null) {
    errors.push("startMillis is required");
  } else if (typeof q.startMillis !== "number" || !Number.isFinite(q.startMillis)) {
    errors.push("startMillis must be a valid number");
  }

  // Validate endMillis
  if (q.endMillis === undefined || q.endMillis === null) {
    errors.push("endMillis is required");
  } else if (typeof q.endMillis !== "number" || !Number.isFinite(q.endMillis)) {
    errors.push("endMillis must be a valid number");
  }

  // Validate time range
  if (
    typeof q.startMillis === "number" &&
    typeof q.endMillis === "number" &&
    q.startMillis >= q.endMillis
  ) {
    errors.push("startMillis must be less than endMillis");
  }

  // Validate limit
  if (q.limit === undefined || q.limit === null) {
    errors.push("limit is required");
  } else if (typeof q.limit !== "number" || !Number.isFinite(q.limit)) {
    errors.push("limit must be a valid number");
  } else if (q.limit <= 0) {
    errors.push("limit must be greater than 0");
  }

  // Validate terms (optional)
  if (q.terms !== undefined) {
    if (!Array.isArray(q.terms)) {
      errors.push("terms must be an array of strings");
    } else if (!q.terms.every((term) => typeof term === "string")) {
      errors.push("terms must be an array of strings");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join("; ")}`);
  }
}
