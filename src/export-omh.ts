/// <reference types="node" />
import { join } from "node:path";
import { loadEndpoint, loadSingleFile } from "./oura-types.js";
import type {
  SleepRecord, ActivityRecord, Spo2Record, WorkoutRecord, TimeSeries,
  HeartRateRecord, SessionRecord, PersonalInfoRecord,
} from "./oura-types.js";
import { ensureOutDir, makeHeader, writeOutput, OUT_DIR } from "./omh-utils.js";
import type { OmhDataPoint } from "./omh-utils.js";

const DATA_DIR = join(process.cwd(), "data");

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
    if (r.heart_rate) {
      for (const [i, p] of expandTimeSeries(r.heart_rate).entries()) {
        points.push({
          header: makeHeader("heart-rate", "2.0", r.id, `interval-${i}`),
          body: {
            heart_rate: { value: p.value, unit: "beats/min" },
            effective_time_frame: {
              time_interval: { start_date_time: p.start, end_date_time: p.end },
            },
            temporal_relationship_to_sleep: "during sleep",
          },
        });
      }
    }
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

function extractTz(isoTimestamp: string): string {
  if (isoTimestamp.endsWith("Z")) return "Z";
  const match = isoTimestamp.match(/([+-]\d{2}:\d{2})$/);
  return match ? match[1] : "Z";
}

function formatTimestamp(ms: number, tz: string): string {
  if (tz === "Z") return new Date(ms).toISOString();
  return formatWithTz(ms, tz);
}

function expandTimeSeries(ts: TimeSeries): Array<{ value: number; start: string; end: string }> {
  const points: Array<{ value: number; start: string; end: string }> = [];
  const baseMs = new Date(ts.timestamp).getTime();
  const intervalMs = ts.interval * 1000;
  const tz = extractTz(ts.timestamp);
  for (let i = 0; i < ts.items.length; i++) {
    const v = ts.items[i];
    if (v == null) continue;
    const startMs = baseMs + i * intervalMs;
    const endMs = startMs + intervalMs;
    points.push({
      value: v,
      start: formatTimestamp(startMs, tz),
      end: formatTimestamp(endMs, tz),
    });
  }
  return points;
}

function convertSleepHrv(records: SleepRecord[]): OmhDataPoint[] {
  const points: OmhDataPoint[] = [];
  for (const r of records) {
    if (!r.bedtime_start || !r.bedtime_end) continue;
    if (r.hrv) {
      for (const [i, p] of expandTimeSeries(r.hrv).entries()) {
        points.push({
          header: makeHeader("rr-interval", "1.0", r.id, `interval-${i}`),
          body: {
            rr_interval: { value: p.value, unit: "ms" },
            effective_time_frame: {
              time_interval: { start_date_time: p.start, end_date_time: p.end },
            },
            temporal_relationship_to_physical_activity: "at rest",
          },
        });
      }
    }
    if (r.average_hrv != null) {
      points.push({
        header: makeHeader("rr-interval", "1.0", r.id, "avg"),
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
      });
    }
  }
  return points;
}

const SLEEP_PHASE_MAP: Record<string, string> = {
  "1": "deep",
  "2": "light",
  "3": "rem",
  "4": "awake",
};

function convertSleepStages(records: SleepRecord[]): OmhDataPoint[] {
  const points: OmhDataPoint[] = [];
  const intervalMs = 5 * 60 * 1000;
  for (const r of records) {
    if (!r.bedtime_start || !r.sleep_phase_5_min) continue;
    const baseMs = new Date(r.bedtime_start).getTime();
    const tz = extractTz(r.bedtime_start);
    let stageIdx = 0;
    let i = 0;
    while (i < r.sleep_phase_5_min.length) {
      const code = r.sleep_phase_5_min[i];
      const stage = SLEEP_PHASE_MAP[code];
      if (!stage) { i++; continue; }
      let j = i + 1;
      while (j < r.sleep_phase_5_min.length && r.sleep_phase_5_min[j] === code) j++;
      const startMs = baseMs + i * intervalMs;
      const endMs = baseMs + j * intervalMs;
      points.push({
        header: makeHeader("sleep-stage", "1.0", r.id, `stage-${stageIdx}`, "custom"),
        body: {
          stage,
          effective_time_frame: {
            time_interval: {
              start_date_time: formatTimestamp(startMs, tz),
              end_date_time: formatTimestamp(endMs, tz),
            },
          },
        },
      });
      stageIdx++;
      i = j;
    }
  }
  return points;
}

