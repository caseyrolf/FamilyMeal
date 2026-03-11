# Family Meal Planner

Password-scoped React web app for saving family recipes, planning meals, and generating consolidated shopping lists.

## Features

- Password gate at entry; each password maps to a separate recipe collection stored locally in `data/family_meals.json`.
- Add recipes by pasting a URL. The server fetches the page, parses JSON-LD recipe data when available, and falls back to heuristic scraping.
- Import recipes by pasting a URL or dropping in raw recipe text; the parser normalises ingredients, steps, and nutrition facts automatically when present.
- Edit recipe details, categorize them (chicken, soup, dessert, etc.), and search by name or ingredient. Recipes support quick inline updates of ingredients and cooking steps from the detail view.
- Build meal plans by selecting multiple recipes and generate an aggregated shopping list with summed ingredient quantities.
- Export shopping lists as JSON, CSV, plain text, PNG image (via `html2canvas` in the browser), or POST them to a custom API endpoint.
- Optional sample dataset (`npm run seed`) seeds two starter recipes protected by password `demo`.

## Tech Stack

- **Frontend:** React 18 (UMD build via CDN) rendered in the browser, no bundler required.
- **Backend:** Node.js 20 HTTP server (no external dependencies) serving the React app, JSON API, recipe scraping, and shopping-list aggregation.
- **Storage:** Local JSON file at `data/family_meals.json`, organized by SHA-256 hash of the family password.

## Getting Started

1. Install dependencies (none beyond Node.js 18+). This project avoids npm packages to keep setup light.
2. Optionally seed demo data:

   ```bash
   npm run seed
   # Password for seeded data: demo
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:4000` in the browser. Enter your family password; if it does not exist yet, choose “Create new list” to initialize storage.

### Development Notes

- Static assets live in `client/` and are served directly by the Node server.
- Recipe parsing favours JSON-LD (`application/ld+json`) blocks; if none are present, it falls back to searching for ingredient and instruction elements.
- Ingredient normalization attempts to parse quantity and units to support shopping-list aggregation. Unknown formats default to carrying the original text.
- Shopping-list exports:
  - **JSON / CSV / Text** downloads happen client-side via blob URLs.
  - **PNG** export uses `html2canvas` loaded from a CDN.
  - **Archive to local JSON** sends the list to `/api/shopping-list/export`, which writes to `data/exports/`.

## Key Scripts

- `npm start` / `npm run server` – launch the HTTP API and static asset server on port 4000.
- `npm run seed` – copy `data/sample_recipes.json` to `data/family_meals.json` with demo credentials.

## File Structure

- `client/` – React UI (`index.html`, `app.jsx`, `styles.css`).
- `server/index.js` – HTTP server, authentication, scraping, REST endpoints.
- `data/` – Persistent JSON storage and optional sample dataset.
- `scripts/seed.js` – Helper to load the sample dataset.

## Caveats

- In this workspace sandbox, binding to TCP ports is blocked, so `npm start` fails with `EPERM`. Run the app on your local machine instead.
- The scraper relies on remote sites serving accessible HTML; some sites may block requests or omit structured recipe data, leading to minimal parsing results.
- There is no sophisticated error logging or rate limiting; this system is intended for personal/home use only.
