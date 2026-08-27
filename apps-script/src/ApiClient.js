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
    "geography_decision",
    "geography_reason",
    "decision",
  ];

  jmRequireFields_(result, requiredFields);

  jmRequireAllowedValue_(
    result.geography_decision,
    ["Accepted", "Rejected", "Manual review"],
    "geography_decision",
  );

  if (!String(result.geography_reason || "").trim()) {
    throw new Error('API field "geography_reason" must not be empty.');
  }

  jmRequireAllowedValue_(
    result.decision,
    ["Apply", "Tailor first", "Skip"],
    "decision",
  );

  if (result.geography_decision !== "Accepted") {
    jmRequireUnevaluatedFields_(
      result,
      [
        "role_ceiling_decision",
        "detected_role_level",
        "role_ceiling_reasons",
        "minimum_required_experience_years",
        "maximum_required_experience_years",
        "company_quality_decision",
        "company_quality_score",
        "company_quality_reasons",
        "company_sources",
      ],
      "geography check",
    );
    jmValidateStoppedResult_(result, "geography check");
    return;
  }

  const roleFields = [
    "role_ceiling_decision",
    "detected_role_level",
    "role_ceiling_reasons",
  ];

  jmRequireFields_(result, roleFields);

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

  if (result.role_ceiling_decision !== "Accepted") {
    jmRequireUnevaluatedFields_(
      result,
      [
        "company_quality_decision",
        "company_quality_score",
        "company_scale_score",
        "company_market_position_score",
        "company_geographic_reach_score",
        "company_engineering_maturity_score",
        "company_reputation_score",
        "company_confidence",
        "company_quality_reasons",
        "company_sources",
      ],
      "role ceiling",
    );
    jmValidateStoppedResult_(result, "role ceiling");
    return;
  }

  const companyFields = [
    "company_quality_decision",
    "company_quality_score",
    "company_scale_score",
    "company_market_position_score",
    "company_geographic_reach_score",
    "company_engineering_maturity_score",
    "company_reputation_score",
    "company_confidence",
    "company_quality_reasons",
    "company_sources",
  ];

  jmRequireFields_(result, companyFields);

  jmRequireAllowedValue_(
    result.company_quality_decision,
    ["Accepted", "Rejected", "Manual review"],
    "company_quality_decision",
  );

  jmRequireAllowedValue_(
    result.company_confidence,
    ["High", "Medium", "Low"],
    "company_confidence",
  );

  jmRequireNumberInRange_(
    result.company_quality_score,
    0,
    100,
    "company_quality_score",
  );
  jmRequireNumberInRange_(
    result.company_scale_score,
    0,
    30,
    "company_scale_score",
  );
  jmRequireNumberInRange_(
    result.company_market_position_score,
    0,
    25,
    "company_market_position_score",
  );
  jmRequireNumberInRange_(
    result.company_geographic_reach_score,
    0,
    15,
    "company_geographic_reach_score",
  );
  jmRequireNumberInRange_(
    result.company_engineering_maturity_score,
    0,
    20,
    "company_engineering_maturity_score",
  );
  jmRequireNumberInRange_(
    result.company_reputation_score,
    0,
    10,
    "company_reputation_score",
  );

  if (!Array.isArray(result.company_quality_reasons)) {
    throw new Error('API field "company_quality_reasons" must be a list.');
  }

  if (result.company_quality_reasons.length === 0) {
    throw new Error('API field "company_quality_reasons" must not be empty.');
  }

  if (!Array.isArray(result.company_sources)) {
    throw new Error('API field "company_sources" must be a list.');
  }

  if (result.company_quality_decision !== "Accepted") {
    jmValidateStoppedResult_(result, "company quality gate");
    return;
  }

  if (["High", "Medium"].indexOf(result.company_confidence) === -1) {
    throw new Error("Accepted company must have High or Medium confidence.");
  }

  const uniqueSources = {};

  result.company_sources.forEach(function (source) {
    const url = String(source || "").trim();

    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`API returned an invalid company source URL: ${url}`);
    }

    uniqueSources[url] = true;
  });

  if (Object.keys(uniqueSources).length < 2) {
    throw new Error("Accepted company must include at least two source URLs.");
  }

  if (result.job_accepted !== true) {
    throw new Error(
      "An accepted geography, role and company must have job_accepted=true.",
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

function jmValidateStoppedResult_(result, stoppedAt) {
  if (result.job_accepted !== false) {
    throw new Error(`A job stopped at the ${stoppedAt} cannot be accepted.`);
  }

  if (result.decision !== "Skip") {
    throw new Error(`A job stopped at the ${stoppedAt} must return Skip.`);
  }

  jmRequireFields_(result, ["match_percentage", "match_level"]);

  if (result.match_percentage !== null || result.match_level !== null) {
    throw new Error(
      `API returned CV-match data even though ` +
        `processing stopped at the ${stoppedAt}.`,
    );
  }
}

function jmRequireUnevaluatedFields_(result, fields, stoppedAt) {
  fields.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      return;
    }

    const value = result[field];
    const isEmptyArray = Array.isArray(value) && value.length === 0;

    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !isEmptyArray
    ) {
      throw new Error(
        `API returned "${field}" even though processing stopped ` +
          `at the ${stoppedAt}.`,
      );
    }
  });
}

function jmRequireFields_(value, fields) {
  fields.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`API response is missing "${field}".`);
    }
  });
}

function jmRequireNumberInRange_(value, minimum, maximum, fieldName) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`API response is missing numeric "${fieldName}".`);
  }

  const numberValue = Number(value);

  if (
    !Number.isFinite(numberValue) ||
    numberValue < minimum ||
    numberValue > maximum
  ) {
    throw new Error(
      `API returned invalid "${fieldName}": ${value}. ` +
        `Expected ${minimum}–${maximum}.`,
    );
  }
}

function jmRequireAllowedValue_(value, allowedValues, fieldName) {
  if (allowedValues.indexOf(value) === -1) {
    throw new Error(`API returned invalid "${fieldName}": ${value}`);
  }
}
