"""
fetch_trials.py
---------------
Pulls every glioblastoma trial from the ClinicalTrials.gov API (v2),
cleans it up, and saves it for the website.

Runs automatically every day on GitHub (see .github/workflows/update-and-deploy.yml).
To run it yourself, from the repo folder in Terminal:
    python3 scripts/fetch_trials.py

Outputs (in trials/data/):
    trials.js     <- what the website loads (works by double-clicking trials/index.html)
    trials.json   <- same data as plain JSON (handy for analysis / other tools)
    summary.json  <- small daily snapshot of the counts (kept in git, so there's a history)

Only uses the Python standard library, so nothing to install.
Re-run it any time to refresh the data (e.g. weekly).
"""

import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Settings you might want to change
# ---------------------------------------------------------------------------

# Condition search sent to ClinicalTrials.gov. Their search already expands
# synonyms (GBM, glioblastoma multiforme, grade IV astrocytoma, etc.), so
# "glioblastoma" by itself catches the standard terms.
SEARCH_CONDITION = "glioblastoma"

API_URL = "https://clinicaltrials.gov/api/v2/studies"
PAGE_SIZE = 1000  # max the API allows per page

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "trials", "data")

# Words used to decide if a trial explicitly names glioblastoma as a condition
# (vs. a broad "solid tumors" / "brain tumors" trial that just matched the search)
GBM_TERMS = [
    "glioblastoma", "gbm", "gliosarcoma",
    "grade iv astrocytoma", "grade 4 astrocytoma", "astrocytoma, grade iv",
    "astrocytoma grade iv", "astrocytoma grade 4", "giant cell glioblastoma",
]

# Words used to tag newly diagnosed vs recurrent trials
NEW_DX_TERMS = ["newly diagnosed", "newly-diagnosed", "new diagnosis", "de novo",
                "treatment-naive", "treatment naive", "untreated", "first-line", "first line"]
RECURRENT_TERMS = ["recurrent", "recurrence", "relapsed", "relapse", "progressive",
                   "progression", "refractory", "second-line", "salvage"]

# Friendly labels for the API's codes
STATUS_LABELS = {
    "RECRUITING": "Recruiting",
    "NOT_YET_RECRUITING": "Not yet recruiting",
    "ENROLLING_BY_INVITATION": "Enrolling by invitation",
    "ACTIVE_NOT_RECRUITING": "Active, not recruiting",
    "COMPLETED": "Completed",
    "SUSPENDED": "Suspended",
    "TERMINATED": "Terminated",
    "WITHDRAWN": "Withdrawn",
    "AVAILABLE": "Expanded access available",
    "NO_LONGER_AVAILABLE": "Expanded access no longer available",
    "TEMPORARILY_NOT_AVAILABLE": "Expanded access temporarily unavailable",
    "APPROVED_FOR_MARKETING": "Approved for marketing",
    "WITHHELD": "Withheld",
    "UNKNOWN": "Unknown status",
}

PHASE_LABELS = {
    "EARLY_PHASE1": "Early Phase 1",
    "PHASE1": "Phase 1",
    "PHASE2": "Phase 2",
    "PHASE3": "Phase 3",
    "PHASE4": "Phase 4",
    "NA": "Not applicable",
}

INTERVENTION_LABELS = {
    "DRUG": "Drug",
    "BIOLOGICAL": "Biological / Immunotherapy",
    "RADIATION": "Radiation",
    "PROCEDURE": "Surgery / Procedure",
    "DEVICE": "Device",
    "BEHAVIORAL": "Behavioral",
    "DIAGNOSTIC_TEST": "Diagnostic test",
    "GENETIC": "Genetic",
    "DIETARY_SUPPLEMENT": "Dietary supplement",
    "COMBINATION_PRODUCT": "Combination product",
    "OTHER": "Other",
}

AGE_LABELS = {
    "CHILD": "Children (0-17)",
    "ADULT": "Adults (18-64)",
    "OLDER_ADULT": "Older adults (65+)",
}

STUDY_TYPE_LABELS = {
    "INTERVENTIONAL": "Interventional (tests a treatment)",
    "OBSERVATIONAL": "Observational (no assigned treatment)",
    "EXPANDED_ACCESS": "Expanded access",
}

# Short names for the Study Type filter (same wording as ClinicalTrials.gov)
STUDY_TYPE_TAGS = {
    "INTERVENTIONAL": "Interventional",
    "OBSERVATIONAL": "Observational",
    "EXPANDED_ACCESS": "Expanded access",
}
EXPANDED_ACCESS_TAGS = {
    "individual": "Individual patients",
    "intermediate": "Intermediate-size population",
    "treatment": "Treatment IND/Protocol",
}