function formatWithTz(ms: number, tz: string): string {
  const d = new Date(ms);
  const sign = tz[0] === "+" ? 1 : -1;
  const offsetH = parseInt(tz.slice(1, 3), 10);
  const offsetM = parseInt(tz.slice(4, 6), 10);
  const totalOffsetMs = sign * (offsetH * 60 + offsetM) * 60 * 1000;
  const local = new Date(d.getTime() + totalOffsetMs);
  const iso = local.toISOString().slice(0, 19);
  return `${iso}${tz}`;
}

function convertBodyTemperature(records: SleepRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.readiness?.temperature_deviation != null && r.bedtime_start && r.bedtime_end)
    .map((r) => ({
      header: makeHeader("body-temperature", "4.0", r.id),
      body: {
        body_temperature: { value: r.readiness!.temperature_deviation!, unit: "C" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.bedtime_start,
            end_date_time: r.bedtime_end,
          },
        },
        measurement_location: "wrist",
        descriptive_statistic: "average",
        temporal_relationship_to_sleep: "during sleep",
      },
    }));
}

function add24Hours(isoTimestamp: string): string {
  const ms = new Date(isoTimestamp).getTime() + 24 * 60 * 60 * 1000;
  return formatTimestamp(ms, extractTz(isoTimestamp));
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
  const points: OmhDataPoint[] = [];
  for (const r of records) {
    if (!r.timestamp) continue;
    const timeInterval = {
      time_interval: {
        start_date_time: r.timestamp,
        end_date_time: add24Hours(r.timestamp),
      },
    };
    if (r.active_calories != null) {
      points.push({
        header: makeHeader("calories-burned", "2.0", r.id, "active"),
        body: {
          kcal_burned: { value: r.active_calories, unit: "kcal" },
          effective_time_frame: timeInterval,
        },
      });
    }
    if (r.total_calories != null) {
      points.push({
        header: makeHeader("calories-burned", "2.0", r.id, "total"),
        body: {
          kcal_burned: { value: r.total_calories, unit: "kcal" },
          effective_time_frame: timeInterval,
        },
      });
    }
  }
  return points;
}

