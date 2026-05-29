function openSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (e) {
    throw new Error(
      'Cannot open spreadsheet ' + CONFIG.SPREADSHEET_ID +
      '. Share it with the Apps Script deployer account (Editor access).'
    );
  }
}

function getHeaders_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  if (sheet.getLastRow() < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
}

function headerIndexMap_(headers) {
  var map = {};
  headers.forEach(function (h, i) {
    if (h) map[h] = i;
  });
  return map;
}

function rowToObject_(headers, row) {
  var obj = {};
  headers.forEach(function (h, i) {
    if (h) obj[h] = row[i] !== undefined && row[i] !== null ? row[i] : '';
  });
  return obj;
}

function schemaIsReady_() {
  try {
    var ss = openSpreadsheet_();
    return Object.keys(CONFIG.SCHEMA).every(function (sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 1) return false;
      var headers = getHeaders_(sheet);
      return CONFIG.SCHEMA[sheetName].every(function (header) {
        return headers.indexOf(header) !== -1;
      });
    });
  } catch (e) {
    return false;
  }
}

function ensureSchemaIfNeeded_() {
  if (schemaIsReady_()) return false;
  ensureSchema();
  return true;
}

function getSheet_(name) {
  ensureSchemaIfNeeded_();
  var sheet = openSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    ensureSchema();
    sheet = openSpreadsheet_().getSheetByName(name);
  }
  if (!sheet) {
    throw new Error('Sheet not found after setup: ' + name);
  }
  return sheet;
}

function ensureSchema() {
  var ss = openSpreadsheet_();
  Object.keys(CONFIG.SCHEMA).forEach(function (sheetName) {
    var headers = CONFIG.SCHEMA[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    var headerRow = sheet.getLastRow() >= 1
      ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
      : [];
    var hasAnyHeader = headerRow.some(function (cell) {
      return String(cell || '').trim() !== '';
    });
    if (!hasAnyHeader) {
      sheet.clear();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      var existing = headerRow.map(function (h) { return String(h || '').trim(); });
      var missing = headers.filter(function (header) {
        return existing.indexOf(header) === -1;
      });
      if (missing.length) {
        var startCol = existing.length + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      }
      sheet.setFrozenRows(1);
    }
  });
}

function getDataRowCount_(sheet) {
  var lastRow = sheet.getLastRow();
  return lastRow >= 2 ? lastRow - 1 : 0;
}

function readSheetObjects_(sheetName) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var numRows = getDataRowCount_(sheet);
  if (numRows < 1) return [];
  var values = sheet.getRange(2, 1, numRows, headers.length).getValues();
  return values.map(function (row) {
    return rowToObject_(headers, row);
  });
}

function appendRowObject_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
  sheet.appendRow(row);
}

function updateRowByKey_(sheetName, keyField, keyValue, updates) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1) return false;
  if (sheet.getLastRow() < 2) return false;

  var numRows = getDataRowCount_(sheet);
  var data = sheet.getRange(2, 1, numRows, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][keyIndex]) === String(keyValue)) {
      headers.forEach(function (h, col) {
        if (updates.hasOwnProperty(h)) {
          data[i][col] = updates[h];
        }
      });
      sheet.getRange(i + 2, 1, 1, headers.length).setValues([data[i]]);
      return true;
    }
  }
  return false;
}

function findRowIndexByKey_(sheetName, keyField, keyValue) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1 || sheet.getLastRow() < 2) return -1;
  var numRows = getDataRowCount_(sheet);
  var data = sheet.getRange(2, 1, numRows, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][keyIndex]) === String(keyValue)) return i + 2;
  }
  return -1;
}

// --- Jobs ---

function normalizeJob_(row) {
  return {
    job_id: String(row['Job ID'] || ''),
    title: String(row['Title'] || ''),
    description: String(row['Description'] || ''),
    skills: String(row['Skills'] || ''),
    resume_folder_id: String(row['Resume Folder ID'] || ''),
    resume_folder_url: String(row['Resume Folder URL'] || ''),
    created_at: String(row['Created At'] || '')
  };
}

function listJobs_() {
  return readSheetObjects_(CONFIG.SHEETS.JOBS).map(normalizeJob_);
}

function getJobById_(jobId) {
  var jobs = listJobs_().filter(function (j) {
    return j.job_id === String(jobId);
  });
  return jobs.length ? jobs[0] : null;
}

