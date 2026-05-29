function enqueueParseTask_(candidateId, jobId) {
  if (hasActiveQueueItem_(candidateId, jobId, CONFIG.TASK_TYPE.PARSE)) {
    return null;
  }
  var queueId = generateId_('queue');
  createQueueRecord_({
    queue_id: queueId,
    candidate_id: candidateId,
    job_id: jobId,
    task_type: CONFIG.TASK_TYPE.PARSE,
    status: CONFIG.QUEUE_STATUS.PENDING,
    error: '',
    started_at: '',
    finished_at: '',
    retry_count: 0
  });
  return queueId;
}

function enqueueEvaluateTask_(candidateId, jobId) {
  if (hasActiveQueueItem_(candidateId, jobId, CONFIG.TASK_TYPE.EVALUATE)) {
    return null;
  }
  if (getEvaluationForCandidateJob_(jobId, candidateId)) {
    return null;
  }
  var queueId = generateId_('queue');
  createQueueRecord_({
    queue_id: queueId,
    candidate_id: candidateId,
    job_id: jobId,
    task_type: CONFIG.TASK_TYPE.EVALUATE,
    status: CONFIG.QUEUE_STATUS.PENDING,
    error: '',
    started_at: '',
    finished_at: '',
    retry_count: 0
  });
  return queueId;
}

function importResumesForJob_(jobId) {
  var job = ensureJobFolder_(jobId);
  var folderId = job.resume_folder_id;
  if (!folderId) {
    throw new Error('Job resume folder is not configured.');
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error(
      'Cannot access job folder. Share the resume root folder with the script owner.'
    );
  }

  var imported = 0;
  var parseQueued = 0;
  var skipped = 0;
  var files = folder.getFiles();

  while (files.hasNext()) {
    var file = files.next();
    var mime = file.getMimeType();
    if (CONFIG.RESUME_MIME_TYPES.indexOf(mime) === -1) {
      skipped += 1;
      continue;
    }

    var fileId = file.getId();
    if (candidateExistsForFile_(jobId, fileId)) {
      skipped += 1;
      continue;
    }

    var candidateId = generateId_('cand');
    createCandidateRecord_({
      candidate_id: candidateId,
      job_id: jobId,
      first_name: filenameStem_(file.getName()),
      last_name: '',
      email: '',
      location: '',
      resume_file_name: file.getName(),
      resume_url: buildDriveFileUrl_(fileId),
      parsed_text: '',
      imported_at: nowIso_()
    });
    imported += 1;

    var queueId = enqueueParseTask_(candidateId, jobId);
    if (queueId) parseQueued += 1;
  }

  if (parseQueued > 0) {
    kickQueueProcessing_(3);
  }

  return {
    imported: imported,
    parseQueued: parseQueued,
    skipped: skipped,
    folder_url: job.resume_folder_url
  };
}

function startAnalysisForJob_(jobId) {
  var candidates = listCandidatesForJob_(jobId);
  var enqueued = 0;
  var skippedNoParse = 0;
  var skippedHasEval = 0;

  candidates.forEach(function (c) {
    if (!String(c.parsed_text || '').trim()) {
      skippedNoParse += 1;
      return;
    }
    if (getEvaluationForCandidateJob_(jobId, c.candidate_id)) {
      skippedHasEval += 1;
      return;
    }
    var queueId = enqueueEvaluateTask_(c.candidate_id, jobId);
    if (queueId) enqueued += 1;
  });

  if (enqueued > 0) {
    kickQueueProcessing_(3);
  }

  return {
    enqueued: enqueued,
    skipped_no_parse: skippedNoParse,
    skipped_has_eval: skippedHasEval,
    total_candidates: candidates.length
  };
}

