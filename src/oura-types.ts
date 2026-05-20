/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface TimeSeries {
  interval: number;
  items: (number | null)[];
  timestamp: string;
}

export interface SleepRecord {
  id: string;
  type: string;
  bedtime_start: string;
  bedtime_end: string;
  total_sleep_duration: number;
  awake_time: number;
  efficiency: number;
  latency: number;
  restless_periods: number;
  average_heart_rate: number;
  lowest_heart_rate: number;
  average_breath: number;
  average_hrv: number;
  hrv: TimeSeries | null;
  heart_rate: TimeSeries | null;
  deep_sleep_duration: number | null;
  light_sleep_duration: number | null;
  rem_sleep_duration: number | null;
  sleep_phase_5_min: string | null;
  readiness: {
    temperature_deviation: number | null;
    temperature_trend_deviation: number | null;
  } | null;
}

export interface ActivityRecord {
  id: string;
  steps: number;
  active_calories: number;
  total_calories: number | null;
  medium_activity_time: number | null;
  timestamp: string;
}

export interface Spo2Record {
  id: string;
  day: string;
  spo2_percentage: { average: number };
}

export interface WorkoutRecord {
  id: string;
  activity: string;
  calories: number;
  start_datetime: string;
  end_datetime: string;
  intensity: string;
  distance: number | null;
}

export interface HeartRateRecord {
  timestamp: string;
  bpm: number;
  source: string;
}

export interface SessionRecord {
  id: string;
  type: string;
  start_datetime: string;
  end_datetime: string;
  heart_rate: TimeSeries | null;
  heart_rate_variability: TimeSeries | null;
}

export interface PersonalInfoRecord {
  id: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  biological_sex: string | null;
  email: string | null;
}

export function loadEndpoint(dataDir: string, endpoint: string): unknown[] {
  const dir = join(dataDir, endpoint);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const all: unknown[] = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (Array.isArray(data)) {
      all.push(...data);
    }
  }
  return all;
}

export function loadSingleFile(dataDir: string, filename: string): unknown | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, filename), "utf-8"));
  } catch {
    return null;
  }
}