function createJobRecord_(record) {
  appendRowObject_(CONFIG.SHEETS.JOBS, {
    'Job ID': record.job_id,
    'Title': record.title,
    'Description': record.description,
    'Skills': record.skills,
    'Resume Folder ID': record.resume_folder_id,
    'Resume Folder URL': record.resume_folder_url,
    'Created At': record.created_at
  });
}

function updateJobRecord_(jobId, updates) {
  var sheetUpdates = {};
  if (updates.title !== undefined) sheetUpdates['Title'] = updates.title;
  if (updates.description !== undefined) sheetUpdates['Description'] = updates.description;
  if (updates.skills !== undefined) sheetUpdates['Skills'] = updates.skills;
  if (updates.resume_folder_id !== undefined) sheetUpdates['Resume Folder ID'] = updates.resume_folder_id;
  if (updates.resume_folder_url !== undefined) sheetUpdates['Resume Folder URL'] = updates.resume_folder_url;
  return updateRowByKey_(CONFIG.SHEETS.JOBS, 'Job ID', jobId, sheetUpdates);
}

function ensureJobFolder_(jobId) {
  var job = getJobById_(jobId);
  if (!job) throw new Error('Job not found: ' + jobId);
  if (job.resume_folder_id) {
    try {
      DriveApp.getFolderById(job.resume_folder_id);
      return job;
    } catch (e) {
      Logger.log('Job folder missing, recreating: ' + e.message);
    }
  }
  var folder = createJobFolder_(jobId, job.title);
  updateJobRecord_(jobId, {
    resume_folder_id: folder.folderId,
    resume_folder_url: folder.folderUrl
  });
  return getJobById_(jobId);
}

// --- Candidates ---

function normalizeCandidate_(row) {
  return {
    candidate_id: String(row['Candidate ID'] || ''),
    job_id: String(row['Job ID'] || ''),
    first_name: String(row['First Name'] || ''),
    last_name: String(row['Last Name'] || ''),
    email: String(row['Email'] || ''),
    location: String(row['Location'] || ''),
    resume_file_name: String(row['Resume File Name'] || ''),
    resume_url: String(row['Resume URL'] || ''),
    parsed_text: String(row['Parsed Text'] || ''),
    imported_at: String(row['Imported At'] || ''),
    display_name: formatCandidateName_(
      row['First Name'],
      row['Last Name'],
      filenameStem_(row['Resume File Name'])
    )
  };
}

function listCandidatesForJob_(jobId) {
  return readSheetObjects_(CONFIG.SHEETS.CANDIDATES)
    .filter(function (row) { return String(row['Job ID']) === String(jobId); })
    .map(normalizeCandidate_);
}

function getCandidateById_(candidateId) {
  var rows = readSheetObjects_(CONFIG.SHEETS.CANDIDATES).filter(function (row) {
    return String(row['Candidate ID']) === String(candidateId);
  });
  return rows.length ? normalizeCandidate_(rows[0]) : null;
}

function candidateExistsForFile_(jobId, fileId) {
  var url = buildDriveFileUrl_(fileId);
  return readSheetObjects_(CONFIG.SHEETS.CANDIDATES).some(function (row) {
    if (String(row['Job ID']) !== String(jobId)) return false;
    var existingId = extractDriveFileId_(row['Resume URL']);
    return existingId === fileId || String(row['Resume URL']) === url;
  });
}

function createCandidateRecord_(record) {
  appendRowObject_(CONFIG.SHEETS.CANDIDATES, {
    'Candidate ID': record.candidate_id,
    'Job ID': record.job_id,
    'First Name': record.first_name,
    'Last Name': record.last_name,
    'Email': record.email,
    'Location': record.location,
    'Resume File Name': record.resume_file_name,
    'Resume URL': record.resume_url,
    'Parsed Text': record.parsed_text,
    'Imported At': record.imported_at
  });
}

