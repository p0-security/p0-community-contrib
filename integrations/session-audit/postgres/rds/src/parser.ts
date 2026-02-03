import { parse } from "csv-parse/sync";
import { compact } from "lodash";
import { logger } from "./logger.js";
import type {
  AuditSessionEvent,
  BaseEvent,
  ErrorEvent,
  GenericLogEvent,
  PostgresAuditEvent,
  PostgresCommandClass,
  StatementEvent,
} from "./types.js";

const DEFAULT_LOG_LINE_PREFIX = "%t:%r:%u@%d:[%p]:";

/**
 * Parsed log_line_prefix format with regex to extract fields.
 */
type LogLinePrefixParser = {
  regex: RegExp;
  fields: (keyof BaseEvent)[];
};

/**
 * Parse PostgreSQL log_line_prefix format and create a parser for it.
 * Supports common escape sequences: %t (timestamp), %r (remote host:port), %u (user), %d (database), %p (pid)
 *
 * @param format - log_line_prefix format string (e.g., "%t:%r:%u@%d:[%p]:")
 * @returns Parser with regex and field names
 */
function createLogLinePrefixParser(format: string): LogLinePrefixParser {
  const fields: (keyof BaseEvent)[] = [];
  let regexPattern = "";

  // Escape special regex characters except our format specifiers
  let escaped = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Replace format specifiers with capture groups
  // Use non-greedy matching (.+?) for fields that might contain separator characters
  // The regex engine will match as little as possible while still satisfying the full pattern

  // %t - timestamp: YYYY-MM-DD HH:MM:SS.mmm TZ (contains colons in time portion)
  escaped = escaped.replace(/%t/g, () => {
    fields.push("ts");
    // Specific pattern for timestamp format
    return "(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)? \\w+)";
  });

  // %r - remote host and port (may contain : for [host]:port format)
  escaped = escaped.replace(/%r/g, () => {
    fields.push("host");
    // Greedy match - matches as much as possible, then backtracks at the next separator
    return "(.+)";
  });

  // %u - username (may contain @ for email addresses like user@example.com)
  escaped = escaped.replace(/%u/g, () => {
    fields.push("user");
    // Greedy match - matches as much as possible, then backtracks to find the @ separator
    // For "user@example.com@test_shop": (.+) initially matches all, then backtracks
    // to match "user@example.com", letting @ match the separator, and (.+) match "test_shop"
    return "(.+)";
  });

  // %d - database name (may contain any characters including potential separators)
  escaped = escaped.replace(/%d/g, () => {
    fields.push("db");
    // Greedy match - matches as much as possible, then backtracks at the next separator
    return "(.+)";
  });

  // %p - process ID (digits only)
  escaped = escaped.replace(/%p/g, () => {
    fields.push("pid");
    return "(\\d+)";
  });

  regexPattern = "^" + escaped;

  return {
    regex: new RegExp(regexPattern),
    fields,
  };
}

/**
 * Extract base event fields from log message using log_line_prefix parser.
 */
function parseLogLinePrefix(message: string, parser: LogLinePrefixParser): BaseEvent | undefined {
  const match = message.match(parser.regex);
  if (!match) {
    return;
  }

  const entries: (readonly [keyof BaseEvent, any])[] = compact(parser.fields.map((field, index) => {
    const value = match[index + 1];
    if (!value) return;

    switch (field) {
      case "ts":
        // Parse PostgreSQL timestamp from log_line_prefix
        // Format: "2026-02-04 16:19:26 UTC" or "2026-02-04 16:19:26.123 UTC"
        const timestamp = new Date(value).getTime();
        if (!isNaN(timestamp)) {
          return [[field, timestamp] as const];
        }
        throw Error("Required field timestamp not found.");
      case "pid":
        const pid = parseInt(value, 10);
        return [[field, pid] as const];
      case "user":
      case "db":
        return [[field, value] as const];
      case "host":
        // Parse remote as host(port) or [host]:port format
        const remoteMatch = value.match(/^([^(]+)\((\d+)\)$/) || value.match(/^\[([^\]]+)\]:(\d+)$/);
        if (remoteMatch) {
          const remoteHost = remoteMatch[1];
          const remotePort = parseInt(remoteMatch[2], 10);
          return [["host", remoteHost] as const, ["port", remotePort] as const]
        } else {
          return [["host", value] as const];
        }
    }
    return;
  }).flat());

  const fields = Object.fromEntries(entries) as BaseEvent;

  return fields;
}

