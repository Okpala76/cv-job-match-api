function analyzeSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveRange().getRow();

  if (row === 1) {
    SpreadsheetApp.getUi().alert("Please select a job row, not the header row.");
    return;
  }

  const apiUrl = PropertiesService.getScriptProperties().getProperty("FASTAPI_URL");
  const apiKey = PropertiesService.getScriptProperties().getProperty("APP_API_KEY");

  if (!apiUrl || !apiKey) {
    SpreadsheetApp.getUi().alert("FASTAPI_URL or APP_API_KEY is missing in Script Properties.");
    return;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const col = (name) => {
    const index = headers.indexOf(name);
    if (index === -1) {
      throw new Error(`Missing column: ${name}`);
    }
    return index + 1;
  };

  const jobDescriptionCol = col("Job Description");
  const matchPercentCol = col("Match %");
  const matchLevelCol = col("Match Level");
  const matchedSkillsCol = col("Matched Skills");
  const missingSkillsCol = col("Missing Skills");
  const tailoringAdviceCol = col("Tailoring Advice");
  const decisionCol = col("Decision");
  const analysisStatusCol = col("Analysis Status");

  try {
    const jobDescription = sheet.getRange(row, jobDescriptionCol).getValue();

    if (!jobDescription || String(jobDescription).trim().length < 50) {
      throw new Error("Job Description is empty or too short.");
    }

    sheet.getRange(row, analysisStatusCol).setValue("Analyzing...");

    const response = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-api-key": apiKey,
      },
      payload: JSON.stringify({
        job_description: jobDescription,
      }),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`API error ${statusCode}: ${responseText}`);
    }

    const result = JSON.parse(responseText);

    sheet.getRange(row, matchPercentCol).setValue(result.match_percentage);
    sheet.getRange(row, matchLevelCol).setValue(result.match_level);
    sheet.getRange(row, matchedSkillsCol).setValue(result.matched_skills.join(", "));
    sheet.getRange(row, missingSkillsCol).setValue(result.missing_skills.join(", "));
    sheet.getRange(row, tailoringAdviceCol).setValue(result.tailoring_advice);
    sheet.getRange(row, decisionCol).setValue(result.decision);
    sheet.getRange(row, analysisStatusCol).setValue("Success");

  } catch (error) {
    sheet.getRange(row, analysisStatusCol).setValue("Analysis failed — retry");
    SpreadsheetApp.getUi().alert(error.message);
  }
}