function updateCandidateRecord_(candidateId, updates) {
  var sheetUpdates = {};
  var map = {
    job_id: 'Job ID',
    first_name: 'First Name',
    last_name: 'Last Name',
    email: 'Email',
    location: 'Location',
    resume_file_name: 'Resume File Name',
    resume_url: 'Resume URL',
    parsed_text: 'Parsed Text',
    imported_at: 'Imported At'
  };
  Object.keys(map).forEach(function (key) {
    if (updates.hasOwnProperty(key)) {
      sheetUpdates[map[key]] = updates[key];
    }
  });
  return updateRowByKey_(CONFIG.SHEETS.CANDIDATES, 'Candidate ID', candidateId, sheetUpdates);
}

// --- Evaluations ---

function normalizeEvaluation_(row) {
  var strengths = [];
  var weaknesses = [];
  try { strengths = JSON.parse(row['Strengths'] || '[]'); } catch (e) { strengths = []; }
  try { weaknesses = JSON.parse(row['Weaknesses'] || '[]'); } catch (e) { weaknesses = []; }
  if (!Array.isArray(strengths)) strengths = [];
  if (!Array.isArray(weaknesses)) weaknesses = [];

  var recommendedRaw = row['Recommended'];
  var recommended = recommendedRaw === true ||
    String(recommendedRaw).toLowerCase() === 'true';

  return {
    evaluation_id: String(row['Evaluation ID'] || ''),
    job_id: String(row['Job ID'] || ''),
    candidate_id: String(row['Candidate ID'] || ''),
    overall_score: Number(row['Overall Score']) || 0,
    skills_match: Number(row['Skills Match']) || 0,
    experience_match: Number(row['Experience Match']) || 0,
    seniority_match: Number(row['Seniority Match']) || 0,
    education_match: Number(row['Education Match']) || 0,
    strengths: strengths,
    weaknesses: weaknesses,
    summary: String(row['Summary'] || ''),
    recommended: recommended,
    evaluated_at: String(row['Evaluated At'] || '')
  };
}

function listEvaluationsForJob_(jobId) {
  return readSheetObjects_(CONFIG.SHEETS.EVALUATIONS)
    .filter(function (row) { return String(row['Job ID']) === String(jobId); })
    .map(normalizeEvaluation_);
}

function getEvaluationForCandidateJob_(jobId, candidateId) {
  var rows = readSheetObjects_(CONFIG.SHEETS.EVALUATIONS).filter(function (row) {
    return String(row['Job ID']) === String(jobId) &&
      String(row['Candidate ID']) === String(candidateId);
  });
  return rows.length ? normalizeEvaluation_(rows[0]) : null;
}

function createEvaluationRecord_(record) {
  appendRowObject_(CONFIG.SHEETS.EVALUATIONS, {
    'Evaluation ID': record.evaluation_id,
    'Job ID': record.job_id,
    'Candidate ID': record.candidate_id,
    'Overall Score': record.overall_score,
    'Skills Match': record.skills_match,
    'Experience Match': record.experience_match,
    'Seniority Match': record.seniority_match,
    'Education Match': record.education_match,
    'Strengths': JSON.stringify(record.strengths || []),
    'Weaknesses': JSON.stringify(record.weaknesses || []),
    'Summary': record.summary,
    'Recommended': record.recommended,
    'Evaluated At': record.evaluated_at
  });
}

function getRankedEvaluationsForJob_(jobId) {
  var evaluations = listEvaluationsForJob_(jobId);
  var candidates = listCandidatesForJob_(jobId);
  var candidateMap = {};
  candidates.forEach(function (c) {
    candidateMap[c.candidate_id] = c;
  });

  return evaluations
    .map(function (ev) {
      var cand = candidateMap[ev.candidate_id] || {};
      return {
        evaluation_id: ev.evaluation_id,
        candidate_id: ev.candidate_id,
        job_id: ev.job_id,
        display_name: cand.display_name || 'Unknown',
        first_name: cand.first_name,
        last_name: cand.last_name,
        email: cand.email,
        location: cand.location,
        resume_url: cand.resume_url,
        overall_score: ev.overall_score,
        recommended: ev.recommended,
        summary: ev.summary,
        strengths: ev.strengths,
        weaknesses: ev.weaknesses,
        skills_match: ev.skills_match,
        experience_match: ev.experience_match,
        seniority_match: ev.seniority_match,
        education_match: ev.education_match,
        evaluated_at: ev.evaluated_at
      };
    })
    .sort(function (a, b) {
      return b.overall_score - a.overall_score;
    });
}

// --- Queue ---

