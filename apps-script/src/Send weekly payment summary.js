function sendWeeklyPaymentSummary() {
  const OWNER_EMAIL = "okpalaogochukwu76@gmail.com";
  const Assistants_EMAIL = "preciousnzechukwu@gmail.com";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Payment Summary");

  if (!sheet) {
    throw new Error("Payment Summary sheet not found.");
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const startCol = headers.indexOf("Week Start");
  const endCol = headers.indexOf("Week End");
  const eligibleCol = headers.indexOf("Eligible Applications");
  const paymentCol = headers.indexOf("Total Payment Due");
  const statusCol = headers.indexOf("Payment Status");

  if (
    startCol === -1 ||
    endCol === -1 ||
    eligibleCol === -1 ||
    paymentCol === -1 ||
    statusCol === -1
  ) {
    throw new Error("Payment Summary is missing required V2 columns.");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the week that ended before today
  let targetRow = null;

  for (let i = 1; i < data.length; i++) {
    const weekEnd = data[i][endCol];

    if (weekEnd instanceof Date) {
      const endDate = new Date(weekEnd);
      endDate.setHours(0, 0, 0, 0);

      const nextDay = new Date(endDate);
      nextDay.setDate(endDate.getDate() + 1);

      if (today.getTime() === nextDay.getTime()) {
        targetRow = data[i];
        break;
      }
    }
  }

  if (!targetRow) {
    return;
  }

  const weekStart = formatDate(targetRow[startCol]);
  const weekEnd = formatDate(targetRow[endCol]);
  const eligibleApplications = targetRow[eligibleCol];
  const paymentDue = targetRow[paymentCol];
  const paymentStatus = targetRow[statusCol];

  const subject = `Weekly Application Payment Summary - ${weekStart}`;

  const body = `
Hello,

Here is the weekly job application payment summary.

Period: ${weekStart} - ${weekEnd}

Eligible Applications: ${eligibleApplications}
Total Payment Due: ₦${Number(paymentDue).toLocaleString()}
Payment Status: ${paymentStatus}

Payment Rule:
₦200 per eligible submitted application.
Tailor-first applications qualify only after tailoring is completed.
Skip decision: ₦0.

Please review this summary and update the payment status in the sheet.

Thank you.
`;

  MailApp.sendEmail({
    to: OWNER_EMAIL + "," + Assistants_EMAIL,
    subject: subject,
    body: body,
  });
}

function formatDate(date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timeZone = ss.getSpreadsheetTimeZone();

  return Utilities.formatDate(new Date(date), timeZone, "dd-MM-yyyy");
}
