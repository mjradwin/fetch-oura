/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
}

export interface ActivityRecord {
  id: string;
  steps: number;
  active_calories: number;
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
