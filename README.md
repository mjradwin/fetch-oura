# fetch-oura

A small TypeScript CLI tool that fetches all of your
[Oura Ring](https://ouraring.com/) data via the
[Oura API v2](https://cloud.ouraring.com/v2/docs) and stores it locally
as JSON files, organized by endpoint and month.

Useful for personal data analysis, backups, or building your own
dashboards on top of raw Oura data.

## Data fetched

The tool fetches 18 months of data across all available API endpoints:

| Endpoint | Description |
|---|---|
| `daily_activity` | Daily activity score, steps, calories |
| `daily_readiness` | Daily readiness score and contributors |
| `daily_sleep` | Daily sleep score and contributors |
| `daily_spo2` | Blood oxygen (SpO2) averages |
| `daily_stress` | Daily stress data |
| `daily_cardiovascular_age` | Cardiovascular age estimates |
| `daily_resilience` | Resilience score |
| `enhanced_tag` | Enhanced tags |
| `heartrate` | Heart rate time-series (5-second intervals) |
| `interbeat_interval` | Raw IBI data (requires research scope) |
| `temperature` | Skin temperature data (requires research scope) |
| `personal_info` | User profile |
| `rest_mode_period` | Rest mode episodes |
| `ring_configuration` | Ring hardware info |
| `session` | Guided/unguided sessions |
| `sleep` | Detailed sleep periods (stages, HRV, HR) |
| `sleep_time` | Sleep time recommendations |
| `tag` | User-entered tags |
| `vo2_max` | VO2 Max estimates |
| `workout` | Workout summaries |

Data is stored as:

```
data/
  personal_info.json
  daily_activity/
    2024-12.json
    2025-01.json
    ...
  sleep/
    2024-12.json
    ...
  heartrate/
    2024-12.json
    ...
```

Re-running the tool skips months that have already been downloaded,
so you can incrementally fetch new data.

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- An [Oura Ring](https://ouraring.com/) with an active membership

## Setup

### 1. Create an Oura API application

Go to <https://developer.ouraring.com/applications> and create a new
application. You'll need this to get an access token.

For full API documentation, see <https://cloud.ouraring.com/v2/docs>.

### 2. Get your access token

Complete the OAuth2 consent flow for your application to obtain an
`access_token`. The specific steps depend on the client type you chose
when creating your application. See the
[Oura authentication docs](https://cloud.ouraring.com/docs/authentication)
for details.

### 3. Store your token

```bash
mkdir -p ~/.config/oura
echo "YOUR_ACCESS_TOKEN" > ~/.config/oura/token
```

The tool reads the token from `~/.config/oura/token` at startup. This
file is never committed to the repository.

### 4. Install and run

```bash
git clone https://github.com/mradwin/fetch-oura.git
cd fetch-oura
npm install
npm start
```

The tool will fetch 18 months of data across all endpoints and write
JSON files to the `data/` directory (which is gitignored).

## Output

Each JSON file contains an array of records exactly as returned by
the Oura API. For example, `data/daily_sleep/2025-03.json`:

```json
[
  {
    "id": "...",
    "day": "2025-03-01",
    "score": 85,
    "contributors": { ... },
    ...
  },
  ...
]
```

## Open mHealth export

The `export-omh` script reads the downloaded Oura JSON files and converts
them to the [Open mHealth](https://www.openmhealth.org/) data point format.

```bash
npm run export-omh
```

This produces one JSON file per schema type in the `omh/` directory:

| Output file | OMH Schema | Oura source | Description |
|---|---|---|---|
| `sleep-episode.json` | `omh:sleep-episode:1.1` | `sleep` | Sleep periods with duration, efficiency, latency, awakenings |
| `sleep-stage.json` | `custom:sleep-stage:1.0` | `sleep` | Time-windowed sleep stages (deep/light/rem/awake) decoded from `sleep_phase_5_min` |
| `heart-rate-sleep.json` | `omh:heart-rate:2.0` | `sleep` | Per-5-minute and summary (avg/min) heart rate during sleep |
| `heart-rate-allday.json` | `omh:heart-rate:2.0` | `heartrate` | All-day heart rate with activity/sleep context |
| `heart-rate-session.json` | `omh:heart-rate:2.0` | `session` | Per-interval heart rate during meditation/rest sessions |
| `respiratory-rate.json` | `omh:respiratory-rate:2.0` | `sleep` | Average breathing rate during sleep |
| `rr-interval-sleep.json` | `omh:rr-interval:1.0` | `sleep` | Per-5-minute and summary HRV (RMSSD) during sleep |
| `rr-interval-session.json` | `omh:rr-interval:1.0` | `session` | Per-interval HRV during meditation/rest sessions |
| `body-temperature.json` | `omh:body-temperature:4.0` | `sleep` | Wrist temperature deviation during sleep |
| `step-count.json` | `omh:step-count:3.0` | `daily_activity` | Daily step count |
| `calories-burned.json` | `omh:calories-burned:2.0` | `daily_activity` | Active and total calories burned per day |
| `minutes-moderate-activity.json` | `omh:minutes-moderate-activity:1.0` | `daily_activity` | Daily moderate-intensity activity minutes |
| `oxygen-saturation.json` | `omh:oxygen-saturation:2.0` | `daily_spo2` | Nightly average SpO2 percentage |
| `physical-activity.json` | `omh:physical-activity:1.2` | `workout` | Workout sessions with activity type, calories, intensity |
| `body-weight.json` | `omh:body-weight:3.0` | `personal_info` | Body weight in kg |
| `body-height.json` | `omh:body-height:2.0` | `personal_info` | Body height in meters |

Each output file contains an array of OMH data points with standard
`header` and `body` fields. Data point IDs are deterministic, so
re-running the script produces identical output. Timestamps preserve
the timezone offset from the original Oura data (local time for sleep,
activity, and workout data; UTC for the all-day heart rate endpoint).

The `omh/` directory is gitignored alongside `data/`.

## Open mHealth export (DSR)

If you have a GDPR/CCPA data subject request (DSR) export from Oura,
the `export-omh-dsr` script converts the CSV files that contain data
not available through the API into Open mHealth format.

Place your DSR export in the `dsr-request/` directory (with `App Data/`
and `Subscriptions/` subdirectories), then run:

```bash
npm run export-omh-dsr
```

This exports 4 data sources unique to the DSR that aren't covered by
the API-based exporter:

| Output file | OMH Schema | DSR source | Description |
|---|---|---|---|
| `blood-glucose.json` | `omh:blood-glucose:3.0` | `bloodglucose.csv` | Blood glucose readings in mg/dL |
| `skin-temperature.json` | `omh:body-temperature:4.0` | `temperature.csv` | Raw wrist skin temperature in °C |
| `food-log.json` | `custom:food-log:1.0` | `meal.csv` + `fooditem.csv` | Meal logging with food items and nutrition details |
| `daytime-stress.json` | `custom:stress-level:1.0` | `daytimestress.csv` | Time-series stress and recovery values |

The remaining DSR CSV files (heartrate, sleep, daily activity, etc.)
duplicate data already available from the API and are not re-exported.

Output goes to the same `omh/` directory. Sensor timestamps (blood
glucose, temperature, stress) are UTC; meal timestamps preserve local
timezone offsets.

## Notes

- The `data/` directory is in `.gitignore` to prevent accidentally
  publishing personal health data.
- The `heartrate` endpoint returns high-volume data (~30,000-50,000
  records per month). Total data size is typically around 100 MB for
  18 months.
- The `interbeat_interval` and `temperature` endpoints require a
  research-scope OAuth token, which is not available to regular
  applications. The tool will silently skip them if your token
  lacks this scope.
- The Oura API rate limit is 5,000 requests per 5 minutes. The tool
  adds a small delay between requests as a courtesy.

## License

BSD-2-Clause
