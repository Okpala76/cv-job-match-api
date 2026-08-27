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

  setupMarkLegacyTrackerHeaders_(sheet);
  setupEnsureTrackerHeaders_(sheet);
  setupReorderTrackerColumns_(sheet);

  setupApplyTrackerFormatting_(sheet);
  setupApplyTrackerValidations_(sheet);
  setupApplyTrackerFormulas_(sheet);
  setupApplyTrackerConditionalFormatting_(sheet);
  setupApplyTrackerFilter_(sheet);
}

function setupReorderTrackerColumns_(sheet) {
  JOB_MATCH_CONFIG.trackerColumns.forEach(function (header, index) {
    const targetColumn = index + 1;
    const headerMap = setupBuildHeaderMap_(sheet);
    const currentColumn = headerMap[setupNormalizeHeader_(header)];

    if (!currentColumn) {
      throw new Error(`Required tracker column missing: ${header}`);
    }

    if (currentColumn !== targetColumn) {
      sheet.moveColumns(
        sheet.getRange(1, currentColumn, sheet.getMaxRows(), 1),
        targetColumn,
      );
    }
  });
}

function setupMarkLegacyTrackerHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    return;
  }

  const range = sheet.getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, lastColumn);
  const headers = range.getDisplayValues()[0];
  const legacyHeaders = {
    "screening decision": "Legacy - Screening Decision",
    "screening reasons": "Legacy - Screening Reasons",
    "company status": "Legacy - Company Status",
    "matched company name": "Legacy - Matched Company Name",
    "company tier": "Legacy - Company Tier",
    "monthly salary (ngn)": "Legacy - Monthly Salary (NGN)",
    "salary status": "Legacy - Salary Status",
    "job quality level": "Legacy - Job Quality Level",
  };
  let changed = false;

  const migratedHeaders = headers.map(function (header) {
    const replacement = legacyHeaders[setupNormalizeHeader_(header)];

    if (replacement) {
      changed = true;
      return replacement;
    }

    return header;
  });

  if (changed) {
    range.setValues([migratedHeaders]);
  }
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

  const currencyHeaders = ["Payment Rate", "Payment Due"];

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

  const scoreHeaders = [
    "Company Quality Score",
    "Company Scale Score",
    "Company Market Position Score",
    "Company Geographic Reach Score",
    "Company Engineering Maturity Score",
    "Company Reputation Score",
  ];

  scoreHeaders.forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (column) {
      sheet
        .getRange(
          JOB_MATCH_CONFIG.dataStartRow,
          column,
          JOB_MATCH_CONFIG.formulaEndRow - JOB_MATCH_CONFIG.dataStartRow + 1,
          1,
        )
        .setNumberFormat("0");
    }
  });

  const wrappedHeaders = [
    "Job Description",
    "Geography Reason",
    "Role Ceiling Reasons",
    "Company Quality Reasons",
    "Company Sources",
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
    "Geography Decision": 135,
    "Geography Reason": 280,
    "Role Ceiling Decision": 150,
    "Detected Role Level": 130,
    "Role Ceiling Reasons": 280,
    "Minimum Experience Years": 140,
    "Maximum Experience Years": 140,
    "Company Quality Decision": 155,
    "Company Quality Score": 125,
    "Company Scale Score": 115,
    "Company Market Position Score": 155,
    "Company Geographic Reach Score": 165,
    "Company Engineering Maturity Score": 175,
    "Company Reputation Score": 135,
    "Company Confidence": 125,
    "Company Quality Reasons": 320,
    "Company Sources": 320,
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
    "Date of Application",
    "Submission Proof Link",
    "Duplicate Status",
    "Analysis Status",
    "Geography Decision",
    "Role Ceiling Decision",
    "Company Quality Decision",
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
  const applicationDateColumn =
    headerMap[setupNormalizeHeader_("Date of Application")];
  const submissionProofColumn =
    headerMap[setupNormalizeHeader_("Submission Proof Link")];
  const duplicateStatusColumn =
    headerMap[setupNormalizeHeader_("Duplicate Status")];
  const analysisStatusColumn =
    headerMap[setupNormalizeHeader_("Analysis Status")];
  const geographyDecisionColumn =
    headerMap[setupNormalizeHeader_("Geography Decision")];
  const roleCeilingColumn =
    headerMap[setupNormalizeHeader_("Role Ceiling Decision")];
  const companyQualityColumn =
    headerMap[setupNormalizeHeader_("Company Quality Decision")];
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
  const applicationDateLetter = setupColumnLetter_(applicationDateColumn);
  const submissionProofLetter = setupColumnLetter_(submissionProofColumn);
  const duplicateStatusLetter = setupColumnLetter_(duplicateStatusColumn);
  const analysisStatusLetter = setupColumnLetter_(analysisStatusColumn);
  const geographyDecisionLetter = setupColumnLetter_(geographyDecisionColumn);
  const roleCeilingLetter = setupColumnLetter_(roleCeilingColumn);
  const companyQualityLetter = setupColumnLetter_(companyQualityColumn);
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
      `=IF(OR(` +
        `$${decisionLetter}${row}="Apply",` +
        `$${decisionLetter}${row}="Tailor first"` +
        `),${JOB_MATCH_CONFIG.paymentRates.Apply},0)`,
    ]);

    paymentEligibilityFormulas.push([
      `=IF(AND(` +
        `OR(` +
        `$${decisionLetter}${row}="Apply",` +
        `$${decisionLetter}${row}="Tailor first"` +
        `),` +
        `$${duplicateStatusLetter}${row}="No duplicate found",` +
        `$${geographyDecisionLetter}${row}="Accepted",` +
        `$${roleCeilingLetter}${row}="Accepted",` +
        `$${companyQualityLetter}${row}="Accepted",` +
        `$${analysisStatusLetter}${row}="Success",` +
        `$${applicationDateLetter}${row}<>"",` +
        `REGEXMATCH(` +
        `$${applicationStatusLetter}${row},` +
        `"^(${submittedStatusPattern})$"` +
        `),` +
        `OR(` +
        `$${decisionLetter}${row}<>"Tailor first",` +
        `$${tailoringCompletedLetter}${row}="Yes"` +
        `),` +
        `$${submissionProofLetter}${row}<>"",` +
        `$${qualityReviewLetter}${row}="Approved"` +
        `),"Eligible","Not eligible")`,
    ]);

    paymentDueFormulas.push([
      `=IF(` +
        `$${paymentEligibilityLetter}${row}="Eligible",` +
        `$${paymentRateLetter}${row},0` +
        `)`,
    ]);

    paymentReasonFormulas.push([
      `=IFS(` +
        `$${decisionLetter}${row}="","Awaiting API decision",` +
        `$${decisionLetter}${row}="Skip","API decision is Skip",` +
        `$${duplicateStatusLetter}${row}<>"No duplicate found",` +
        `"Duplicate check not clear",` +
        `$${geographyDecisionLetter}${row}<>"Accepted",` +
        `"Geography not accepted",` +
        `$${roleCeilingLetter}${row}<>"Accepted",` +
        `"Role ceiling not accepted",` +
        `$${companyQualityLetter}${row}<>"Accepted",` +
        `"Company quality not accepted",` +
        `$${analysisStatusLetter}${row}<>"Success",` +
        `"Analysis not successful",` +
        `$${applicationDateLetter}${row}="","Application date missing",` +
        `NOT(REGEXMATCH(` +
        `$${applicationStatusLetter}${row},"^(${submittedStatusPattern})$"` +
        `)),"Application not submitted",` +
        `AND(` +
        `$${decisionLetter}${row}="Tailor first",` +
        `$${tailoringCompletedLetter}${row}<>"Yes"` +
        `),"Tailoring not completed",` +
        `$${submissionProofLetter}${row}="","Submission proof missing",` +
        `$${qualityReviewLetter}${row}<>"Approved",` +
        `"Quality review not approved",` +
        `TRUE,"Eligible for payment")`,
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
      "Workflow",
      "1. Record job",
      "Complete job details",
      "Record the company, title, location, link, description and any disclosed salary.",
    ],
    [
      "Workflow",
      "2. Duplicate check",
      "Duplicate check",
      "Already-applied jobs stop before the API call.",
    ],
    [
      "Workflow",
      "3. Geography check",
      "Africa eligibility",
      "The role must be in Africa or explicitly remote for candidates in Africa.",
    ],
    [
      "Workflow",
      "4. Role floor / ceiling",
      "Role and experience eligibility",
      "Trainee and unpaid roles fail. Minimum required experience must be no more than five years.",
    ],
    [
      "Workflow",
      "5. Company quality research",
      "Public-evidence assessment",
      "The API researches and scores company scale, position, reach, engineering maturity and reputation.",
    ],
    [
      "Workflow",
      "6. CV match",
      "Apply, Tailor first or Skip",
      "CV matching runs only after geography, role and company quality are accepted.",
    ],
    [
      "Workflow",
      "7. Tailor if required",
      "Complete tailoring",
      "Tailor-first jobs require a tailored CV before submission.",
    ],
    [
      "Workflow",
      "8. Submit",
      "Record application status and date",
      "Only mark the application submitted after completion.",
    ],
    [
      "Workflow",
      "9. Add proof",
      "Submission Proof Link",
      "Add a screenshot, email or portal confirmation proving submission.",
    ],
    [
      "Workflow",
      "10. Quality review",
      "Approved or Rejected",
      "The reviewer verifies the application and proof.",
    ],
    [
      "Workflow",
      "11. Payment",
      "₦200 per eligible submitted application",
      "Apply and Tailor-first both pay a flat ₦200 after every V2 eligibility and submission control passes.",
    ],
    [
      "Geography",
      "Target area",
      "Africa",
      "African roles and remote roles explicitly open to African candidates may proceed.",
    ],
    [
      "Role floor",
      "Do not apply",
      "Trainee or unpaid roles",
      "Internships, trainee programmes, apprenticeships, NYSC, volunteer and unpaid roles fail.",
    ],
    [
      "Role floor",
      "Graduate engineering exception",
      "May proceed",
      "Graduate Software Engineer, Graduate Developer and Graduate Engineer are not trainee programmes by title alone.",
    ],
    [
      "Experience ceiling",
      "Accepted range",
      "0–5 years minimum required",
      "Senior title alone is not a reason to reject.",
    ],
    [
      "Experience ceiling",
      "Rejected range",
      "6+ years minimum required",
      "Roles above the five-year minimum-experience ceiling must be skipped.",
    ],
    [
      "Company quality",
      "Authoritative decision",
      "API public-evidence assessment",
      "Do not manually decide that a company is big enough. Manual review must stop for reviewer input.",
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
      "Apply and Tailor-first rate",
      "₦200 per eligible submitted application",
      "Tailor-first is payable only after tailoring is confirmed.",
    ],
    ["Payment", "Skip rate", "₦0", "Skipped jobs do not qualify for payment."],
    [
      "Payment",
      "Final eligibility",
      "All controls must pass",
      "Application date/status, proof, quality approval, duplicate clearance and all V2 gates are required.",
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
      "Maximum Accepted Experience",
      JOB_MATCH_CONFIG.roleCeiling.maximumAcceptedExperienceYears,
      "Config.js",
      "0–5 years may proceed; 6+ years are rejected.",
    ],
    [
      "Company Quality Minimum",
      70,
      "FastAPI",
      "Python also requires scale score 20+, sufficient confidence and at least two sources.",
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
      `₦${JOB_MATCH_CONFIG.paymentRates.Apply}`,
      "Config.js",
      "Flat ₦200 per eligible submitted application.",
    ],
    [
      "Tailor-first Payment",
      `₦${JOB_MATCH_CONFIG.paymentRates.TailorFirst}`,
      "Config.js",
      "Flat ₦200 per eligible submitted application; requires Tailoring Completed = Yes.",
    ],
    [
      "Skip Payment",
      `₦${JOB_MATCH_CONFIG.paymentRates.Skip}`,
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
      "Record the job",
      "Fill company, title, location, link and full job description.",
      "Salary is informational only and never controls acceptance or payment.",
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
      "Review geography",
      "Geography Decision must be Accepted.",
      "Target African countries or remote roles explicitly available to African candidates.",
    ],
    [
      5,
      "Review role eligibility",
      "Role Ceiling Decision should be Accepted.",
      "Do not apply to internships, trainee programmes, apprenticeships, NYSC, volunteer or unpaid roles.",
    ],
    [
      6,
      "Apply the experience ceiling",
      "0–5 years may proceed; 6+ minimum years are rejected.",
      "Senior title alone is not a reason to reject.",
    ],
    [
      7,
      "Recognise graduate engineering roles",
      "Graduate Software Engineer, Developer or Engineer may qualify.",
      "Do not confuse a real engineering role with a Graduate Trainee programme.",
    ],
    [
      8,
      "Review company quality",
      "Company Quality Decision must be Accepted.",
      "Never manually decide that a company is big enough; Manual review requires reviewer input.",
    ],
    [
      9,
      "Follow the CV decision",
      "Apply, Tailor first or Skip.",
      "90+ means Apply, 70–89 Tailor first, and below 70 Skip.",
    ],
    [
      10,
      "Complete Tailor first",
      "Tailor the CV and set Tailoring Completed? to Yes before submission.",
      "Apply and Tailor first both pay ₦200 per eligible submitted application.",
    ],
    [
      11,
      "Submit and add proof",
      "Record Date of Application, submitted status and Submission Proof Link.",
      "Do not mark an unfinished form as submitted.",
    ],
    [
      12,
      "Quality review and payment",
      "Reviewer sets Quality Review; approved eligible rows receive ₦200 per submitted application.",
      "Skip, Rejected and Manual-review rows receive NGN 0.",
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
    "Total Payment Due",
    "Payment Status",
    "Date Paid",
    "Notes",
  ];

  setupEnsureGridSize_(sheet, 200, headers.length);
  setupMigratePaymentSummaryHeaders_(sheet);

  const existingColumnCount = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet
    .getRange(1, 1, 1, existingColumnCount)
    .getDisplayValues()[0];

  const isBlank = existingHeaders.every(function (value) {
    return !String(value || "").trim();
  });

  if (isBlank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existingNormalized = {};

    existingHeaders.forEach(function (header) {
      existingNormalized[setupNormalizeHeader_(header)] = true;
    });

    const missingHeaders = headers.filter(function (header) {
      return !existingNormalized[setupNormalizeHeader_(header)];
    });

    if (missingHeaders.length > 0) {
      const firstNewColumn = existingColumnCount + 1;
      setupEnsureGridSize_(
        sheet,
        200,
        existingColumnCount + missingHeaders.length,
      );
      sheet
        .getRange(1, firstNewColumn, 1, missingHeaders.length)
        .setValues([missingHeaders]);
    }
  }

  const headerMap = setupBuildHeaderMap_(sheet);
  const lastColumn = sheet.getLastColumn();

  sheet
    .getRange(1, 1, 1, lastColumn)
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center")
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  const widths = {
    "Week Start": 110,
    "Week End": 110,
    "Eligible Applications": 145,
    "Total Payment Due": 145,
    "Payment Status": 120,
    "Date Paid": 110,
    Notes: 280,
  };

  Object.keys(widths).forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (column) {
      sheet.setColumnWidth(column, widths[header]);
    }
  });

  ["Week Start", "Week End", "Date Paid"].forEach(function (header) {
    const column = headerMap[setupNormalizeHeader_(header)];

    if (column) {
      sheet.getRange(2, column, 199, 1).setNumberFormat("dd-mmm-yyyy");
    }
  });

  const totalPaymentColumn =
    headerMap[setupNormalizeHeader_("Total Payment Due")];

  sheet.getRange(2, totalPaymentColumn, 199, 1).setNumberFormat("₦#,##0");

  const statusValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pending", "Paid"], true)
    .setAllowInvalid(false)
    .build();

  const paymentStatusColumn =
    headerMap[setupNormalizeHeader_("Payment Status")];

  sheet
    .getRange(2, paymentStatusColumn, 199, 1)
    .setDataValidation(statusValidation);

  setupAddPaymentWeekRow_(sheet, trackerSheet, setupGetCurrentWeekStart_());
}