// Create parser from environment variable or use default
const LOG_LINE_PREFIX = process.env.LOG_LINE_PREFIX ?? DEFAULT_LOG_LINE_PREFIX;
const logLinePrefixParser = createLogLinePrefixParser(LOG_LINE_PREFIX);

/**
 * Parse a PostgreSQL log line into a PostgresAuditEvent.
 * Supports multiple log types: AUDIT SESSION, ERROR, STATEMENT, and generic LOG events.
 *
 * @see https://github.com/pgaudit/pgaudit - pgAudit log format specification
 * @see https://access.crunchydata.com/documentation/pgaudit/latest/ - pgAudit documentation
 */
export function parseAuditLog(
  message: string,
): PostgresAuditEvent | undefined {
  try {
    // Extract base fields from log_line_prefix once
    const baseFields = parseLogLinePrefix(message, logLinePrefixParser);

    if (!baseFields) {
      logger.warn({ message }, "Could not extract base fields");
      return;
    }

    const specificFields = parseAuditSessionEvent(message)
      ?? parseErrorEvent(message)
      ?? parseStatementEvent(message)
      ?? parseGenericLogEvent(message);
    
    if (!specificFields) {
      logger.warn({ message }, "Could not extract specific fields");
      return;
    }

    const event: PostgresAuditEvent = {
      ...baseFields,
      ...specificFields,
      raw: message, // Include raw message for size estimation and debugging
    };

    return event;
  } catch (error) {
    logger.warn({ error, message }, "Failed to parse log");
    return undefined;
  }
}

/**
 * Parse a pgAudit SESSION log event.
 * Format: LOG: AUDIT: SESSION,<sid>,<ssid>,<class>,<command>,<objType>,<objName>,<stmt>,<params>
 * Returns only the specific fields for this event type.
 */
function parseAuditSessionEvent(
  message: string
): AuditSessionEvent | undefined {
  try {
    // Include `,` so the first column is sid when parsing the csvPart
    const auditPrefix = "AUDIT: SESSION,";
    const auditIndex = message.indexOf(auditPrefix);

    if (auditIndex === -1) {
      return undefined;
    }

    // Extract the CSV portion after "AUDIT: SESSION,"
    const csvPart = message.substring(auditIndex + auditPrefix.length);

    // Parse CSV (handling quoted fields with commas)
    const fields = parseCSVLine(csvPart);

    if (fields.length < 8) {
      logger.warn({ message, fieldCount: fields.length }, "Invalid audit log format");
      return undefined;
    }

    const [
      sidStr,
      ssidStr,
      classStr,
      command,
      objType,
      objName,
      stmt,
      paramsStr,
    ] = fields;

    const sid = parseInt(sidStr, 10);
    const ssid = parseInt(ssidStr, 10);

    if (isNaN(sid) || isNaN(ssid)) {
      logger.warn({ sidStr, ssidStr }, "Invalid statement IDs");
      return undefined;
    }

    // Parse parameters
    const params = normalizeField(paramsStr)
      ? parseParameters(paramsStr)
      : [];

    const event: AuditSessionEvent = {
      type: "LOG:AUDIT:SESSION",
      sid,
      ssid,
      class: classStr as PostgresCommandClass,
      cmd: normalizeField(command) || "",
      stmt: normalizeField(stmt) || "",
      params,
    };

    // Add optional fields only if they have meaningful values
    const normalizedObjType = normalizeField(objType);
    const normalizedObjName = normalizeField(objName);

    if (normalizedObjType !== undefined) {
      event.objType = normalizedObjType;
    }
    if (normalizedObjName !== undefined) {
      event.objName = normalizedObjName;
    }

    return event;
  } catch (error) {
    logger.warn({ error, message }, "Failed to parse audit session event");
    return undefined;
  }
}

