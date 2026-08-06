function jmCallAnalyzeMatchApi_(payload) {
  const scriptProperties = PropertiesService.getScriptProperties();

  const endpoint = scriptProperties.getProperty(
    JOB_MATCH_CONFIG.scriptProperties.fastApiUrl,
  );

  const apiKey = scriptProperties.getProperty(
    JOB_MATCH_CONFIG.scriptProperties.apiKey,
  );

  if (!endpoint) {
    throw new Error('Script Property "FASTAPI_URL" is missing.');
  }

  if (!apiKey) {
    throw new Error('Script Property "APP_API_KEY" is missing.');
  }

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",

    headers: {
      [JOB_MATCH_CONFIG.apiKeyHeaderName]: apiKey,
    },

    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const responseCode = response.getResponseCode();

  const responseText = response.getContentText();

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `API returned invalid JSON. ` +
        `HTTP ${responseCode}. ` +
        `Response: ${responseText.slice(0, 500)}`,
    );
  }

  if (responseCode < 200 || responseCode >= 300) {
    const detail =
      typeof responseData.detail === "string"
        ? responseData.detail
        : JSON.stringify(responseData);

    throw new Error(`API request failed. ` + `HTTP ${responseCode}: ${detail}`);
  }

  jmValidateApiResponse_(responseData);

  return responseData;
}

function jmValidateApiResponse_(result) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("API returned an invalid response object.");
  }

  const requiredFields = [
    "job_accepted",
    "screening_decision",
    "screening_reasons",
    "company_status",
    "salary_status",
    "job_quality_level",
    "decision",
  ];

  requiredFields.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`API response is missing "${field}".`);
    }
  });

  if (!Array.isArray(result.screening_reasons)) {
    throw new Error('API field "screening_reasons" must be a list.');
  }

  jmRequireAllowedValue_(
    result.screening_decision,
    ["Accepted", "Rejected", "Manual review"],
    "screening_decision",
  );

  jmRequireAllowedValue_(
    result.company_status,
    ["Approved", "Not approved", "Unknown"],
    "company_status",
  );

  jmRequireAllowedValue_(
    result.salary_status,
    ["High-paying", "Not high-paying", "Unknown"],
    "salary_status",
  );

  jmRequireAllowedValue_(
    result.job_quality_level,
    ["High-end", "Not high-end", "Unknown"],
    "job_quality_level",
  );

  jmRequireAllowedValue_(
    result.decision,
    ["Apply", "Tailor first", "Skip"],
    "decision",
  );

  /*
   * Approved companies must identify the matched
   * company and its approved tier.
   */
  if (result.company_status === "Approved") {
    if (!String(result.matched_company_name || "").trim()) {
      throw new Error(
        "Approved company response is missing " + '"matched_company_name".',
      );
    }

    jmRequireAllowedValue_(result.company_tier, ["A", "B"], "company_tier");
  }

  if (
    result.monthly_salary_ngn !== null &&
    result.monthly_salary_ngn !== undefined
  ) {
    const monthlySalary = Number(result.monthly_salary_ngn);

    if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
      throw new Error("API returned an invalid monthly salary.");
    }
  }

  /*
   * A failed company/salary gate does not reach the
   * role ceiling or CV-match stage.
   */
  if (result.screening_decision !== "Accepted") {
    if (result.job_accepted !== false) {
      throw new Error(
        "A rejected or manual-review opportunity " +
          "cannot have job_accepted=true.",
      );
    }

    if (result.decision !== "Skip") {
      throw new Error(
        "A job that fails the opportunity gate " +
          "must return Decision = Skip.",
      );
    }

    jmValidateNoMatchResult_(result, "opportunity gate");

    return;
  }

  const roleFields = [
    "role_ceiling_decision",
    "detected_role_level",
    "role_ceiling_reasons",
  ];

  roleFields.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`API response is missing "${field}".`);
    }
  });

  if (!Array.isArray(result.role_ceiling_reasons)) {
    throw new Error('API field "role_ceiling_reasons" ' + "must be a list.");
  }

  jmRequireAllowedValue_(
    result.role_ceiling_decision,
    ["Accepted", "Rejected", "Manual review"],
    "role_ceiling_decision",
  );

  jmRequireAllowedValue_(
    result.detected_role_level,
    [
      "Internship",
      "Graduate",
      "Entry-level",
      "Junior",
      "Mid-level",
      "Senior",
      "Leadership",
      "Unspecified",
    ],
    "detected_role_level",
  );

  /*
   * A role-ceiling failure must stop before CV matching.
   */
  if (result.role_ceiling_decision !== "Accepted") {
    if (result.job_accepted !== false) {
      throw new Error(
        "A rejected or manual-review role cannot " + "have job_accepted=true.",
      );
    }

    if (result.decision !== "Skip") {
      throw new Error(
        "A role that fails the role ceiling " + "must return Decision = Skip.",
      );
    }

    jmValidateNoMatchResult_(result, "role ceiling");

    return;
  }

  /*
   * Both gates passed, so CV matching must exist.
   */
  if (result.job_accepted !== true) {
    throw new Error(
      "An accepted opportunity and role must have " + "job_accepted=true.",
    );
  }

  if (
    result.match_percentage === null ||
    result.match_percentage === undefined
  ) {
    throw new Error("Accepted job response has no match percentage.");
  }

  const score = Number(result.match_percentage);

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("API returned an invalid match percentage.");
  }

  if (score >= 90) {
    if (result.match_level !== "Strong" || result.decision !== "Apply") {
      throw new Error("API decision violates the 90% Apply rule.");
    }

    return;
  }

  if (score >= 70) {
    if (result.match_level !== "Medium" || result.decision !== "Tailor first") {
      throw new Error("API decision violates the 70% " + "Tailor-first rule.");
    }

    return;
  }

  if (result.match_level !== "Weak" || result.decision !== "Skip") {
    throw new Error("API decision violates the below-70% Skip rule.");
  }
}

function jmValidateNoMatchResult_(result, stoppedAt) {
  const hasMatchPercentage =
    result.match_percentage !== null &&
    result.match_percentage !== undefined &&
    result.match_percentage !== "";

  const hasMatchLevel =
    result.match_level !== null &&
    result.match_level !== undefined &&
    result.match_level !== "";

  if (hasMatchPercentage || hasMatchLevel) {
    throw new Error(
      `API returned CV-match data even though ` +
        `processing stopped at the ${stoppedAt}.`,
    );
  }
}

function jmRequireAllowedValue_(value, allowedValues, fieldName) {
  if (allowedValues.indexOf(value) === -1) {
    throw new Error(`API returned invalid "${fieldName}": ${value}`);
  }
}