function setupMigratePaymentSummaryHeaders_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const range = sheet.getRange(1, 1, 1, lastColumn);
  const headers = range.getDisplayValues()[0];
  const replacements = {
    "valid applications": "Eligible Applications",
    "payment due": "Total Payment Due",
    "paid?": "Payment Status",
  };
  let changed = false;

  const migratedHeaders = headers.map(function (header) {
    const replacement = replacements[setupNormalizeHeader_(header)];

    if (replacement) {
      changed = true;
      return replacement;
    }

    return header;
  });

  if (changed) {
    range.setValues([migratedHeaders]);
  }

  const paymentStatusColumn = migratedHeaders.findIndex(function (header) {
    return setupNormalizeHeader_(header) === "payment status";
  });

  if (paymentStatusColumn === -1 || sheet.getLastRow() < 2) {
    return;
  }

  const statusRange = sheet.getRange(
    2,
    paymentStatusColumn + 1,
    sheet.getLastRow() - 1,
    1,
  );
  const statuses = statusRange.getDisplayValues().map(function (row) {
    const value = String(row[0] || "")
      .trim()
      .toLowerCase();

    if (value === "yes" || value === "paid") {
      return ["Paid"];
    }

    if (value === "no" || value === "pending") {
      return ["Pending"];
    }

    return [row[0]];
  });

  statusRange.setValues(statuses);
}

