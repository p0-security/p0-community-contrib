export const version0_0_1 = "0.0.1" as const;
type Version0_0_1 = typeof version0_0_1;

export type PostgresSessionQuery = {
  version: Version0_0_1;
  requestId: string;
  principal: string;
  startMillis: number;
  endMillis: number;
  /** Most recent N records */
  limit: number;
  /** AND'ed "contains" search terms */
  terms?: string[];
};

export const CommandClassValues = [
  "DDL",
  "FUNCTION",
  "MISC",
  "MISC_SET",
  "READ",
  "ROLE",
  "WRITE",
] as const;

export type PostgresCommandClass = (typeof CommandClassValues)[number];

/**
 * Base event fields extracted from PostgreSQL log_line_prefix.
 * All fields are optional as they depend on the log_line_prefix format.
 */
export type BaseEvent = {
  /** Timestamp in milliseconds */
  ts: number;
  /** PostgreSQL backend process ID */
  pid?: number;
  /** Database user name */
  user?: string;
  /** Database name */
  db?: string;
  /** Remote host address */
  host?: string;
  /** Remote port number */
  port?: number;
  /** Raw log message string */
  raw: string;
};

/**
 * pgAudit SESSION log event.
 * Format: LOG: AUDIT: SESSION,<sid>,<ssid>,<class>,<command>,<objType>,<objName>,<stmt>,<params>
 */
export type AuditSessionEvent = {
  type: "LOG:AUDIT:SESSION";
  /** Statement ID */
  sid: number;
  /** Substatement ID */
  ssid: number;
  class: PostgresCommandClass;
  /** The SQL command */
  cmd: string;
  /** Object type */
  objType?: string;
  /** Object name */
  objName?: string;
  /** Statement */
  stmt: string;
  /** Parameters of prepared statement or undefined if none (not a prepared statement) or if pgaudit.log_parameters is not enabled. */
  params: any[];
};

/**
 * PostgreSQL ERROR log event.
 * Format: ERROR: <message>
 */
export type ErrorEvent = {
  type: "ERROR";
  /** Error message */
  message: string;
};

/**
 * PostgreSQL STATEMENT log event (follows an ERROR).
 * Format: STATEMENT: <statement>
 */
export type StatementEvent = {
  type: "STATEMENT";
  /** SQL statement that caused the error */
  statement: string;
};

/**
 * Generic PostgreSQL LOG event (connections, checkpoints, etc.).
 * Format: LOG: <message>
 */
export type GenericLogEvent = {
  type: "LOG";
  /** Log message */
  message: string;
};

/**
 * Union type for all PostgreSQL log events.
 * Discriminated by the `type` field.
 */
export type PostgresAuditEvent = BaseEvent &
  (AuditSessionEvent | ErrorEvent | StatementEvent | GenericLogEvent);

export type PostgresAuditSession = {
  version: Version0_0_1;
  events: PostgresAuditEvent[];
};
