/**
 * Adds all missing input and result columns.
 *
 * Existing columns are preserved.
 */
function jmEnsureRequiredColumns_(sheet) {
  const headerMap = jmBuildHeaderMap_(sheet);

  const missingHeaders = JOB_MATCH_CONFIG.requiredColumns.filter(
    function (header) {
      const normalizedHeader = jmNormalizeHeader_(header);

      return !Object.prototype.hasOwnProperty.call(headerMap, normalizedHeader);
    },
  );

  if (missingHeaders.length === 0) {
    return;
  }

  const lastUsedColumn = sheet.getLastColumn();
  const requiredLastColumn = lastUsedColumn + missingHeaders.length;

  const currentMaximumColumns = sheet.getMaxColumns();

  /*
   * Expand the physical sheet before using getRange()
   * beyond its current dimensions.
   */
  if (requiredLastColumn > currentMaximumColumns) {
    sheet.insertColumnsAfter(
      currentMaximumColumns,
      requiredLastColumn - currentMaximumColumns,
    );
  }

  const newHeaderRange = sheet.getRange(
    JOB_MATCH_CONFIG.headerRow,
    lastUsedColumn + 1,
    1,
    missingHeaders.length,
  );

  /*
   * Copy formatting from the previous header column.
   */
  if (lastUsedColumn >= 1) {
    sheet
      .getRange(JOB_MATCH_CONFIG.headerRow, lastUsedColumn)
      .copyTo(newHeaderRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  newHeaderRange.setValues([missingHeaders]);
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

    outputHeaders.companyStatus,
    outputHeaders.matchedCompanyName,
    outputHeaders.companyTier,
    outputHeaders.monthlySalaryNgn,

    outputHeaders.salaryStatus,
    outputHeaders.jobQualityLevel,

    outputHeaders.roleCeilingDecision,
    outputHeaders.detectedRoleLevel,
    outputHeaders.roleCeilingReasons,
    outputHeaders.minimumExperienceYears,
    outputHeaders.maximumExperienceYears,

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

function jmWriteApiResult_(sheet, selectedRow, result) {
  const outputHeaders = JOB_MATCH_CONFIG.outputHeaders;

  const valuesByHeader = {};

  valuesByHeader[outputHeaders.screeningDecision] =
    result.screening_decision || "";

  valuesByHeader[outputHeaders.screeningReasons] = jmJoinList_(
    result.screening_reasons,
    "\n",
  );

  valuesByHeader[outputHeaders.companyStatus] = result.company_status || "";

  valuesByHeader[outputHeaders.matchedCompanyName] =
    result.matched_company_name || "";

  valuesByHeader[outputHeaders.companyTier] = result.company_tier || "";

  valuesByHeader[outputHeaders.monthlySalaryNgn] = jmOptionalNumber_(
    result.monthly_salary_ngn,
  );

  valuesByHeader[outputHeaders.salaryStatus] = result.salary_status || "";

  valuesByHeader[outputHeaders.jobQualityLevel] =
    result.job_quality_level || "";

  valuesByHeader[outputHeaders.roleCeilingDecision] =
    result.role_ceiling_decision || "";

  valuesByHeader[outputHeaders.detectedRoleLevel] =
    result.detected_role_level || "";

  valuesByHeader[outputHeaders.roleCeilingReasons] = jmJoinList_(
    result.role_ceiling_reasons,
    "\n",
  );

  valuesByHeader[outputHeaders.minimumExperienceYears] = jmOptionalNumber_(
    result.minimum_required_experience_years,
  );

  valuesByHeader[outputHeaders.maximumExperienceYears] = jmOptionalNumber_(
    result.maximum_required_experience_years,
  );

  valuesByHeader[outputHeaders.matchPercentage] = jmOptionalNumber_(
    result.match_percentage,
  );

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

  const wrappedHeaders = [
    outputHeaders.screeningReasons,
    outputHeaders.roleCeilingReasons,
    outputHeaders.matchedSkills,
    outputHeaders.missingSkills,
    outputHeaders.tailoringAdvice,
  ];

  wrappedHeaders.forEach(function (header) {
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

function jmOptionalNumber_(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "";
  }

  return numberValue;
}