function setupAddPaymentWeekRow_(paymentSheet, trackerSheet, weekStart) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const timezone = spreadsheet.getSpreadsheetTimeZone();

  const weekKey = Utilities.formatDate(weekStart, timezone, "yyyy-MM-dd");

  const paymentMap = setupBuildHeaderMap_(paymentSheet);
  const weekStartColumn = paymentMap[setupNormalizeHeader_("Week Start")];
  const weekEndColumn = paymentMap[setupNormalizeHeader_("Week End")];
  const eligibleApplicationsColumn =
    paymentMap[setupNormalizeHeader_("Eligible Applications")];
  const totalPaymentColumn =
    paymentMap[setupNormalizeHeader_("Total Payment Due")];
  const paymentStatusColumn =
    paymentMap[setupNormalizeHeader_("Payment Status")];

  if (
    !weekStartColumn ||
    !weekEndColumn ||
    !eligibleApplicationsColumn ||
    !totalPaymentColumn ||
    !paymentStatusColumn
  ) {
    throw new Error("Payment Summary is missing required V2 columns.");
  }

  const lastRow = Math.max(paymentSheet.getLastRow(), 1);

  if (lastRow >= 2) {
    const existingDates = paymentSheet
      .getRange(2, weekStartColumn, lastRow - 1, 1)
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

  paymentSheet.getRange(row, weekStartColumn).setValue(weekStart);
  paymentSheet.getRange(row, weekEndColumn).setValue(weekEnd);

  const trackerMap = setupBuildHeaderMap_(trackerSheet);

  const dateColumn = trackerMap[setupNormalizeHeader_("Date of Application")];

  const eligibilityColumn =
    trackerMap[setupNormalizeHeader_("Payment Eligibility")];

  const paymentDueColumn = trackerMap[setupNormalizeHeader_("Payment Due")];

  if (!dateColumn || !eligibilityColumn || !paymentDueColumn) {
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

  const paymentDueRange =
    `'${trackerName}'!$` +
    `${setupColumnLetter_(paymentDueColumn)}$` +
    `${JOB_MATCH_CONFIG.dataStartRow}:$` +
    `${setupColumnLetter_(paymentDueColumn)}$` +
    `${JOB_MATCH_CONFIG.formulaEndRow}`;

  const weekStartCell = `$${setupColumnLetter_(weekStartColumn)}${row}`;
  const weekEndCell = `$${setupColumnLetter_(weekEndColumn)}${row}`;

  paymentSheet
    .getRange(row, eligibleApplicationsColumn)
    .setFormula(
      `=COUNTIFS(` +
        `${dateRange},">="&${weekStartCell},` +
        `${dateRange},"<="&${weekEndCell},` +
        `${eligibilityRange},"Eligible"` +
        `)`,
    );

  paymentSheet
    .getRange(row, totalPaymentColumn)
    .setFormula(
      `=SUMIFS(` +
        `${paymentDueRange},` +
        `${dateRange},">="&${weekStartCell},` +
        `${dateRange},"<="&${weekEndCell},` +
        `${eligibilityRange},"Eligible"` +
        `)`,
    );

  paymentSheet.getRange(row, paymentStatusColumn).setValue("Pending");

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
