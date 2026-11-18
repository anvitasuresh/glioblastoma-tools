/* =========================================================
   Glioblastoma Research Finder - settings
   Everything you're likely to want to change is in this file.
   ========================================================= */

window.GBM_PAPERS_CONFIG = {
  // --- PubMed API (NCBI E-utilities) ---
  // Optional but recommended: a free NCBI API key raises the limit from
  // 3 to 10 requests per second. Get one at
  // https://www.ncbi.nlm.nih.gov/account/settings/ (API Key Management).
  apiKey: "",
  // NCBI asks apps to identify themselves. Put the foundation's contact email here.
  tool: "gliolab-research-finder",
  email: "",

  // --- The glioblastoma restriction ---
  // Every search is combined with this, so results are always glioblastoma papers.
  // Note: "GBM" alone isn't used because it also means "glomerular basement
  // membrane" in kidney research, which pulls in unrelated papers.
  baseQuery:
    '(glioblastoma[MeSH Terms] OR glioblastoma[Title/Abstract] OR ' +
    '"glioblastoma multiforme"[Title/Abstract] OR gliosarcoma[Title/Abstract])',

  pageSize: 20,

  // --- Topic filters (GBM-specific) ---
  // label = what users see, query = PubMed search syntax behind it.
  // Selecting several topics finds papers matching ANY of them.
  topics: [
    { label: "Immunotherapy", query: 'immunotherapy[MeSH Terms] OR immunotherapy[tiab] OR vaccine*[tiab] OR "CAR T"[tiab] OR CAR-T[tiab] OR "checkpoint inhibitor*"[tiab]' },
    { label: "Temozolomide & chemotherapy", query: 'temozolomide[MeSH Terms] OR temozolomide[tiab] OR chemotherapy[tiab]' },
    { label: "Radiation therapy", query: 'radiotherapy[MeSH Terms] OR radiotherapy[tiab] OR "radiation therapy"[tiab] OR chemoradiation[tiab]' },
    { label: "Surgery", query: '"neurosurgical procedures"[MeSH Terms] OR resection[tiab] OR surgery[tiab] OR surgical[tiab]' },
    { label: "Tumor Treating Fields", query: '"tumor treating fields"[tiab] OR "tumour treating fields"[tiab] OR TTFields[tiab] OR Optune[tiab]' },
    { label: "MGMT", query: 'MGMT[tiab] OR O6-methylguanine[tiab]' },
    { label: "IDH", query: 'IDH[tiab] OR IDH1[tiab] OR "isocitrate dehydrogenase"[tiab]' },
    { label: "DNA methylation & classification", query: '"DNA methylation"[MeSH Terms] OR "methylation profiling"[tiab] OR "methylation classifier"[tiab] OR epigenetic*[tiab]' },
    { label: "Genomics & biomarkers", query: '"biomarkers, tumor"[MeSH Terms] OR genomic*[tiab] OR EGFR[tiab] OR sequencing[tiab]' },
    { label: "Imaging (MRI/PET)", query: '"magnetic resonance imaging"[MeSH Terms] OR MRI[tiab] OR PET[tiab] OR "positron emission"[tiab]' },
    { label: "Recurrent glioblastoma", query: 'recurrent[tiab] OR recurrence[tiab] OR progressive[tiab] OR relapse*[tiab]' },
    { label: "Drug repurposing", query: '"drug repositioning"[MeSH Terms] OR repurpos*[tiab] OR repositioning[tiab]' },
    { label: "Focused ultrasound", query: '"ultrasonic therapy"[MeSH Terms] OR "focused ultrasound"[tiab] OR "blood-brain barrier opening"[tiab]' },
    { label: "Quality of life & caregiving", query: '"quality of life"[MeSH Terms] OR "quality of life"[tiab] OR caregiver*[tiab] OR palliative[tiab]' },
    { label: "Children & young adults", query: 'child[MeSH Terms] OR adolescent[MeSH Terms] OR pediatric[tiab] OR paediatric[tiab]' },
  ],

  // --- Article type filters (PubMed publication types) ---
  articleTypes: [
    { label: "Clinical trial", query: '"clinical trial"[pt]' },
    { label: "Randomized controlled trial", query: '"randomized controlled trial"[pt]' },
    { label: "Review", query: 'review[pt]' },
    { label: "Systematic review", query: '"systematic review"[pt]' },
    { label: "Meta-analysis", query: 'meta-analysis[pt]' },
    { label: "Case report", query: '"case reports"[pt]' },
    { label: "Guideline", query: 'guideline[pt] OR "practice guideline"[pt]' },
  ],
};
