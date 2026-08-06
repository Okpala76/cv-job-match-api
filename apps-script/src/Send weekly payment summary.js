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

  const weekCol = headers.indexOf("Week");
  const startCol = headers.indexOf("Week Start");
  const endCol = headers.indexOf("Week End");
  const totalCol = headers.indexOf("Total Applications");
  const validCol = headers.indexOf("Valid Applications");
  const paymentCol = headers.indexOf("Payment Due");
  const confirmedCol = headers.indexOf("Confirmation");
  const paidCol = headers.indexOf("Paid?");

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

  const week = targetRow[weekCol];
  const weekStart = formatDate(targetRow[startCol]);
  const weekEnd = formatDate(targetRow[endCol]);
  const totalApplications = targetRow[totalCol];
  const validApplications = targetRow[validCol];
  const paymentDue = targetRow[paymentCol];
  const assistantsConfirmation = targetRow[confirmedCol];
  const paidStatus = targetRow[paidCol];

  const subject = `Weekly Application Payment Summary - ${week}`;

  const body = `
Hello,

Here is the weekly job application payment summary.

Week: ${week}
Period: ${weekStart} - ${weekEnd}

Total Applications: ${totalApplications}
Valid Applications: ${validApplications}
Payment Due: ₦${Number(paymentDue).toLocaleString()}

Assistants Confirmation: ${assistantsConfirmation}
Paid Status: ${paidStatus}

Payment Rule:
₦200 per eligible submitted application.
Tailor-first applications qualify only after tailoring is completed.
Skip decision: ₦0.

Please review this summary and update your confirmation status in the sheet.

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
