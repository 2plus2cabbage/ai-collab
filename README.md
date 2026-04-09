<img align="right" width="150" src="https://github.com/2plus2cabbage/2plus2cabbage/blob/main/images/2plus2cabbage.png">

<img src="https://github.com/2plus2cabbage/2plus2cabbage/blob/main/images/ai-collab.png" alt="ai-collab" width="300" align="left">
<br clear="left">

# Multi-Agent AI Collaboration Platform

> **⚠ Proof of Concept — Not Production Ready**
> This is a working POC built to explore multi-provider AI consensus mechanics. It is not hardened for public deployment. See [Security](#security) for known gaps and planned mitigations.

A single-page web application that runs multiple AI agents from different providers simultaneously, forces structured debate, tracks disagreement, and drives toward a reasoned consensus — or invokes a reserved arbitrator if consensus isn't reached.

---

## What It Does

You pose a problem. Up to four AI agents — Anthropic Claude, OpenAI GPT, xAI Grok, and Google Gemini — participate in the session. When the arbitrator is enabled, one of the four is randomly selected at session start and held in reserve, leaving three to debate. Each of the active agents responds independently in Round 1 without seeing each other's answers. From Round 2 onward, they debate in parallel, each seeing the full prior transcript. They are required to contribute only new positions, challenge specific claims, and call out repetition. If they cannot agree by a configurable round threshold, the reserved agent enters as a neutral arbitrator — having observed the full discussion without participating — issues definitive rulings on each unresolved disagreement, and writes the final synthesis.

The system is designed to surface genuine disagreement between AI models, avoid anchoring bias, prevent one provider from dominating the conversation, and produce a synthesis that reflects where the models actually converged rather than where one model led the others.

---

## Architecture

```
Browser (index.html)
    │
    │  POST /api/anthropic|openai|grok|gemini
    │  GET  /api/sessions | /api/logs
    ▼
Node.js / Express (server.js, port 3001)
    │  ├── Logs every call to /logs/YYYY-MM-DD.log (NDJSON, 30-day rotation)
    │  ├── Persists completed sessions to /sessions/{id}.json
    │  └── Rate limiter: 200 req/min per IP
    │
    ├── Anthropic API  (claude-haiku-4-5 / claude-sonnet-4)
    ├── OpenAI API     (gpt-4o-mini / gpt-4o)
    ├── xAI Grok API   (grok-3-mini / grok-3)
    └── Google Gemini  (gemini-2.5-flash / gemini-2.5-pro)
```

**All AI API keys are server-side only.** The browser never sees them. Every provider call is proxied through Express, logged, and forwarded.

---

## Key Features

### Conversation Mechanics
- **Independent Round 1** — all agents respond in parallel without seeing each other, eliminating first-mover anchoring bias
- **Parallel execution** — from Round 2 onward all agents run simultaneously; a round takes as long as the slowest provider, not the sum
- **Structured response format** — agents must label `NEW:`, `CHALLENGE:`, `REPETITION:`, `UNADDRESSED:`, or `AGREEMENT:` — no padding, no pleasantries
- **Randomised agent order** — displayed in a different shuffled order each round so no provider consistently anchors the discussion
- **Identity anchoring** — each agent is explicitly told which transcript entries are their own prior responses, preventing cross-agent identity confusion

### Consensus System
- **Self-certification** — from Round 3, each agent appends `[CONSENSUS: YES]` or `[CONSENSUS: NO: reason]` to every response
- **All-or-nothing** — consensus only fires when every active agent certifies YES in the same round
- **Reserve arbitrator** — one agent is held in reserve and excluded from all rounds; if consensus is not reached by a configurable round (default: Round 10), it enters, reviews the full transcript, rules definitively on each unresolved point, and writes the synthesis
- **Arbitrator fallback** — if the designated arbitrator's provider fails, the system falls back to a randomly selected active agent

### Cost Visibility
- Live session cost display updated after every agent call
- Per-agent cumulative cost shown in the legend
- Pricing table covers all current models with prefix matching for dated variants
- Costs included in session logs and prompt logs

### Session Management
- Sessions saved server-side on completion and on stop — survive browser close and server restart
- Session history browser with full transcript replay, export, and delete
- Daily-rotating server-side prompt logs capture every system prompt, user prompt, response, token counts, latency, and error for every call

### Operator Controls
- **Checkpoint pauses** every N rounds — the agent that most recently certified NO writes a bullet-list of open disagreements from their perspective; operator can inject guidance that propagates into all agent system prompts
- **Stop** — cancels all in-flight parallel fetches simultaneously via shared AbortController
- **Agent drop handling** — permanent errors trigger a drop confirmation; session continues if ≥2 agents remain

---

## Project Structure

```
/
├── server.js          — Express proxy, logging, session persistence
├── public/
│   └── index.html     — Entire frontend (single file, ~2000 lines)
├── .env               — API keys (never committed)
├── .env.example       — Template
├── logs/              — Daily NDJSON prompt logs (auto-created)
├── sessions/          — Completed session JSON files (auto-created)
└── README.md
```

---

## Setup

### Prerequisites
- Node.js 18+
- API keys for at least 2 of the 4 providers
- A Linux server or local machine (tested on Ubuntu 22.04)

### Install

```bash
git clone https://github.com/2plus2cabbage/ai-collab.git
cd ai-collab
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROK_API_KEY=xai-...
GEMINI_API_KEY=AIza...
PORT=3001
LOG_DIR=./logs
LOG_RETENTION_DAYS=30
SESSIONS_DIR=./sessions
```

Only configure the providers you have keys for. The UI auto-detects which providers are available and enables only those.

### Run

```bash
node server.js
```

Or with PM2 for persistence:

```bash
npm install -g pm2
pm2 start server.js --name multiagent
pm2 save
pm2 startup
```

Open `http://localhost:3001` in your browser.

---

## Deployment (Ubuntu + Nginx)

```bash
# Nginx reverse proxy config
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Usage

1. **Configure agents** — check the providers you want to include; select models and review the analytical lens for each
2. **Set arbitrator round** — default is Round 10; set to Disabled if you want to run manually
3. **Enter a problem** — specific, debatable questions with concrete constraints work best
4. **Start** — Round 1 runs in parallel independently; from Round 2 agents debate the full transcript
5. **Monitor** — watch consensus certifications appear on each message; cost accumulates in the header bar
6. **Intervene at checkpoints** — every 10 rounds (configurable) the session pauses and shows open disagreements from the dissenting agent's perspective; add operator guidance or end and synthesize
7. **Review history** — click 📂 History to browse all past sessions with full transcript replay

### Prompt Tips

The system works best with problems that:
- Have a specific, answerable question
- Include concrete constraints (numbers, timeframes, resources)
- Have at least 2-3 defensible positions
- Are not purely factual lookups

Examples that work well:
- Business strategy decisions with budget/resource constraints
- Technical architecture choices with specific requirements
- Medical/financial situations with defined parameters
- Policy questions where tradeoffs exist

---

## Configuration Reference

| Setting | Default | Description |
|---|---|---|
| Model tier | Economy | Economy/Standard/Premium — selects models per tier |
| Max tokens | 1000 | Per-response token limit across all providers |
| Verbosity | Standard | Concise/Standard/Detailed — injected into system prompts |
| Pause every | 10 rounds | Checkpoint frequency for operator review |
| Consensus detection | Auto | Auto (agent self-certification) or Run to max rounds |
| Arbitrator activates | Round 10 | Round at which reserve agent enters; Disabled to turn off |
| Round delay | 500ms | Pause between rounds; set to 0 for maximum speed |

---

## Provider Notes

| Provider | Economy model | Premium model | Notes |
|---|---|---|---|
| Anthropic | claude-haiku-4-5 | claude-sonnet-4 | Fastest responses; best instruction-following |
| OpenAI | gpt-4o-mini | gpt-4o | Strict model allowlist to exclude non-chat models |
| Grok (xAI) | grok-3-mini | grok-3 | OpenAI-compatible endpoint at api.x.ai |
| Gemini | gemini-2.5-flash | gemini-2.5-pro | Model name goes in URL, not body; `_model` field stripped |

Model dropdowns populate live from each provider's model list API. Click ⟳ on any agent card to refresh.

---

## Security

> **This POC has known security gaps. It is suitable for personal use or controlled internal environments only.**

### Current mitigations
- API keys are server-side only — never sent to the browser
- Express rate limiter: 200 requests/minute per IP
- Session ID sanitisation on all server routes (`/^[a-z0-9-]+$/i`)
- Request body size limit: 4MB

### Known gaps — planned for future iterations

| Gap | Risk | Planned mitigation |
|---|---|---|
| No authentication | Anyone with the URL can use your API keys | Password gate or OAuth |
| HTTP only | Traffic and API responses visible on network | HTTPS via Let's Encrypt / certbot |
| No input sanitisation | Prompt injection via problem field | Strip/escape control characters |
| No CORS policy | Any origin can call the API | Restrict to known origins |
| Single shared server | No multi-tenancy, no user isolation | Per-user sessions, auth middleware |
| Sessions stored as plain JSON | No encryption at rest | Encrypt session files or use a DB |
| No audit trail for operator guidance | Guidance injections not attributed | Add operator identity to guidance log |

---

## How Consensus Works

```
Round 1:  All agents respond independently (no cross-visibility)
Round 2:  All agents see full Round 1 transcript, respond in parallel
Round 3+: Same, plus each agent appends:
            [CONSENSUS: YES]  — if zero remaining substantive disagreements
            [CONSENSUS: NO: reason]  — if any disagreement remains

Consensus fires when ALL active agents certify YES in the same round.

If consensus not reached by Round N (default: 10):
  → Reserve arbitrator enters
  → Reviews full transcript
  → Issues binding rulings on each open disagreement
  → Writes final synthesis incorporating rulings
```

Certification tags are stripped before display and shown as green/amber badges on each message.

### Without an arbitrator

When the arbitrator is disabled, the session ends in one of three ways:

1. **Consensus** — all active agents certify `[CONSENSUS: YES]` in the same round. The last agent to certify writes the final synthesis.
2. **Checkpoint pause** — every N rounds (default 10) the session pauses and shows open disagreements written from the perspective of the most recent dissenting agent. The operator can inject guidance to steer the agents and resume, or choose to end and synthesize immediately with whatever convergence exists.
3. **Manual stop** — the operator hits ⏹ at any point, cancelling all in-flight calls. They can then generate a synthesis from the existing transcript or export and walk away.

Without an arbitrator there is no automatic hard cap — the session can run indefinitely if consensus is never reached and the operator keeps resuming at checkpoints. The **Default max rounds** setting (default 50, configurable in Settings) acts as a background ceiling to prevent runaway sessions.

---

## Logs

Every AI call is logged server-side as a JSON line:

```json
{
  "timestamp": "2026-04-09T14:23:11.042Z",
  "sessionId": "s1h2k4j-abc7x",
  "round": 3,
  "agent": "Gemini",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "latencyMs": 2341,
  "systemPrompt": "...",
  "userPrompt": "...",
  "response": "...",
  "inputTokens": 1842,
  "outputTokens": 387,
  "error": null
}
```

Files: `logs/YYYY-MM-DD.log` — retained for 30 days, then auto-deleted.

Browse and download from the **📋 Logs → Server logs** panel in the UI.

---

## Limitations & Known Issues

- **No streaming** — responses appear all at once when complete, not token-by-token
- **Context growth** — long sessions send the full transcript to every agent every round; costs grow quadratically with rounds
- **Model pricing table** — hardcoded; will need updating as providers change pricing
- **Anthropic billing quirk** — confirmed issue where a valid credit balance returns "too low" errors; contact Anthropic support with your request ID
- **Parallel execution trade-off** — agents in the same round cannot see each other's current-round responses, only prior rounds; this is intentional but means within-round convergence isn't possible

---

## A Note on AI Reasoning Quality

This platform coordinates multiple AI models but does not make them smarter. AI chat assistants are fundamentally pattern-matching systems trained to produce plausible-sounding text. They will:

- State incorrect facts with complete confidence
- Make logically inconsistent arguments across rounds
- Agree with each other for the wrong reasons
- Reach consensus on a wrong answer
- Produce sophisticated-sounding analysis that is subtly or catastrophically flawed

The structured debate format, repetition enforcement, and consensus certification all reduce some failure modes — but they do not eliminate them. The arbitrator is an AI too.

**Treat all output as a starting point for human judgment, not a substitute for it.** The value of this system is in surfacing multiple perspectives and forcing explicit disagreement — not in the correctness of any individual agent's reasoning. A human operator should always review the synthesis critically before acting on it.

The more consequential the decision, the more skepticism you should apply.

---

## Costs & Responsibilities

- API usage costs are incurred directly with each provider (Anthropic, OpenAI, xAI, Google) based on tokens consumed. The live cost display in the UI tracks session spend in real time. Economy-tier models (the default) are significantly cheaper — a typical 10-round session with 4 agents costs less than $0.10 at economy tier.
- Self-hosting this application on your own infrastructure incurs whatever compute and bandwidth costs your environment carries. There is no licensing fee for the software itself.
- You are responsible for securing your API keys, rotating them if compromised, and ensuring they are never committed to version control or exposed publicly.
- It is important to fully understand your organization's policies regarding external API usage, data residency, and what information may be sent to third-party AI providers. All problem statements and agent responses are transmitted to the respective provider APIs.
- You are responsible for monitoring provider billing, setting appropriate spend limits on each API key, and ensuring usage remains within budget.
- Regular backups of the `sessions/` and `logs/` directories are recommended for data retention and disaster recovery.
- Review each provider's terms of service regarding data usage, retention, and permissible use cases before deploying in an organizational context.

---

## Contributing

This is a POC. Issues and PRs welcome, particularly around:
- Security hardening items listed above
- Additional provider integrations
- Streaming response support
- Test coverage
