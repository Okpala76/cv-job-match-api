const DUPLICATE_CHECK_CONFIG = Object.freeze({
  trackerSheetName: "Sheet1",
  headerRow: 1,

  headerAliases: {
    companyName: ["company name", "company"],

    jobTitle: ["job title", "role title", "position"],

    location: ["country / location", "country/location", "location"],

    jobLink: ["job link", "job url", "application link"],

    jobDescription: ["job description", "description"],

    applicationStatus: ["application status", "status"],
  },

  outputHeaders: {
    duplicateStatus: "Duplicate Status",
    duplicateRow: "Duplicate Row",
    duplicateReason: "Duplicate Reason",
  },
});

/**
 * Temporary Batch 3 test function.
 *
 * Select a row in Sheet1 and run this function.
 * It checks the row and writes the duplicate result into the sheet.
 */
function checkSelectedRowForDuplicate() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  try {
    if (sheet.getName() !== DUPLICATE_CHECK_CONFIG.trackerSheetName) {
      throw new Error(
        `Select a row inside ` +
          `"${DUPLICATE_CHECK_CONFIG.trackerSheetName}".`,
      );
    }

    const activeRange = sheet.getActiveRange();

    if (!activeRange) {
      throw new Error("Select a job row first.");
    }

    const selectedRow = activeRange.getRow();

    if (selectedRow <= DUPLICATE_CHECK_CONFIG.headerRow) {
      throw new Error("Select a job row, not the header row.");
    }

    duplicateEnsureOutputColumns_(sheet);

    const result = duplicateCheckRow_(sheet, selectedRow);

    duplicateWriteResult_(sheet, selectedRow, result);

    const matchedRowMessage = result.matchedRow
      ? `Matched sheet row: ${result.matchedRow}`
      : "Matched sheet row: None";

    ui.alert(
      result.status,
      `${matchedRowMessage}\n\n${result.reason}`,
      ui.ButtonSet.OK,
    );

    return result;
  } catch (error) {
    ui.alert("Duplicate check failed", error.message, ui.ButtonSet.OK);

    throw error;
  }
}

/**
 * Checks one selected row against all submitted applications.
 */
function duplicateCheckRow_(sheet, selectedRow) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= DUPLICATE_CHECK_CONFIG.headerRow) {
    return duplicateNewJobResult_();
  }

  const columnMap = duplicateBuildColumnMap_(sheet);

  const companyColumn = duplicateFindColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.companyName,
    "Company Name",
  );

  const titleColumn = duplicateFindColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.jobTitle,
    "Job Title",
  );

  const linkColumn = duplicateFindColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.jobLink,
    "Job Link",
  );

  const statusColumn = duplicateFindColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.applicationStatus,
    "Application Status",
  );

  const locationColumn = duplicateFindOptionalColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.location,
  );

  const descriptionColumn = duplicateFindOptionalColumn_(
    columnMap,
    DUPLICATE_CHECK_CONFIG.headerAliases.jobDescription,
  );

  const allRows = sheet
    .getRange(
      DUPLICATE_CHECK_CONFIG.headerRow + 1,
      1,
      lastRow - DUPLICATE_CHECK_CONFIG.headerRow,
      lastColumn,
    )
    .getDisplayValues();

  const selectedArrayIndex = selectedRow - DUPLICATE_CHECK_CONFIG.headerRow - 1;

  const currentValues = allRows[selectedArrayIndex];

  if (!currentValues) {
    throw new Error(`Unable to read selected row ${selectedRow}.`);
  }

  const currentJob = duplicateCreateJobRecord_(currentValues, {
    companyColumn,
    titleColumn,
    linkColumn,
    statusColumn,
    locationColumn,
    descriptionColumn,
  });

  duplicateValidateCurrentJob_(currentJob);

  let possibleDuplicate = null;

  // Search from the bottom so the most recent application wins.
  for (let index = allRows.length - 1; index >= 0; index -= 1) {
    const sheetRow = DUPLICATE_CHECK_CONFIG.headerRow + index + 1;

    if (sheetRow === selectedRow) {
      continue;
    }

    const previousValues = allRows[index];

    const previousJob = duplicateCreateJobRecord_(previousValues, {
      companyColumn,
      titleColumn,
      linkColumn,
      statusColumn,
      locationColumn,
      descriptionColumn,
    });

    /*
     * Only rows proving a submitted application
     * are allowed to block the selected job.
     */
    if (!duplicateIsSubmittedStatus_(previousJob.applicationStatus)) {
      continue;
    }

    const comparison = duplicateCompareJobs_(currentJob, previousJob);

    if (comparison.type === "confirmed") {
      return {
        state: "duplicate",
        status: "Already applied",
        matchedRow: sheetRow,
        reason: comparison.reason,
      };
    }

    if (comparison.type === "possible" && !possibleDuplicate) {
      possibleDuplicate = {
        state: "possible",
        status: "Possible duplicate — review",
        matchedRow: sheetRow,
        reason: comparison.reason,
      };
    }
  }

  return possibleDuplicate || duplicateNewJobResult_();
}

