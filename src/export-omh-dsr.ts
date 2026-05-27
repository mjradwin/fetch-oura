/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOutDir, makeHeader, writeOutput } from "./omh-utils.js";
import type { OmhDataPoint } from "./omh-utils.js";

const DSR_DIR = join(process.cwd(), "dsr-request", "App Data");

// --- CSV Parser (semicolon-delimited, handles quoted fields with embedded JSON) ---

function parseCsv(filepath: string): Record<string, string>[] {
  const text = readFileSync(filepath, "utf-8");
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].trimEnd().split(";");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line === "") continue;
    const fields = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      if (i < line.length && line[i] === ";") i++;
    } else {
      const next = line.indexOf(";", i);
      if (next === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return fields;
}

// --- Converters ---

function convertBloodGlucose(rows: Record<string, string>[]): OmhDataPoint[] {
  return rows
    .filter((r) => r.timestamp && r.value)
    .map((r) => ({
      header: makeHeader("blood-glucose", "4.0", r.timestamp),
      body: {
        blood_glucose: {
          value: parseFloat(r.value),
          unit: "mg/dL",
        },
        effective_time_frame: { date_time: r.timestamp },
      },
    }));
}

function convertSkinTemperature(rows: Record<string, string>[]): OmhDataPoint[] {
  return rows
    .filter((r) => r.timestamp && r.skin_temp)
    .map((r) => ({
      header: makeHeader("body-temperature", "4.0", r.timestamp, "skin"),
      body: {
        body_temperature: {
          value: parseFloat(r.skin_temp),
          unit: "C",
        },
        effective_time_frame: { date_time: r.timestamp },
        measurement_location: "finger",
      },
    }));
}

interface FoodItem {
  name: string;
  weight: number;
}

function convertFoodLog(
  mealRows: Record<string, string>[],
  foodItemMap: Map<string, FoodItem>,
): OmhDataPoint[] {
  return mealRows
    .filter((r) => r.id && r.start_time)
    .map((r) => {
      let foodItems: Array<{ name: string; weight: { value: number; unit: string } }> = [];
      if (r.food_item_ids) {
        try {
          const ids: string[] = JSON.parse(r.food_item_ids);
          foodItems = ids
            .map((id) => foodItemMap.get(id))
            .filter((item): item is FoodItem => item != null)
            .map((item) => ({
              name: item.name,
              weight: { value: item.weight, unit: "g" },
            }));
        } catch { /* ignore malformed JSON */ }
      }
      let nutrition: Record<string, number | null> | undefined;
      if (r.nutrition_details) {
        try {
          nutrition = JSON.parse(r.nutrition_details);
        } catch { /* ignore */ }
      }
      return {
        header: makeHeader("food-log", "1.0", r.id, "", "custom"),
        body: {
          meal_name: r.name || undefined,
          meal_type: r.type || undefined,
          effective_time_frame: { date_time: r.start_time },
          ...(r.weight && {
            total_weight: { value: parseFloat(r.weight), unit: "g" },
          }),
          ...(foodItems.length > 0 && { food_items: foodItems }),
          ...(nutrition && { nutrition_per_100g: nutrition }),
        },
      };
    });
}

function convertDaytimeStress(rows: Record<string, string>[]): OmhDataPoint[] {
  return rows
    .filter((r) => r.timestamp && (r.stress_value || r.recovery_value))
    .map((r) => ({
      header: makeHeader("stress-level", "1.0", r.timestamp, "", "custom"),
      body: {
        ...(r.stress_value && { stress_value: parseInt(r.stress_value, 10) }),
        ...(r.recovery_value && { recovery_value: parseInt(r.recovery_value, 10) }),
        effective_time_frame: { date_time: r.timestamp },
      },
    }));
}

// --- Main ---

function loadFoodItemMap(rows: Record<string, string>[]): Map<string, FoodItem> {
  const map = new Map<string, FoodItem>();
  for (const row of rows) {
    if (row.id && row.name) {
      map.set(row.id, { name: row.name, weight: parseFloat(row.weight) || 0 });
    }
  }
  return map;
}

function main(): void {
  ensureOutDir();

  console.log(`Reading DSR CSV files from ${DSR_DIR}/\n`);

  const bloodGlucoseRows = parseCsv(join(DSR_DIR, "bloodglucose.csv"));
  const temperatureRows = parseCsv(join(DSR_DIR, "temperature.csv"));
  const mealRows = parseCsv(join(DSR_DIR, "meal.csv"));
  const foodItemRows = parseCsv(join(DSR_DIR, "fooditem.csv"));
  const stressRows = parseCsv(join(DSR_DIR, "daytimestress.csv"));

  console.log(`Loaded: ${bloodGlucoseRows.length} blood glucose, ${temperatureRows.length} temperature, ${mealRows.length} meal, ${foodItemRows.length} food item, ${stressRows.length} stress records`);

  const foodItemMap = loadFoodItemMap(foodItemRows);
  console.log(`\nExporting to omh/\n`);

  writeOutput("blood-glucose", convertBloodGlucose(bloodGlucoseRows));
  writeOutput("skin-temperature", convertSkinTemperature(temperatureRows));
  writeOutput("food-log", convertFoodLog(mealRows, foodItemMap));
  writeOutput("daytime-stress", convertDaytimeStress(stressRows));

  console.log("\nDone!");
}

main();
