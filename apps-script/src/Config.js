/**
 * Permanent source of truth for the Clasp-managed workbook.
 *
 * Sensitive values remain in Apps Script Script Properties:
 *   FASTAPI_URL
 *   APP_API_KEY
 */
const JOB_MATCH_TRACKER_COLUMNS = Object.freeze([
  "S/N",
  "Date Added",
  "Company Name",
  "Job Title",
  "Country / Location",
  "Job Type",
  "Job Level",
  "Job Link",
  "Job Description",
  "Salary / Compensation",

  "Application Status",
  "Date of Application",
  "Cover Letter Link",
  "Tailored CV Link",
  "Submission Proof Link",
  "Gmail Feedback",
  "Notes",

  "Duplicate Status",
  "Duplicate Row",
  "Duplicate Reason",
  "Analysis Status",

  "Screening Decision",
  "Screening Reasons",
  "Company Status",
  "Matched Company Name",
  "Company Tier",
  "Monthly Salary (NGN)",
  "Salary Status",
  "Job Quality Level",

  "Role Ceiling Decision",
  "Detected Role Level",
  "Role Ceiling Reasons",
  "Minimum Experience Years",
  "Maximum Experience Years",

  "Match %",
  "Match Level",
  "Matched Skills",
  "Missing Skills",
  "Tailoring Advice",
  "Decision",

  "Tailoring Completed?",
  "Quality Review",

  "Payment Rate",
  "Payment Eligibility",
  "Payment Due",
  "Payment Eligibility Reason",
]);

const JOB_MATCH_CONFIG = Object.freeze({
  workbookVersion: "3.0.0",

  trackerSheetName: "Sheet1",
  paymentSheetName: "Payment Summary",
  setupSheetName: "Setup",
  configSheetName: "Config",
  instructionsSheetName: "Instructions",

  headerRow: 1,
  dataStartRow: 2,
  formulaEndRow: 1000,

  scriptProperties: Object.freeze({
    fastApiUrl: "FASTAPI_URL",
    apiKey: "APP_API_KEY",
  }),

  apiKeyHeaderName: "x-api-key",

  opportunityGate: Object.freeze({
    minimumMonthlySalaryNgn: 500000,
    approvedCompanyTiers: Object.freeze(["A", "B"]),
  }),

  roleCeiling: Object.freeze({
    maximumAcceptedExperienceYears: 4,

    acceptedLevels: Object.freeze([
      "Internship",
      "Graduate",
      "Entry-level",
      "Junior",
      "Mid-level",
      "Unspecified",
    ]),

    manualReviewLevels: Object.freeze(["Senior"]),

    rejectedLevels: Object.freeze(["Leadership"]),
  }),

  thresholds: Object.freeze({
    applyMinimum: 90,
    tailorMinimum: 70,
    skipMaximum: 69,
  }),

  paymentRates: Object.freeze({
    Apply: 200,
    TailorFirst: 250,
    Skip: 0,
  }),

  targets: Object.freeze({
    jobsReviewedPerDay: 10,
    validApplicationsPerDay: 5,
    validApplicationsPerWeek: 25,
  }),

  submittedApplicationStatuses: Object.freeze([
    "Applied",
    "Screening",
    "Assessment",
    "Interview",
    "Rejected",
    "Offer",
    "Withdrawn",
  ]),

  trackerColumns: JOB_MATCH_TRACKER_COLUMNS,

  /*
   * Kept for compatibility with jmEnsureRequiredColumns_().
   */
  requiredColumns: JOB_MATCH_TRACKER_COLUMNS,

  inputHeaders: Object.freeze({
    companyName: Object.freeze(["company name", "company"]),

    jobTitle: Object.freeze(["job title", "role title", "position"]),

    countryLocation: Object.freeze([
      "country / location",
      "country/location",
      "location",
    ]),

    jobType: Object.freeze(["job type", "employment type"]),

    jobLevel: Object.freeze(["job level", "seniority", "seniority level"]),

    salaryText: Object.freeze([
      "salary / compensation",
      "salary",
      "compensation",
      "salary range",
    ]),

    jobLink: Object.freeze(["job link", "job url", "application link"]),

    jobDescription: Object.freeze(["job description", "description"]),
  }),

  outputHeaders: Object.freeze({
    screeningDecision: "Screening Decision",
    screeningReasons: "Screening Reasons",

    companyStatus: "Company Status",
    matchedCompanyName: "Matched Company Name",
    companyTier: "Company Tier",
    monthlySalaryNgn: "Monthly Salary (NGN)",

    salaryStatus: "Salary Status",
    jobQualityLevel: "Job Quality Level",

    roleCeilingDecision: "Role Ceiling Decision",
    detectedRoleLevel: "Detected Role Level",
    roleCeilingReasons: "Role Ceiling Reasons",
    minimumExperienceYears: "Minimum Experience Years",
    maximumExperienceYears: "Maximum Experience Years",

    matchPercentage: "Match %",
    matchLevel: "Match Level",
    matchedSkills: "Matched Skills",
    missingSkills: "Missing Skills",
    tailoringAdvice: "Tailoring Advice",
    decision: "Decision",

    analysisStatus: "Analysis Status",
  }),

  duplicateOutputHeaders: Object.freeze({
    duplicateStatus: "Duplicate Status",
    duplicateRow: "Duplicate Row",
    duplicateReason: "Duplicate Reason",
  }),

  validations: Object.freeze({
    "Job Type": Object.freeze([
      "Full-time",
      "Part-time",
      "Contract",
      "Remote",
      "Hybrid",
      "On-site",
    ]),

    "Job Level": Object.freeze([
      "Internship",
      "Graduate",
      "Entry-level",
      "Junior",
      "Mid-level",
      "Senior",
      "Lead",
      "Staff",
      "Principal",
      "Architect",
      "Manager",
      "Director",
      "Unspecified",
    ]),

    "Application Status": Object.freeze([
      "Not Applied",
      "In Progress",
      "Applied",
      "Screening",
      "Assessment",
      "Interview",
      "Rejected",
      "Offer",
      "Withdrawn",
      "Skipped",
    ]),

    "Duplicate Status": Object.freeze([
      "No duplicate found",
      "Already applied",
      "Possible duplicate — review",
    ]),

    "Analysis Status": Object.freeze([
      "Success",
      "Analysis failed — retry",
      "Already applied — API not called",
      "Possible duplicate — review",
      "Checking duplicate...",
      "Analyzing...",
    ]),

    "Screening Decision": Object.freeze([
      "Accepted",
      "Rejected",
      "Manual review",
    ]),

    "Company Status": Object.freeze(["Approved", "Not approved", "Unknown"]),

    "Company Tier": Object.freeze(["A", "B"]),

    "Salary Status": Object.freeze([
      "High-paying",
      "Not high-paying",
      "Unknown",
    ]),

    "Job Quality Level": Object.freeze(["High-end", "Not high-end", "Unknown"]),

    "Role Ceiling Decision": Object.freeze([
      "Accepted",
      "Rejected",
      "Manual review",
    ]),

    "Detected Role Level": Object.freeze([
      "Internship",
      "Graduate",
      "Entry-level",
      "Junior",
      "Mid-level",
      "Senior",
      "Leadership",
      "Unspecified",
    ]),

    "Match Level": Object.freeze(["Strong", "Medium", "Weak"]),

    Decision: Object.freeze(["Apply", "Tailor first", "Skip"]),

    "Tailoring Completed?": Object.freeze(["No", "Yes"]),

    "Quality Review": Object.freeze(["Pending", "Approved", "Rejected"]),
  }),
});
