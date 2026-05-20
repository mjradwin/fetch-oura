/// <reference types="node" />
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const OUT_DIR = join(process.cwd(), "omh");

export interface OmhHeader {
  id: string;
  creation_date_time: string;
  schema_id: { namespace: string; name: string; version: string };
  acquisition_provenance: {
    source_name: string;
    source_data_point_id: string;
    modality: string;
  };
}

export interface OmhDataPoint {
  header: OmhHeader;
  body: Record<string, unknown>;
}

export function deterministicId(schemaName: string, ouraId: string, discriminator = ""): string {
  const input = `${schemaName}:${ouraId}:${discriminator}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function makeHeader(schemaName: string, version: string, ouraId: string, discriminator = "", namespace = "omh"): OmhHeader {
  return {
    id: deterministicId(schemaName, ouraId, discriminator),
    creation_date_time: new Date().toISOString(),
    schema_id: { namespace, name: schemaName, version },
    acquisition_provenance: {
      source_name: "Oura Ring",
      source_data_point_id: ouraId,
      modality: "sensed",
    },
  };
}

export function ensureOutDir(): void {
  mkdirSync(OUT_DIR, { recursive: true });
}

export function writeOutput(schemaName: string, dataPoints: OmhDataPoint[]): void {
  if (dataPoints.length === 0) return;
  const filepath = join(OUT_DIR, `${schemaName}.json`);
  writeFileSync(filepath, JSON.stringify(dataPoints, null, 2) + "\n");
  console.log(`  ${schemaName}.json: ${dataPoints.length} data points`);
}
