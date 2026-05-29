var CONFIG = {
  SPREADSHEET_ID: '1ZEWgvTHh2Pw1uEaJ5x-YhzP0m7phLiCWBuNgQtlNkt0',
  RESUME_ROOT_FOLDER_ID: '1E6XaiBVnTnq6Oy0xFYrtRH5Ms9a8gDRn',
  DEFAULT_OPENROUTER_MODEL: 'google/gemini-2.0-flash-001',
  BATCH_SIZE: 5,
  MAX_RETRIES: 1,
  RESUME_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  SHEETS: {
    JOBS: 'Jobs',
    CANDIDATES: 'Candidates',
    EVALUATIONS: 'Evaluations',
    QUEUE: 'Queue'
  },
  SCHEMA: {
    Jobs: [
      'Job ID', 'Title', 'Description', 'Skills',
      'Resume Folder ID', 'Resume Folder URL', 'Created At'
    ],
    Candidates: [
      'Candidate ID', 'Job ID', 'First Name', 'Last Name', 'Email', 'Location',
      'Resume File Name', 'Resume URL', 'Parsed Text', 'Imported At'
    ],
    Evaluations: [
      'Evaluation ID', 'Job ID', 'Candidate ID', 'Overall Score',
      'Skills Match', 'Experience Match', 'Seniority Match', 'Education Match',
      'Strengths', 'Weaknesses', 'Summary', 'Recommended', 'Evaluated At'
    ],
    Queue: [
      'Queue ID', 'Candidate ID', 'Job ID', 'Task Type', 'Status', 'Error',
      'Started At', 'Finished At', 'Retry Count'
    ]
  },
  QUEUE_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  },
  TASK_TYPE: {
    PARSE: 'parse',
    EVALUATE: 'evaluate'
  },
  SCORE_WEIGHTS: {
    skills: 0.40,
    experience: 0.35,
    seniority: 0.15,
    education: 0.10
  }
};

function getScriptProperty_(key, defaultValue) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (value === null || value === '') {
    return defaultValue !== undefined ? defaultValue : '';
  }
  return value;
}

function getOpenRouterApiKey_() {
  return getScriptProperty_('OPENROUTER_API_KEY', '');
}

function getOpenRouterModel_() {
  return getScriptProperty_('OPENROUTER_MODEL', CONFIG.DEFAULT_OPENROUTER_MODEL);
}

function generateId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function nowIso_() {
  return new Date().toISOString();
}

function buildDriveFolderUrl_(folderId) {
  return 'https://drive.google.com/drive/folders/' + String(folderId);
}

function buildDriveFileUrl_(fileId) {
  return 'https://drive.google.com/file/d/' + String(fileId) + '/view';
}

function extractDriveFileId_(url) {
  if (!url) return '';
  var value = String(url);
  var fileIdMatch = value.match(/\/file\/d\/([^/]+)/i);
  if (fileIdMatch) return fileIdMatch[1];
  var idMatch = value.match(/[?&]id=([^&]+)/i);
  if (idMatch) return decodeURIComponent(idMatch[1]);
  return '';
}

function extractFolderIdFromUrl_(url) {
  if (!url) return '';
  var value = String(url);
  var match = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]+$/.test(value.trim())) return value.trim();
  return '';
}

function sanitizeFolderName_(name) {
  return String(name || 'Untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function createJobFolder_(jobId, title) {
  var root = DriveApp.getFolderById(CONFIG.RESUME_ROOT_FOLDER_ID);
  var folderName = sanitizeFolderName_(jobId + ' - ' + (title || 'Job'));
  var folder = root.createFolder(folderName);
  return {
    folderId: folder.getId(),
    folderUrl: buildDriveFolderUrl_(folder.getId())
  };
}

function cleanResumeText_(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractJsonObject_(content) {
  var text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // fall through
  }
  var match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e2) {
    return null;
  }
}

function clampScore_(value, min, max) {
  var num = Number(value);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function computeWeightedOverallScore_(skills, experience, seniority, education) {
  var s = clampScore_(skills, 1, 5);
  var e = clampScore_(experience, 1, 5);
  var sen = clampScore_(seniority, 1, 5);
  var ed = clampScore_(education, 1, 5);
  var overall = (
    s * CONFIG.SCORE_WEIGHTS.skills +
    e * CONFIG.SCORE_WEIGHTS.experience +
    sen * CONFIG.SCORE_WEIGHTS.seniority +
    ed * CONFIG.SCORE_WEIGHTS.education
  );
  return Math.round(clampScore_(overall, 1, 5) * 10) / 10;
}

function formatCandidateName_(firstName, lastName, fallback) {
  var first = String(firstName || '').trim();
  var last = String(lastName || '').trim();
  if (first && last) return first + ' ' + last;
  if (first) return first;
  if (last) return last;
  return String(fallback || 'Unknown').trim() || 'Unknown';
}

function filenameStem_(filename) {
  var name = String(filename || '').trim();
  var dot = name.lastIndexOf('.');
  if (dot > 0) return name.slice(0, dot);
  return name;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function truncateText_(text, maxLen) {
  var value = String(text || '');
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + '…';
}

function uiSuccess_(data) {
  return { ok: true, data: data || {}, error: '' };
}

function uiError_(message, data) {
  return { ok: false, data: data || {}, error: String(message || 'Unknown error') };
}

function wrapUi_(fn) {
  try {
    var result = fn();
    if (result && result.ok === false) {
      return result;
    }
    if (result && result.ok === true) {
      return result;
    }
    return uiSuccess_(result);
  } catch (e) {
    Logger.log('UI error: ' + e.message + '\n' + e.stack);
    return uiError_(e.message);
  }
}
