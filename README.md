<img align="right" width="150" src="https://github.com/2plus2cabbage/2plus2cabbage/blob/main/images/2plus2cabbage.png">

<img src="https://github.com/2plus2cabbage/2plus2cabbage/blob/main/images/ai-collab.png" alt="ai-collab" width="300" align="left">
<br clear="left">

# Multi-Agent AI Collaboration Platform

> **⚠ Proof of Concept — Not Production Ready**
> This is a working POC built to explore multi-provider AI consensus mechanics. It is not hardened for public deployment. See [Security](#security) for known gaps and planned mitigations.

A single-page web application that runs multiple AI agents from different providers simultaneously, forces structured debate, tracks disagreement, and drives toward a reasoned consensus — or invokes a reserved arbitrator if consensus isn't reached.

---

## What It Does

You pose a problem. Up to five AI agents — Anthropic Claude, OpenAI GPT, xAI Grok, Google Gemini, and Perplexity — participate in the session. When the arbitrator is enabled, one agent is designated at session start and held in reserve, leaving the others to debate. Each active agent responds independently in Round 1 without seeing each other's answers. From Round 2 onward, they debate in parallel, each seeing the full prior transcript. They are required to contribute only new positions, challenge specific claims, and call out repetition. If they cannot agree by a configurable round threshold, the reserved agent enters as a neutral arbitrator — having observed the full discussion without participating — issues definitive rulings on each unresolved disagreement, and writes the final synthesis.

The system is designed to surface genuine disagreement between AI models, avoid anchoring bias, prevent one provider from dominating the conversation, and produce a synthesis that reflects where the models actually converged rather than where one model led the others.

---

## Architecture

```
Browser (index.html)
    │
    │  POST /api/anthropic|openai|grok|gemini|perplexity
    │  GET  /api/sessions | /api/logs
    ▼
Node.js / Express (server.js, port 3001)
    │  ├── Logs every call to /logs/YYYY-MM-DD.log (NDJSON, 30-day rotation)
    │  ├── Persists completed sessions to /sessions/{id}.json
    │  └── Rate limiter: 200 req/min per IP
    │
    ├── Anthropic API   (claude-haiku-4-5 / claude-sonnet-4-5)
    ├── OpenAI API      (gpt-4o-mini / gpt-4o)
    ├── xAI Grok API    (grok-3-mini / grok-3)
    ├── Google Gemini   (gemini-2.5-flash / gemini-2.5-pro)
    └── Perplexity API  (sonar / sonar-pro — includes live web search)
```

**All AI API keys are server-side only.** The browser never sees them. Every provider call is proxied through Express, logged, and forwarded.

---

## Key Features

### Conversation Mechanics
- **Independent Round 1** — all agents respond in parallel without seeing each other, eliminating first-mover anchoring bias
- **Parallel execution** — from Round 2 onward all agents run simultaneously with a staggered 500ms launch offset to avoid rate limit bursts; a round takes as long as the slowest provider, not the sum
- **Structured response format** — agents must label `NEW:`, `CHALLENGE:`, `REPETITION:`, `UNADDRESSED:`, or `AGREEMENT:` — no padding, no pleasantries
- **Randomised agent order** — shuffled each round so no provider consistently anchors the discussion
- **Identity anchoring** — each agent is explicitly told which transcript entries are their own prior responses, preventing cross-agent identity confusion
- **Brevity rule** — if the question has a clear factual answer all agents stated correctly in Round 1, agents are instructed to certify consensus immediately rather than padding with analysis

### Focus Modes

A **Focus mode** selector on the main page changes how agents approach the problem:

| Mode | Best for | Agent lenses | Synthesis output |
|---|---|---|---|
| **General** | Strategy, analysis, decisions, research, factual questions | Logical structure · Practical implementation · Stress-testing · Breadth & synthesis | Recommended solution, reasoning, next steps |
| **Coding** | Implementation, code review, debugging, architecture | Correctness & clarity · Production reliability · Performance & failure modes · Security & tradeoffs | Complete solution with code, correctness rationale, edge cases |

Switching modes changes the textarea placeholder, per-agent system prompts, debate framing, and synthesis instruction. Additional modes (Medical, Legal, Financial, Technical Architecture) can be added by extending the `FOCUS_CONFIGS` table in `index.html`.

### Consensus System
- **Self-certification** — from Round 2, each agent appends `[CONSENSUS: YES]` or `[CONSENSUS: NO: reason]` to every response
- **All-or-nothing** — consensus only fires when every active agent certifies YES in the same round
- **Reserve arbitrator** — one agent is held completely out of the debate; if consensus is not reached by a configurable round (default: Round 10), it enters, reviews the full transcript, rules definitively on each unresolved point, and writes the synthesis
- **Arbitrator selection** — the arbitrator can be designated explicitly (e.g. always use Perplexity for live-data grounding) or selected randomly
- **Arbitrator fallback** — if the designated arbitrator's provider fails, the system falls back to a randomly selected active agent
- **Manual arbitration** — at any checkpoint pause the operator can designate any active agent to close the discussion immediately as an on-demand arbitrator

### Operator Controls
- **Checkpoint pauses** every N rounds — the most recent dissenting agent writes a concise bullet-list of open disagreements from their own perspective; operator can inject guidance, use their own text as a final answer, or designate an agent to close
- **Use as final answer** — operator types a definitive answer in the guidance field and clicks this button to bypass all further rounds and go straight to synthesis
- **Agent closes** — operator selects any active agent at a checkpoint to act as immediate arbitrator
- **Stop** — cancels all in-flight parallel fetches simultaneously via shared AbortController
- **Agent drop handling** — permanent errors trigger a drop confirmation; session continues if ≥2 agents remain

### Perplexity Integration
Perplexity is the only provider in this system with **live web search** built into every API response. All other providers (Anthropic, OpenAI, Grok, Gemini) reason from training data with knowledge cutoffs ranging from early 2024 to early 2025 — even though their consumer products may have browsing features, those are not available through the API.

This creates a meaningful role distinction:

- **Perplexity as a debate agent** — useful for questions where current data shapes the analysis (market conditions, recent research, live pricing)
- **Perplexity as the arbitrator** — recommended for most sessions; it stays out of the debate entirely and enters at Round 10 with live-grounded facts to resolve any factual disagreements definitively

For purely analytical, strategic, or historical questions where recency doesn't matter, Perplexity's web search advantage is less relevant and it functions like any other agent.

### Cost Visibility
- Live session total cost displayed in the header bar, updated after every agent call
- Per-agent cumulative cost shown in the legend
- Pricing table covers all current models for all five providers with prefix matching for dated variants
- Costs included in server-side session logs and prompt logs

### Session Management
- Sessions saved server-side on completion and on stop — survive browser close and server restart
- Session history browser with full transcript replay, export (text), and delete
- Daily-rotating server-side prompt logs capture every system prompt, user prompt, response, token counts, latency, and error for every call
- Log files browsable and downloadable from the **📋 Logs → Server logs** panel without SSH

---

## Project Structure

```
/
├── server.js          — Express proxy, logging, session persistence
├── public/
│   └── index.html     — Entire frontend (single file, ~2200 lines)
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
- API keys for at least 2 of the 5 providers
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
PERPLEXITY_API_KEY=pplx-...
PORT=3001
LOG_DIR=./logs
LOG_RETENTION_DAYS=30
SESSIONS_DIR=./sessions
```

Only configure the providers you have keys for. The UI auto-detects which providers are available and enables only those agents.

#### Obtaining API keys

| Provider | Where to get a key | Key prefix |
|---|---|---|
| Anthropic | console.anthropic.com/settings/keys | `sk-ant-` |
| OpenAI | platform.openai.com/api-keys | `sk-` |
| Grok (xAI) | console.x.ai | `xai-` |
| Google Gemini | aistudio.google.com/app/apikey | `AIza` |
| Perplexity | perplexity.ai/settings/api — requires Pro subscription or API credits | `pplx-` |

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
2. **Select focus mode** — General for analysis and strategy; Coding for implementation and review
3. **Set arbitrator** — choose which round the arbitrator activates (default: Round 10) and which agent to use (default: random; consider Perplexity for live-data grounding)
4. **Enter a problem** — specific, debatable questions with concrete constraints work best
5. **Start** — Round 1 runs in parallel independently; from Round 2 agents debate the full transcript
6. **Monitor** — watch consensus certifications appear on each message; cost accumulates in the header bar
7. **Intervene at checkpoints** — every 10 rounds (configurable) the session pauses with a concise disagreement summary; options include: add operator guidance and resume, type a definitive answer and use it directly, designate an agent to close, or end and synthesize
8. **Review history** — click 📂 History to browse all past sessions with full transcript replay

### Prompt Tips

The system works best with problems that:
- Have a specific, answerable question
- Include concrete constraints (numbers, timeframes, resources)
- Have at least 2-3 defensible positions

Examples that work well:
- Business strategy decisions with budget/resource constraints
- Technical architecture choices with specific requirements
- Medical/financial situations with defined parameters
- Policy questions where tradeoffs exist
- Current events or recent research questions (use Perplexity as arbitrator)

Prompts that tend to over-debate:
- Open-ended "most important factor" questions — agents manufacture disagreement to fill the response structure
- Simple factual lookups — the brevity rule handles these but keep prompts specific
- Questions without a decision to make — "tell me about X" produces elaboration, not debate

---

## Configuration Reference

| Setting | Default | Description |
|---|---|---|
| Focus mode | General | General or Coding — changes agent lenses, debate framing, and synthesis format |
| Model tier | Economy | Economy/Standard/Premium — selects models per tier across all providers |
| Max tokens | 1000 | Per-response token limit across all providers |
| Verbosity | Standard | Concise/Standard/Detailed — injected into system prompts |
| Pause every | 10 rounds | Checkpoint frequency for operator review |
| Consensus detection | Auto | Auto (agent self-certification) or Run to max rounds |
| Arbitrator activates | Round 10 | Round at which reserve agent enters; Disabled to turn off |
| Arbitrator | Auto (random) | Which provider to hold in reserve; explicit selection recommended for Perplexity |
| Round delay | 500ms | Pause between rounds; set to 0 for maximum speed |

---

## Provider Notes

| Provider | Economy model | Premium model | Live data | Notes |
|---|---|---|---|---|
| Anthropic | claude-haiku-4-5 | claude-sonnet-4-5 | No | Fastest responses; best instruction-following |
| OpenAI | gpt-4o-mini | gpt-4o | No | Strict model allowlist to exclude non-chat models |
| Grok (xAI) | grok-3-mini | grok-3 | No | OpenAI-compatible endpoint at api.x.ai |
| Gemini | gemini-2.5-flash | gemini-2.5-pro | No | Model name goes in URL, not body |
| Perplexity | sonar | sonar-pro | **Yes** | Live web search on every call; best used as arbitrator |

Model dropdowns populate live from each provider's model list API. Click ⟳ on any agent card to refresh. Perplexity's model list is static (no /models endpoint).

**Note on live data:** None of the providers expose their consumer web-browsing features through the API. Anthropic, OpenAI, Grok, and Gemini all reason from training data only when called via API, regardless of what their chat interfaces can do. Perplexity is the sole exception — web search is integral to every API call.

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
Round 1:  All agents respond independently (no cross-visibility) — in parallel
Round 2+: All agents see full prior transcript, respond in parallel
          Each agent appends to every response:
            [CONSENSUS: YES]  — zero remaining substantive disagreements
            [CONSENSUS: NO: reason]  — any disagreement on any topic

Consensus fires when ALL active agents certify YES in the same round.

If consensus not reached by Round N (default: 10):
  → Reserve arbitrator enters (having observed but not participated)
  → Reviews full transcript
  → Issues binding rulings on each open disagreement
  → Writes final synthesis incorporating rulings
```

Certification tags are stripped before display and shown as green/amber badges on each message. The last agent to certify YES writes the final synthesis when consensus is reached naturally.

### Without an arbitrator

When the arbitrator is disabled, the session ends in one of three ways:

1. **Consensus** — all active agents certify `[CONSENSUS: YES]` in the same round. The last agent to certify writes the final synthesis.
2. **Checkpoint pause** — every N rounds the session pauses with a concise bullet-list of open disagreements written from the most recent dissenting agent's perspective. The operator can inject guidance and resume, type a definitive answer and use it directly, designate an active agent to close the discussion, or end and synthesize.
3. **Manual stop** — the operator hits ⏹ at any point, cancelling all in-flight calls. They can then generate a synthesis from the existing transcript or export and walk away.

Without an arbitrator there is no automatic hard cap. The **Default max rounds** setting (default 50, configurable in Settings) acts as a background ceiling.

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

Files: `logs/YYYY-MM-DD.log` — retained for 30 days, then auto-deleted. Browse and download from the **📋 Logs → Server logs** panel in the UI.

---

## Limitations & Known Issues

- **No streaming** — responses appear all at once when complete, not token-by-token
- **Context growth** — long sessions send the full transcript to every agent every round; costs grow with rounds as context length increases
- **Model pricing table** — hardcoded in `index.html`; will need updating as providers change pricing
- **Parallel execution trade-off** — agents in the same round see the same prior transcript but not each other's current-round responses; within-round convergence is not possible by design
- **Rate limits** — parallel execution with long transcripts can hit provider rate limits, especially Anthropic's 50k tokens/minute limit; the 500ms stagger between agent launches reduces but does not eliminate this risk; lowering max tokens or adding round delay helps
- **Operator guidance compliance** — injecting a definitive answer via the guidance field does not guarantee agents will immediately accept it; use the "Use as final answer" button to bypass agents entirely when you want to force an end

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

- API usage costs are incurred directly with each provider (Anthropic, OpenAI, xAI, Google, Perplexity) based on tokens consumed. The live cost display in the UI tracks session spend in real time. Economy-tier models (the default) are significantly cheaper — a typical 10-round session with 4 agents costs less than $0.10 at economy tier.
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
- Additional focus modes (Medical, Legal, Financial, Technical Architecture)
- Test coverage
