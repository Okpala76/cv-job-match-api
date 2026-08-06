/**
 * Builds or repairs the complete workbook structure.
 *
 * Safe to run repeatedly:
 * - Existing tracker records are preserved.
 * - Missing tracker columns are added.
 * - Formula columns are refreshed.
 * - Setup, Config and Instructions are regenerated.
 * - Payment Summary is repaired.
 */
function setupWorkbookStructure() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const trackerSheet = setupEnsureSheet_(
    spreadsheet,
    JOB_MATCH_CONFIG.trackerSheetName,
  );

  setupTrackerSheet_(trackerSheet);

  setupSetupSheet_(
    setupEnsureSheet_(spreadsheet, JOB_MATCH_CONFIG.setupSheetName),
  );

  setupConfigSheet_(
    setupEnsureSheet_(spreadsheet, JOB_MATCH_CONFIG.configSheetName),
  );

  setupInstructionsSheet_(
    setupEnsureSheet_(spreadsheet, JOB_MATCH_CONFIG.instructionsSheetName),
  );

  const paymentSheet = setupEnsureSheet_(
    spreadsheet,
    JOB_MATCH_CONFIG.paymentSheetName,
  );

  setupPaymentSummarySheet_(paymentSheet, trackerSheet);

  spreadsheet.setActiveSheet(trackerSheet);
  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    "Workbook setup complete",
    "The tracker, Setup, Config, Instructions and " +
      "Payment Summary sheets are ready.",
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

/**
 * Adds the current week to Payment Summary.
 *
 * Safe to run repeatedly. The same week will not be added twice.
 */
function addCurrentPaymentWeek() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const trackerSheet = spreadsheet.getSheetByName(
    JOB_MATCH_CONFIG.trackerSheetName,
  );

  const paymentSheet = spreadsheet.getSheetByName(
    JOB_MATCH_CONFIG.paymentSheetName,
  );

  if (!trackerSheet || !paymentSheet) {
    throw new Error('Run "Setup / Repair Workbook" first.');
  }

  const weekStart = setupGetCurrentWeekStart_();

  const added = setupAddPaymentWeekRow_(paymentSheet, trackerSheet, weekStart);

  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    added ? "Payment week added" : "Payment week already exists",
    Utilities.formatDate(
      weekStart,
      spreadsheet.getSpreadsheetTimeZone(),
      "dd MMM yyyy",
    ),
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

function setupTrackerSheet_(sheet) {
  setupEnsureGridSize_(
    sheet,
    JOB_MATCH_CONFIG.formulaEndRow,
    JOB_MATCH_CONFIG.trackerColumns.length,
  );

  setupEnsureTrackerHeaders_(sheet);

  setupApplyTrackerFormatting_(sheet);
  setupApplyTrackerValidations_(sheet);
  setupApplyTrackerFormulas_(sheet);
  setupApplyTrackerConditionalFormatting_(sheet);
  setupApplyTrackerFilter_(sheet);
}

function setupEnsureTrackerHeaders_(sheet) {
  const requiredHeaders = JOB_MATCH_CONFIG.trackerColumns;

  const lastUsedColumn = Math.max(sheet.getLastColumn(), 1);

  const existingHeaders = sheet
    .getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, lastUsedColumn)
    .getDisplayValues()[0]
    .map(function (header) {
      return String(header || "").trim();
    });

  const hasExistingHeaders = existingHeaders.some(function (header) {
    return Boolean(header);
  });

  if (!hasExistingHeaders) {
    setupEnsureGridSize_(
      sheet,
      JOB_MATCH_CONFIG.formulaEndRow,
      requiredHeaders.length,
    );

    sheet
      .getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, requiredHeaders.length)
      .setValues([requiredHeaders]);

    return;
  }

  const existingNormalized = {};

  existingHeaders.forEach(function (header) {
    const normalized = setupNormalizeHeader_(header);

    if (normalized) {
      existingNormalized[normalized] = true;
    }
  });

  const missingHeaders = requiredHeaders.filter(function (header) {
    return !existingNormalized[setupNormalizeHeader_(header)];
  });

  if (missingHeaders.length === 0) {
    return;
  }

  const newLastColumn = lastUsedColumn + missingHeaders.length;

  setupEnsureGridSize_(sheet, JOB_MATCH_CONFIG.formulaEndRow, newLastColumn);

  sheet
    .getRange(
      JOB_MATCH_CONFIG.headerRow,
      lastUsedColumn + 1,
      1,
      missingHeaders.length,
    )
    .setValues([missingHeaders]);
}