/**
 * Parse an ERROR log event.
 * Format: ERROR: <message>
 * Returns only the specific fields for this event type.
 */
function parseErrorEvent(message: string): ErrorEvent | undefined {
  const errorPrefix = "ERROR:";
  const errorIndex = message.indexOf(errorPrefix);

  if (errorIndex === -1) {
    return undefined;
  }

  const errorMessage = message.substring(errorIndex + errorPrefix.length).trim();

  return {
    type: "ERROR",
    message: errorMessage,
  };
}

/**
 * Parse a STATEMENT log event (usually follows an ERROR).
 * Format: STATEMENT: <statement>
 * Returns only the specific fields for this event type.
 */
function parseStatementEvent(message: string): StatementEvent | undefined {
  const statementPrefix = "STATEMENT:";
  const statementIndex = message.indexOf(statementPrefix);

  if (statementIndex === -1) {
    return undefined;
  }

  const statement = message.substring(statementIndex + statementPrefix.length).trim();

  return {
    type: "STATEMENT",
    statement,
  };
}

/**
 * Parse a generic LOG event (connections, checkpoints, etc.).
 * Format: LOG: <message>
 * Returns only the specific fields for this event type.
 */
function parseGenericLogEvent(message: string): GenericLogEvent | undefined {
  const logPrefix = "LOG:";
  const logIndex = message.indexOf(logPrefix);

  if (logIndex === -1) {
    return undefined;
  }

  const logMessage = message.substring(logIndex + logPrefix.length).trim();

  // Skip AUDIT logs (handled separately)
  if (logMessage.startsWith("AUDIT:")) {
    return undefined;
  }

  return {
    type: "LOG",
    message: logMessage,
  };
}

/**
 * Parse a CSV line, handling quoted fields that may contain commas.
 * Uses csv-parse library for robust CSV parsing with quote handling.
 * Handles escaped quotes: "" represents a literal " character in CSV.
 *
 * @see https://github.com/pgaudit/pgaudit/blob/master/pgaudit.c - append_valid_csv() function
 */
function parseCSVLine(line: string): string[] {
  try {
    const records = parse(line, {
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
    });
    return records[0] || [];
  } catch (error) {
    logger.warn({ error, line }, "Failed to parse CSV line");
    return [];
  }
}

/**
 * Normalize field values, converting sentinel values to undefined.
 * Sentinel values from pgAudit:
 * - <not logged>: field was not captured based on configuration
 * - <none>: no parameters exist (when parameter logging is enabled)
 * - <long param suppressed>: parameters exceed configured byte limits
 * - empty string: field has no value
 *
 * @see https://github.com/pgaudit/pgaudit - pgAudit official documentation
 * @see https://access.crunchydata.com/documentation/pgaudit/latest/ - pgAudit format specification
 */
function normalizeField(value: string): string | undefined {
  if (
    !value ||
    value === "" ||
    value === "<not logged>" ||
    value === "<none>" ||
    value === "<long param suppressed>"
  ) {
    return undefined;
  }
  return value;
}

/**
 * Parse parameter string from pgAudit log.
 * Format: Standard CSV format with values separated by commas.
 * Values containing commas, quotes, newlines, or carriage returns are wrapped in quotes.
 * Internal quotes are doubled for escaping.
 *
 * Examples:
 * - "value1,123" -> ["value1", 123]
 * - "\"quoted value\",42" -> ["quoted value", 42]
 * - "NULL,test" -> [null, "test"]
 *
 * @see https://github.com/pgaudit/pgaudit/blob/master/pgaudit.c - log_audit_event() and append_valid_csv() functions
 */
function parseParameters(paramsStr: string): any[] {
  // parseCSVLine already handles CSV parsing correctly
  const values = parseCSVLine(paramsStr);

  // Convert string values to appropriate types
  return values.map((value) => {
    // Handle NULL
    if (value === "NULL" || value === "null") {
      return null;
    }

    // Try to parse as number
    const num = parseFloat(value);
    if (!isNaN(num) && value.trim() !== "") {
      return num;
    }

    // Return as string
    return value;
  });
}
