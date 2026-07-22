import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MAX_BODY_BYTES = 18 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    image_quality: {
      type: 'object', additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        limitations: { type: 'array', items: { type: 'string' } },
        retake_instructions: { type: 'array', items: { type: 'string' } }
      },
      required: ['score', 'limitations', 'retake_instructions']
    },
    urgency: {
      type: 'object', additionalProperties: false,
      properties: {
        level: { type: 'string', enum: ['emergency', 'urgent', 'prompt_review', 'routine', 'uncertain'] },
        reasons: { type: 'array', items: { type: 'string' } },
        immediate_action: { type: 'string' }
      },
      required: ['level', 'reasons', 'immediate_action']
    },
    measurements: {
      type: 'object', additionalProperties: false,
      properties: {
        rate_bpm: { type: ['number', 'null'] },
        rhythm_regular: { type: ['boolean', 'null'] },
        pr_ms: { type: ['number', 'null'] },
        qrs_ms: { type: ['number', 'null'] },
        qt_ms: { type: ['number', 'null'] },
        qtc_ms: { type: ['number', 'null'] },
        axis: { type: 'string' },
        st_t_findings: { type: 'array', items: { type: 'string' } },
        confidence_notes: { type: 'array', items: { type: 'string' } }
      },
      required: ['rate_bpm', 'rhythm_regular', 'pr_ms', 'qrs_ms', 'qt_ms', 'qtc_ms', 'axis', 'st_t_findings', 'confidence_notes']
    },
    primary_interpretation: {
      type: 'object', additionalProperties: false,
      properties: {
        label: { type: 'string' },
        confidence: { type: 'integer', minimum: 0, maximum: 100 },
        supporting_features: { type: 'array', items: { type: 'string' } },
        conflicting_features: { type: 'array', items: { type: 'string' } }
      },
      required: ['label', 'confidence', 'supporting_features', 'conflicting_features']
    },
    differential: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          diagnosis: { type: 'string' },
          why_possible: { type: 'array', items: { type: 'string' } },
          why_less_likely: { type: 'array', items: { type: 'string' } },
          discriminator: { type: 'string' }
        },
        required: ['diagnosis', 'why_possible', 'why_less_likely', 'discriminator']
      }
    },
    why_the_interpretation_may_be_wrong: { type: 'array', items: { type: 'string' } },
    clinical_context_links: { type: 'array', items: { type: 'string' } },
    suggested_next_steps: { type: 'array', items: { type: 'string' } },
    treatment_discussion: {
      type: 'object', additionalProperties: false,
      properties: {
        clinician_directed_options: { type: 'array', items: { type: 'string' } },
        avoid_until_reviewed: { type: 'array', items: { type: 'string' } },
        treatment_caveat: { type: 'string' }
      },
      required: ['clinician_directed_options', 'avoid_until_reviewed', 'treatment_caveat']
    },
    calculations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' },
          formula: { type: 'string' },
          inputs: { type: 'string' },
          result: { type: 'string' },
          interpretation: { type: 'string' }
        },
        required: ['name', 'formula', 'inputs', 'result', 'interpretation']
      }
    },
    questions_for_clinician: { type: 'array', items: { type: 'string' } },
    education_summary: { type: 'string' },
    disclaimer: { type: 'string' }
  },
  required: [
    'image_quality', 'urgency', 'measurements', 'primary_interpretation', 'differential',
    'why_the_interpretation_may_be_wrong', 'clinical_context_links', 'suggested_next_steps',
    'treatment_discussion', 'calculations', 'questions_for_clinician', 'education_summary', 'disclaimer'
  ]
};

const agentSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    role: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    conclusion: { type: 'string' }
  },
  required: ['role', 'findings', 'concerns', 'confidence', 'conclusion']
};

const SYSTEM_BASE = `You are part of an educational ECG image-review system. You may analyze visible ECG features and supplied measurements, but you must not claim certainty from a photograph, replace a clinician, or provide individualized prescription dosing. Explicitly identify image-quality limits, lead/calibration uncertainty, and missing clinical data. Prioritize emergency symptoms and dangerous patterns. Distinguish observed features from inference. Do not invent measurements that cannot be read. When treatment is discussed, keep it clinician-directed and high-level. Never recommend delaying emergency care. The output must be valid JSON matching the provided schema.`;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request is too large. Use a compressed ECG image.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function outputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

