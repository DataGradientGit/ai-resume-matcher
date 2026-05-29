var OPENROUTER_CHAT_URL_ = 'https://openrouter.ai/api/v1/chat/completions';
var OPENROUTER_MODELS_URL_ = 'https://openrouter.ai/api/v1/models';
var OPENROUTER_MODELS_CACHE_KEY_ = 'arm_openrouter_models_v1';
var OPENROUTER_MODELS_CACHE_SEC_ = 21600;

function callOpenRouter_(messages, temperature) {
  var apiKey = getOpenRouterApiKey_();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured in Script properties.');
  }

  var payload = {
    model: getOpenRouterModel_(),
    messages: messages,
    temperature: temperature !== undefined ? temperature : 0.2
  };

  var response = UrlFetchApp.fetch(OPENROUTER_CHAT_URL_, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://script.google.com',
      'X-Title': 'AI Resume Matcher'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var bodyText = response.getContentText();
  if (code >= 400) {
    throw new Error('OpenRouter request failed (' + code + '): ' + bodyText);
  }

  var body = JSON.parse(bodyText);
  var content = body.choices && body.choices[0] && body.choices[0].message
    ? body.choices[0].message.content
    : '';
  if (!content) {
    throw new Error('OpenRouter returned empty content.');
  }
  return content;
}

function callOpenRouterJson_(systemPrompt, userPrompt, retryPrompt) {
  var content = callOpenRouter_([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 0.2);

  var parsed = extractJsonObject_(content);
  if (parsed) return parsed;

  if (!retryPrompt) {
    throw new Error('AI returned invalid JSON.');
  }

  content = callOpenRouter_([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: content },
    { role: 'user', content: retryPrompt }
  ], 0.1);

  parsed = extractJsonObject_(content);
  if (!parsed) {
    throw new Error('AI returned invalid JSON after retry.');
  }
  return parsed;
}

function extractCandidateFields_(parsedText) {
  var systemPrompt = [
    'You extract structured contact information from resume text.',
    'Return ONLY valid JSON with keys: first_name, last_name, email, location.',
    'Use empty strings when unknown. Do not include markdown or commentary.'
  ].join('\n');

  var userPrompt = 'Extract candidate profile fields from this resume:\n\n' +
    truncateText_(parsedText, 8000);

  var retryPrompt = 'Your previous response was not valid JSON. Return ONLY a JSON object with keys first_name, last_name, email, location.';

  var result = callOpenRouterJson_(systemPrompt, userPrompt, retryPrompt);
  return {
    first_name: String(result.first_name || '').trim(),
    last_name: String(result.last_name || '').trim(),
    email: String(result.email || '').trim(),
    location: String(result.location || '').trim()
  };
}

function evaluateCandidateForJob_(candidateId, jobId) {
  var candidate = getCandidateById_(candidateId);
  if (!candidate) throw new Error('Candidate not found: ' + candidateId);
  if (!candidate.parsed_text) {
    throw new Error('Candidate resume has not been parsed yet.');
  }

  var job = getJobById_(jobId);
  if (!job) throw new Error('Job not found: ' + jobId);

  var systemPrompt = [
    'You are an expert technical recruiter evaluating candidate fit for a job.',
    'Return ONLY valid JSON with keys:',
    'skills_match, experience_match, seniority_match, education_match, strengths, weaknesses, summary, recommended.',
    'Each *_match score must be an integer from 1 to 5.',
    'strengths and weaknesses must be arrays of short strings.',
    'summary must be 2-3 recruiter-friendly sentences.',
    'recommended must be boolean.'
  ].join('\n');

  var userPrompt = [
    'Job Title: ' + job.title,
    'Job Description: ' + job.description,
    'Required Skills: ' + (job.skills || 'Not specified'),
    '',
    'Candidate Resume:',
    truncateText_(candidate.parsed_text, 12000)
  ].join('\n');

  var retryPrompt = 'Return ONLY valid JSON with keys skills_match, experience_match, seniority_match, education_match, strengths, weaknesses, summary, recommended. No markdown.';

  var result = callOpenRouterJson_(systemPrompt, userPrompt, retryPrompt);

  var skills = clampScore_(result.skills_match, 1, 5);
  var experience = clampScore_(result.experience_match, 1, 5);
  var seniority = clampScore_(result.seniority_match, 1, 5);
  var education = clampScore_(result.education_match, 1, 5);
  var overall = computeWeightedOverallScore_(skills, experience, seniority, education);

  var strengths = Array.isArray(result.strengths) ? result.strengths : [];
  var weaknesses = Array.isArray(result.weaknesses) ? result.weaknesses : [];

  var evaluation = {
    evaluation_id: generateId_('eval'),
    job_id: jobId,
    candidate_id: candidateId,
    overall_score: overall,
    skills_match: skills,
    experience_match: experience,
    seniority_match: seniority,
    education_match: education,
    strengths: strengths.map(String),
    weaknesses: weaknesses.map(String),
    summary: String(result.summary || '').trim(),
    recommended: result.recommended === true,
    evaluated_at: nowIso_()
  };

  createEvaluationRecord_(evaluation);
  return evaluation;
}

