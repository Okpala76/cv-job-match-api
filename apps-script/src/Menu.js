function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Job Tools")
    .addItem("Analyze Selected Row", "analyzeSelectedRow")
    .addItem("Check Selected Row for Duplicate", "checkSelectedRowForDuplicate")
    .addToUi();
}
