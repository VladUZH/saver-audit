// --json: everything machine-readable. Project names are dropped unless --show-projects.
import type { AuditResult } from "../audit.ts";

export const JSON_SCHEMA_VERSION = 1;

export function renderJson(r: AuditResult, o: { showProjects: boolean; version: string }): string {
  const { projects, waste, looked, ...rest } = r;
  const doc = {
    schema: JSON_SCHEMA_VERSION,
    tool: { name: "saver-audit", version: o.version },
    costBasis: "API-equivalent at list prices; not a subscription bill",
    ...rest,
    projects: o.showProjects ? projects : projects.length,
    waste: waste.map((w) => ({ ...w, projects: o.showProjects ? w.projects : w.projects.length })),
    ...(o.showProjects ? { looked } : {}),
  };
  return JSON.stringify(doc, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v), 2) + "\n";
}