// --- OpenRouter model list ---

function providerLabelFromModelId_(modelId) {
  var parts = String(modelId || '').split('/');
  var slug = parts[0] || 'other';
  var labels = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    meta: 'Meta',
    'meta-llama': 'Meta',
    mistralai: 'Mistral',
    qwen: 'Qwen',
    deepseek: 'DeepSeek'
  };
  return labels[slug] || slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
}

function normalizeOpenRouterModel_(raw) {
  if (!raw || !raw.id) return null;
  var id = String(raw.id);
  return {
    id: id,
    name: String(raw.name || id),
    provider: providerLabelFromModelId_(id),
    isFree: id.indexOf(':free') !== -1
  };
}

function readModelsCache_() {
  var raw = CacheService.getScriptCache().get(OPENROUTER_MODELS_CACHE_KEY_);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeModelsCache_(models) {
  try {
    CacheService.getScriptCache().put(
      OPENROUTER_MODELS_CACHE_KEY_,
      JSON.stringify({ models: models, fetchedAt: nowIso_() }),
      OPENROUTER_MODELS_CACHE_SEC_
    );
  } catch (e) {
    Logger.log('Model cache write failed: ' + e.message);
  }
}

function fetchOpenRouterModelsFromApi_() {
  var apiKey = getOpenRouterApiKey_();
  var headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

  var response = UrlFetchApp.fetch(OPENROUTER_MODELS_URL_, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var bodyText = response.getContentText();
  if (code >= 400) {
    throw new Error('OpenRouter models request failed (' + code + '): ' + bodyText);
  }

  var body = JSON.parse(bodyText);
  var list = body.data || [];
  var models = [];
  list.forEach(function (raw) {
    var normalized = normalizeOpenRouterModel_(raw);
    if (normalized) models.push(normalized);
  });

  models.sort(function (a, b) {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.name.localeCompare(b.name);
  });
  return models;
}

function filterOpenRouterModels_(models, freeOnly, providerPrefix) {
  var list = models;
  if (freeOnly === true) {
    list = list.filter(function (m) { return m.isFree === true; });
  }
  if (providerPrefix) {
    var prefix = String(providerPrefix);
    list = list.filter(function (m) { return m.id.indexOf(prefix) === 0; });
  }
  return list;
}

function groupModelsByProvider_(models) {
  var byProvider = {};
  models.forEach(function (m) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  });
  return Object.keys(byProvider).sort().map(function (provider) {
    return {
      provider: provider,
      models: byProvider[provider].sort(function (a, b) {
        return a.name.localeCompare(b.name);
      })
    };
  });
}

function listOpenRouterModels_(forceRefresh, freeOnly, providerPrefix) {
  freeOnly = freeOnly === true;
  providerPrefix = providerPrefix ? String(providerPrefix) : '';

  if (!getOpenRouterApiKey_()) {
    return {
      ok: false,
      models: [],
      grouped: [],
      defaultModelId: getOpenRouterModel_(),
      error: 'OPENROUTER_API_KEY is not configured.'
    };
  }

  var allModels = null;
  var fromCache = false;

  if (!forceRefresh) {
    var cached = readModelsCache_();
    if (cached && cached.models && cached.models.length) {
      allModels = cached.models;
      fromCache = true;
    }
  }

  if (!allModels) {
    allModels = fetchOpenRouterModelsFromApi_();
    writeModelsCache_(allModels);
    fromCache = false;
  }

  var filtered = filterOpenRouterModels_(allModels, freeOnly, providerPrefix);
  return {
    ok: true,
    models: filtered,
    grouped: groupModelsByProvider_(filtered),
    cached: fromCache,
    defaultModelId: getOpenRouterModel_(),
    totalCount: allModels.length,
    error: ''
  };
}

function getCachedOpenRouterModelIds_() {
  var cached = readModelsCache_();
  if (!cached || !cached.models) return [];
  return cached.models.map(function (m) { return m.id; });
}

function assertValidEvaluationModel_(modelId) {
  var id = String(modelId || '').trim();
  if (!id) throw new Error('Model ID is required.');
  var ids = getCachedOpenRouterModelIds_();
  if (ids.indexOf(id) !== -1) return;
  listOpenRouterModels_(true);
  ids = getCachedOpenRouterModelIds_();
  if (ids.indexOf(id) === -1) {
    throw new Error('Invalid model: ' + id);
  }
}

function setEvaluationModel_(modelId) {
  assertValidEvaluationModel_(modelId);
  PropertiesService.getScriptProperties().setProperty('OPENROUTER_MODEL', modelId);
  return modelId;
}

function getEvaluationModel_() {
  return getOpenRouterModel_();
}