def study_type_tags(design):
    """Main study type plus subtypes, e.g. ["Observational", "Patient registries"]."""
    tags = []
    main = design.get("studyType", "")
    if main in STUDY_TYPE_TAGS:
        tags.append(STUDY_TYPE_TAGS[main])
    if design.get("patientRegistry"):
        tags.append("Patient registries")
    ea = design.get("expandedAccessTypes") or {}
    for key, label in EXPANDED_ACCESS_TAGS.items():
        if ea.get(key):
            tags.append(label)
    return tags


# ---------------------------------------------------------------------------
# Downloading
# ---------------------------------------------------------------------------

def make_ssl_context():
    """Use certifi's certificates if installed (fixes a common Mac python.org SSL error)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def get_json(params, ctx, retries=3):
    url = API_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "gbm-trials-finder/1.0"})
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # network hiccup -> wait and retry
            if attempt == retries:
                raise
            print(f"  request failed ({e}), retrying in {attempt * 3}s...")
            time.sleep(attempt * 3)


def download_all_studies():
    ctx = make_ssl_context()
    params = {
        "query.cond": SEARCH_CONDITION,
        "pageSize": PAGE_SIZE,
        "countTotal": "true",
        "format": "json",
    }
    studies, page = [], 1
    while True:
        data = get_json(params, ctx)
        batch = data.get("studies", [])
        studies.extend(batch)
        total = data.get("totalCount", "?")
        print(f"  page {page}: got {len(batch)} (total so far {len(studies)} / {total})")
        token = data.get("nextPageToken")
        if not token:
            break
        params["pageToken"] = token
        page += 1
        time.sleep(0.5)  # be polite to the API
    return studies


# ---------------------------------------------------------------------------
# Cleaning one study into a flat record for the website
# ---------------------------------------------------------------------------

def has_any(text, terms):
    return any(t in text for t in terms)


def classify_diagnosis(primary_text, fallback_text):
    """Newly diagnosed / Recurrent / Both / Not specified, based on keywords."""
    for text in (primary_text, fallback_text):
        new = has_any(text, NEW_DX_TERMS)
        rec = has_any(text, RECURRENT_TERMS)
        if new and rec:
            return "Both"
        if new:
            return "Newly diagnosed"
        if rec:
            return "Recurrent"
    return "Not specified"


def phase_label(phases):
    if not phases:
        return "Not applicable"
    labels = [PHASE_LABELS.get(p, p) for p in phases]
    if len(labels) == 2 and all(l.startswith("Phase") for l in labels):
        return "Phase " + "/".join(l.replace("Phase ", "") for l in labels)  # e.g. Phase 1/2
    return " / ".join(labels)


def clean_study(study):
    ps = study.get("protocolSection", {})
    ident = ps.get("identificationModule", {})
    status = ps.get("statusModule", {})
    sponsor = ps.get("sponsorCollaboratorsModule", {})
    desc = ps.get("descriptionModule", {})
    conds = ps.get("conditionsModule", {})
    design = ps.get("designModule", {})
    arms = ps.get("armsInterventionsModule", {})
    elig = ps.get("eligibilityModule", {})
    contacts = ps.get("contactsLocationsModule", {})

    nct = ident.get("nctId", "")
    conditions = conds.get("conditions", []) or []
    keywords = conds.get("keywords", []) or []
    brief_title = ident.get("briefTitle", "")
    official_title = ident.get("officialTitle", "")
    summary = desc.get("briefSummary", "")

    # interventions
    interventions = []
    for iv in arms.get("interventions", []) or []:
        interventions.append({
            "type": INTERVENTION_LABELS.get(iv.get("type", "OTHER"), "Other"),
            "name": iv.get("name", ""),
        })
    intervention_types = sorted({iv["type"] for iv in interventions})

    # locations
    locations = []
    for loc in contacts.get("locations", []) or []:
        c = (loc.get("contacts") or [{}])[0]
        locations.append({
            "facility": loc.get("facility", ""),
            "city": loc.get("city", ""),
            "state": loc.get("state", ""),
            "country": loc.get("country", ""),
            "status": STATUS_LABELS.get(loc.get("status", ""), loc.get("status", "")),
            "contact": c.get("name", ""),
            "phone": c.get("phone", ""),
            "email": c.get("email", ""),
        })
    countries = sorted({l["country"] for l in locations if l["country"]})
    us_states = sorted({l["state"] for l in locations if l["country"] == "United States" and l["state"]})

    central = [{
        "name": c.get("name", ""),
        "phone": c.get("phone", ""),
        "email": c.get("email", ""),
    } for c in contacts.get("centralContacts", []) or []]

    # tags
    cond_text = " ".join(conditions).lower()
    primary_text = " ".join([brief_title, official_title, " ".join(conditions), " ".join(keywords)]).lower()
    diagnosis = classify_diagnosis(primary_text, summary.lower())

    overall = status.get("overallStatus", "UNKNOWN")

    return {
        "nct_id": nct,
        "title": brief_title,
        "official_title": official_title,
        "acronym": ident.get("acronym", ""),
        "status": STATUS_LABELS.get(overall, overall),
        "status_code": overall,
        "phase": phase_label(design.get("phases")),
        "study_type": STUDY_TYPE_LABELS.get(design.get("studyType", ""), design.get("studyType", "")),
        "study_type_tags": study_type_tags(design),
        "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
        "sponsor": (sponsor.get("leadSponsor") or {}).get("name", ""),
        "summary": summary,
        "conditions": conditions,
        "gbm_named": has_any(cond_text, GBM_TERMS),
        "diagnosis": diagnosis,
        "interventions": interventions,
        "intervention_types": intervention_types,
        "eligibility": elig.get("eligibilityCriteria", ""),
        "sex": (elig.get("sex") or "ALL").title(),
        "min_age": elig.get("minimumAge", ""),
        "max_age": elig.get("maximumAge", ""),
        "age_groups": [AGE_LABELS.get(a, a) for a in elig.get("stdAges", []) or []],
        "healthy_volunteers": bool(elig.get("healthyVolunteers")),
        "start_date": (status.get("startDateStruct") or {}).get("date", ""),
        "completion_date": (status.get("primaryCompletionDateStruct") or {}).get("date", ""),
        "last_updated": (status.get("lastUpdatePostDateStruct") or {}).get("date", ""),
        "has_results": bool(study.get("hasResults")),
        "central_contacts": central,
        "locations": locations,
        "countries": countries,
        "us_states": us_states,
        "url": f"https://clinicaltrials.gov/study/{nct}",
    }


# ---------------------------------------------------------------------------
# Saving
# ---------------------------------------------------------------------------

def save(trials):
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "search_condition": SEARCH_CONDITION,
        "count": len(trials),
        "trials": trials,
    }
    with open(os.path.join(OUT_DIR, "trials.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    # .js version so index.html works when opened straight from Finder
    with open(os.path.join(OUT_DIR, "trials.js"), "w", encoding="utf-8") as f:
        f.write("// Auto-generated by fetch_trials.py - don't edit by hand, just re-run the script.\n")
        f.write("window.GBM_TRIALS = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def save_summary(trials):
    """Small file with today's counts. The daily GitHub job commits this, which
    builds a history of trial counts over time and keeps the daily schedule active."""
    open_statuses = ("RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION")
    open_trials = [t for t in trials if t["status_code"] in open_statuses]
    summary = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "total_trials": len(trials),
        "open_trials": len(open_trials),
        "open_in_us": sum("United States" in t["countries"] for t in open_trials),
        "open_in_nc": sum("North Carolina" in t["us_states"] for t in open_trials),
        "countries": len({c for t in trials for c in t["countries"]}),
    }
    with open(os.path.join(OUT_DIR, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
    return summary


def main():
    print(f"Downloading '{SEARCH_CONDITION}' trials from ClinicalTrials.gov...")
    try:
        studies = download_all_studies()
    except Exception as e:
        print("\nCouldn't reach ClinicalTrials.gov:", e)
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            print("Fix: run  pip3 install certifi  (or open 'Install Certificates.command' "
                  "in your Python folder in Applications), then try again.")
        sys.exit(1)

    trials = [clean_study(s) for s in studies]
    trials = [t for t in trials if t["nct_id"]]
    # newest updates first
    trials.sort(key=lambda t: t["last_updated"], reverse=True)

    save(trials)
    save_summary(trials)

    recruiting = sum(t["status_code"] in ("RECRUITING", "NOT_YET_RECRUITING") for t in trials)
    named = sum(t["gbm_named"] for t in trials)
    print(f"\nDone! Saved {len(trials)} trials to trials/data/")
    print(f"  {recruiting} recruiting or not yet recruiting")
    print(f"  {named} list glioblastoma explicitly as a condition")
    print("Open trials/index.html to view the site.")


if __name__ == "__main__":
    main()
