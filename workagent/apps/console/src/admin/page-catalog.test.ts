import { describe, expect, it } from "vitest";
import { platformRoutes, tenantRoutes, type AdminPageId } from "./navigation.js";
import { adminPageCatalog } from "./page-catalog.js";

describe("administrative page catalog", () => {
  it("provides an implementation definition for every route page", () => {
    const routePageIds = [...platformRoutes, ...tenantRoutes]
      .map((route) => route.pageId)
      .filter((pageId): pageId is NonNullable<typeof pageId> => Boolean(pageId));
    for (const pageId of new Set(routePageIds)) {
      expect(adminPageCatalog[pageId], `missing page definition: ${pageId}`).toBeDefined();
    }
  });

  it("gives each operational page a real API resource and usable fields", () => {
    for (const [rawPageId, page] of Object.entries(adminPageCatalog)) {
      const pageId = rawPageId as AdminPageId;
      expect(page.title, pageId).toBeTruthy();
      expect(page.description, pageId).toBeTruthy();
      expect(page.endpoint, pageId).toMatch(/^\/v1\//);
      if (page.kind === "resource" || page.kind === "workflow") expect(page.fields.length, pageId).toBeGreaterThan(0);
    }
  });

  it("uses explicit command actions for stateful workflow pages", () => {
    const workflowPages = ["connector-catalog", "runtime-instances", "control-center", "provisioning", "schedules", "content", "distribution-channels"] as const satisfies readonly AdminPageId[];
    for (const pageId of workflowPages) {
      expect(adminPageCatalog[pageId].actions.length, pageId).toBeGreaterThan(0);
    }
  });
});