async function openAIResponse({ system, prompt, imageDataUrl, schema, schemaName, maxOutputTokens = 2200, apiKey = OPENAI_API_KEY, model = MODEL }) {
  if (!apiKey) throw new Error('No API key is configured. Add a personal session key in the app or set OPENAI_API_KEY on the server.');
  const userContent = [{ type: 'input_text', text: prompt }];
  if (imageDataUrl) userContent.push({ type: 'input_image', image_url: imageDataUrl, detail: 'high' });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ],
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed (${response.status}).`;
    throw new Error(message);
  }
  const text = outputText(payload);
  if (!text) throw new Error('The model returned no readable output.');
  return JSON.parse(text);
}

function cleanContext(context = {}) {
  const safe = {
    age: String(context.age || '').slice(0, 10),
    sex: String(context.sex || '').slice(0, 30),
    symptoms: String(context.symptoms || '').slice(0, 1500),
    duration: String(context.duration || '').slice(0, 300),
    vitals: String(context.vitals || '').slice(0, 800),
    medications: String(context.medications || '').slice(0, 1200),
    history: String(context.history || '').slice(0, 1200),
    electrolytes: String(context.electrolytes || '').slice(0, 800),
    device_readout: String(context.device_readout || '').slice(0, 800)
  };
  return safe;
}

function contextPrompt(context, manual, mode) {
  return `Review the attached ECG image.\n\nClinical context (may be incomplete):\n${JSON.stringify(cleanContext(context), null, 2)}\n\nUser measurements and calibration:\n${JSON.stringify(manual || {}, null, 2)}\n\nRequested workflow: ${mode}.\n\nDo not treat device-generated labels as ground truth. State what is visible, what is uncertain, what could make the reading wrong, and what additional data would discriminate the differential.`;
}

async function interpretFast(body, credentials) {
  return openAIResponse({
    system: `${SYSTEM_BASE}\nAct as an integrated ECG signal analyst, clinical differential reviewer, and safety validator.`,
    prompt: contextPrompt(body.context, body.manual, 'single integrated review'),
    imageDataUrl: body.image,
    schema: reportSchema,
    schemaName: 'ekg_interpretation_report',
    maxOutputTokens: 3600,
    ...credentials
  });
}

async function interpretAgents(body, credentials) {
  const shared = contextPrompt(body.context, body.manual, 'multi-agent independent review');
  const roles = [
    {
      role: 'Signal Analyst',
      instruction: 'Focus on image quality, calibration, rate, rhythm, P waves, PR, QRS, axis clues, R progression, ST-T, QT, artifact, lead reversal, and measurable features. Do not discuss treatment beyond urgency.'
    },
    {
      role: 'Differential Challenger',
      instruction: 'Challenge the obvious interpretation. List plausible mimics, technical errors, lead-placement errors, baseline wander, early repolarization, conduction patterns, electrolyte/drug effects, and the evidence that would separate them.'
    },
    {
      role: 'Clinical Safety Reviewer',
      instruction: 'Use symptoms, vitals, history, and medications to identify red flags, urgency, clinician-directed next steps, and unsafe assumptions. Do not provide individualized prescription dosing.'
    }
  ];

  const agentResults = await Promise.all(roles.map(r => openAIResponse({
    system: `${SYSTEM_BASE}\nYou are the ${r.role}. ${r.instruction}`,
    prompt: shared,
    imageDataUrl: body.image,
    schema: agentSchema,
    schemaName: `ekg_${r.role.toLowerCase().replace(/[^a-z]+/g, '_')}`,
    maxOutputTokens: 1400,
    ...credentials
  })));

  const synthesisPrompt = `Synthesize the three independent ECG reviews into one conservative report. Resolve disagreements explicitly. Do not invent measurements.\n\nClinical context and manual measurements:\n${JSON.stringify({ context: cleanContext(body.context), manual: body.manual || {} }, null, 2)}\n\nAgent reviews:\n${JSON.stringify(agentResults, null, 2)}`;

  const report = await openAIResponse({
    system: `${SYSTEM_BASE}\nYou are the senior ECG synthesis agent. Produce a clinically cautious educational report and preserve disagreements or uncertainty.`,
    prompt: synthesisPrompt,
    imageDataUrl: body.image,
    schema: reportSchema,
    schemaName: 'ekg_multi_agent_report',
    maxOutputTokens: 3800,
    ...credentials
  });
  report.agent_reviews = agentResults;
  return report;
}

async function chatAboutReport(body, credentials) {
  const question = String(body.question || '').slice(0, 2500);
  if (!question) throw new Error('Enter a question.');
  const report = body.report || {};
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const prompt = `The user is discussing an educational ECG report. Answer their question using the report, supplied measurements, and context. Explain calculations, differential reasoning, why an interpretation might be wrong, and general clinician-directed treatment concepts. Never provide individualized medication dosing or claim a definitive diagnosis. Escalate emergency symptoms.\n\nReport:\n${JSON.stringify(report, null, 2)}\n\nRecent conversation:\n${JSON.stringify(history, null, 2)}\n\nQuestion: ${question}`;

  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      answer: { type: 'string' },
      key_reasoning: { type: 'array', items: { type: 'string' } },
      uncertainty: { type: 'array', items: { type: 'string' } },
      safety_note: { type: 'string' }
    },
    required: ['answer', 'key_reasoning', 'uncertainty', 'safety_note']
  };

  return openAIResponse({
    system: SYSTEM_BASE,
    prompt,
    imageDataUrl: body.image || null,
    schema,
    schemaName: 'ekg_followup_answer',
    maxOutputTokens: 1800,
    ...credentials
  });
}


function credentialsFromBody(body = {}) {
  const providedKey = String(body.apiKey || '').trim();
  const providedModel = String(body.model || '').trim();
  const apiKey = providedKey || OPENAI_API_KEY;
  const model = providedModel || MODEL;
  if (!apiKey) throw new Error('No API key is configured. Open Connect AI and add a personal session key, or set OPENAI_API_KEY on the server.');
  if (apiKey.length < 20) throw new Error('The API key appears incomplete.');
  if (!model || model.length > 100) throw new Error('Choose a valid model name.');
  return { apiKey, model };
}

async function testCredentials(credentials) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${credentials.apiKey}`
    },
    body: JSON.stringify({
      model: credentials.model,
      input: 'Reply with exactly: connection ok',
      max_output_tokens: 12
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Connection test failed (${response.status}).`);
  return { ok: true, model: credentials.model };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, { configured: Boolean(OPENAI_API_KEY), model: MODEL, mode: OPENAI_API_KEY ? 'server' : 'demo', sessionKeySupported: true });
  }
  if (pathname === '/api/test-key' && req.method === 'POST') {
    const body = await readJson(req);
    const credentials = credentialsFromBody(body);
    const result = await testCredentials(credentials);
    return sendJson(res, 200, result);
  }
  if (pathname === '/api/interpret' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.image || !String(body.image).startsWith('data:image/')) {
      return sendJson(res, 400, { error: 'Upload or capture an ECG image first.' });
    }
    const credentials = credentialsFromBody(body);
    const report = body.mode === 'agents' ? await interpretAgents(body, credentials) : await interpretFast(body, credentials);
    return sendJson(res, 200, { report, model: credentials.model, mode: body.mode === 'agents' ? 'agents' : 'fast' });
  }
  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await readJson(req);
    const credentials = credentialsFromBody(body);
    const result = await chatAboutReport(body, credentials);
    return sendJson(res, 200, result);
  }
  return sendJson(res, 404, { error: 'API route not found.' });
}

async function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  requested = decodeURIComponent(requested);
  const full = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self)',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Frame-Options': 'DENY'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url.pathname);
    else await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error?.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`EKG Lens AI running at http://localhost:${PORT}`);
  console.log(OPENAI_API_KEY ? `OpenAI enabled with ${MODEL}` : 'Demo mode: set OPENAI_API_KEY to enable LLM analysis.');
});
