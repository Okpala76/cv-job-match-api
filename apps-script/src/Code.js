/**
 * Main Batch 4 function.
 *
 * The sheet button and menu should call this function.
 */
function analyzeSelectedRow() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const sheet = spreadsheet.getActiveSheet();

  const ui = SpreadsheetApp.getUi();

  let selectedRow = null;

  try {
    if (sheet.getName() !== JOB_MATCH_CONFIG.trackerSheetName) {
      throw new Error(
        `Open "${JOB_MATCH_CONFIG.trackerSheetName}" ` +
          "and select a job row.",
      );
    }

    const activeRange = sheet.getActiveRange();

    if (!activeRange) {
      throw new Error("Select a job row first.");
    }

    selectedRow = activeRange.getRow();

    if (selectedRow <= JOB_MATCH_CONFIG.headerRow) {
      throw new Error("Select a job row, not the header row.");
    }

    /*
     * Add any missing input/output columns.
     */
    jmEnsureRequiredColumns_(sheet);
    duplicateEnsureOutputColumns_(sheet);

    /*
     * Clear previous API results before starting.
     */
    jmClearAnalysisResult_(sheet, selectedRow);

    jmWriteAnalysisStatus_(sheet, selectedRow, "Checking duplicate...");

    /*
     * Batch 3 duplicate check.
     */
    const duplicateResult = duplicateCheckRow_(sheet, selectedRow);

    duplicateWriteResult_(sheet, selectedRow, duplicateResult);

    /*
     * Stop both confirmed and possible duplicates.
     *
     * A possible duplicate requires manual review before
     * spending an API call.
     */
    if (duplicateResult.state === "duplicate") {
      jmWriteAnalysisStatus_(
        sheet,
        selectedRow,
        "Already applied — API not called",
      );

      ui.alert(
        "Already applied",
        `Matched row: ${duplicateResult.matchedRow}\n\n` +
          duplicateResult.reason,
        ui.ButtonSet.OK,
      );

      return;
    }

    if (duplicateResult.state === "possible") {
      jmWriteAnalysisStatus_(sheet, selectedRow, "Possible duplicate — review");

      ui.alert(
        "Possible duplicate",
        `Matched row: ${duplicateResult.matchedRow}\n\n` +
          duplicateResult.reason +
          "\n\nReview the earlier row before analysing.",
        ui.ButtonSet.OK,
      );

      return;
    }

    const payload = jmBuildSelectedRowPayload_(sheet, selectedRow);

    jmWriteAnalysisStatus_(sheet, selectedRow, "Analyzing...");

    SpreadsheetApp.flush();

    const result = jmCallAnalyzeMatchApi_(payload);

    jmWriteApiResult_(sheet, selectedRow, result);

    SpreadsheetApp.flush();

    const scoreMessage =
      result.match_percentage === null || result.match_percentage === undefined
        ? "CV match: Not calculated"
        : `CV match: ${result.match_percentage}% ` + `(${result.match_level})`;

    const companyMessage =
      result.company_status === "Approved"
        ? `${result.matched_company_name} ` + `(Tier ${result.company_tier})`
        : result.company_status;

    const roleMessage = result.role_ceiling_decision
      ? `${result.role_ceiling_decision} ` +
        `(${result.detected_role_level || "Unspecified"})`
      : "Not evaluated";

    const potentialPayment =
      result.decision === "Apply"
        ? JOB_MATCH_CONFIG.paymentRates.Apply
        : result.decision === "Tailor first"
          ? JOB_MATCH_CONFIG.paymentRates.TailorFirst
          : JOB_MATCH_CONFIG.paymentRates.Skip;

    ui.alert(
      "Analysis complete",
      [
        `Opportunity gate: ${result.screening_decision}`,
        `Company: ${companyMessage}`,
        `Role ceiling: ${roleMessage}`,
        scoreMessage,
        `Decision: ${result.decision}`,
        `Potential payment rate: ₦${potentialPayment}`,
      ].join("\n"),
      ui.ButtonSet.OK,
    );
  } catch (error) {
    if (selectedRow && selectedRow > JOB_MATCH_CONFIG.headerRow) {
      try {
        jmEnsureRequiredColumns_(sheet);

        jmWriteAnalysisStatus_(sheet, selectedRow, "Analysis failed — retry");
      } catch (statusError) {
        console.error("Could not write failure status:", statusError);
      }
    }

    ui.alert("Analysis failed", error.message, ui.ButtonSet.OK);

    throw error;
  }
}

/**
 * Reads the selected row and creates the request expected
 * by FastAPI.
 */
function jmBuildSelectedRowPayload_(sheet, selectedRow) {
  const headerMap = jmBuildHeaderMap_(sheet);

  const aliases = JOB_MATCH_CONFIG.inputHeaders;

  const companyColumn = jmFindOptionalColumn_(headerMap, aliases.companyName);

  const titleColumn = jmFindOptionalColumn_(headerMap, aliases.jobTitle);

  const locationColumn = jmFindOptionalColumn_(
    headerMap,
    aliases.countryLocation,
  );

  const typeColumn = jmFindOptionalColumn_(headerMap, aliases.jobType);

  const levelColumn = jmFindOptionalColumn_(headerMap, aliases.jobLevel);

  const salaryColumn = jmFindOptionalColumn_(headerMap, aliases.salaryText);

  const linkColumn = jmFindOptionalColumn_(headerMap, aliases.jobLink);

  const descriptionColumn = jmFindRequiredColumn_(
    headerMap,
    aliases.jobDescription,
    "Job Description",
  );

  const rowValues = sheet
    .getRange(selectedRow, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];

  const jobDescription = jmReadCell_(rowValues, descriptionColumn);

  if (!jobDescription) {
    throw new Error(
      "The selected row has no Job Description. " +
        "Paste the full job description before analysing.",
    );
  }

  return {
    company_name: jmReadCell_(rowValues, companyColumn),

    job_title: jmReadCell_(rowValues, titleColumn),

    country_location: jmReadCell_(rowValues, locationColumn),

    job_type: jmReadCell_(rowValues, typeColumn),

    job_level: jmReadCell_(rowValues, levelColumn),

    salary_text: jmReadCell_(rowValues, salaryColumn),

    job_link: jmReadCell_(rowValues, linkColumn),

    job_description: jobDescription,
  };
}
