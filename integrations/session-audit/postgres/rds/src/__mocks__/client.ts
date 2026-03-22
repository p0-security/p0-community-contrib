import type {
  FilterLogEventsCommandInput,
  FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";

export const newCloudWatchLogsClient = () => createMockClientForUnstructuredLogQuery();

/**
 * Mock CloudWatch Logs client that reads from cloudwatch-logs.csv and filters based on filterPattern.
 * 
 * Only supports a limited set of features within filter patterns for unstructured logs:
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html#matching-terms-unstructured-log-events
 * 
 * AWS CloudWatch filter pattern rules:
 * - Case sensitive
 * - Multiple terms use AND logic (all must be present)
 * - Quoted terms can contain spaces/special chars
 * - Unquoted terms are single words
 * Supported: quoted terms with AND logic (sufficient for our use case)
 * Not supported: optional terms (?), exclude terms (-), or match-everything (" ")
 */
const createMockClientForUnstructuredLogQuery = () => {
  return {
    filterLogEvents: async (
      input: FilterLogEventsCommandInput
    ): Promise<FilterLogEventsCommandOutput> => {
      // Read and parse CSV
      const logsPath = join(__dirname, "cloudwatch-logs.csv");
      const logsContent = readFileSync(logsPath, "utf-8");

      // Parse CSV with csv-parse library (handles multiline quoted fields)
      const records = parse(logsContent, {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
      }) as Array<{ timestamp: string; message: string }>;

      // Convert to CloudWatch event format
      const parsedEvents = records
        .map((record, index) => {
          const timestamp = parseInt(record.timestamp, 10);
          if (isNaN(timestamp)) return null;

          return {
            logStreamName: input.logStreamNames?.[0] ?? "mock-stream",
            timestamp,
            message: record.message,
            ingestionTime: timestamp,
            eventId: `event-${index}`,
          };
        })
        .filter((event): event is NonNullable<typeof event> => event !== null);

      // Step 2: Filter by time range
      const timeFilteredEvents = parsedEvents.filter((event) => {
        if (input.startTime && event.timestamp <= input.startTime) return false;
        if (input.endTime && event.timestamp >= input.endTime) return false;
        return true;
      });

      // Step 3: Apply filter pattern to message content
      const filterPattern = input.filterPattern ?? "";

      // Extract both quoted and unquoted terms
      const quotedTerms = filterPattern.match(/"([^"]+)"/g)?.map((term) =>
        term.slice(1, -1) // Remove surrounding quotes
      ) || [];

      // Extract unquoted terms (words not in quotes)
      const withoutQuoted = filterPattern.replace(/"([^"]+)"/g, "");
      const unquotedTerms = withoutQuoted.trim().split(/\s+/).filter(t => t.length > 0);

      const allTerms = [...quotedTerms, ...unquotedTerms];

      const patternFilteredEvents = timeFilteredEvents.filter((event) => {
        // All filter terms must be present (AND logic, case-sensitive)
        return allTerms.every((term) => event.message.includes(term));
      });

      return {
        events: patternFilteredEvents,
        $metadata: {},
      };
    },
  };
};
