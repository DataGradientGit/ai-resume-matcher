function onOpen() {
  try {
    ensureSchemaIfNeeded_();
  } catch (e) {
    Logger.log('Schema init on open failed: ' + e.message);
  }

  SpreadsheetApp.getUi()
    .createMenu('AI Resume Matcher')
    .addItem('Initialize / repair sheets', 'ensureSchema')
    .addItem('Install queue trigger', 'installQueueTrigger')
    .addItem('Repair queue triggers', 'repairQueueTriggers')
    .addItem('Process queue now', 'processQueueBatch_')
    .addToUi();
}

function doGet() {
  ensureSchemaIfNeeded_();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('AI Resume Matcher')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