function normalizeQueueItem_(row) {
  return {
    queue_id: String(row['Queue ID'] || ''),
    candidate_id: String(row['Candidate ID'] || ''),
    job_id: String(row['Job ID'] || ''),
    task_type: String(row['Task Type'] || ''),
    status: String(row['Status'] || ''),
    error: String(row['Error'] || ''),
    started_at: String(row['Started At'] || ''),
    finished_at: String(row['Finished At'] || ''),
    retry_count: Number(row['Retry Count']) || 0
  };
}

function listQueueItems_() {
  return readSheetObjects_(CONFIG.SHEETS.QUEUE).map(normalizeQueueItem_);
}

function listQueueItemsForJob_(jobId) {
  return listQueueItems_().filter(function (q) {
    return String(q.job_id) === String(jobId);
  });
}

function getQueueItemById_(queueId) {
  var rows = listQueueItems_().filter(function (q) {
    return q.queue_id === String(queueId);
  });
  return rows.length ? rows[0] : null;
}

function createQueueRecord_(record) {
  appendRowObject_(CONFIG.SHEETS.QUEUE, {
    'Queue ID': record.queue_id,
    'Candidate ID': record.candidate_id,
    'Job ID': record.job_id,
    'Task Type': record.task_type,
    'Status': record.status,
    'Error': record.error || '',
    'Started At': record.started_at || '',
    'Finished At': record.finished_at || '',
    'Retry Count': record.retry_count || 0
  });
}

function updateQueueRecord_(queueId, updates) {
  var sheetUpdates = {};
  var map = {
    candidate_id: 'Candidate ID',
    job_id: 'Job ID',
    task_type: 'Task Type',
    status: 'Status',
    error: 'Error',
    started_at: 'Started At',
    finished_at: 'Finished At',
    retry_count: 'Retry Count'
  };
  Object.keys(map).forEach(function (key) {
    if (updates.hasOwnProperty(key)) {
      sheetUpdates[map[key]] = updates[key];
    }
  });
  return updateRowByKey_(CONFIG.SHEETS.QUEUE, 'Queue ID', queueId, sheetUpdates);
}

function hasActiveQueueItem_(candidateId, jobId, taskType) {
  var active = [CONFIG.QUEUE_STATUS.PENDING, CONFIG.QUEUE_STATUS.PROCESSING];
  return listQueueItems_().some(function (q) {
    return q.candidate_id === String(candidateId) &&
      q.job_id === String(jobId) &&
      q.task_type === String(taskType) &&
      active.indexOf(q.status) !== -1;
  });
}

function getQueueStatusCounts_(jobId) {
  var items = jobId ? listQueueItemsForJob_(jobId) : listQueueItems_();
  var statuses = [
    CONFIG.QUEUE_STATUS.PENDING,
    CONFIG.QUEUE_STATUS.PROCESSING,
    CONFIG.QUEUE_STATUS.COMPLETED,
    CONFIG.QUEUE_STATUS.FAILED
  ];
  var emptyCounts = function () {
    var c = {};
    statuses.forEach(function (s) { c[s] = 0; });
    return c;
  };

  var result = {
    parse: emptyCounts(),
    evaluate: emptyCounts(),
    total: emptyCounts()
  };

  items.forEach(function (item) {
    var bucket = item.task_type === CONFIG.TASK_TYPE.EVALUATE ? 'evaluate' : 'parse';
    if (result[bucket][item.status] !== undefined) {
      result[bucket][item.status] += 1;
      result.total[item.status] += 1;
    }
  });

  return result;
}

function getPendingQueueItems_(limit) {
  var pending = listQueueItems_().filter(function (q) {
    return q.status === CONFIG.QUEUE_STATUS.PENDING;
  });

  var retriable = listQueueItems_().filter(function (q) {
    return q.status === CONFIG.QUEUE_STATUS.FAILED &&
      q.retry_count < CONFIG.MAX_RETRIES;
  });

  var combined = pending.concat(retriable);
  combined.sort(function (a, b) {
    if (a.task_type !== b.task_type) {
      if (a.task_type === CONFIG.TASK_TYPE.PARSE) return -1;
      if (b.task_type === CONFIG.TASK_TYPE.PARSE) return 1;
    }
    return 0;
  });

  return combined.slice(0, limit || CONFIG.BATCH_SIZE);
}
