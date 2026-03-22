import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilterLogEventsCommandInput,
  type FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";

/**
 * Create a new CloudWatch Logs client for retrieving filtered log events.
 */
export const newCloudWatchLogsClient = () => {
  const client = new CloudWatchLogsClient({});

  return {
      filterLogEvents: async (
      input: FilterLogEventsCommandInput
    ): Promise<FilterLogEventsCommandOutput> =>  {
      return await client.send(new FilterLogEventsCommand(input));
    }
  }
}
