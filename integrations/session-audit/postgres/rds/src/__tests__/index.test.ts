import { describe, expect, it, vi } from "vitest";
import { handler } from "../index.js";
import { version0_0_1, type PostgresSessionQuery } from "../types.js";
import { Context } from "aws-lambda";

// Mock the client module
vi.mock("../client.js");

// Mock environment variable
process.env.DB_IDENTIFIER = "test-db";


const context = { awsRequestId: "aws-test-123" } as Context;

describe("Lambda Handler - Session Audit", () => {
  it("should return all audit events for user@example.com", async () => {
    const query: PostgresSessionQuery = {
      version: version0_0_1,
      requestId: "test-user-events",
      principal: "user@example.com",
      startMillis: new Date("2026-02-04T16:00:00Z").getTime(), // 1770221600000
      endMillis: new Date("2026-02-04T16:30:00Z").getTime(),   // 1770223400000
      limit: 100,
    };


    const result = await handler(query, context, () => {});

    expect(result).toBeDefined();

    expect(result?.events.length ?? 0).toEqual(26);

    expect(result).toMatchSnapshot();
  });

  it("should return empty events for a user with no audit logs", async () => {
    const query: PostgresSessionQuery = {
      version: version0_0_1,
      requestId: "test-no-events",
      principal: "nonexistent@example.com",
      startMillis: new Date("2026-02-04T16:00:00Z").getTime(),
      endMillis: new Date("2026-02-04T16:30:00Z").getTime(),
      limit: 100,
    };

    const result = await handler(query, context, () => {});

    expect(result).toMatchSnapshot();
  });

  it("should validate required parameters", async () => {
    const invalidQuery = {
      requestId: "",
      principal: "user@example.com",
      startMillis: 0,
      endMillis: 0,
    } as PostgresSessionQuery;

    await expect(handler(invalidQuery, context, () => {})).rejects.toThrow(
      "Validation failed"
    );
  });

  it("should filter events by time range", async () => {
    const query: PostgresSessionQuery = {
      version: version0_0_1,
      requestId: "test-time-filter",
      principal: "user@example.com",
      // Narrow time range - should get fewer events
      startMillis: new Date("2026-02-04T16:19:00Z").getTime(),
      endMillis: new Date("2026-02-04T16:20:00Z").getTime(),
      limit: 100,
    };

    const result = await handler(query, context, () => {});

    expect(result).toBeDefined();

    expect(result?.events.length).toEqual(3);

    result?.events.forEach((event) => {
      expect(event.ts).toBeGreaterThanOrEqual(query.startMillis);
      expect(event.ts).toBeLessThanOrEqual(query.endMillis);
    });
  });

  it("should filter events by additional terms", async () => {
    const query: PostgresSessionQuery = {
      version: version0_0_1,
      requestId: "test-terms-filter",
      principal: "user@example.com",
      startMillis: new Date("2026-02-04T16:00:00Z").getTime(),
      endMillis: new Date("2026-02-04T16:30:00Z").getTime(),
      limit: 100,
      terms: ["AUDIT", "SELECT"], // AND logic: principal AND AUDIT AND SELECT
    };

    const result = await handler(query, context, () => {});

    expect(result).toBeDefined();

    // Should only get AUDIT SESSION events with SELECT command
    expect(result?.events.length).toBeGreaterThan(0);
    result?.events.forEach((event) => {
      expect(event.type).toContain("SESSION");
    });
  });

  it("should respect the limit parameter", async () => {
    const query: PostgresSessionQuery = {
      version: version0_0_1,
      requestId: "test-limit",
      principal: "user@example.com",
      startMillis: new Date("2026-02-04T16:00:00Z").getTime(),
      endMillis: new Date("2026-02-04T16:30:00Z").getTime(),
      limit: 3, // Only return 3 most recent events
    };

    const result = await handler(query, context, () => {});

    expect(result).toBeDefined();
    expect(result?.events.length).toBeLessThanOrEqual(3);

    // Verify we get the most recent 5 events
    expect(result).toMatchSnapshot();
  });
});
