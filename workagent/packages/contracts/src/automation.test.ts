import { it, expect } from "vitest";
import { automationWallTime, automationWallMinute } from "./automation-time.js";
it("resolves explicit IANA wall times independently of host timezone, rejecting DST gaps/folds", () => {
  expect(automationWallTime("2026-10-30T09:00", "Asia/Shanghai")).toBe(
    "2026-10-30T01:00:00.000Z",
  );
  expect(automationWallTime("2026-10-30T09:00", "America/Los_Angeles")).toBe(
    "2026-10-30T16:00:00.000Z",
  );
  expect(automationWallTime("2026-10-30T09:00", "Asia/Kathmandu")).toBe(
    "2026-10-30T03:15:00.000Z",
  );
  expect(automationWallMinute("2026-10-30T01:00:00Z", "Asia/Shanghai")).toBe(
    "2026-10-30T09:00",
  );
  expect(() =>
    automationWallTime("2026-03-08T02:30", "America/New_York"),
  ).toThrow();
  expect(() =>
    automationWallTime("2026-11-01T01:30", "America/New_York"),
  ).toThrow();
  expect(() => automationWallTime("2026-02-30T09:00", "UTC")).toThrow();
  expect(() => automationWallTime("2026-10-30T09:00", "invalid")).toThrow();
});