/**
 * Creates a consistent internal representation of a row.
 */
function duplicateCreateJobRecord_(rowValues, columns) {
  const companyName = duplicateCellValue_(rowValues, columns.companyColumn);

  const jobTitle = duplicateCellValue_(rowValues, columns.titleColumn);

  const jobLink = duplicateCellValue_(rowValues, columns.linkColumn);

  const jobDescription = duplicateCellValue_(
    rowValues,
    columns.descriptionColumn,
  );

  return {
    companyName,
    jobTitle,
    jobLink,
    jobDescription,

    location: duplicateCellValue_(rowValues, columns.locationColumn),

    applicationStatus: duplicateCellValue_(rowValues, columns.statusColumn),

    normalizedCompany: duplicateNormalizeCompany_(companyName),

    normalizedTitle: duplicateNormalizeText_(jobTitle),

    normalizedLink: duplicateNormalizeJobUrl_(jobLink),

    jobIdentifier: duplicateExtractJobIdentifier_(jobLink),

    descriptionFingerprint:
      duplicateCreateDescriptionFingerprint_(jobDescription),
  };
}

/**
 * Compares the selected job with one submitted application.
 */
function duplicateCompareJobs_(currentJob, previousJob) {
  const sameCompany = Boolean(
    currentJob.normalizedCompany &&
    currentJob.normalizedCompany === previousJob.normalizedCompany,
  );

  const sameTitle = Boolean(
    currentJob.normalizedTitle &&
    currentJob.normalizedTitle === previousJob.normalizedTitle,
  );

  /*
   * Strongest ordinary comparison.
   *
   * The company and job title both match.
   */
  if (sameCompany && sameTitle) {
    return {
      type: "confirmed",
      reason:
        "The same company and job title already have " +
        "a submitted application.",
    };
  }

  /*
   * Strong ATS/job-board identifier.
   *
   * Examples:
   * LinkedIn job number, Greenhouse ID,
   * BambooHR career ID or vacancy UUID.
   */
  if (
    currentJob.jobIdentifier &&
    currentJob.jobIdentifier === previousJob.jobIdentifier
  ) {
    return {
      type: "confirmed",
      reason:
        "The same identifiable job-posting ID was " + "already submitted.",
    };
  }

  /*
   * Identical full descriptions are strong evidence,
   * but we also require the company or title to match.
   */
  if (
    currentJob.descriptionFingerprint &&
    currentJob.descriptionFingerprint === previousJob.descriptionFingerprint &&
    (sameCompany || sameTitle)
  ) {
    return {
      type: "confirmed",
      reason:
        "The same job description was previously " +
        "submitted for the same company or title.",
    };
  }

  /*
   * URL alone is not enough for automatic rejection.
   *
   * A company can use one Google Form for several roles.
   */
  if (
    currentJob.normalizedLink &&
    currentJob.normalizedLink === previousJob.normalizedLink
  ) {
    return {
      type: "possible",
      reason:
        "The same application link was used before, " +
        "but the company/title combination is different. " +
        "Review the earlier row before applying.",
    };
  }

  return {
    type: "none",
    reason: "",
  };
}

function duplicateValidateCurrentJob_(job) {
  const hasCompanyAndTitle = Boolean(
    job.normalizedCompany && job.normalizedTitle,
  );

  const hasJobIdentifier = Boolean(job.jobIdentifier);

  const hasJobLink = Boolean(job.normalizedLink);

  const hasDescription = Boolean(job.descriptionFingerprint);

  if (
    !hasCompanyAndTitle &&
    !hasJobIdentifier &&
    !hasJobLink &&
    !hasDescription
  ) {
    throw new Error(
      "The selected row needs a company and job title, " +
        "a job link, or a full job description.",
    );
  }
}

/**
 * Application statuses which prove the application
 * was previously submitted.
 */
