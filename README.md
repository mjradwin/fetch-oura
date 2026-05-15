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

## Notes

- The `data/` directory is in `.gitignore` to prevent accidentally
  publishing personal health data.
- The `heartrate` endpoint returns high-volume data (~30,000-50,000
  records per month). Total data size is typically around 100 MB for
  18 months.
- The `interbeat_interval` endpoint requires a research-scope OAuth
  token, which is not available to regular applications. The tool
  will silently skip it if your token lacks this scope.
- The Oura API rate limit is 5,000 requests per 5 minutes. The tool
  adds a small delay between requests as a courtesy.

## License

BSD-2-Clause
