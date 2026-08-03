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
  if (typeof result !== "object" || result === null) {
    throw new Error("API returned an invalid response object.");
  }

  const requiredFields = [
    "job_accepted",
    "screening_decision",
    "screening_reasons",
    "salary_status",
    "job_quality_level",
    "decision",
  ];

  requiredFields.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`API response is missing "${field}".`);
    }
  });

  if (
    result.match_percentage === null ||
    result.match_percentage === undefined
  ) {
    return;
  }

  const score = Number(result.match_percentage);

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("API returned an invalid match percentage.");
  }

  if (
    score >= 90 &&
    (result.match_level !== "Strong" || result.decision !== "Apply")
  ) {
    throw new Error("API decision violates the 90% Apply rule.");
  }

  if (
    score >= 70 &&
    score < 90 &&
    (result.match_level !== "Medium" || result.decision !== "Tailor first")
  ) {
    throw new Error("API decision violates the 70% Tailor-first rule.");
  }

  if (
    score < 70 &&
    (result.match_level !== "Weak" || result.decision !== "Skip")
  ) {
    throw new Error("API decision violates the below-70% Skip rule.");
  }
}
