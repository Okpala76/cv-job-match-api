function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Job Tools")
    .addItem("Setup / Repair Workbook", "setupWorkbookStructure")
    .addSeparator()
    .addItem("Analyze Selected Row", "analyzeSelectedRow")
    .addItem("Check Selected Row for Duplicate", "checkSelectedRowForDuplicate")
    .addSeparator()
    .addItem("Add Current Payment Week", "addCurrentPaymentWeek")
    .addToUi();
}