function setupApplyTrackerFormatting_(sheet) {
  const headerMap = setupBuildHeaderMap_(sheet);

  const lastColumn = sheet.getLastColumn();

  sheet.setFrozenRows(JOB_MATCH_CONFIG.headerRow);

  sheet
    .getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, lastColumn)
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.setRowHeight(JOB_MATCH_CONFIG.headerRow, 48);

  sheet
    .getRange(
      JOB_MATCH_CONFIG.dataStartRow,
      1,
      JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1,
      lastColumn,
    )
    .setVerticalAlignment("top");

  const dateHeaders = ["Date Added", "Date of Application"];

  dateHeaders.forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (!column) {
      return;
    }

    sheet
      .getRange(
        JOB_MATCH_CONFIG.dataStartRow,
        column,
        JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1,
        1,
      )
      .setNumberFormat("dd-mmm-yyyy");
  });

  const currencyHeaders = [
    "Monthly Salary (NGN)",
    "Payment Rate",
    "Payment Due",
  ];

  currencyHeaders.forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (!column) {
      return;
    }

    sheet
      .getRange(
        JOB_MATCH_CONFIG.dataStartRow,
        column,
        JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1,
        1,
      )
      .setNumberFormat("₦#,##0");
  });

  const wrappedHeaders = [
    "Job Description",
    "Screening Reasons",
    "Role Ceiling Reasons",
    "Matched Skills",
    "Missing Skills",
    "Tailoring Advice",
    "Duplicate Reason",
    "Payment Eligibility Reason",
    "Notes",
  ];

  wrappedHeaders.forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (!column) {
      return;
    }

    sheet
      .getRange(
        JOB_MATCH_CONFIG.dataStartRow,
        column,
        JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1,
        1,
      )
      .setWrap(true);
  });

  const widthMap = {
    "S/N": 55,
    "Date Added": 100,
    "Company Name": 170,
    "Job Title": 190,
    "Country / Location": 140,
    "Job Type": 110,
    "Job Level": 110,
    "Job Link": 180,
    "Job Description": 360,
    "Salary / Compensation": 150,
    "Application Status": 125,
    "Date of Application": 120,
    "Cover Letter Link": 160,
    "Tailored CV Link": 160,
    "Submission Proof Link": 180,
    "Gmail Feedback": 180,
    Notes: 220,
    "Duplicate Status": 155,
    "Duplicate Row": 95,
    "Duplicate Reason": 260,
    "Analysis Status": 175,
    "Screening Decision": 135,
    "Screening Reasons": 280,
    "Company Status": 120,
    "Matched Company Name": 190,
    "Company Tier": 90,
    "Monthly Salary (NGN)": 145,
    "Salary Status": 125,
    "Job Quality Level": 130,
    "Role Ceiling Decision": 150,
    "Detected Role Level": 130,
    "Role Ceiling Reasons": 280,
    "Minimum Experience Years": 140,
    "Maximum Experience Years": 140,
    "Match %": 80,
    "Match Level": 100,
    "Matched Skills": 230,
    "Missing Skills": 230,
    "Tailoring Advice": 300,
    Decision: 110,
    "Tailoring Completed?": 145,
    "Quality Review": 120,
    "Payment Rate": 105,
    "Payment Eligibility": 130,
    "Payment Due": 105,
    "Payment Eligibility Reason": 260,
  };

  Object.keys(widthMap).forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (column) {
      sheet.setColumnWidth(column, widthMap[header]);
    }
  });
}

function setupApplyTrackerValidations_(sheet) {
  const headerMap = setupBuildHeaderMap_(sheet);

  const rowCount =
    JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1;

  Object.keys(JOB_MATCH_CONFIG.validations).forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (!column) {
      return;
    }

    const values = JOB_MATCH_CONFIG.validations[header];

    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(Array.from(values), true)
      .setAllowInvalid(false)
      .build();

    sheet
      .getRange(JOB_MATCH_CONFIG.dataStartRow, column, rowCount, 1)
      .setDataValidation(validation);
  });
}

