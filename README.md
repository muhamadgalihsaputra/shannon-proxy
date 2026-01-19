# Shannon CLI Proxy

**_Penetration testing for those who refuse to be confined by API vendor lock-in_**

[![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-experimental-orange.svg)](https://github.com/user/shannon-cli-proxy)

> _"The best way to predict the future is to invent it."_
> — Alan Kay
>
> _"The best way to avoid vendor lock-in is to route around it."_
> — Every engineer who's been burned by API deprecations

---

## What Is This, Exactly?

Shannon CLI Proxy is a fork of [Shannon](https://github.com/KeygraphHQ/shannon) that replaces hardcoded Anthropic model references with **configurable endpoints**. This allows Shannon to work with any OpenAI-compatible API proxy, local LLM servers, or multi-provider routers.

The original Shannon is a magnificent piece of AI-powered penetration testing orchestration. It is also, regrettably, married to `claude-sonnet-4-5-20250929` in ways that would make a divorce lawyer weep. The model string is embedded not just in the application code, but deep within the `@anthropic-ai/claude-agent-sdk` bundle itself—in minified JavaScript where variable names have been reduced to single characters and hope goes to die.

We fixed that.

### The Core Problem

```
Shannon Application
      │
      ▼
┌─────────────────────────────────────────┐
│  src/ai/claude-executor.ts              │
│  model: process.env.CLAUDE_MODEL ✓      │  ◄── You can configure this
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  @anthropic-ai/claude-agent-sdk         │
│  model: 'claude-sonnet-4-5-20250929' ✗  │  ◄── But the SDK ignores you
└─────────────────────────────────────────┘
      │
      ▼
   Task Tool spawns sub-agents
   with hardcoded model
      │
      ▼
   Your proxy rejects unknown model
      │
      ▼
   💀 Failure
```

When the main Claude agent uses the `Task` tool to spawn sub-agents, those sub-agents bypass your environment configuration entirely. They use whatever model string Anthropic baked into their SDK. If your proxy doesn't recognize `claude-sonnet-4-5-20250929`, you get cryptic errors about unsupported models.

### The Solution

We patch the SDK at Docker build time using `sed`. It's not elegant. It's not pretty. But it works, and it gives you freedom.

```
Docker Build
      │
      ▼
┌─────────────────────────────────────────┐
│  npm ci (install dependencies)          │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  sed -i "s/claude-sonnet-4-5-20250929/  │
│          ${DEFAULT_MODEL}/g"            │
│  node_modules/@anthropic-ai/*           │
└─────────────────────────────────────────┘
      │
      ▼
   All model references now point
   to YOUR chosen model
      │
      ▼
   🎉 Freedom
```

---

## Philosophy (Or: Why We Built This)

### The Tyranny of Hardcoded Strings

Modern AI tooling has a curious pathology: it assumes you want to call *their* API, with *their* models, at *their* prices. This is understandable from a business perspective and insufferable from an engineering one.

You might want to:

- **Route through a local proxy** that provides caching, rate limiting, or cost tracking
- **Use alternative providers** (Groq, Together, Nebius) that offer the same models cheaper
- **Run local models** for sensitive codebases that shouldn't touch external APIs
- **Load balance** across multiple providers for reliability
- **Audit every request** passing through your infrastructure

None of this is possible when the SDK has opinions about which endpoint to call.

### The Proxy Pattern

We advocate for a simple architectural pattern: **all LLM calls route through a local proxy**.

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Infrastructure                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │   Shannon    │────────▶│   Local      │                  │
│  │   Worker     │         │   Proxy      │                  │
│  └──────────────┘         └──────────────┘                  │
│                                  │                           │
│                    ┌─────────────┼─────────────┐            │
│                    ▼             ▼             ▼            │
│             ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│             │ Anthropic│  │  Groq    │  │  Local   │        │
│             │   API    │  │   API    │  │  Ollama  │        │
│             └──────────┘  └──────────┘  └──────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

The proxy decides where requests actually go. Shannon just talks to `localhost:8317` and trusts that something intelligent will happen.

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A local LLM proxy (Claude CLI Proxy, LiteLLM, OpenRouter, etc.)
- A model that your proxy supports

### 1. Clone and Configure

```bash
git clone https://github.com/user/shannon-cli-proxy.git
cd shannon-cli-proxy

# Copy and edit environment
cp .env.example .env
```

Edit `.env`:

```bash
# Your proxy endpoint (from Docker's perspective)
ANTHROPIC_BASE_URL=http://host.docker.internal:8317

# Your proxy's API key
ANTHROPIC_API_KEY=sk-local-your-key

# The model your proxy understands
CLAUDE_MODEL=gpt-5.2-codex

# Optional: increase output tokens
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

### 2. Build the Patched Image

```bash
# This patches the SDK during build
docker compose build worker
```

The build process will:
1. Install dependencies
2. **Patch all hardcoded model strings** in `@anthropic-ai/*` packages
3. Build TypeScript
4. Create the final image

### 3. Start Shannon

```bash
# Start Temporal + Worker
docker compose up -d

# Run a pentest
./shannon start URL=https://target.example.com REPO=/path/to/target/repo
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | Yes | - | Your proxy endpoint. Use `host.docker.internal` for localhost from Docker |
| `ANTHROPIC_API_KEY` | Yes | - | API key your proxy expects |
| `CLAUDE_MODEL` | Yes | `gpt-5.2-codex` | Model identifier your proxy understands |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | No | `64000` | Maximum output tokens per request |
| `TEMPORAL_ADDRESS` | No | `temporal:7233` | Temporal server address |

### Docker Compose Build Args

| Arg | Default | Description |
|-----|---------|-------------|
| `DEFAULT_MODEL` | Value of `CLAUDE_MODEL` | Model string to patch into SDK |

### Proxy Endpoint Examples

| Proxy Type | `ANTHROPIC_BASE_URL` |
|------------|---------------------|
| Claude CLI Proxy (local) | `http://host.docker.internal:8317` |
| LiteLLM (local) | `http://host.docker.internal:4000` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Together AI | `https://api.together.xyz/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Local Ollama | `http://host.docker.internal:11434/v1` |

---

## Tested Model Configurations

We've tested Shannon with the following proxy/model combinations:

| Proxy | Model ID | Status | Notes |
|-------|----------|--------|-------|
| Claude CLI Proxy | `gpt-5.2-codex` | ✅ Works | Recommended |
| Claude CLI Proxy | `gemini-2.5-pro` | ✅ Works | Good for complex analysis |
| Claude CLI Proxy | `gemini-2.5-flash` | ✅ Works | Fast, cost-effective |
| LiteLLM | `anthropic/claude-3-5-sonnet` | ✅ Works | Native Anthropic routing |
| OpenRouter | `anthropic/claude-3.5-sonnet` | ✅ Works | Multi-provider fallback |
| Ollama | `llama3.1:70b` | ⚠️ Partial | Tool use may be limited |

---

## How the Patching Works

### The Dockerfile Modification

```dockerfile
# Build argument for configurable model
ARG DEFAULT_MODEL=gpt-5.2-codex

# Install dependencies
RUN npm ci && \
    cd mcp-server && npm ci && cd ..

# Patch SDK to use configurable model
RUN echo "Patching SDK to use model: ${DEFAULT_MODEL}" && \
    find node_modules/@anthropic-ai -type f -name "*.js" \
        -exec sed -i "s/claude-sonnet-4-5-20250929/${DEFAULT_MODEL}/g" {} \; && \
    find node_modules/@anthropic-ai -type f -name "*.js" \
        -exec sed -i "s/claude-sonnet-4-20250514/${DEFAULT_MODEL}/g" {} \; && \
    find node_modules/@anthropic-ai -type f -name "*.js" \
        -exec sed -i "s/claude-opus-4-20250514/${DEFAULT_MODEL}/g" {} \; && \
    echo "SDK patched successfully"
```

### What Gets Patched

The SDK contains several hardcoded model references:

| Original Model | Context |
|---------------|---------|
| `claude-sonnet-4-5-20250929` | Default model for agents |
| `claude-sonnet-4-20250514` | Fallback model |
| `claude-opus-4-20250514` | High-capability model |

All are replaced with your `DEFAULT_MODEL` value.

### Verifying the Patch

After building, you can verify the patch worked:

```bash
docker run --rm shannon-cli-proxy-worker \
  grep -r "claude-sonnet-4-5" /app/node_modules/@anthropic-ai/ | wc -l
# Should output: 0
```

---

## Troubleshooting

### "Model not found" or "Unsupported model"

**Cause:** Your proxy doesn't recognize the model ID being sent.

**Solution:** 
1. Check what model Shannon is requesting (look at proxy logs)
2. Ensure `CLAUDE_MODEL` in `.env` matches a model your proxy supports
3. Rebuild the Docker image: `docker compose build --no-cache worker`

### "Connection refused" to proxy

**Cause:** Docker can't reach your local proxy.

**Solution:**
1. Ensure your proxy is running and listening on the expected port
2. Use `host.docker.internal` instead of `localhost` in `ANTHROPIC_BASE_URL`
3. Check that `extra_hosts` is set in `docker-compose.yml`:
   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

### Task sub-agents still use wrong model

**Cause:** Image wasn't rebuilt after changing `CLAUDE_MODEL`.

**Solution:**
```bash
docker compose build --no-cache worker
docker compose up -d
```

The model is patched at **build time**, not runtime. Changing `.env` requires a rebuild.

### Temporal workflow stuck

**Cause:** Various—usually API errors in worker.

**Solution:**
```bash
# Check worker logs
docker compose logs -f worker

# Reset Temporal (nuclear option)
docker compose down -v
docker compose up -d
```

---

## Architecture Deep Dive

### Request Flow

```
1. User runs ./shannon start URL=... REPO=...

2. CLI creates Temporal workflow
   └─▶ Temporal Server (port 7233)

3. Worker picks up workflow
   └─▶ Creates Claude agent with ANTHROPIC_BASE_URL
   └─▶ Agent uses patched SDK (model = gpt-5.2-codex)

4. Agent needs sub-task
   └─▶ Calls Task tool
   └─▶ SDK spawns sub-agent
   └─▶ Sub-agent ALSO uses patched model (critical fix!)

5. All requests route through proxy
   └─▶ http://host.docker.internal:8317
   └─▶ Proxy routes to actual provider

6. Results flow back through Temporal
   └─▶ Deliverables written to output directory
```

### Why Temporal?

Shannon uses [Temporal](https://temporal.io/) for workflow orchestration. This provides:

- **Durability**: Workflows survive worker restarts
- **Visibility**: Web UI shows workflow state (port 8233)
- **Retries**: Failed activities automatically retry
- **Timeouts**: Long-running tasks don't hang forever

---

## Limitations

### Model Capability Requirements

Shannon expects a capable model that supports:

- **Tool use / Function calling**: Essential for all operations
- **Large context windows**: 100k+ tokens recommended
- **Strong instruction following**: Complex multi-step prompts

Models that struggle with these (most small local models) will produce poor results.

### Single Model for All Tasks

The current patching approach uses **one model for everything**. The original Shannon might have used different models for different tasks (fast model for classification, smart model for analysis). After patching, all tasks use your configured model.

This is usually fine—modern frontier models handle all tasks well—but worth noting.

### Build-Time Configuration

The model is patched at Docker build time. To change models, you must rebuild the image. This is intentional (immutable infrastructure) but can be inconvenient during experimentation.

---

## Contributing

We welcome contributions, particularly from those who:

- Have been burned by hardcoded API endpoints
- Believe in infrastructure independence
- Think vendor lock-in is an anti-pattern
- Want to run AI tools on their own terms

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## FAQ

**Q: Why not just use environment variables in the SDK?**

A: We would love to. The SDK doesn't expose this configuration. The model string is buried in minified JavaScript, likely generated from TypeScript that also doesn't expose configuration. We're working with what we have.

**Q: Is patching the SDK with `sed` safe?**

A: It's not *elegant*, but it's deterministic and auditable. The `sed` command replaces exact strings. If Anthropic changes the model format in future SDK versions, the patch might need updating—but it won't silently break. It will either work or obviously fail.

**Q: Will this work with future SDK versions?**

A: Probably, with minor adjustments. Model naming conventions are relatively stable. If Anthropic releases `claude-sonnet-5-0-20260101`, you'd add another `sed` line to the Dockerfile.

**Q: Can I use this with the official Anthropic API?**

A: Yes! Set `ANTHROPIC_BASE_URL=https://api.anthropic.com` and `CLAUDE_MODEL=claude-sonnet-4-5-20250929`. You'll get the original behavior but with the flexibility to switch providers later.

**Q: Why fork instead of PR upstream?**

A: This is a philosophical divergence, not a bug fix. The upstream project may have business reasons to prefer direct Anthropic integration. We respect that while providing an alternative for those who need flexibility.

---

## Credits

- **Shannon**: Original project by [Keygraph, Inc.](https://keygraph.io/) — the foundation we built upon
- **Claude CLI Proxy**: For making local LLM routing painless
- **Every engineer** who's ever had to work around a hardcoded string in a dependency

---

## Fork Acknowledgment

Shannon CLI Proxy is a fork of [**Shannon**](https://github.com/KeygraphHQ/shannon) by [Keygraph, Inc.](https://keygraph.io/)

We gratefully acknowledge the original authors for building an excellent AI-powered penetration testing framework. Our modifications are focused solely on provider flexibility—the core reconnaissance and analysis capabilities remain their excellent work.

If you find value in the CLI proxy additions, consider also starring the [upstream repository](https://github.com/KeygraphHQ/shannon).

---

## License

AGPL-3.0. Because security tools should be auditable, and infrastructure freedom should be shareable.

---

<p align="center">
  <i>"In a world of vendor lock-in, the proxy is liberation."</i>
</p>
