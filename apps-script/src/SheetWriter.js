/**
 * Adds all missing input and result columns.
 *
 * Existing columns are preserved.
 */
function jmEnsureRequiredColumns_(sheet) {
  let headerMap = jmBuildHeaderMap_(sheet);
  let nextColumn = sheet.getLastColumn() + 1;

  JOB_MATCH_CONFIG.requiredColumns.forEach(function (header) {
    const normalizedHeader = jmNormalizeHeader_(header);

    if (Object.prototype.hasOwnProperty.call(headerMap, normalizedHeader)) {
      return;
    }

    /*
     * Copy formatting from the previous header.
     */
    if (nextColumn > 1) {
      sheet
        .getRange(JOB_MATCH_CONFIG.headerRow, nextColumn - 1)
        .copyTo(
          sheet.getRange(JOB_MATCH_CONFIG.headerRow, nextColumn),
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
          false,
        );
    }

    sheet.getRange(JOB_MATCH_CONFIG.headerRow, nextColumn).setValue(header);

    nextColumn += 1;
    headerMap = jmBuildHeaderMap_(sheet);
  });
}

/**
 * Clears old API results before starting a fresh analysis.
 *
 * This prevents stale results from remaining visible when
 * a later request fails.
 */
function jmClearAnalysisResult_(sheet, selectedRow) {
  const outputHeaders = JOB_MATCH_CONFIG.outputHeaders;

  const headersToClear = [
    outputHeaders.screeningDecision,
    outputHeaders.screeningReasons,
    outputHeaders.salaryStatus,
    outputHeaders.jobQualityLevel,
    outputHeaders.matchPercentage,
    outputHeaders.matchLevel,
    outputHeaders.matchedSkills,
    outputHeaders.missingSkills,
    outputHeaders.tailoringAdvice,
    outputHeaders.decision,
    outputHeaders.analysisStatus,
  ];

  const headerMap = jmBuildHeaderMap_(sheet);

  headersToClear.forEach(function (header) {
    const columnIndex = jmFindRequiredColumn_(headerMap, [header], header);

    sheet.getRange(selectedRow, columnIndex + 1).clearContent();
  });
}

/**
 * Writes the completed FastAPI response into the selected row.
 */
function jmWriteApiResult_(sheet, selectedRow, result) {
  const outputHeaders = JOB_MATCH_CONFIG.outputHeaders;

  const valuesByHeader = {};

  valuesByHeader[outputHeaders.screeningDecision] =
    result.screening_decision || "";

  valuesByHeader[outputHeaders.screeningReasons] = jmJoinList_(
    result.screening_reasons,
    "\n",
  );

  valuesByHeader[outputHeaders.salaryStatus] = result.salary_status || "";

  valuesByHeader[outputHeaders.jobQualityLevel] =
    result.job_quality_level || "";

  valuesByHeader[outputHeaders.matchPercentage] =
    result.match_percentage === null || result.match_percentage === undefined
      ? ""
      : Number(result.match_percentage);

  valuesByHeader[outputHeaders.matchLevel] = result.match_level || "";

  valuesByHeader[outputHeaders.matchedSkills] = jmJoinList_(
    result.matched_skills,
    ", ",
  );

  valuesByHeader[outputHeaders.missingSkills] = jmJoinList_(
    result.missing_skills,
    ", ",
  );

  valuesByHeader[outputHeaders.tailoringAdvice] = result.tailoring_advice || "";

  valuesByHeader[outputHeaders.decision] = result.decision || "";

  valuesByHeader[outputHeaders.analysisStatus] = "Success";

  const headerMap = jmBuildHeaderMap_(sheet);

  Object.keys(valuesByHeader).forEach(function (header) {
    const columnIndex = jmFindRequiredColumn_(headerMap, [header], header);

    sheet
      .getRange(selectedRow, columnIndex + 1)
      .setValue(valuesByHeader[header]);
  });

  /*
   * Improve readability for longer result cells.
   */
  [
    outputHeaders.screeningReasons,
    outputHeaders.matchedSkills,
    outputHeaders.missingSkills,
    outputHeaders.tailoringAdvice,
  ].forEach(function (header) {
    const columnIndex = jmFindRequiredColumn_(headerMap, [header], header);

    sheet.getRange(selectedRow, columnIndex + 1).setWrap(true);
  });
}

function jmWriteAnalysisStatus_(sheet, selectedRow, status) {
  const headerMap = jmBuildHeaderMap_(sheet);

  const columnIndex = jmFindRequiredColumn_(
    headerMap,
    [JOB_MATCH_CONFIG.outputHeaders.analysisStatus],
    "Analysis Status",
  );

  sheet.getRange(selectedRow, columnIndex + 1).setValue(status);
}

function jmJoinList_(value, separator) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(function (item) {
      return Boolean(item);
    })
    .join(separator);
}

function jmBuildHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  const headers = sheet
    .getRange(JOB_MATCH_CONFIG.headerRow, 1, 1, lastColumn)
    .getDisplayValues()[0];

  const headerMap = {};

  headers.forEach(function (header, index) {
    const normalized = jmNormalizeHeader_(header);

    if (
      normalized &&
      !Object.prototype.hasOwnProperty.call(headerMap, normalized)
    ) {
      headerMap[normalized] = index;
    }
  });

  return headerMap;
}

function jmFindRequiredColumn_(headerMap, aliases, displayName) {
  const columnIndex = jmFindOptionalColumn_(headerMap, aliases);

  if (columnIndex === -1) {
    throw new Error(`Required column "${displayName}" was not found.`);
  }

  return columnIndex;
}

function jmFindOptionalColumn_(headerMap, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const normalizedAlias = jmNormalizeHeader_(aliases[index]);

    if (Object.prototype.hasOwnProperty.call(headerMap, normalizedAlias)) {
      return headerMap[normalizedAlias];
    }
  }

  return -1;
}

function jmNormalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function jmReadCell_(rowValues, columnIndex) {
  if (columnIndex === -1 || columnIndex === undefined) {
    return "";
  }

  return String(rowValues[columnIndex] || "").trim();
}
