import { describe, expect, it } from "vitest";
import { filterAdminRows, paginateAdminRows } from "./table-model.js";

describe("admin table interactions", () => {
  const rows = [
    { name: "Alpha tenant", status: "active" },
    { name: "Beta tenant", status: "suspended" },
    { name: "Gamma workspace", status: "active" },
  ];

  it("combines local text and status filters without mutating data", () => {
    expect(filterAdminRows(rows, "TENANT", "active")).toEqual([rows[0]]);
    expect(filterAdminRows(rows, "", "suspended")).toEqual([rows[1]]);
    expect(rows).toHaveLength(3);
  });

  it("slices a stable page and handles an out-of-range page", () => {
    expect(paginateAdminRows(rows, 2, 2)).toEqual([rows[2]]);
    expect(paginateAdminRows(rows, 4, 2)).toEqual([]);
  });
});
