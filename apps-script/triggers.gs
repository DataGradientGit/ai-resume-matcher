var QUEUE_TRIGGER_HANDLER_ = 'processQueueBatch_';

function ensureTriggerInstalled_() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function (trigger) {
    return trigger.getHandlerFunction() === QUEUE_TRIGGER_HANDLER_;
  });
  if (exists) return { installed: true, created: false };

  ScriptApp.newTrigger(QUEUE_TRIGGER_HANDLER_)
    .timeBased()
    .everyMinutes(1)
    .create();

  return { installed: true, created: true };
}

function removeQueueTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === QUEUE_TRIGGER_HANDLER_) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function repairTriggers_() {
  removeQueueTriggers_();
  return ensureTriggerInstalled_();
}

function installQueueTrigger() {
  return ensureTriggerInstalled_();
}

function repairQueueTriggers() {
  return repairTriggers_();
}