function processQueueItem_(item) {
  updateQueueRecord_(item.queue_id, {
    status: CONFIG.QUEUE_STATUS.PROCESSING,
    started_at: nowIso_(),
    error: ''
  });

  if (item.task_type === CONFIG.TASK_TYPE.PARSE) {
    var parseResult = processParseTask_(item.candidate_id);
    var parseError = parseResult.warnings && parseResult.warnings.length
      ? parseResult.warnings.join('; ')
      : '';
    updateQueueRecord_(item.queue_id, {
      status: CONFIG.QUEUE_STATUS.COMPLETED,
      finished_at: nowIso_(),
      error: parseError
    });
    return;
  }

  if (item.task_type === CONFIG.TASK_TYPE.EVALUATE) {
    var candidate = getCandidateById_(item.candidate_id);
    if (!candidate || !String(candidate.parsed_text || '').trim()) {
      throw new Error('Cannot evaluate: resume text not parsed yet.');
    }
    evaluateCandidateForJob_(item.candidate_id, item.job_id);
    updateQueueRecord_(item.queue_id, {
      status: CONFIG.QUEUE_STATUS.COMPLETED,
      finished_at: nowIso_(),
      error: ''
    });
    return;
  }

  throw new Error('Unknown task type: ' + item.task_type);
}

function handleQueueItemFailure_(item, errorMessage) {
  var retryCount = (Number(item.retry_count) || 0) + 1;
  if (retryCount > CONFIG.MAX_RETRIES) {
    updateQueueRecord_(item.queue_id, {
      status: CONFIG.QUEUE_STATUS.FAILED,
      finished_at: nowIso_(),
      error: errorMessage,
      retry_count: retryCount
    });
  } else {
    updateQueueRecord_(item.queue_id, {
      status: CONFIG.QUEUE_STATUS.PENDING,
      error: errorMessage,
      retry_count: retryCount,
      started_at: '',
      finished_at: ''
    });
  }
}

function processQueueBatch_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Queue batch skipped: could not acquire lock.');
    return { processed: 0, skipped: true };
  }

  try {
    ensureSchemaIfNeeded_();
    var items = getPendingQueueItems_(CONFIG.BATCH_SIZE);
    var processed = 0;

    items.forEach(function (item) {
      try {
        processQueueItem_(item);
        processed += 1;
      } catch (e) {
        Logger.log('Queue item failed ' + item.queue_id + ': ' + e.message);
        handleQueueItemFailure_(item, e.message);
      }
    });

    return { processed: processed, skipped: false };
  } finally {
    lock.releaseLock();
  }
}

function getQueueStatusForJob_(jobId) {
  var counts = getQueueStatusCounts_(jobId);
  var candidates = listCandidatesForJob_(jobId);
  var parsedCount = candidates.filter(function (c) {
    return String(c.parsed_text || '').trim() !== '';
  }).length;

  return {
    counts: counts,
    candidates_total: candidates.length,
    candidates_parsed: parsedCount,
    candidates_parsing: candidates.length - parsedCount
  };
}

function getCandidateStatsForJob_(jobId) {
  var candidates = listCandidatesForJob_(jobId);
  var parsed = candidates.filter(function (c) {
    return String(c.parsed_text || '').trim() !== '';
  });
  return {
    total: candidates.length,
    parsed: parsed.length,
    unparsed: candidates.length - parsed.length
  };
}

/** Install trigger and run queue batches immediately (no wait for 1-min trigger). */
function kickQueueProcessing_(maxBatches) {
  ensureTriggerInstalled_();
  maxBatches = maxBatches || 2;
  var totalProcessed = 0;
  var startMs = Date.now();
  var maxMs = 270000;

  for (var i = 0; i < maxBatches; i++) {
    if (Date.now() - startMs > maxMs) break;
    if (!getPendingQueueItems_(1).length) break;
    var result = processQueueBatch_();
    totalProcessed += result.processed || 0;
    if (!result.processed) break;
  }

  return {
    processed: totalProcessed,
    trigger_installed: true,
    pending_remaining: getPendingQueueItems_(1).length > 0
  };
}

/** Reset failed queue rows to pending so they run again after a fix (e.g. new OAuth scope). */
function requeueFailedTasksForJob_(jobId, taskType) {
  var count = 0;
  listQueueItemsForJob_(jobId).forEach(function (item) {
    if (item.status !== CONFIG.QUEUE_STATUS.FAILED) return;
    if (taskType && item.task_type !== taskType) return;
    updateQueueRecord_(item.queue_id, {
      status: CONFIG.QUEUE_STATUS.PENDING,
      error: '',
      retry_count: 0,
      started_at: '',
      finished_at: ''
    });
    count += 1;
  });
  if (count > 0) {
    kickQueueProcessing_(3);
  }
  return { requeued: count };
}
