/// <reference types="node" />
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEndpoint } from "./oura-types.js";
import type { SleepRecord, ActivityRecord, Spo2Record, WorkoutRecord } from "./oura-types.js";

const DATA_DIR = join(process.cwd(), "data");
const OUT_DIR = join(process.cwd(), "omh");

interface OmhHeader {
  id: string;
  creation_date_time: string;
  schema_id: { namespace: string; name: string; version: string };
  acquisition_provenance: {
    source_name: string;
    source_data_point_id: string;
    modality: string;
  };
}

interface OmhDataPoint {
  header: OmhHeader;
  body: Record<string, unknown>;
}

function deterministicId(schemaName: string, ouraId: string, discriminator = ""): string {
  const input = `${schemaName}:${ouraId}:${discriminator}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function makeHeader(schemaName: string, version: string, ouraId: string, discriminator = ""): OmhHeader {
  return {
    id: deterministicId(schemaName, ouraId, discriminator),
    creation_date_time: new Date().toISOString(),
    schema_id: { namespace: "omh", name: schemaName, version },
    acquisition_provenance: {
      source_name: "Oura Ring",
      source_data_point_id: ouraId,
      modality: "sensed",
    },
  };
}

// --- Converters ---

function convertSleepEpisodes(records: SleepRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.bedtime_start && r.bedtime_end)
    .map((r) => ({
      header: makeHeader("sleep-episode", "1.1", r.id),
      body: {
        effective_time_frame: {
          time_interval: {
            start_date_time: r.bedtime_start,
            end_date_time: r.bedtime_end,
          },
        },
        ...(r.latency != null && {
          latency_to_sleep_onset: { value: r.latency, unit: "sec" },
        }),
        ...(r.total_sleep_duration != null && {
          total_sleep_time: { value: r.total_sleep_duration, unit: "sec" },
        }),
        ...(r.awake_time != null && {
          wake_after_sleep_onset: { value: r.awake_time, unit: "sec" },
        }),
        ...(r.restless_periods != null && {
          number_of_awakenings: r.restless_periods,
        }),
        is_main_sleep: r.type === "long_sleep",
        ...(r.efficiency != null && {
          sleep_maintenance_efficiency_percentage: { value: r.efficiency, unit: "%" },
        }),
      },
    }));
}

function convertSleepHeartRate(records: SleepRecord[]): OmhDataPoint[] {
  const points: OmhDataPoint[] = [];
  for (const r of records) {
    if (!r.bedtime_start || !r.bedtime_end) continue;
    const timeInterval = {
      time_interval: {
        start_date_time: r.bedtime_start,
        end_date_time: r.bedtime_end,
      },
    };
    if (r.average_heart_rate != null) {
      points.push({
        header: makeHeader("heart-rate", "2.0", r.id, "avg"),
        body: {
          heart_rate: { value: r.average_heart_rate, unit: "beats/min" },
          effective_time_frame: timeInterval,
          descriptive_statistic: "average",
          temporal_relationship_to_sleep: "during sleep",
        },
      });
    }
    if (r.lowest_heart_rate != null) {
      points.push({
        header: makeHeader("heart-rate", "2.0", r.id, "min"),
        body: {
          heart_rate: { value: r.lowest_heart_rate, unit: "beats/min" },
          effective_time_frame: timeInterval,
          descriptive_statistic: "minimum",
          temporal_relationship_to_sleep: "during sleep",
        },
      });
    }
  }
  return points;
}

function convertSleepRespiratoryRate(records: SleepRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.bedtime_start && r.bedtime_end && r.average_breath != null)
    .map((r) => ({
      header: makeHeader("respiratory-rate", "2.0", r.id),
      body: {
        respiratory_rate: { value: r.average_breath, unit: "breaths/min" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.bedtime_start,
            end_date_time: r.bedtime_end,
          },
        },
        descriptive_statistic: "average",
      },
    }));
}

function convertSleepHrv(records: SleepRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.bedtime_start && r.bedtime_end && r.average_hrv != null)
    .map((r) => ({
      header: makeHeader("rr-interval", "1.0", r.id),
      body: {
        rr_interval: { value: r.average_hrv, unit: "ms" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.bedtime_start,
            end_date_time: r.bedtime_end,
          },
        },
        descriptive_statistic: "average",
        temporal_relationship_to_physical_activity: "at rest",
      },
    }));
}

function add24Hours(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function convertStepCount(records: ActivityRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.steps != null && r.timestamp)
    .map((r) => ({
      header: makeHeader("step-count", "3.0", r.id),
      body: {
        step_count: { value: r.steps, unit: "steps" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.timestamp,
            end_date_time: add24Hours(r.timestamp),
          },
        },
      },
    }));
}

function convertCaloriesBurned(records: ActivityRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.active_calories != null && r.timestamp)
    .map((r) => ({
      header: makeHeader("calories-burned", "2.0", r.id),
      body: {
        kcal_burned: { value: r.active_calories, unit: "kcal" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.timestamp,
            end_date_time: add24Hours(r.timestamp),
          },
        },
      },
    }));
}

function convertOxygenSaturation(records: Spo2Record[]): OmhDataPoint[] {
  return records
    .filter((r) => r.spo2_percentage?.average != null)
    .map((r) => ({
      header: makeHeader("oxygen-saturation", "2.0", r.id),
      body: {
        oxygen_saturation: { value: r.spo2_percentage.average, unit: "%" },
        effective_time_frame: {
          date_time: `${r.day}T00:00:00Z`,
        },
        system: "peripheral capillary",
        measurement_method: "pulse oximetry",
        descriptive_statistic: "average",
      },
    }));
}

const INTENSITY_MAP: Record<string, string> = {
  low: "light",
  moderate: "moderate",
  high: "vigorous",
};

function convertPhysicalActivity(records: WorkoutRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.activity && r.start_datetime && r.end_datetime)
    .map((r) => ({
      header: makeHeader("physical-activity", "1.2", r.id),
      body: {
        activity_name: r.activity,
        effective_time_frame: {
          time_interval: {
            start_date_time: r.start_datetime,
            end_date_time: r.end_datetime,
          },
        },
        ...(r.calories != null && {
          kcal_burned: { value: r.calories, unit: "kcal" },
        }),
        ...(r.intensity && INTENSITY_MAP[r.intensity] && {
          reported_activity_intensity: INTENSITY_MAP[r.intensity],
        }),
        ...(r.distance != null && {
          distance: { value: r.distance, unit: "m" },
        }),
      },
    }));
}

// --- Main ---

function writeOutput(schemaName: string, dataPoints: OmhDataPoint[]): void {
  if (dataPoints.length === 0) return;
  const filepath = join(OUT_DIR, `${schemaName}.json`);
  writeFileSync(filepath, JSON.stringify(dataPoints, null, 2) + "\n");
  console.log(`  ${schemaName}.json: ${dataPoints.length} data points`);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const sleepRecords = loadEndpoint(DATA_DIR, "sleep") as SleepRecord[];
  const activityRecords = loadEndpoint(DATA_DIR, "daily_activity") as ActivityRecord[];
  const spo2Records = loadEndpoint(DATA_DIR, "daily_spo2") as Spo2Record[];
  const workoutRecords = loadEndpoint(DATA_DIR, "workout") as WorkoutRecord[];

  console.log(`Loaded: ${sleepRecords.length} sleep, ${activityRecords.length} activity, ${spo2Records.length} spo2, ${workoutRecords.length} workout records`);
  console.log(`\nExporting to ${OUT_DIR}/\n`);

  writeOutput("sleep-episode", convertSleepEpisodes(sleepRecords));
  writeOutput("heart-rate", convertSleepHeartRate(sleepRecords));
  writeOutput("respiratory-rate", convertSleepRespiratoryRate(sleepRecords));
  writeOutput("rr-interval", convertSleepHrv(sleepRecords));
  writeOutput("step-count", convertStepCount(activityRecords));
  writeOutput("calories-burned", convertCaloriesBurned(activityRecords));
  writeOutput("oxygen-saturation", convertOxygenSaturation(spo2Records));
  writeOutput("physical-activity", convertPhysicalActivity(workoutRecords));

  console.log("\nDone!");
}

main();
