function runEnsureSchema() {
  return wrapUi_(function () {
    ensureSchema();
    return { initialized: true };
  });
}

function bootstrapApp() {
  return wrapUi_(function () {
    ensureSchemaIfNeeded_();
    ensureTriggerInstalled_();
    return {
      spreadsheet_id: CONFIG.SPREADSHEET_ID,
      resume_root_folder_id: CONFIG.RESUME_ROOT_FOLDER_ID,
      evaluation_model: getEvaluationModel_()
    };
  });
}

function listJobs() {
  return wrapUi_(function () {
    return listJobs_();
  });
}

function createJob(payload) {
  return wrapUi_(function () {
    payload = payload || {};
    var title = String(payload.title || '').trim();
    var description = String(payload.description || '').trim();
    var skills = String(payload.skills || '').trim();

    if (!title) throw new Error('Job title is required.');
    if (!description) throw new Error('Job description is required.');

    var jobId = generateId_('job');
    var folder = createJobFolder_(jobId, title);
    var record = {
      job_id: jobId,
      title: title,
      description: description,
      skills: skills,
      resume_folder_id: folder.folderId,
      resume_folder_url: folder.folderUrl,
      created_at: nowIso_()
    };
    createJobRecord_(record);
    return record;
  });
}

function importResumesForJob(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return importResumesForJob_(jobId);
  });
}

function getCandidatesForJob(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return listCandidatesForJob_(jobId);
  });
}

function startAnalysis(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return startAnalysisForJob_(jobId);
  });
}

function getQueueStatus(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return getQueueStatusForJob_(jobId);
  });
}

function getRankedEvaluations(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return getRankedEvaluationsForJob_(jobId);
  });
}

function listOpenRouterModels(forceRefresh, freeOnly, providerPrefix) {
  return wrapUi_(function () {
    return listOpenRouterModels_(forceRefresh === true, freeOnly === true, providerPrefix || '');
  });
}

function getEvaluationModel() {
  return wrapUi_(function () {
    return { model_id: getEvaluationModel_() };
  });
}

function setEvaluationModel(modelId) {
  return wrapUi_(function () {
    var id = setEvaluationModel_(modelId);
    return { model_id: id };
  });
}

function installTriggers() {
  return wrapUi_(function () {
    return installQueueTrigger();
  });
}

function repairTriggers() {
  return wrapUi_(function () {
    return repairQueueTriggers();
  });
}

function reprocessFailedQueue(jobId) {
  return wrapUi_(function () {
    if (!jobId) throw new Error('Job ID is required.');
    return requeueFailedTasksForJob_(jobId, '');
  });
}

function processQueueNow() {
  return wrapUi_(function () {
    return processQueueBatch_();
  });
}
