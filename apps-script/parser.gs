function extractEmailFromText_(text) {
  var match = String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

function parseResumeFromFile_(fileId) {
  var tempDocId = null;
  try {
    var resource = {
      title: 'temp_resume_parse_' + fileId,
      mimeType: MimeType.GOOGLE_DOCS
    };
    var copied = Drive.Files.copy(resource, fileId, { convert: true });
    tempDocId = copied.id;
    var doc = DocumentApp.openById(tempDocId);
    var text = doc.getBody().getText();
    return cleanResumeText_(text);
  } finally {
    if (tempDocId) {
      try {
        DriveApp.getFileById(tempDocId).setTrashed(true);
      } catch (e) {
        Logger.log('Failed to delete temp doc: ' + e.message);
      }
    }
  }
}

function parseResumeForCandidate_(candidateId) {
  var candidate = getCandidateById_(candidateId);
  if (!candidate) throw new Error('Candidate not found: ' + candidateId);

  var parsedText = candidate.parsed_text;
  if (!parsedText) {
    var fileId = extractDriveFileId_(candidate.resume_url);
    if (!fileId) throw new Error('Invalid resume URL for candidate ' + candidateId);
    parsedText = parseResumeFromFile_(fileId);
    updateCandidateRecord_(candidateId, { parsed_text: parsedText });
  }

  return parsedText;
}

function needsProfileExtraction_(candidate) {
  return !String(candidate.first_name || '').trim() ||
    !String(candidate.last_name || '').trim() ||
    !String(candidate.email || '').trim() ||
    !String(candidate.location || '').trim();
}

function mergeProfileFields_(candidate, aiFields, regexEmail) {
  var updates = {};
  var ai = aiFields || {};

  if (!String(candidate.first_name || '').trim() && String(ai.first_name || '').trim()) {
    updates.first_name = String(ai.first_name).trim();
  }
  if (!String(candidate.last_name || '').trim() && String(ai.last_name || '').trim()) {
    updates.last_name = String(ai.last_name).trim();
  }

  var email = String(candidate.email || '').trim();
  if (!email) {
    var aiEmail = String(ai.email || '').trim();
    if (isValidEmail_(aiEmail)) {
      updates.email = aiEmail;
    } else if (isValidEmail_(regexEmail)) {
      updates.email = regexEmail;
    }
  }

  if (!String(candidate.location || '').trim() && String(ai.location || '').trim()) {
    updates.location = String(ai.location).trim();
  }

  return updates;
}

function extractAndSaveCandidateProfile_(candidateId) {
  var candidate = getCandidateById_(candidateId);
  if (!candidate) throw new Error('Candidate not found: ' + candidateId);
  if (!candidate.parsed_text) {
    throw new Error('Parsed text required before profile extraction');
  }

  if (!needsProfileExtraction_(candidate)) {
    return { updated: false, warning: '' };
  }

  var regexEmail = extractEmailFromText_(candidate.parsed_text);
  var warning = '';

  try {
    var aiFields = extractCandidateFields_(candidate.parsed_text);
    var updates = mergeProfileFields_(candidate, aiFields, regexEmail);
    if (Object.keys(updates).length) {
      updateCandidateRecord_(candidateId, updates);
    }
    return { updated: true, warning: '' };
  } catch (e) {
    warning = 'Profile extraction warning: ' + e.message;
    var fallbackUpdates = mergeProfileFields_(candidate, {}, regexEmail);
    if (Object.keys(fallbackUpdates).length) {
      updateCandidateRecord_(candidateId, fallbackUpdates);
    }
    return { updated: false, warning: warning };
  }
}

function processParseTask_(candidateId) {
  var warnings = [];
  parseResumeForCandidate_(candidateId);

  var profileResult = extractAndSaveCandidateProfile_(candidateId);
  if (profileResult.warning) {
    warnings.push(profileResult.warning);
  }

  return {
    ok: true,
    warnings: warnings
  };
}
