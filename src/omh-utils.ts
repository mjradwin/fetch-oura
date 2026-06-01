/// <reference types="node" />
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const OUT_DIR = join(process.cwd(), "omh");

export interface DataSeriesHeader {
  uuid: string;
  schema_id: { namespace: string; name: string; version: string };
  source_creation_date_time: string;
  modality: "sensed" | "self-reported";
}

export interface DataSeries {
  header: DataSeriesHeader;
  body: Record<string, unknown>[];
}

export function ensureOutDir(): void {
  mkdirSync(OUT_DIR, { recursive: true });
}

const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toUuid(sourceId: string): string {
  if (UUID_V5_RE.test(sourceId)) return sourceId.toLowerCase();
  const hash = createHash("sha1").update(sourceId).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface WriteOutputOpts {
  namespace?: string;
  modality?: "sensed" | "self-reported";
  sourceId?: string;
}

export function writeOutput(
  fileName: string,
  schemaName: string,
  version: string,
  bodies: Record<string, unknown>[],
  opts?: WriteOutputOpts,
): void {
  if (bodies.length === 0) return;
  const series: DataSeries = {
    header: {
      uuid: opts?.sourceId ? toUuid(opts.sourceId) : toUuid(fileName),
      schema_id: { namespace: opts?.namespace ?? "omh", name: schemaName, version },
      source_creation_date_time: new Date().toISOString(),
      modality: opts?.modality ?? "sensed",
    },
    body: bodies,
  };
  const filepath = join(OUT_DIR, `${fileName}.json`);
  writeFileSync(filepath, JSON.stringify(series) + "\n");
  console.log(`  ${fileName}.json: ${bodies.length} data points`);
}
