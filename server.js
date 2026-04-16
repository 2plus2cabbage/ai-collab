'use strict';
require('dotenv').config();

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware (must come before all routes) ─────────────────────────────────
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: { message: 'Too many requests — slow down.' } }
});
app.use('/api/', limiter);

// ─── Logging setup ────────────────────────────────────────────────────────────
const LOG_DIR            = process.env.LOG_DIR || path.join(__dirname, 'logs');
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30');

// Ensure log directory exists on startup
fs.mkdirSync(LOG_DIR, { recursive: true });

// Returns today's log file path: logs/YYYY-MM-DD.log
function logFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${date}.log`);
}

// Async append — never blocks the event loop
function writeLog(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(logFilePath(), line, err => {
    if (err) console.error('[logger] Write error:', err.message);
  });
}

// Remove log files older than LOG_RETENTION_DAYS at startup
function pruneOldLogs() {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 86_400_000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const fp = path.join(LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        console.log(`[logger] Pruned ${f}`);
      }
    }
  } catch (e) {
    console.error('[logger] Prune error:', e.message);
  }
}
pruneOldLogs();

// Strip <think>...</think> reasoning blocks that sonar-reasoning models emit
function stripThinkBlocks(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

// Extract the structured fields we want to log from each provider's request/response format
function extractFields(provider, reqBody, resData) {
  try {
    switch (provider) {
      case 'anthropic': return {
        model:        reqBody.model,
        systemPrompt: reqBody.system || '',
        userPrompt:   reqBody.messages?.slice(-1)[0]?.content || '',
        response:     resData.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '',
        inputTokens:  resData.usage?.input_tokens,
        outputTokens: resData.usage?.output_tokens
      };
      case 'openai':
      case 'grok': return {
        model:        reqBody.model,
        systemPrompt: reqBody.messages?.find(m => m.role === 'system')?.content || '',
        userPrompt:   reqBody.messages?.filter(m => m.role === 'user').slice(-1)[0]?.content || '',
        response:     resData.choices?.[0]?.message?.content || '',
        inputTokens:  resData.usage?.prompt_tokens,
        outputTokens: resData.usage?.completion_tokens
      };
      case 'perplexity': return {
        model:        reqBody.model,
        systemPrompt: reqBody.messages?.find(m => m.role === 'system')?.content || '',
        userPrompt:   reqBody.messages?.filter(m => m.role === 'user').slice(-1)[0]?.content || '',
        response:     stripThinkBlocks(resData.choices?.[0]?.message?.content || ''),
        inputTokens:  resData.usage?.prompt_tokens,
        outputTokens: resData.usage?.completion_tokens
      };
      case 'gemini': return {
        model:        reqBody._model || '',
        systemPrompt: reqBody.system_instruction?.parts?.[0]?.text || '',
        userPrompt:   reqBody.contents?.[0]?.parts?.[0]?.text || '',
        response:     resData.candidates?.[0]?.content?.parts?.[0]?.text || '',
        inputTokens:  resData.usageMetadata?.promptTokenCount,
        outputTokens: resData.usageMetadata?.candidatesTokenCount
      };
      default: return { model: reqBody.model };
    }
  } catch {
    return { model: reqBody.model };
  }
}

// ─── Core logging proxy ───────────────────────────────────────────────────────
// Replaces the old proxyPost — intercepts response before forwarding so we can log it
async function loggingProxy(provider, url, extraHeaders, reqBody, req, res) {
  const start = Date.now();
  // Strip any internal underscore fields we added for logging before forwarding
  const sendBody = Object.fromEntries(Object.entries(reqBody).filter(([k]) => !k.startsWith('_')));
  try {
    const r = await fetch(url, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', ...extraHeaders },
      body    : JSON.stringify(sendBody)
    });
    const data = await r.json();

    // Write log entry (non-blocking)
    const fields = extractFields(provider, reqBody, data);
    writeLog({
      timestamp   : new Date().toISOString(),
      sessionId   : req.headers['x-session-id']  || 'unknown',
      round       : req.headers['x-round']        || '?',
      agent       : req.headers['x-agent-name']   || provider,
      provider,
      latencyMs   : Date.now() - start,
      error       : data.error ? data.error.message : null,
      ...fields
    });

    // Strip <think> blocks from Perplexity reasoning models before returning to browser
    if (provider === 'perplexity' && data.choices?.[0]?.message?.content) {
      data.choices[0].message.content = stripThinkBlocks(data.choices[0].message.content);
    }

    res.status(r.status).json(data);
  } catch (e) {
    console.error(`[${provider}] Proxy error:`, e.message);
    writeLog({ timestamp: new Date().toISOString(), provider,
               sessionId: req.headers['x-session-id'] || 'unknown',
               error: e.message, latencyMs: Date.now() - start });
    res.status(500).json({ error: { message: e.message } });
  }
}

// GET proxy (model lists — not logged, just forwarded)
async function proxyGet(url, extraHeaders, res) {
  try {
    const r    = await fetch(url, { headers: { 'Content-Type': 'application/json', ...extraHeaders } });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('Proxy GET error:', e.message);
    res.status(500).json({ error: { message: e.message } });
  }
}

// ─── Sessions storage ─────────────────────────────────────────────────────────
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Save a completed session
app.post('/api/sessions', (req, res) => {
  try {
    const session = req.body;
    if (!session.sessionId) return res.status(400).json({ error: 'sessionId required' });
    const fp = path.join(SESSIONS_DIR, `${session.sessionId}.json`);
    fs.writeFileSync(fp, JSON.stringify(session, null, 2));
    res.json({ saved: true, sessionId: session.sessionId });
  } catch(e) {
    console.error('[sessions] Save error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// List all sessions — metadata only, no full log
app.get('/api/sessions', (_req, res) => {
  try {
    const sessions = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          return {
            sessionId     : d.sessionId,
            timestamp     : d.timestamp,
            problem       : (d.problem || '').slice(0, 120),
            agents        : (d.agents || []).map(a => a.name),
            rounds        : d.rounds,
            consensusReached : d.consensusReached,
            synthesisAgent: d.synthesisAgent,
            stopped       : d.stopped || false
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ sessions });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Get full session data
app.get('/api/sessions/:id', (req, res) => {
  // Sanitise the ID — only allow alphanumeric + dash
  if (!/^[a-z0-9-]+$/i.test(req.params.id))
    return res.status(400).json({ error: 'Invalid session ID' });
  const fp = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Session not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
  if (!/^[a-z0-9-]+$/i.test(req.params.id))
    return res.status(400).json({ error: 'Invalid session ID' });
  const fp = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Session not found' });
  try { fs.unlinkSync(fp); res.json({ deleted: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Status ───────────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({
    anthropic  : !!process.env.ANTHROPIC_API_KEY,
    openai     : !!process.env.OPENAI_API_KEY,
    grok       : !!process.env.GROK_API_KEY,
    gemini     : !!process.env.GEMINI_API_KEY,
    perplexity : !!process.env.PERPLEXITY_API_KEY
  });
});

// ─── Log viewer endpoints ─────────────────────────────────────────────────────
// List available log dates
app.get('/api/logs', (_req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .reverse()
      .map(f => ({
        date : f.replace('.log', ''),
        size : fs.statSync(path.join(LOG_DIR, f)).size
      }));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download a specific day's log as newline-delimited JSON
app.get('/api/logs/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  const fp = path.join(LOG_DIR, `${date}.log`);
  if (!fs.existsSync(fp))
    return res.status(404).json({ error: `No log found for ${date}` });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Content-Disposition', `attachment; filename="${date}.log"`);
  fs.createReadStream(fp).pipe(res);
});

// ─── Model list routes ────────────────────────────────────────────────────────
app.get('/api/anthropic/models', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: { message: 'ANTHROPIC_API_KEY not set' } });
  proxyGet('https://api.anthropic.com/v1/models',
    { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, res);
});
app.get('/api/openai/models', (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: { message: 'OPENAI_API_KEY not set' } });
  proxyGet('https://api.openai.com/v1/models', { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }, res);
});
app.get('/api/grok/models', (req, res) => {
  if (!process.env.GROK_API_KEY) return res.status(503).json({ error: { message: 'GROK_API_KEY not set' } });
  proxyGet('https://api.x.ai/v1/models', { 'Authorization': `Bearer ${process.env.GROK_API_KEY}` }, res);
});
app.get('/api/gemini/models', (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: { message: 'GEMINI_API_KEY not set' } });
  proxyGet(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`, {}, res);
});

