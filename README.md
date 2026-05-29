# AI Resume Matcher

AI-powered recruiting assistant built on **Google Apps Script**, **Google Sheets**, **Google Drive**, and **OpenRouter**. Recruiters create jobs, drop resumes into per-job Drive folders, and get ranked candidate evaluations with scores and summaries.

## Repository layout

| Path | Purpose |
|------|---------|
| [`apps-script/`](apps-script/) | Deployable Apps Script project (clasp root) |
| [`apps-script/index.html`](apps-script/index.html) | Dashboard shell |
| [`apps-script/dashboard.html`](apps-script/dashboard.html) | Client JS (included by index; mirrors `dashboard.js`) |
| [`apps-script/*.gs`](apps-script/) | Backend modules |

## Fixed environment IDs

Configured in [`apps-script/utils.gs`](apps-script/utils.gs):

| Constant | Value |
|----------|-------|
| Spreadsheet | `1ZEWgvTHh2Pw1uEaJ5x-YhzP0m7phLiCWBuNgQtlNkt0` (inside Drive folder `17rX9WWYD5CHhYeqe00Uc2fVx0jkHmNwU`) |
| Resume root folder | `1E6XaiBVnTnq6Oy0xFYrtRH5Ms9a8gDRn` |

The Apps Script deployer must have **Editor** access to both.

## Prerequisites

- Google account with access to the spreadsheet and resume root folder
- [clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
- OpenRouter API key ([openrouter.ai](https://openrouter.ai))

## Quick start

### 1. Create or link the Apps Script project

```bash
cd apps-script
clasp login
```

**Option A — New standalone project:**

```bash
clasp create --type standalone --title "AI Resume Matcher"
```

**Option B — Bind to existing sheet:**

```bash
clasp clone <SCRIPT_ID>
```

Copy [`.clasp.json.example`](apps-script/.clasp.json.example) to `.clasp.json` and set your script ID.

### 2. Enable the Drive advanced service

In the Apps Script editor:

1. **Project Settings** → enable **Google Apps Script API** (for clasp)
2. **Services** (+) → add **Google Drive API** (identifier: `Drive`, v2)
3. In [Google Cloud Console](https://console.cloud.google.com/) for the script’s GCP project, enable **Google Drive API**

### 3. Push code

```bash
clasp push
```

### 4. Set Script properties

In Apps Script: **Project Settings** → **Script properties**

| Property | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `OPENROUTER_MODEL` | No | Default model (e.g. `google/gemini-2.0-flash-001`); also settable in UI |

### 5. Initialize sheets

Open the spreadsheet and use menu **AI Resume Matcher → Initialize / repair sheets**, or load the web app (auto-initializes).

Sheets created: **Jobs**, **Candidates**, **Evaluations**, **Queue**.

### 6. Install queue trigger

Menu: **AI Resume Matcher → Install queue trigger**

Or click **Repair triggers** in the web app. A 1-minute time-based trigger processes the queue (5 items per run).

### 7. Deploy web app

1. **Deploy** → **New deployment** → type **Web app**
2. **Execute as:** Me
3. **Who has access:** Anyone (or your organization)
4. Copy the deployment URL

## Usage walkthrough

1. **Create a job** — title, description, optional skills. A Drive subfolder is created under the resume root.
2. **Drop resumes** — PDF or DOCX files into the job’s folder (link in UI).
3. **Import resumes** — selects new files, creates candidate rows, and **auto-queues parsing** (text + name/email/location extraction).
4. **Wait for parsing** — progress bar shows parse status; candidate table fills in contact fields.
5. **Select evaluation model** — OpenRouter dropdown in header (optional **Free only** filter).
6. **Analyze candidates** — queues AI evaluation for parsed resumes only; results appear ranked by score.
7. **Review results** — scores 4–5 green, 3 yellow, 1–2 red; summary and recommended flag per candidate.

## Architecture

```
Import (metadata) → parse queue → evaluate queue
                         ↓              ↓
                   Text + profile    OpenRouter scoring
                   extraction        → Evaluations sheet
```

- **Parse tasks:** Drive PDF/DOCX conversion, regex email, OpenRouter profile JSON
- **Evaluate tasks:** OpenRouter job-fit JSON, server-side weighted overall score (Skills 40%, Experience 35%, Seniority 15%, Education 10%)

## Google Sheets schema

### Jobs
`Job ID | Title | Description | Skills | Resume Folder ID | Resume Folder URL | Created At`

### Candidates
`Candidate ID | Job ID | First Name | Last Name | Email | Location | Resume File Name | Resume URL | Parsed Text | Imported At`

### Evaluations
`Evaluation ID | Job ID | Candidate ID | Overall Score | Skills Match | Experience Match | Seniority Match | Education Match | Strengths | Weaknesses | Summary | Recommended | Evaluated At`

### Queue
`Queue ID | Candidate ID | Job ID | Task Type | Status | Error | Started At | Finished At | Retry Count`

Task types: `parse`, `evaluate`. Statuses: `pending`, `processing`, `completed`, `failed`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Cannot open spreadsheet | Share sheet with deployer account (Editor) |
| Cannot access job folder | Share resume root folder `1E6XaiBVnTnq6Oy0xFYrtRH5Ms9a8gDRn` with deployer |
| OPENROUTER_API_KEY error | Add key in Script properties |
| Models dropdown empty | Set API key, click **Refresh models** |
| Parsing stuck | **Repair triggers**; menu **Process queue now** |
| Analyze disabled | Wait until candidates show **Parsed** status |
| Invalid JSON from AI | Auto-retries once; check Queue sheet **Error** column |
| PDF parse fails | Confirm Drive API advanced service is enabled; re-authorize after scope updates (Documents access) |
| All parses failed | Click **Repair triggers** with the job selected to requeue failed tasks |
| Candidates still parsing after Analyze | Click **Analyze** again after parse completes |

## Development notes

- Client logic lives in `dashboard.html` (Apps Script `include()` only supports `.html`). `dashboard.js` is a local reference stub.
- API keys never exposed to the frontend; all OpenRouter calls are server-side.
- Queue batch size: 5 items per minute (configurable in `CONFIG.BATCH_SIZE`).

## License

Internal MVP — DataGradient.