function convertOxygenSaturation(records: Spo2Record[]): OmhDataPoint[] {
  return records
    .filter((r) => r.spo2_percentage?.average != null)
    .map((r) => ({
      header: makeHeader("oxygen-saturation", "2.0", r.id),
      body: {
        oxygen_saturation: { value: r.spo2_percentage.average, unit: "%" },
        effective_time_frame: {
          date_time: r.day,
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

const HR_SOURCE_MAP: Record<string, { activity?: string; sleep?: string }> = {
  rest: { activity: "at rest", sleep: "during sleep" },
  awake: { activity: "at rest" },
  workout: { activity: "during exercise" },
  live: {},
};

function convertAllDayHeartRate(records: HeartRateRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.bpm != null && r.timestamp)
    .map((r, i) => {
      const mapping = HR_SOURCE_MAP[r.source] ?? {};
      return {
        header: makeHeader("heart-rate", "2.0", r.timestamp, `hr-${i}`),
        body: {
          heart_rate: { value: r.bpm, unit: "beats/min" },
          effective_time_frame: { date_time: r.timestamp },
          ...(mapping.activity && {
            temporal_relationship_to_physical_activity: mapping.activity,
          }),
          ...(mapping.sleep && {
            temporal_relationship_to_sleep: mapping.sleep,
          }),
        },
      };
    });
}

function convertSessionHeartRate(records: SessionRecord[]): OmhDataPoint[] {
  const points: OmhDataPoint[] = [];
  for (const r of records) {
    if (!r.heart_rate || !r.start_datetime || !r.end_datetime) continue;
    for (const [i, p] of expandTimeSeries(r.heart_rate).entries()) {
      points.push({
        header: makeHeader("heart-rate", "2.0", r.id, `session-${i}`),
        body: {
          heart_rate: { value: p.value, unit: "beats/min" },
          effective_time_frame: {
            time_interval: { start_date_time: p.start, end_date_time: p.end },
          },
          temporal_relationship_to_physical_activity: "at rest",
        },
      });
    }
  }
  return points;
}

function convertSessionHrv(records: SessionRecord[]): OmhDataPoint[] {
  const points: OmhDataPoint[] = [];
  for (const r of records) {
    if (!r.heart_rate_variability || !r.start_datetime || !r.end_datetime) continue;
    for (const [i, p] of expandTimeSeries(r.heart_rate_variability).entries()) {
      points.push({
        header: makeHeader("rr-interval", "1.0", r.id, `session-${i}`),
        body: {
          rr_interval: { value: p.value, unit: "ms" },
          effective_time_frame: {
            time_interval: { start_date_time: p.start, end_date_time: p.end },
          },
          temporal_relationship_to_physical_activity: "at rest",
        },
      });
    }
  }
  return points;
}

function convertMinutesModerateActivity(records: ActivityRecord[]): OmhDataPoint[] {
  return records
    .filter((r) => r.medium_activity_time != null && r.timestamp)
    .map((r) => ({
      header: makeHeader("minutes-moderate-activity", "1.0", r.id),
      body: {
        minutes_moderate_activity: { value: Math.round(r.medium_activity_time! / 60), unit: "min" },
        effective_time_frame: {
          time_interval: {
            start_date_time: r.timestamp,
            end_date_time: add24Hours(r.timestamp),
          },
        },
      },
    }));
}

function convertBodyWeight(info: PersonalInfoRecord): OmhDataPoint[] {
  if (info.weight == null) return [];
  return [{
    header: makeHeader("body-weight", "3.0", info.id),
    body: {
      body_weight: { value: info.weight, unit: "kg" },
      effective_time_frame: { date_time: new Date().toISOString() },
    },
  }];
}

function convertBodyHeight(info: PersonalInfoRecord): OmhDataPoint[] {
  if (info.height == null) return [];
  return [{
    header: makeHeader("body-height", "2.0", info.id),
    body: {
      body_height: { value: info.height, unit: "m" },
      effective_time_frame: { date_time: new Date().toISOString() },
    },
  }];
}

// --- Main ---

function main(): void {
  ensureOutDir();

  const sleepRecords = loadEndpoint(DATA_DIR, "sleep") as SleepRecord[];
  const activityRecords = loadEndpoint(DATA_DIR, "daily_activity") as ActivityRecord[];
  const spo2Records = loadEndpoint(DATA_DIR, "daily_spo2") as Spo2Record[];
  const workoutRecords = loadEndpoint(DATA_DIR, "workout") as WorkoutRecord[];
  const heartRateRecords = loadEndpoint(DATA_DIR, "heartrate") as HeartRateRecord[];
  const sessionRecords = loadEndpoint(DATA_DIR, "session") as SessionRecord[];
  const personalInfo = loadSingleFile(DATA_DIR, "personal_info.json") as PersonalInfoRecord | null;

  console.log(`Loaded: ${sleepRecords.length} sleep, ${activityRecords.length} activity, ${spo2Records.length} spo2, ${workoutRecords.length} workout, ${heartRateRecords.length} heartrate, ${sessionRecords.length} session records`);
  console.log(`\nExporting to ${OUT_DIR}/\n`);

  writeOutput("sleep-episode", convertSleepEpisodes(sleepRecords));
  writeOutput("heart-rate-sleep", convertSleepHeartRate(sleepRecords));
  writeOutput("heart-rate-allday", convertAllDayHeartRate(heartRateRecords));
  writeOutput("heart-rate-session", convertSessionHeartRate(sessionRecords));
  writeOutput("respiratory-rate", convertSleepRespiratoryRate(sleepRecords));
  writeOutput("rr-interval-sleep", convertSleepHrv(sleepRecords));
  writeOutput("rr-interval-session", convertSessionHrv(sessionRecords));
  writeOutput("sleep-stage", convertSleepStages(sleepRecords));
  writeOutput("body-temperature", convertBodyTemperature(sleepRecords));
  writeOutput("step-count", convertStepCount(activityRecords));
  writeOutput("calories-burned", convertCaloriesBurned(activityRecords));
  writeOutput("minutes-moderate-activity", convertMinutesModerateActivity(activityRecords));
  writeOutput("oxygen-saturation", convertOxygenSaturation(spo2Records));
  writeOutput("physical-activity", convertPhysicalActivity(workoutRecords));
  if (personalInfo) {
    writeOutput("body-weight", convertBodyWeight(personalInfo));
    writeOutput("body-height", convertBodyHeight(personalInfo));
  }

  console.log("\nDone!");
}

main();