// ─── AI proxy routes ──────────────────────────────────────────────────────────
app.post('/api/anthropic', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: { message: 'ANTHROPIC_API_KEY not set in .env' } });
  loggingProxy('anthropic', 'https://api.anthropic.com/v1/messages',
    { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    req.body, req, res);
});

app.post('/api/openai', (req, res) => {
  if (!process.env.OPENAI_API_KEY)
    return res.status(503).json({ error: { message: 'OPENAI_API_KEY not set in .env' } });
  loggingProxy('openai', 'https://api.openai.com/v1/chat/completions',
    { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    req.body, req, res);
});

app.post('/api/grok', (req, res) => {
  if (!process.env.GROK_API_KEY)
    return res.status(503).json({ error: { message: 'GROK_API_KEY not set in .env' } });
  loggingProxy('grok', 'https://api.x.ai/v1/chat/completions',
    { 'Authorization': `Bearer ${process.env.GROK_API_KEY}` },
    req.body, req, res);
});

// ─── Perplexity (OpenAI-compatible) ───────────────────────────────────────────
app.get('/api/perplexity/models', (req, res) => {
  if (!process.env.PERPLEXITY_API_KEY)
    return res.status(503).json({ error: { message: 'PERPLEXITY_API_KEY not set' } });
  // Perplexity doesn't have a /models endpoint — return a static known list
  res.json({ data: [
    { id:'sonar' },
    { id:'sonar-pro' },
    { id:'sonar-reasoning' },
    { id:'sonar-reasoning-pro' }
  ]});
});

app.post('/api/perplexity', (req, res) => {
  if (!process.env.PERPLEXITY_API_KEY)
    return res.status(503).json({ error: { message: 'PERPLEXITY_API_KEY not set in .env' } });
  loggingProxy('perplexity', 'https://api.perplexity.ai/chat/completions',
    { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    req.body, req, res);
});

app.post('/api/gemini', (req, res) => {
  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: { message: 'GEMINI_API_KEY not set in .env' } });
  const { model, ...body } = req.body;
  if (!model) return res.status(400).json({ error: { message: 'model is required in request body' } });
  // Stash model on body so extractFields can read it after the key is removed for the URL
  body._model = model;
  loggingProxy('gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {}, body, req, res);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nMulti-agent proxy listening on port ${PORT}`);
  console.log(`Log directory     : ${LOG_DIR}  (${LOG_RETENTION_DAYS}-day retention)`);
  console.log(`Sessions directory: ${SESSIONS_DIR}`);
  console.log('Providers configured:');
  ['anthropic','openai','grok','gemini','perplexity'].forEach(p => {
    const key = p.toUpperCase() + '_API_KEY';
    console.log(`  ${p.padEnd(10)} ${process.env[key] ? '✓ ready' : '✗ missing (add to .env)'}`);
  });
  console.log('');
});
