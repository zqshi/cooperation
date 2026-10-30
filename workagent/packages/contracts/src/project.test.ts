import { it, expect } from "vitest";
import {
  createProjectSchema,
  projectTaskSchema,
  productCategories,
} from "./project.js";
it("project creation validates names and excludes run fields", () => {
  expect(createProjectSchema.safeParse({ name: " " }).success).toBe(false);
  expect(
    createProjectSchema.safeParse({ name: "Project", runId: "run" }).success,
  ).toBe(false);
  expect(createProjectSchema.parse({ name: " Demo " })).toEqual({
    name: "Demo",
    description: "",
  });
  expect(
    projectTaskSchema.safeParse({
      id: "t",
      projectId: "p",
      title: "Plan",
      status: "running",
    }).success,
  ).toBe(false);
});

it("product contract exposes exactly two physical frontend products", () => {
  expect(productCategories).toEqual(["console", "user-portal"]);
});