function duplicateIsSubmittedStatus_(status) {
  const normalizedStatus = duplicateNormalizeText_(status);

  if (!normalizedStatus) {
    return false;
  }

  const nonSubmittedStatuses = [
    "not applied",
    "not submitted",
    "draft",
    "saved",
    "to apply",
    "skip",
    "skipped",
  ];

  const isNonSubmitted = nonSubmittedStatuses.some(function (item) {
    return normalizedStatus === item || normalizedStatus.indexOf(item) !== -1;
  });

  if (isNonSubmitted) {
    return false;
  }

  const submittedStatusTerms = [
    "applied",
    "submitted",
    "screening",
    "assessment",
    "interview",
    "interviewing",
    "rejected",
    "offer",
    "offered",
    "accepted",
    "withdrawn",
  ];

  return submittedStatusTerms.some(function (item) {
    return normalizedStatus === item || normalizedStatus.indexOf(item) !== -1;
  });
}

/**
 * Adds the three duplicate-result columns when missing.
 */
function duplicateEnsureOutputColumns_(sheet) {
  const outputHeaders = DUPLICATE_CHECK_CONFIG.outputHeaders;

  const requiredHeaders = [
    outputHeaders.duplicateStatus,
    outputHeaders.duplicateRow,
    outputHeaders.duplicateReason,
  ];

  const columnMap = duplicateBuildColumnMap_(sheet);

  const missingHeaders = requiredHeaders.filter(function (header) {
    const normalizedHeader = duplicateNormalizeHeader_(header);

    return !Object.prototype.hasOwnProperty.call(columnMap, normalizedHeader);
  });

  if (missingHeaders.length === 0) {
    return;
  }

  const lastUsedColumn = sheet.getLastColumn();

  const requiredLastColumn = lastUsedColumn + missingHeaders.length;

  const currentMaximumColumns = sheet.getMaxColumns();

  /*
   * Add physical columns before requesting ranges
   * that extend beyond the current sheet dimensions.
   */
  if (requiredLastColumn > currentMaximumColumns) {
    sheet.insertColumnsAfter(
      currentMaximumColumns,
      requiredLastColumn - currentMaximumColumns,
    );
  }

  const newHeaderRange = sheet.getRange(
    DUPLICATE_CHECK_CONFIG.headerRow,
    lastUsedColumn + 1,
    1,
    missingHeaders.length,
  );

  if (lastUsedColumn >= 1) {
    sheet
      .getRange(DUPLICATE_CHECK_CONFIG.headerRow, lastUsedColumn)
      .copyTo(newHeaderRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  newHeaderRange.setValues([missingHeaders]);
}

/**
 * Writes the duplicate result to the selected row.
 */
function duplicateWriteResult_(sheet, selectedRow, result) {
  const columnMap = duplicateBuildColumnMap_(sheet);
  const outputHeaders = DUPLICATE_CHECK_CONFIG.outputHeaders;

  const statusColumn = duplicateFindColumn_(
    columnMap,
    [outputHeaders.duplicateStatus],
    outputHeaders.duplicateStatus,
  );

  const rowColumn = duplicateFindColumn_(
    columnMap,
    [outputHeaders.duplicateRow],
    outputHeaders.duplicateRow,
  );

  const reasonColumn = duplicateFindColumn_(
    columnMap,
    [outputHeaders.duplicateReason],
    outputHeaders.duplicateReason,
  );

  sheet.getRange(selectedRow, statusColumn + 1).setValue(result.status);

  sheet.getRange(selectedRow, rowColumn + 1).setValue(result.matchedRow || "");

  sheet.getRange(selectedRow, reasonColumn + 1).setValue(result.reason);
}

function duplicateNewJobResult_() {
  return {
    state: "new",
    status: "No duplicate found",
    matchedRow: "",
    reason: "No matching submitted application was found.",
  };
}

/**
 * Builds a case-insensitive header → zero-based index map.
 */
function duplicateBuildColumnMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  const headers = sheet
    .getRange(DUPLICATE_CHECK_CONFIG.headerRow, 1, 1, lastColumn)
    .getDisplayValues()[0];

  const columnMap = {};

  headers.forEach(function (header, index) {
    const normalizedHeader = duplicateNormalizeHeader_(header);

    if (
      normalizedHeader &&
      !Object.prototype.hasOwnProperty.call(columnMap, normalizedHeader)
    ) {
      columnMap[normalizedHeader] = index;
    }
  });

  return columnMap;
}

function duplicateFindColumn_(columnMap, aliases, displayName) {
  const columnIndex = duplicateFindOptionalColumn_(columnMap, aliases);

  if (columnIndex === -1) {
    throw new Error(`Required column "${displayName}" was not found.`);
  }

  return columnIndex;
}

function duplicateFindOptionalColumn_(columnMap, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const normalizedAlias = duplicateNormalizeHeader_(aliases[index]);

    if (Object.prototype.hasOwnProperty.call(columnMap, normalizedAlias)) {
      return columnMap[normalizedAlias];
    }
  }

  return -1;
}

