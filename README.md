# Glioblastoma Research Tools

Two free tools from the Glioblastoma Foundation / Gliolab, published as one website:

- **Clinical Trials Finder** (`trials/`): every glioblastoma trial from ClinicalTrials.gov, refreshed **every day**.
- **Research Finder** (`papers/`): glioblastoma papers from PubMed, searched **live**, so it's always current.

The landing page (`index.html`) links to both.

## How the daily refresh works

A GitHub Actions job (`.github/workflows/update-and-deploy.yml`) runs every morning at about 5–6 AM Eastern. Each run:

1. Runs `scripts/fetch_trials.py` to download all glioblastoma trials from the ClinicalTrials.gov API.
2. Commits a small `trials/data/summary.json` with the day's counts (total, open, open in the U.S., open in NC). Over time this builds a history, and it keeps GitHub from pausing the schedule.
3. Publishes the site to GitHub Pages.

The big data files (`trials.js` / `trials.json`, about 15 MB) are rebuilt on every run and aren't stored in git.

**Run it by hand:** go to the Actions tab, open **Update data and deploy**, and click **Run workflow**.
**If a run fails** (e.g., ClinicalTrials.gov is down), the live site keeps the previous day's data and GitHub emails the repo owner.
**Pushing changes** to `main` also republishes the site automatically.

The Research Finder needs no refresh. It asks PubMed directly every time someone searches.

## Folder layout

| Path | What it is |
|---|---|
| `index.html` | Landing page linking to both tools |
| `trials/` | Trials finder: `index.html` (layout), `styles.css` (shared colors/fonts), `app.js` (search, filters, popup) |
| `trials/data/` | Trial data. `summary.json` is in git; `trials.js`/`trials.json` are generated |
| `scripts/fetch_trials.py` | Downloads and cleans the trials (standard-library Python, nothing to install) |
| `papers/` | Research finder: `index.html`, `styles.css`, `app.js`, and `config.js` (settings: GBM search, topics, article types, API key) |
| `.github/workflows/` | The daily job |

## Working on it locally

```
git clone https://github.com/<owner>/<repo>.git
cd <repo>
python3 scripts/fetch_trials.py   # download trial data
open index.html                   # open the landing page (or trials/index.html, papers/index.html)
```

Edit, check it in your browser, then commit and push. The site updates within a couple of minutes.

## Common edits

- **Trials search terms / tagging:** settings at the top of `scripts/fetch_trials.py`
- **Research topics, article types, GBM restriction:** `papers/config.js`
- **Colors and fonts:** the `:root` block in `trials/styles.css` (the landing page uses it too) and `papers/styles.css`
- **Schedule time:** the `cron` line in the workflow file (times are UTC)

## Before sharing widely

- Add an NCBI API key and the foundation's contact email to `papers/config.js` (free; raises PubMed's limit from 3 to 10 requests/second).
- Add the Gliolab logo (see the comment in each page's header).
- Optional: point a custom domain (e.g. `trials.gliolab.org`) at the site under Settings → Pages.
