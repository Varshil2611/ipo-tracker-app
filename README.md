# IPO Tracker — Google Sheets Sync (via Apps Script, no Cloud Console)

React + Node/Express IPO tracker backed by a Google Sheet. This version connects to
Google using **Apps Script**, not the Google Cloud Console / service accounts — so
there's nothing to enable, no JSON keys, and no billing to worry about. Apps Script
is a free, built-in part of every Google account.

## Features
- Viewer-only IPO summary and applicant list.
- PAN and Beneficiary ID are masked for viewers.
- Admin PIN protected panel.
- Admin can view unmasked sensitive applicant fields.
- Admin can add/edit/delete IPO rows and applicant rows from the website.
- Website admin changes are written straight back to your Google Sheet.
- Sheet changes (edited directly by you) are checked automatically every
  **5 minutes** (configurable).
- Admin can use **Sync Google Sheet Now** without waiting.
- Search, status, date range, investment range, and sorting filters for IPOs.
- No database, no Google Cloud project, no service account, no bill — ever.

---

## Why this is genuinely free

- Apps Script scripts run under **your own Google account**, for free, with a daily
  quota (20,000 web-app requests/day on a personal account) far beyond what a
  personal tracker uses.
- There's no Cloud Console project to create, no API to enable, and nothing to
  attach a credit card to. If you never explicitly go create a *separate* Cloud
  project and *explicitly* add billing to it (which nothing in this guide asks you
  to do), you cannot be charged.

---

## 1. One-time Google setup (all inside Google Sheets — no Cloud Console)

1. **Create a Google Sheet.** Go to [sheets.google.com](https://sheets.google.com) →
   **Blank spreadsheet**. Name it e.g. "IPO Tracker Data". You don't need to add any
   tabs yourself — the script below creates an `IPOs` tab and an `Applicants` tab
   automatically the first time it runs.

2. **Open the script editor.** In the Sheet, go to **Extensions → Apps Script**. A
   new tab opens with a blank `Code.gs` file.

3. **Paste the script.** Delete the placeholder code and paste in the entire
   contents of `apps-script/Code.gs` from this project.

4. **Set your own secret.** Near the top of the pasted code, change this line to
   your own random string (treat it like a password):
   ```js
   const SECRET = 'change-this-to-a-long-random-string';
   ```
   Save the script (Ctrl/Cmd+S).

5. **Deploy it as a web app.** Click **Deploy → New deployment**. Click the gear
   icon next to "Select type" and choose **Web app**. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy**.

6. **Authorize it.** Google will ask you to authorize the script. Click
   **Authorize access**, pick your Google account, and if you see a "Google hasn't
   verified this app" screen, click **Advanced → Go to (your project name) (unsafe)**
   — this warning is normal and expected for scripts you write and run yourself; it
   only means Google hasn't manually reviewed it (they haven't reviewed your own
   script because nobody submitted it for review), not that anything is wrong.

7. **Copy the Web app URL.** After deploying, copy the URL shown (ends in `/exec`).
   That's your `APPS_SCRIPT_URL`.

That's the entire setup. No Cloud Console, no JSON key files, no billing.

---

## 2. Configure the app

1. Install Node.js 20+.
2. From the project root:
   ```bash
   npm install
   npm run install:all
   ```
3. Copy the env template and fill it in:
   ```bash
   cp server/.env.example server/.env
   ```
4. Open `server/.env` and set:
   - `ADMIN_PIN` — any PIN you want for the admin panel.
   - `APPS_SCRIPT_URL` — the URL from setup step 7.
   - `APPS_SCRIPT_SECRET` — the same string you put in `SECRET` in `Code.gs`.

## 3. Migrate your existing Excel data (optional, one time)

If you have the old `IPO Tracker Updated.xlsx` (it's included at
`server/data/IPO Tracker Updated.xlsx`), run:

```bash
npm run migrate
```

This reads the workbook and writes its rows into the `IPOs` and `Applicants` tabs of
your Google Sheet through the Apps Script web app. Run it only once — after that,
the Sheet is the source of truth.

## 4. Test the connection

```bash
npm run test-connection
```

You should see `All good! You can now run: npm run dev`. If it fails, the error
message tells you which setup step to re-check (wrong URL, secret mismatch, "Who
has access" not set to Anyone, etc.).

## 5. Run it locally

```bash
npm run dev
```

Open `http://localhost:5173`. Try it end to end:
- Load the page — you should see your IPOs.
- Click **Admin**, enter your PIN, edit or add an IPO, save — check your Google
  Sheet and you should see the change in the `IPOs` tab within a couple of seconds.
- Edit a cell directly in the Google Sheet, then click **Sync Google Sheet Now** in
  the admin panel (or wait 5 minutes) — the change should appear in the app.

## 6. Production build (for hosting)

```bash
npm run build
npm start
```

Builds the React client into `client/dist` and starts the Express server on port
4000 (or `$PORT`), serving both the API and the built frontend from one process.

---

## 7. Host it online for free (Render.com)

1. **Put the project in a Git repo** (GitHub is easiest). The `.gitignore` already
   excludes `.env`, so your secret and PIN won't be committed.

2. **Sign up at [render.com](https://render.com)** (free, can use GitHub login).

3. Click **New +** → **Web Service** → connect your GitHub repo.

4. Configure:
   - **Runtime**: Node.
   - **Build Command**: `npm run install:all && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**.

5. Under **Environment Variables**, add:
   - `ADMIN_PIN` = your chosen PIN
   - `APPS_SCRIPT_URL` = your Apps Script web app URL
   - `APPS_SCRIPT_SECRET` = your secret from `Code.gs`
   - `SYNC_INTERVAL_MS` = `300000` (optional)

6. Click **Create Web Service**. You'll get a public URL like
   `https://ipo-tracker.onrender.com`.

   *(Or use Render's **New + → Blueprint**, which reads the included `render.yaml`
   and only asks for the secret values.)*

**Free-tier note:** Render's free web services spin down after ~15 minutes idle and
take ~30–60 seconds to wake on the next visit — normal for a personal tracker.

---

## How the two-way sync works

- **App → Sheet**: any admin save calls the Apps Script web app, which overwrites
  the relevant tab's rows.
- **Sheet → App**: the server re-fetches from Apps Script on a timer
  (`SYNC_INTERVAL_MS`, default 5 minutes) and whenever an admin clicks **Sync Google
  Sheet Now**. Viewers get fresh data on each page load.
- The whole `IPOs` tab and whole `Applicants` tab are rewritten as one block on
  every save — keep the header row (row 1) intact and don't add unrelated columns to
  those two tabs.
- Dates are stored as plain `YYYY-MM-DD` text so parsing stays predictable.

## If you ever change the script

If you edit `apps-script/Code.gs` later (e.g. to change the SECRET), you need to
click **Deploy → Manage deployments → (pencil/edit icon) → New version → Deploy**
for the change to take effect — saving the file alone isn't enough for an existing
deployment.