function setupApplyTrackerFormulas_(sheet) {
  const headerMap = setupBuildHeaderMap_(sheet);

  const rowStart = JOB_MATCH_CONFIG.dataStartRow;

  const rowEnd = JOB_MATCH_CONFIG.formulaEndRow;

  const rowCount = rowEnd - rowStart + 1;

  const required = [
    "S/N",
    "Company Name",
    "Salary / Compensation",
    "Application Status",
    "Submission Proof Link",
    "Duplicate Status",
    "Analysis Status",
    "Screening Decision",
    "Role Ceiling Decision",
    "Decision",
    "Tailoring Completed?",
    "Quality Review",
    "Payment Rate",
    "Payment Eligibility",
    "Payment Due",
    "Payment Eligibility Reason",
  ];

  required.forEach(function (header) {
    if (!headerMap[setupNormalizeHeader_(header)]) {
      throw new Error(`Required tracker column missing: ${header}`);
    }
  });

  const snColumn = headerMap[setupNormalizeHeader_("S/N")];

  const companyColumn = headerMap[setupNormalizeHeader_("Company Name")];

  const salaryTextColumn =
    headerMap[setupNormalizeHeader_("Salary / Compensation")];

  const applicationStatusColumn =
    headerMap[setupNormalizeHeader_("Application Status")];

  const submissionProofColumn =
    headerMap[setupNormalizeHeader_("Submission Proof Link")];

  const duplicateStatusColumn =
    headerMap[setupNormalizeHeader_("Duplicate Status")];

  const analysisStatusColumn =
    headerMap[setupNormalizeHeader_("Analysis Status")];

  const screeningDecisionColumn =
    headerMap[setupNormalizeHeader_("Screening Decision")];

  const roleCeilingColumn =
    headerMap[setupNormalizeHeader_("Role Ceiling Decision")];

  const decisionColumn = headerMap[setupNormalizeHeader_("Decision")];

  const tailoringCompletedColumn =
    headerMap[setupNormalizeHeader_("Tailoring Completed?")];

  const qualityReviewColumn =
    headerMap[setupNormalizeHeader_("Quality Review")];

  const paymentRateColumn = headerMap[setupNormalizeHeader_("Payment Rate")];

  const paymentEligibilityColumn =
    headerMap[setupNormalizeHeader_("Payment Eligibility")];

  const paymentDueColumn = headerMap[setupNormalizeHeader_("Payment Due")];

  const paymentReasonColumn =
    headerMap[setupNormalizeHeader_("Payment Eligibility Reason")];

  const companyLetter = setupColumnLetter_(companyColumn);

  const salaryTextLetter = setupColumnLetter_(salaryTextColumn);

  const applicationStatusLetter = setupColumnLetter_(applicationStatusColumn);

  const submissionProofLetter = setupColumnLetter_(submissionProofColumn);

  const duplicateStatusLetter = setupColumnLetter_(duplicateStatusColumn);

  const analysisStatusLetter = setupColumnLetter_(analysisStatusColumn);

  const screeningDecisionLetter = setupColumnLetter_(screeningDecisionColumn);

  const roleCeilingLetter = setupColumnLetter_(roleCeilingColumn);

  const decisionLetter = setupColumnLetter_(decisionColumn);

  const tailoringCompletedLetter = setupColumnLetter_(tailoringCompletedColumn);

  const qualityReviewLetter = setupColumnLetter_(qualityReviewColumn);

  const paymentRateLetter = setupColumnLetter_(paymentRateColumn);

  const paymentEligibilityLetter = setupColumnLetter_(paymentEligibilityColumn);

  const submittedStatusPattern =
    JOB_MATCH_CONFIG.submittedApplicationStatuses.join("|");

  const snFormulas = [];
  const paymentRateFormulas = [];
  const paymentEligibilityFormulas = [];
  const paymentDueFormulas = [];
  const paymentReasonFormulas = [];

  for (let row = rowStart; row <= rowEnd; row += 1) {
    snFormulas.push([
      `=IF(COUNTA($${companyLetter}${row}:` +
        `$${salaryTextLetter}${row})=0,"",` +
        `ROW()-${JOB_MATCH_CONFIG.headerRow})`,
    ]);

    paymentRateFormulas.push([
      `=IF($${decisionLetter}${row}="Apply",` +
        `${JOB_MATCH_CONFIG.paymentRates.Apply},` +
        `IF($${decisionLetter}${row}="Tailor first",` +
        `${JOB_MATCH_CONFIG.paymentRates.TailorFirst},0))`,
    ]);

    paymentEligibilityFormulas.push([
      `=IF(` +
        `OR(` +
        `$${decisionLetter}${row}="",` +
        `$${decisionLetter}${row}="Skip"` +
        `),` +
        `"Not eligible",` +
        `IF(` +
        `$${screeningDecisionLetter}${row}<>"Accepted",` +
        `"Not eligible",` +
        `IF(` +
        `$${roleCeilingLetter}${row}<>"Accepted",` +
        `"Not eligible",` +
        `IF(` +
        `$${duplicateStatusLetter}${row}<>"No duplicate found",` +
        `"Not eligible",` +
        `IF(` +
        `$${analysisStatusLetter}${row}<>"Success",` +
        `"Not eligible",` +
        `IF(` +
        `NOT(REGEXMATCH(` +
        `$${applicationStatusLetter}${row},` +
        `"^(${submittedStatusPattern})$"` +
        `)),` +
        `"Not eligible",` +
        `IF(` +
        `$${submissionProofLetter}${row}="",` +
        `"Not eligible",` +
        `IF(` +
        `$${qualityReviewLetter}${row}<>"Approved",` +
        `"Not eligible",` +
        `IF(` +
        `AND(` +
        `$${decisionLetter}${row}="Tailor first",` +
        `$${tailoringCompletedLetter}${row}<>"Yes"` +
        `),` +
        `"Not eligible",` +
        `"Eligible"` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)`,
    ]);

    paymentDueFormulas.push([
      `=IF(` +
        `$${paymentEligibilityLetter}${row}="Eligible",` +
        `$${paymentRateLetter}${row},0` +
        `)`,
    ]);

    paymentReasonFormulas.push([
      `=IF(` +
        `$${decisionLetter}${row}="",` +
        `"Awaiting API decision",` +
        `IF(` +
        `$${decisionLetter}${row}="Skip",` +
        `"API decision is Skip",` +
        `IF(` +
        `$${screeningDecisionLetter}${row}<>"Accepted",` +
        `"Company/salary gate not accepted",` +
        `IF(` +
        `$${roleCeilingLetter}${row}<>"Accepted",` +
        `"Role ceiling not accepted",` +
        `IF(` +
        `$${duplicateStatusLetter}${row}<>"No duplicate found",` +
        `"Duplicate check not clear",` +
        `IF(` +
        `$${analysisStatusLetter}${row}<>"Success",` +
        `"Analysis not successful",` +
        `IF(` +
        `NOT(REGEXMATCH(` +
        `$${applicationStatusLetter}${row},` +
        `"^(${submittedStatusPattern})$"` +
        `)),` +
        `"Application not submitted",` +
        `IF(` +
        `$${submissionProofLetter}${row}="",` +
        `"Submission proof missing",` +
        `IF(` +
        `AND(` +
        `$${decisionLetter}${row}="Tailor first",` +
        `$${tailoringCompletedLetter}${row}<>"Yes"` +
        `),` +
        `"Tailoring not completed",` +
        `IF(` +
        `$${qualityReviewLetter}${row}<>"Approved",` +
        `"Quality review not approved",` +
        `"Eligible for payment"` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)` +
        `)`,
    ]);
  }

  sheet.getRange(rowStart, snColumn, rowCount, 1).setFormulas(snFormulas);

  sheet
    .getRange(rowStart, paymentRateColumn, rowCount, 1)
    .setFormulas(paymentRateFormulas);

  sheet
    .getRange(rowStart, paymentEligibilityColumn, rowCount, 1)
    .setFormulas(paymentEligibilityFormulas);

  sheet
    .getRange(rowStart, paymentDueColumn, rowCount, 1)
    .setFormulas(paymentDueFormulas);

  sheet
    .getRange(rowStart, paymentReasonColumn, rowCount, 1)
    .setFormulas(paymentReasonFormulas);
}

function setupApplyTrackerConditionalFormatting_(sheet) {
  const headerMap = setupBuildHeaderMap_(sheet);

  const rules = [];

  const decisionColumn = headerMap[setupNormalizeHeader_("Decision")];

  const paymentEligibilityColumn =
    headerMap[setupNormalizeHeader_("Payment Eligibility")];

  const analysisStatusColumn =
    headerMap[setupNormalizeHeader_("Analysis Status")];

  const rowCount =
    JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1;

  if (decisionColumn) {
    const decisionRange = sheet.getRange(
      JOB_MATCH_CONFIG.dataStartRow,
      decisionColumn,
      rowCount,
      1,
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Apply")
        .setBackground("#D9EAD3")
        .setRanges([decisionRange])
        .build(),
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Tailor first")
        .setBackground("#FFF2CC")
        .setRanges([decisionRange])
        .build(),
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Skip")
        .setBackground("#F4CCCC")
        .setRanges([decisionRange])
        .build(),
    );
  }

  if (paymentEligibilityColumn) {
    const eligibilityRange = sheet.getRange(
      JOB_MATCH_CONFIG.dataStartRow,
      paymentEligibilityColumn,
      rowCount,
      1,
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Eligible")
        .setBackground("#D9EAD3")
        .setRanges([eligibilityRange])
        .build(),
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Not eligible")
        .setBackground("#E7E6E6")
        .setRanges([eligibilityRange])
        .build(),
    );
  }

  if (analysisStatusColumn) {
    const analysisRange = sheet.getRange(
      JOB_MATCH_CONFIG.dataStartRow,
      analysisStatusColumn,
      rowCount,
      1,
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Analysis failed — retry")
        .setBackground("#F4CCCC")
        .setRanges([analysisRange])
        .build(),
    );
  }

  sheet.setConditionalFormatRules(rules);
}

function setupApplyTrackerFilter_(sheet) {
  const existingFilter = sheet.getFilter();

  if (existingFilter) {
    existingFilter.remove();
  }

  sheet
    .getRange(
      JOB_MATCH_CONFIG.headerRow,
      1,
      JOB_MATCH_CONFIG.formulaEndRow,
      sheet.getLastColumn(),
    )
    .createFilter();
}

function setupSetupSheet_(sheet) {
  const rows = [
    ["SECTION", "RULE", "VALUE", "EXPLANATION"],
    [
      "System",
      "Workbook version",
      JOB_MATCH_CONFIG.workbookVersion,
      "Generated from the Clasp codebase.",
    ],
    [
      "System flow",
      "Stage 1",
      "Duplicate check",
      "Already-applied jobs stop before the API call.",
    ],
    [
      "System flow",
      "Stage 2",
      "Approved company OR ₦500,000+ monthly",
      "An approved Tier A/B company passes even where salary is not disclosed.",
    ],
    [
      "System flow",
      "Stage 3",
      "Role ceiling",
      "Lower-level roles are allowed. Roles clearly above the candidate's level are blocked.",
    ],
    [
      "System flow",
      "Stage 4",
      "CV match",
      "The API compares the accepted opportunity against the hardcoded CV.",
    ],
    [
      "Opportunity gate",
      "Approved companies",
      "Tier A or Tier B",
      "Approved-company matching is performed locally by FastAPI.",
    ],
    [
      "Opportunity gate",
      "Unknown company",
      "Minimum ₦500,000 monthly",
      "A clear guaranteed salary must meet the threshold.",
    ],
    [
      "Role ceiling",
      "Accepted",
      "0–4 years",
      "Internship, graduate, entry, junior and mid-level roles may pass.",
    ],
    [
      "Role ceiling",
      "Manual review",
      "Senior",
      "Senior roles require manual confirmation.",
    ],
    [
      "Role ceiling",
      "Rejected",
      "5+ years or leadership",
      "Staff, principal, architect, lead, manager, director and executive roles are blocked.",
    ],
    [
      "CV decision",
      "Apply",
      "90–100%",
      "Use the correct existing CV and submit.",
    ],
    [
      "CV decision",
      "Tailor first",
      "70–89%",
      "Tailoring must be completed before submission.",
    ],
    ["CV decision", "Skip", "0–69%", "Do not apply."],
    [
      "Payment",
      "Apply rate",
      "₦200",
      "Potential rate set automatically from the API decision.",
    ],
    [
      "Payment",
      "Tailor-first rate",
      "₦200",
      "Payable only after tailoring is confirmed.",
    ],
    ["Payment", "Skip rate", "₦0", "Skipped jobs do not qualify for payment."],
    [
      "Payment",
      "Final eligibility",
      "All controls must pass",
      "Submission, proof, quality approval, duplicate clearance and successful analysis are required.",
    ],
    [
      "Submission proof",
      "Valid proof",
      "Drive link or confirmation reference",
      "Use a screenshot or email showing the job/company and successful submission.",
    ],
    [
      "Submission proof",
      "Invalid proof",
      "Job advert or unfinished form",
      "A job link, CV file or unsubmitted form does not prove submission.",
    ],
    [
      "Targets",
      "Jobs reviewed daily",
      JOB_MATCH_CONFIG.targets.jobsReviewedPerDay,
      "Jobs reviewed should include accepted and rejected opportunities.",
    ],
    [
      "Targets",
      "Valid applications daily",
      JOB_MATCH_CONFIG.targets.validApplicationsPerDay,
      "Only successfully submitted and properly recorded applications count.",
    ],
    [
      "Targets",
      "Valid applications weekly",
      JOB_MATCH_CONFIG.targets.validApplicationsPerWeek,
      "Measured from eligible tracker rows.",
    ],
    [
      "Security",
      "Script Properties",
      "FASTAPI_URL and APP_API_KEY",
      "Secret values must never be stored in spreadsheet cells or committed to Git.",
    ],
  ];

  setupRewriteDocumentationSheet_(sheet, rows, [145, 190, 230, 430]);
}

function setupConfigSheet_(sheet) {
  const rows = [
    ["SETTING", "VALUE", "SOURCE", "NOTES"],
    [
      "Workbook Version",
      JOB_MATCH_CONFIG.workbookVersion,
      "Config.js",
      "Clasp-managed schema version.",
    ],
    [
      "Tracker Sheet",
      JOB_MATCH_CONFIG.trackerSheetName,
      "Config.js",
      "Main application tracker.",
    ],
    [
      "Minimum Monthly Salary",
      JOB_MATCH_CONFIG.opportunityGate.minimumMonthlySalaryNgn,
      "Config.js",
      "Used only where the company is not approved.",
    ],
    [
      "Approved Company Tiers",
      JOB_MATCH_CONFIG.opportunityGate.approvedCompanyTiers.join(", "),
      "Config.js",
      "Tier A and Tier B both pass.",
    ],
    [
      "Maximum Accepted Experience",
      JOB_MATCH_CONFIG.roleCeiling.maximumAcceptedExperienceYears,
      "Config.js",
      "Roles requiring 5+ years are rejected.",
    ],
    [
      "Apply Minimum",
      JOB_MATCH_CONFIG.thresholds.applyMinimum,
      "Config.js",
      "90% and above.",
    ],
    [
      "Tailor Minimum",
      JOB_MATCH_CONFIG.thresholds.tailorMinimum,
      "Config.js",
      "70% to 89%.",
    ],
    [
      "Skip Maximum",
      JOB_MATCH_CONFIG.thresholds.skipMaximum,
      "Config.js",
      "69% and below.",
    ],
    [
      "Apply Payment",
      JOB_MATCH_CONFIG.paymentRates.Apply,
      "Config.js",
      "Potential payment rate.",
    ],
    [
      "Tailor-first Payment",
      JOB_MATCH_CONFIG.paymentRates.TailorFirst,
      "Config.js",
      "Requires Tailoring Completed = Yes.",
    ],
    [
      "Skip Payment",
      JOB_MATCH_CONFIG.paymentRates.Skip,
      "Config.js",
      "Never payable.",
    ],
    [
      "Jobs Reviewed Daily",
      JOB_MATCH_CONFIG.targets.jobsReviewedPerDay,
      "Config.js",
      "Performance target.",
    ],
    [
      "Valid Applications Daily",
      JOB_MATCH_CONFIG.targets.validApplicationsPerDay,
      "Config.js",
      "Performance target.",
    ],
    [
      "Valid Applications Weekly",
      JOB_MATCH_CONFIG.targets.validApplicationsPerWeek,
      "Config.js",
      "Performance target.",
    ],
    [
      "API URL Property",
      JOB_MATCH_CONFIG.scriptProperties.fastApiUrl,
      "Script Properties",
      "The secret value is not displayed here.",
    ],
    [
      "API Key Property",
      JOB_MATCH_CONFIG.scriptProperties.apiKey,
      "Script Properties",
      "The secret value is not displayed here.",
    ],
    [
      "API Header",
      JOB_MATCH_CONFIG.apiKeyHeaderName,
      "Config.js",
      "Header used when Apps Script calls FastAPI.",
    ],
  ];

  setupRewriteDocumentationSheet_(sheet, rows, [210, 220, 150, 420]);

  sheet.getRange(2, 2, rows.length - 1, 1).setNumberFormat("@");
}

function setupInstructionsSheet_(sheet) {
  const rows = [
    ["STEP", "ACTION", "REQUIRED RESULT", "IMPORTANT NOTE"],
    [
      1,
      "Record the opportunity",
      "Fill Company Name, Job Title, Job Link and the full Job Description.",
      "Add salary and level information whenever disclosed.",
    ],
    [
      2,
      "Select the job row",
      "The active cell must be inside the correct tracker row.",
      "Do not select the header row.",
    ],
    [
      3,
      "Run Analyze Selected Row",
      "The duplicate check runs before FastAPI.",
      "Confirmed and possible duplicates stop before the API call.",
    ],
    [
      4,
      "Review the opportunity gate",
      "Screening Decision should be Accepted.",
      "Approved Tier A/B company or salary of at least ₦500,000 monthly is required.",
    ],
    [
      5,
      "Review the role ceiling",
      "Role Ceiling Decision should be Accepted.",
      "Manual-review or rejected roles must not be submitted automatically.",
    ],
    [
      6,
      "Follow the API decision",
      "Apply, Tailor first or Skip.",
      "The assistant must not override the decision.",
    ],
    [
      7,
      "For Apply",
      "Use the correct existing CV and complete the application.",
      "Potential payment rate is automatically ₦300.",
    ],
    [
      8,
      "For Tailor first",
      "Tailor the CV before applying and set Tailoring Completed? to Yes.",
      "Potential payment rate is automatically ₦250.",
    ],
    [9, "For Skip", "Do not submit the application.", "Payment is ₦0."],
    [
      10,
      "Record successful submission",
      "Set Application Status to Applied or a later submitted status.",
      "Do not mark an unfinished form as Applied.",
    ],
    [
      11,
      "Upload submission proof",
      "Paste a Drive link, confirmation email reference or portal proof.",
      "Proof should show the company/job and that submission succeeded.",
    ],
    [
      12,
      "Quality review",
      "Reviewer sets Quality Review to Approved or Rejected.",
      "The applicant must not approve their own work.",
    ],
    [
      13,
      "Payment",
      "Payment Eligibility becomes Eligible only after every requirement passes.",
      "Payment Due remains ₦0 until the row is eligible.",
    ],
  ];

  setupRewriteDocumentationSheet_(sheet, rows, [70, 280, 320, 440]);
}

function setupRewriteDocumentationSheet_(sheet, rows, columnWidths) {
  const existingFilter = sheet.getFilter();

  if (existingFilter) {
    existingFilter.remove();
  }

  sheet.clear();
  sheet.clearConditionalFormatRules();

  setupEnsureGridSize_(sheet, Math.max(rows.length + 10, 50), rows[0].length);

  sheet
    .getRange(1, 1, rows.length, rows[0].length)
    .setValues(rows)
    .setVerticalAlignment("top")
    .setWrap(true);

  sheet
    .getRange(1, 1, 1, rows[0].length)
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  columnWidths.forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });

  sheet
    .getRange(2, 1, rows.length - 1, 1)
    .setFontWeight("bold")
    .setBackground("#D9EAF7");
}

function setupPaymentSummarySheet_(sheet, trackerSheet) {
  const headers = [
    "Week Start",
    "Week End",
    "Eligible Applications",
    "Apply Applications",
    "Tailor-first Applications",
    "Total Payment Due",
    "Payment Status",
    "Date Paid",
    "Notes",
  ];

  setupEnsureGridSize_(sheet, 200, headers.length);

  const existingHeaders = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0];

  const isBlank = existingHeaders.every(function (value) {
    return !String(value || "").trim();
  });

  if (isBlank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center")
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  const widths = [110, 110, 145, 130, 165, 145, 120, 110, 280];

  widths.forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });

  sheet.getRange(2, 1, 199, 2).setNumberFormat("dd-mmm-yyyy");

  sheet.getRange(2, 6, 199, 1).setNumberFormat("₦#,##0");

  const statusValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pending", "Paid"], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, 7, 199, 1).setDataValidation(statusValidation);

  setupAddPaymentWeekRow_(sheet, trackerSheet, setupGetCurrentWeekStart_());
}

function setupAddPaymentWeekRow_(paymentSheet, trackerSheet, weekStart) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const timezone = spreadsheet.getSpreadsheetTimeZone();

  const weekKey = Utilities.formatDate(weekStart, timezone, "yyyy-MM-dd");

  const lastRow = Math.max(paymentSheet.getLastRow(), 1);

  if (lastRow >= 2) {
    const existingDates = paymentSheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues();

    const alreadyExists = existingDates.some(function (row) {
      const value = row[0];

      if (!(value instanceof Date)) {
        return false;
      }

      return Utilities.formatDate(value, timezone, "yyyy-MM-dd") === weekKey;
    });

    if (alreadyExists) {
      return false;
    }
  }

  const row = Math.max(paymentSheet.getLastRow() + 1, 2);

  const weekEnd = new Date(weekStart);

  weekEnd.setDate(weekStart.getDate() + 6);

  paymentSheet.getRange(row, 1, 1, 2).setValues([[weekStart, weekEnd]]);

  const trackerMap = setupBuildHeaderMap_(trackerSheet);

  const dateColumn = trackerMap[setupNormalizeHeader_("Date of Application")];

  const eligibilityColumn =
    trackerMap[setupNormalizeHeader_("Payment Eligibility")];

  const decisionColumn = trackerMap[setupNormalizeHeader_("Decision")];

  const paymentDueColumn = trackerMap[setupNormalizeHeader_("Payment Due")];

  if (
    !dateColumn ||
    !eligibilityColumn ||
    !decisionColumn ||
    !paymentDueColumn
  ) {
    throw new Error(
      "Payment Summary could not find the required tracker columns.",
    );
  }

  const trackerName = trackerSheet.getName().replace(/'/g, "''");

  const dateRange =
    `'${trackerName}'!$` +
    `${setupColumnLetter_(dateColumn)}$` +
    `${JOB_MATCH_CONFIG.dataStartRow}:$` +
    `${setupColumnLetter_(dateColumn)}$` +
    `${JOB_MATCH_CONFIG.formulaEndRow}`;

  const eligibilityRange =
    `'${trackerName}'!$` +
    `${setupColumnLetter_(eligibilityColumn)}$` +
    `${JOB_MATCH_CONFIG.dataStartRow}:$` +
    `${setupColumnLetter_(eligibilityColumn)}$` +
    `${JOB_MATCH_CONFIG.formulaEndRow}`;

  const decisionRange =
    `'${trackerName}'!$` +
    `${setupColumnLetter_(decisionColumn)}$` +
    `${JOB_MATCH_CONFIG.dataStartRow}:$` +
    `${setupColumnLetter_(decisionColumn)}$` +
    `${JOB_MATCH_CONFIG.formulaEndRow}`;

  const paymentDueRange =
    `'${trackerName}'!$` +
    `${setupColumnLetter_(paymentDueColumn)}$` +
    `${JOB_MATCH_CONFIG.dataStartRow}:$` +
    `${setupColumnLetter_(paymentDueColumn)}$` +
    `${JOB_MATCH_CONFIG.formulaEndRow}`;

  paymentSheet
    .getRange(row, 3, 1, 4)
    .setFormulas([
      [
        `=COUNTIFS(` +
          `${dateRange},">="&$A${row},` +
          `${dateRange},"<="&$B${row},` +
          `${eligibilityRange},"Eligible"` +
          `)`,

        `=COUNTIFS(` +
          `${dateRange},">="&$A${row},` +
          `${dateRange},"<="&$B${row},` +
          `${eligibilityRange},"Eligible",` +
          `${decisionRange},"Apply"` +
          `)`,

        `=COUNTIFS(` +
          `${dateRange},">="&$A${row},` +
          `${dateRange},"<="&$B${row},` +
          `${eligibilityRange},"Eligible",` +
          `${decisionRange},"Tailor first"` +
          `)`,

        `=SUMIFS(` +
          `${paymentDueRange},` +
          `${dateRange},">="&$A${row},` +
          `${dateRange},"<="&$B${row},` +
          `${eligibilityRange},"Eligible"` +
          `)`,
      ],
    ]);

  paymentSheet.getRange(row, 7).setValue("Pending");

  return true;
}

function setupGetCurrentWeekStart_() {
  const date = new Date();

  date.setHours(0, 0, 0, 0);

  const day = date.getDay();

  const difference = day === 0 ? -6 : 1 - day;

  date.setDate(date.getDate() + difference);

  return date;
}

function setupEnsureSheet_(spreadsheet, sheetName) {
  return (
    spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName)
  );
}

function setupEnsureGridSize_(sheet, requiredRows, requiredColumns) {
  const currentRows = sheet.getMaxRows();

  const currentColumns = sheet.getMaxColumns();

  if (requiredRows > currentRows) {
    sheet.insertRowsAfter(currentRows, requiredRows - currentRows);
  }

  if (requiredColumns > currentColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function setupBuildHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  const headers = sheet
    .getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, lastColumn)
    .getDisplayValues()[0];

  const map = {};

  headers.forEach(function (header, index) {
    const normalized = setupNormalizeHeader_(header);

    if (normalized && !Object.prototype.hasOwnProperty.call(map, normalized)) {
      map[normalized] = index + 1;
    }
  });

  return map;
}

function setupNormalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function setupColumnLetter_(columnNumber) {
  let number = columnNumber;
  let result = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;

    result = String.fromCharCode(65 + remainder) + result;

    number = Math.floor((number - 1) / 26);
  }

  return result;
}
