const JOB_MATCH_CONFIG = Object.freeze({
  trackerSheetName: "Sheet1",
  headerRow: 1,

  scriptProperties: {
    fastApiUrl: "FASTAPI_URL",
    apiKey: "APP_API_KEY",
  },

  apiKeyHeaderName: "x-api-key",

  inputHeaders: {
    companyName: ["company name", "company"],

    jobTitle: ["job title", "role title", "position"],

    countryLocation: ["country / location", "country/location", "location"],

    jobType: ["job type", "employment type"],

    jobLevel: ["job level", "seniority", "seniority level"],

    salaryText: [
      "salary / compensation",
      "salary",
      "compensation",
      "salary range",
    ],

    jobLink: ["job link", "job url", "application link"],

    jobDescription: ["job description", "description"],
  },

  requiredColumns: [
    "Job Description",
    "Salary / Compensation",
    "Screening Decision",
    "Screening Reasons",
    "Salary Status",
    "Job Quality Level",
    "Match %",
    "Match Level",
    "Matched Skills",
    "Missing Skills",
    "Tailoring Advice",
    "Decision",
    "Analysis Status",
  ],

  outputHeaders: {
    screeningDecision: "Screening Decision",
    screeningReasons: "Screening Reasons",
    salaryStatus: "Salary Status",
    jobQualityLevel: "Job Quality Level",
    matchPercentage: "Match %",
    matchLevel: "Match Level",
    matchedSkills: "Matched Skills",
    missingSkills: "Missing Skills",
    tailoringAdvice: "Tailoring Advice",
    decision: "Decision",
    analysisStatus: "Analysis Status",
  },
});
