const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

function loadScripts(files, additions = {}) {
  const context = vm.createContext({ console, ...additions });

  files.forEach(function (file) {
    const source = fs.readFileSync(path.join(sourceDirectory, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });

  return context;
}

function acceptedResponse(overrides = {}) {
  return {
    job_accepted: true,
    geography_decision: "Accepted",
    geography_reason: "Role is located in Lagos, Nigeria.",
    role_ceiling_decision: "Accepted",
    detected_role_level: "Senior",
    role_ceiling_reasons: ["Four years is within the ceiling."],
    minimum_required_experience_years: 4,
    maximum_required_experience_years: null,
    company_quality_decision: "Accepted",
    company_quality_score: 84,
    company_scale_score: 27,
    company_market_position_score: 22,
    company_geographic_reach_score: 12,
    company_engineering_maturity_score: 15,
    company_reputation_score: 8,
    company_confidence: "High",
    company_quality_reasons: ["Large established organisation."],
    company_sources: [
      "https://company.example/report",
      "https://regulator.example/record",
    ],
    match_percentage: 78,
    match_level: "Medium",
    matched_skills: ["Python"],
    missing_skills: ["Kubernetes"],
    tailoring_advice: "Emphasise production delivery.",
    decision: "Tailor first",
    ...overrides,
  };
}

test("fresh tracker schema uses the required V2 analysis order", function () {
  const context = loadScripts(["Config.js"]);
  const columns = vm.runInContext(
    "Array.from(JOB_MATCH_CONFIG.trackerColumns)",
    context,
  );
  const analysisStart = columns.indexOf("Duplicate Status");
  const analysisEnd = columns.indexOf("Decision") + 1;

  assert.deepEqual(Array.from(columns.slice(analysisStart, analysisEnd)), [
    "Duplicate Status",
    "Duplicate Row",
    "Duplicate Reason",
    "Analysis Status",
    "Geography Decision",
    "Geography Reason",
    "Role Ceiling Decision",
    "Detected Role Level",
    "Role Ceiling Reasons",
    "Minimum Experience Years",
    "Maximum Experience Years",
    "Company Quality Decision",
    "Company Quality Score",
    "Company Scale Score",
    "Company Market Position Score",
    "Company Geographic Reach Score",
    "Company Engineering Maturity Score",
    "Company Reputation Score",
    "Company Confidence",
    "Company Quality Reasons",
    "Company Sources",
    "Match %",
    "Match Level",
    "Matched Skills",
    "Missing Skills",
    "Tailoring Advice",
    "Decision",
  ]);
  assert.equal(columns.includes("Company Tier"), false);
  assert.equal(columns.includes("Salary Status"), false);
  assert.equal(
    vm.runInContext("JOB_MATCH_CONFIG.paymentRates.Apply", context),
    200,
  );
  assert.equal(
    vm.runInContext("JOB_MATCH_CONFIG.paymentRates.TailorFirst", context),
    200,
  );
});

test("API validation follows geography, role and company stop order", function () {
  const context = loadScripts(["ApiClient.js"]);
  const validate = context.jmValidateApiResponse_;

  assert.doesNotThrow(function () {
    validate({
      job_accepted: false,
      geography_decision: "Rejected",
      geography_reason: "US-only remote role.",
      decision: "Skip",
      match_percentage: null,
      match_level: null,
    });
  });

  assert.doesNotThrow(function () {
    validate({
      job_accepted: false,
      geography_decision: "Accepted",
      geography_reason: "Role is in Kenya.",
      role_ceiling_decision: "Rejected",
      detected_role_level: "Graduate",
      role_ceiling_reasons: ["Graduate Trainee is below the role floor."],
      decision: "Skip",
      match_percentage: null,
      match_level: null,
    });
  });

  ["Rejected", "Manual review"].forEach(function (companyDecision) {
    assert.doesNotThrow(function () {
      validate(
        acceptedResponse({
          job_accepted: false,
          company_quality_decision: companyDecision,
          company_quality_score: 54,
          company_scale_score: 12,
          company_confidence: companyDecision === "Rejected" ? "High" : "Low",
          match_percentage: null,
          match_level: null,
          decision: "Skip",
        }),
      );
    });
  });
});

test("accepted companies require confidence and two source URLs", function () {
  const context = loadScripts(["ApiClient.js"]);
  const validate = context.jmValidateApiResponse_;

  assert.doesNotThrow(function () {
    validate(acceptedResponse());
  });
  assert.throws(function () {
    validate(acceptedResponse({ company_sources: ["https://one.example"] }));
  }, /at least two source URLs/);
  assert.throws(function () {
    validate(acceptedResponse({ company_confidence: "Low" }));
  }, /High or Medium confidence/);
});

test("CV threshold validation preserves weak and strong outcomes", function () {
  const context = loadScripts(["ApiClient.js"]);
  const validate = context.jmValidateApiResponse_;

  assert.doesNotThrow(function () {
    validate(
      acceptedResponse({
        match_percentage: 69,
        match_level: "Weak",
        decision: "Skip",
      }),
    );
  });
  assert.doesNotThrow(function () {
    validate(
      acceptedResponse({
        match_percentage: 90,
        match_level: "Strong",
        decision: "Apply",
      }),
    );
  });
});

test("SheetWriter persists V2 fields without object coercion", function () {
  const writes = {};
  const links = {};
  const richTextFactory = {
    newRichTextValue() {
      let textValue = "";
      const linkValues = [];

      return {
        setText(value) {
          textValue = value;
          return this;
        },
        setLinkUrl(start, end, url) {
          linkValues.push({ start, end, url });
          return this;
        },
        build() {
          return { text: textValue, links: linkValues };
        },
      };
    },
  };
  const context = loadScripts(["Config.js", "SheetWriter.js"], {
    SpreadsheetApp: richTextFactory,
  });
  const headers = vm.runInContext(
    "Array.from(JOB_MATCH_CONFIG.trackerColumns)",
    context,
  );
  const sheet = {
    getLastColumn() {
      return headers.length;
    },
    getRange(row, column) {
      const header = headers[column - 1];

      return {
        getDisplayValues() {
          return [headers];
        },
        setValue(value) {
          writes[header] = value;
          return this;
        },
        setWrap() {
          return this;
        },
        setRichTextValue(value) {
          writes[header] = value.text;
          links[header] = value.links;
          return this;
        },
        clearContent() {
          writes[header] = "";
          return this;
        },
      };
    },
  };

  context.testSheet = sheet;
  context.testResult = acceptedResponse();
  vm.runInContext("jmWriteApiResult_(testSheet, 2, testResult)", context);

  assert.equal(writes["Geography Decision"], "Accepted");
  assert.equal(writes["Company Quality Score"], 84);
  assert.equal(
    writes["Company Quality Reasons"],
    "Large established organisation.",
  );
  assert.equal(
    writes["Company Sources"],
    "https://company.example/report\nhttps://regulator.example/record",
  );
  assert.equal(links["Company Sources"].length, 2);
  assert.equal(writes["Company Sources"].includes("[object Object]"), false);
});

test("payment formulas require every V2 eligibility control", function () {
  const formulas = {};
  const context = loadScripts(["Config.js", "SheetSetup.js"]);
  const headers = vm.runInContext(
    "Array.from(JOB_MATCH_CONFIG.trackerColumns)",
    context,
  );
  const sheet = {
    getLastColumn() {
      return headers.length;
    },
    getRange(row, column) {
      const header = headers[column - 1];

      return {
        getDisplayValues() {
          return [headers];
        },
        setFormulas(values) {
          formulas[header] = values;
          return this;
        },
      };
    },
  };

  context.testSheet = sheet;
  vm.runInContext("setupApplyTrackerFormulas_(testSheet)", context);

  const eligibilityFormula = formulas["Payment Eligibility"][0][0];
  const rateFormula = formulas["Payment Rate"][0][0];
  const requiredHeaders = [
    "Date of Application",
    "Application Status",
    "Submission Proof Link",
    "Duplicate Status",
    "Analysis Status",
    "Geography Decision",
    "Role Ceiling Decision",
    "Company Quality Decision",
    "Decision",
    "Tailoring Completed?",
    "Quality Review",
  ];

  requiredHeaders.forEach(function (header) {
    const column = headers.indexOf(header) + 1;
    const letter = vm.runInContext(`setupColumnLetter_(${column})`, context);
    assert.match(eligibilityFormula, new RegExp(`\\$${letter}2`));
  });

  assert.match(rateFormula, /"Apply"/);
  assert.match(rateFormula, /"Tailor first"/);
  assert.match(rateFormula, /,200,0\)$/);
});

test("repair reorders V2 columns and preserves existing row data", function () {
  const context = loadScripts(["Config.js", "SheetSetup.js"]);
  const requiredColumns = vm.runInContext(
    "Array.from(JOB_MATCH_CONFIG.trackerColumns)",
    context,
  );
  let headers = ["Company Tier", ...Array.from(requiredColumns).reverse()];
  let rowData = headers.map(function (header) {
    return `value:${header}`;
  });
  const sheet = {
    getLastColumn() {
      return headers.length;
    },
    getMaxRows() {
      return 2;
    },
    getRange(row, column = 1, rowCount = 1, columnCount = headers.length) {
      return {
        column,
        getDisplayValues() {
          return [headers.slice(column - 1, column - 1 + columnCount)];
        },
        setValues(values) {
          headers.splice(column - 1, values[0].length, ...values[0]);
          return this;
        },
      };
    },
    moveColumns(range, destination) {
      const source = range.column - 1;
      const movedHeader = headers.splice(source, 1)[0];
      const movedValue = rowData.splice(source, 1)[0];

      headers.splice(destination - 1, 0, movedHeader);
      rowData.splice(destination - 1, 0, movedValue);
    },
  };

  context.testSheet = sheet;
  vm.runInContext("setupMarkLegacyTrackerHeaders_(testSheet)", context);
  vm.runInContext("setupReorderTrackerColumns_(testSheet)", context);

  assert.deepEqual(
    headers.slice(0, requiredColumns.length),
    Array.from(requiredColumns),
  );
  assert.equal(headers.at(-1), "Legacy - Company Tier");
  assert.equal(rowData[headers.indexOf("Company Name")], "value:Company Name");
  assert.equal(rowData.at(-1), "value:Company Tier");
});

test("payment repair migrates legacy headers and status values in place", function () {
  const context = loadScripts(["Config.js", "SheetSetup.js"]);
  let rows = [
    ["Week Start", "Week End", "Valid Applications", "Payment Due", "Paid?"],
    ["2026-08-17", "2026-08-23", 4, 800, "Yes"],
  ];
  const sheet = {
    getLastColumn() {
      return rows[0].length;
    },
    getLastRow() {
      return rows.length;
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        getDisplayValues() {
          return rows.slice(row - 1, row - 1 + rowCount).map(function (values) {
            return values.slice(column - 1, column - 1 + columnCount);
          });
        },
        setValues(values) {
          values.forEach(function (newValues, rowOffset) {
            newValues.forEach(function (value, columnOffset) {
              rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
      };
    },
  };

  context.testSheet = sheet;
  vm.runInContext("setupMigratePaymentSummaryHeaders_(testSheet)", context);

  assert.deepEqual(rows[0], [
    "Week Start",
    "Week End",
    "Eligible Applications",
    "Total Payment Due",
    "Payment Status",
  ]);
  assert.deepEqual(rows[1], ["2026-08-17", "2026-08-23", 4, 800, "Paid"]);
});

test("confirmed duplicate stops before the API call", function () {
  let apiCalls = 0;
  const ui = {
    ButtonSet: { OK: "OK" },
    alert() {},
  };
  const sheet = {
    getName() {
      return "Sheet1";
    },
    getActiveRange() {
      return { getRow: () => 2 };
    },
  };
  const context = loadScripts(["Config.js", "Code.js"], {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return { getActiveSheet: () => sheet };
      },
      getUi() {
        return ui;
      },
      flush() {},
    },
    jmEnsureRequiredColumns_() {},
    duplicateEnsureOutputColumns_() {},
    jmClearAnalysisResult_() {},
    jmWriteAnalysisStatus_() {},
    duplicateCheckRow_() {
      return {
        state: "duplicate",
        matchedRow: 1,
        reason: "Already submitted.",
      };
    },
    duplicateWriteResult_() {},
    jmCallAnalyzeMatchApi_() {
      apiCalls += 1;
    },
  });

  context.analyzeSelectedRow();
  assert.equal(apiCalls, 0);
});
