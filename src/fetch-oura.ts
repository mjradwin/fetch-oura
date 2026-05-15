/// <reference types="node" />
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_URL = "https://api.ouraring.com/v2/usercollection";
const TOKEN_PATH = join(homedir(), ".config", "oura", "token");
const DATA_DIR = join(process.cwd(), "data");
const MONTHS_BACK = 18;
const REQUEST_DELAY_MS = 100;

const DATE_ENDPOINTS = [
  "daily_activity",
  "daily_readiness",
  "daily_sleep",
  "daily_spo2",
  "daily_stress",
  "daily_cardiovascular_age",
  "daily_resilience",
  "enhanced_tag",
  "rest_mode_period",
  "ring_configuration",
  "session",
  "sleep",
  "sleep_time",
  "tag",
  "vo2_max",
  "workout",
];

// Uses start_datetime/end_datetime like heartrate (max ~30 days per request)
const DATETIME_ENDPOINTS = [
  "heartrate",
  "interbeat_interval", // requires research scope OAuth token
];

function loadToken(): string {
  try {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  } catch {
    console.error(`Error: Could not read token from ${TOKEN_PATH}`);
    console.error(`Create it with: mkdir -p ~/.config/oura && echo "YOUR_TOKEN" > ~/.config/oura/token`);
    process.exit(1);
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMonthRange(): Array<{ start: Date; end: Date; label: string }> {
  const now = new Date();
  const months: Array<{ start: Date; end: Date; label: string }> = [];

  for (let i = MONTHS_BACK; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0); // last day of month

    if (end > now) {
      end.setTime(now.getTime());
    }

    const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    months.push({ start, end, label });
  }

  return months;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPaginated(
  token: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<unknown[]> {
  const allData: unknown[] = [];
  let nextToken: string | null = null;

  do {
    const searchParams = new URLSearchParams(params);
    if (nextToken) {
      searchParams.set("next_token", nextToken);
    }

    const url = `${BASE_URL}/${endpoint}?${searchParams}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404 || response.status === 401) {
      return [];
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }

    const json = (await response.json()) as {
      data: unknown[];
      next_token: string | null;
    };

    allData.push(...json.data);
    nextToken = json.next_token;

    if (nextToken) {
      await delay(REQUEST_DELAY_MS);
    }
  } while (nextToken);

  return allData;
}

function writeData(dir: string, filename: string, data: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2) + "\n");
}

async function fetchDateEndpoint(
  token: string,
  endpoint: string,
  start: Date,
  end: Date,
  label: string,
): Promise<void> {
  const dir = join(DATA_DIR, endpoint);
  const filename = `${label}.json`;

  if (existsSync(join(dir, filename))) {
    console.log(`  skip ${endpoint}/${filename} (already exists)`);
    return;
  }

  const params = {
    start_date: formatDate(start),
    end_date: formatDate(end),
  };

  try {
    const data = await fetchPaginated(token, endpoint, params);
    if (data.length === 0) {
      console.log(`  skip ${endpoint}/${filename} (no data)`);
      return;
    }
    writeData(dir, filename, data);
    console.log(`  wrote ${endpoint}/${filename} (${data.length} records)`);
  } catch (err) {
    console.error(`  error ${endpoint}/${filename}: ${err}`);
  }
}

async function fetchDatetimeEndpoint(
  token: string,
  endpoint: string,
  start: Date,
  end: Date,
  label: string,
): Promise<void> {
  const dir = join(DATA_DIR, endpoint);
  const filename = `${label}.json`;

  if (existsSync(join(dir, filename))) {
    console.log(`  skip ${endpoint}/${filename} (already exists)`);
    return;
  }

  const params = {
    start_datetime: start.toISOString(),
    end_datetime: end.toISOString(),
  };

  try {
    const data = await fetchPaginated(token, endpoint, params);
    if (data.length === 0) {
      console.log(`  skip ${endpoint}/${filename} (no data)`);
      return;
    }
    writeData(dir, filename, data);
    console.log(`  wrote ${endpoint}/${filename} (${data.length} records)`);
  } catch (err) {
    console.error(`  error ${endpoint}/${filename}: ${err}`);
  }
}

async function fetchPersonalInfo(token: string): Promise<void> {
  const filepath = join(DATA_DIR, "personal_info.json");

  if (existsSync(filepath)) {
    console.log("  skip personal_info.json (already exists)");
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}/personal_info`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }

    const data = await response.json();
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n");
    console.log("  wrote personal_info.json");
  } catch (err) {
    console.error(`  error personal_info.json: ${err}`);
  }
}

async function main(): Promise<void> {
  const token = loadToken();
  const months = getMonthRange();

  console.log(`Fetching Oura data for ${months.length} months: ${months[0].label} to ${months[months.length - 1].label}`);
  console.log(`Output directory: ${DATA_DIR}\n`);

  console.log("Fetching personal_info...");
  await fetchPersonalInfo(token);
  await delay(REQUEST_DELAY_MS);

  for (const { start, end, label } of months) {
    console.log(`\n--- ${label} ---`);

    for (const endpoint of DATE_ENDPOINTS) {
      await fetchDateEndpoint(token, endpoint, start, end, label);
      await delay(REQUEST_DELAY_MS);
    }

    for (const endpoint of DATETIME_ENDPOINTS) {
      await fetchDatetimeEndpoint(token, endpoint, start, end, label);
      await delay(REQUEST_DELAY_MS);
    }
  }

  console.log("\nDone!");
}

main();