function duplicateCellValue_(rowValues, columnIndex) {
  if (columnIndex === -1 || columnIndex === undefined) {
    return "";
  }

  return String(rowValues[columnIndex] || "").trim();
}

function duplicateNormalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function duplicateNormalizeText_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes common company suffixes so:
 *
 * "Example Technologies Limited"
 * and
 * "Example Technologies Ltd"
 *
 * can match.
 */
function duplicateNormalizeCompany_(value) {
  const normalized = duplicateNormalizeText_(value);

  if (!normalized) {
    return "";
  }

  const suffixes = {
    limited: true,
    ltd: true,
    llc: true,
    incorporated: true,
    inc: true,
    plc: true,
    company: true,
    co: true,
  };

  return normalized
    .split(" ")
    .filter(function (word) {
      return !suffixes[word];
    })
    .join(" ")
    .trim();
}

/**
 * Removes tracking parameters but preserves meaningful IDs.
 */
function duplicateNormalizeJobUrl_(url) {
  let value = String(url || "")
    .trim()
    .toLowerCase();

  if (!value) {
    return "";
  }

  value = value.split("#")[0];

  const urlParts = value.split("?");
  const baseUrl = urlParts[0].replace(/\/+$/g, "");

  if (urlParts.length === 1) {
    return baseUrl;
  }

  const queryString = urlParts.slice(1).join("?");

  const trackingParameterPattern =
    /^(utm_|source$|ref$|referrer$|gh_src$|pli$|trk$|tracking$)/;

  const meaningfulParameters = queryString
    .split("&")
    .filter(function (parameter) {
      if (!parameter) {
        return false;
      }

      const parameterName = parameter.split("=")[0].trim().toLowerCase();

      return !trackingParameterPattern.test(parameterName);
    })
    .sort();

  if (meaningfulParameters.length === 0) {
    return baseUrl;
  }

  return `${baseUrl}?` + meaningfulParameters.join("&");
}

/**
 * Extracts stable job IDs from common ATS/job-board URLs.
 *
 * Google Form IDs are deliberately excluded because a single
 * form can accept applications for several different roles.
 */
function duplicateExtractJobIdentifier_(url) {
  const rawUrl = String(url || "")
    .trim()
    .toLowerCase();

  if (!rawUrl) {
    return "";
  }

  if (
    rawUrl.indexOf("docs.google.com/forms") !== -1 ||
    rawUrl.indexOf("forms.gle") !== -1
  ) {
    return "";
  }

  const patterns = [
    {
      name: "linkedin",
      pattern: /linkedin\.com\/jobs\/view\/(\d+)/i,
    },
    {
      name: "greenhouse",
      pattern: /greenhouse\.io\/[^?#]*\/jobs\/(\d+)/i,
    },
    {
      name: "bamboohr",
      pattern: /bamboohr\.com\/careers\/(\d+)/i,
    },
    {
      name: "job-apply",
      pattern: /\/jobs\/apply\/(\d+)/i,
    },
    {
      name: "vacancy",
      pattern: /\/vacancy\/post\/([a-f0-9-]{20,})/i,
    },
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const item = patterns[index];
    const match = rawUrl.match(item.pattern);

    if (match && match[1]) {
      return `${item.name}:${match[1]}`;
    }
  }

  const queryString = rawUrl.split("?")[1] || "";

  const acceptedQueryKeys = {
    gh_jid: true,
    job_id: true,
    jobid: true,
    requisitionid: true,
    reqid: true,
    vacancyid: true,
  };

  const parameters = queryString.split("&");

  for (let index = 0; index < parameters.length; index += 1) {
    const pair = parameters[index].split("=");

    const key = String(pair[0] || "")
      .trim()
      .toLowerCase();

    const value = String(pair[1] || "")
      .trim()
      .toLowerCase();

    if (acceptedQueryKeys[key] && value) {
      return `${key}:${value}`;
    }
  }

  return "";
}

/**
 * Generates a SHA-256 fingerprint for a substantial
 * job description.
 */
function duplicateCreateDescriptionFingerprint_(jobDescription) {
  const normalizedDescription = duplicateNormalizeText_(jobDescription);

  /*
   * Very short descriptions are not reliable enough
   * to use as duplicate evidence.
   */
  if (normalizedDescription.length < 120) {
    return "";
  }

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalizedDescription,
    Utilities.Charset.UTF_8,
  );

  return digest
    .map(function (byte) {
      const unsignedByte = (byte + 256) % 256;

      return ("0" + unsignedByte.toString(16)).slice(-2);
    })
    .join("");
}
