# Penetration Test Scope & Boundaries

**Primary Directive:** Your analysis is strictly limited to the **network-accessible attack surface** of the application. All subsequent tasks must adhere to this scope. Before reporting any finding (e.g., an entry point, a vulnerability sink), you must first verify it meets the "In-Scope" criteria.

### In-Scope: Network-Reachable Components
A component is considered **in-scope** if its execution can be initiated, directly or indirectly, by a network request that the deployed application server is capable of receiving. This includes:
- Publicly exposed web pages and API endpoints.
- Endpoints requiring authentication via the application's standard login mechanisms.
- Any developer utility, debug console, or script that has been mistakenly exposed through a route or is otherwise callable from other in-scope, network-reachable code.

### Out-of-Scope: Locally Executable Only
A component is **out-of-scope** if it **cannot** be invoked through the running application's network interface and requires an execution context completely external to the application's request-response cycle. This includes tools that must be run via:
- A command-line interface (e.g., `go run ./cmd/...`, `python scripts/...`).
- A development environment's internal tooling (e.g., a "run script" button in an IDE).
- CI/CD pipeline scripts or build tools (e.g., Dagger build definitions).
- Database migration scripts, backup tools, or maintenance utilities.
- Local development servers, test harnesses, or debugging utilities.
- Static files or scripts that require manual opening in a browser (not served by the application).

---
  ## 1. Executive Summary

This repository is not a web application; it is a CLI-driven, Temporal-orchestrated pentest automation framework that targets external systems. As a result, the codebase itself does not implement network-facing HTTP routes, web controllers, or authentication endpoints. The only network-reachable components in code are the MCP tool server and any Temporal services exposed by runtime configuration, which means the external attack surface is narrow and largely depends on deployment choices rather than application logic.

Security risk concentrates in privileged execution and outbound activity. The system executes external scanners (`nmap`, `subfinder`, `whatweb`, `schemathesis`) against a user-supplied target and sends prompts containing target and credential data to the Anthropic API. If the MCP server or Temporal ports are exposed to untrusted networks, their unauthenticated tool surface and workflow endpoints become the primary entry points for abuse. Additionally, prompts and logs persist potentially sensitive credentials, creating high-impact data exposure risks if audit logs are accessible.

From an external attacker perspective, the critical question is whether the MCP server (`/target-repo/mcp-server/src/index.ts`) and Temporal services defined in `/target-repo/docker-compose.yml` are reachable over the internet. If they are, attackers can invoke tools such as `save_deliverable` or `generate_totp` without code-level authentication and may coerce the system into running scans or exfiltrating data via LLM prompts. If they are not exposed, the network attack surface is minimal, and risk shifts to insider misuse and configuration hygiene.

  ## 2. Architecture & Technology Stack
  **TASK AGENT COORDINATION:** Use findings from the **Architecture Scanner Agent** (Phase 1) to populate this section.

- **Framework & Language:** The codebase is TypeScript/Node.js with Temporal workflow orchestration. Core orchestration lives in `/target-repo/src/temporal/workflows.ts` with activities in `/target-repo/src/temporal/activities.ts`, while LLM execution uses the Claude Agent SDK in `/target-repo/src/ai/claude-executor.ts`. This architecture implies no native HTTP server is embedded; network exposure arises from Temporal and MCP runtime services rather than Express/Koa-style endpoints. The explicit `permissionMode: 'bypassPermissions'` in `/target-repo/src/ai/claude-executor.ts` expands tool access and must be treated as high-risk if external callers can trigger workflows.

- **Architectural Pattern:** The system is a hybrid CLI + workflow engine. The `shannon` CLI triggers Temporal workflows, and the workflow runs multiple vulnerability/exploit pipelines in parallel (`/target-repo/src/temporal/workflows.ts`). This creates a trust boundary between user-provided input (CLI args or config) and privileged execution of external tools and MCP actions. If any network-accessible service (Temporal gRPC/UI) is exposed, it provides a path to trigger workflows that can execute scans, file writes, or LLM prompts.

- **Critical Security Components:** There is no application-level auth/authz; security is primarily operational. Docker configuration in `/target-repo/docker-compose.yml` sets `ipc: host` and `security_opt: seccomp:unconfined`, reducing isolation, and exposes Temporal ports by default. The MCP server (`/target-repo/mcp-server/src/index.ts`) registers tools without authentication guards. The config parser includes defensive pattern checks (`/target-repo/src/config-parser.ts`) that block obvious path traversal or URL scheme injection in config values, but this does not mitigate runtime command execution or data exposure risks.

  ## 3. Authentication & Authorization Deep Dive
  **TASK AGENT COORDINATION:** Use findings from the **Security Pattern Hunter Agent** (Phase 1) to populate this section.

The codebase does not implement network authentication endpoints or a session model. Instead, it defines an authentication configuration schema used to instruct the agent how to log into a target application. These instructions are interpolated into prompts in `/target-repo/src/prompts/prompt-manager.ts` using config types in `/target-repo/src/types/config.ts` and schema rules in `/target-repo/configs/config-schema.json`. This means authentication is a *client-side automation concept*, not a server-side control. As such, there are **no login/logout/token endpoints** implemented by this system to enumerate, and no JWT/OAuth/OIDC handlers or session cookie management in code.

Session management is internal and used for audit/log concurrency only (`/target-repo/src/audit/audit-session.ts`, `/target-repo/src/utils/concurrency.ts`). There are **no session cookies** or HTTP response headers configured anywhere in the source, so there are **no code locations for `HttpOnly`, `Secure`, or `SameSite` flags**. Security headers middleware (e.g., Helmet) is absent. The only auth-adjacent runtime capability is TOTP generation exposed via an MCP tool (`/target-repo/mcp-server/src/tools/generate-totp.ts`), which is registered without authentication in `/target-repo/mcp-server/src/index.ts`.

OAuth/SSO support exists only as **prompt instructions** in `/target-repo/prompts/shared/login-instructions.txt` rather than code. There are no callback endpoints or `state`/`nonce` validators implemented in this repository. This matters for the pentest team: any OAuth or session-security weaknesses reside in the *target application* being assessed, not in this automation framework. The principal security concern inside this repo is that secrets (username/password/TOTP) are inserted into prompts and can be logged to disk (see `/target-repo/src/audit/logger.ts`).

  ## 4. Data Security & Storage
  **TASK AGENT COORDINATION:** Use findings from the **Data Security Auditor Agent** (Phase 2, if databases detected) to populate this section.

There is no application database or ORM in the source code. The only DB reference is Temporal’s local SQLite file in `/target-repo/docker-compose.yml`, which is infrastructure-level and not handled by application code. As a result, there are no SQL query builders, ORM models, or database security controls (encryption-at-rest, row-level security) implemented in this codebase. This reduces classic data layer attack surface but shifts risk to local file storage and logs.

Sensitive data flows primarily involve authentication credentials and TOTP secrets provided in configuration. These values are validated for dangerous patterns in `/target-repo/src/config-parser.ts` and then interpolated into prompt content in `/target-repo/src/prompts/prompt-manager.ts`. Because prompts are persisted via `/target-repo/src/audit/logger.ts` and `/target-repo/src/audit/utils.ts`, secrets can be written to disk in `audit-logs/.../prompts/` and echoed into workflow logs in `/target-repo/src/audit/workflow-logger.ts`. This is the primary data exposure risk: credential leakage through audit artifacts and logs rather than through database compromise.

No payment processing, PCI data handling, or explicit PII storage was detected. The only PII-like fields are `username`/`password`/`totp_secret` in `/target-repo/src/types/config.ts` and `/target-repo/configs/config-schema.json`. There is no redaction or secret masking in log outputs, so operational controls (file permissions, retention, and access control) are critical for compliance.

  ## 5. Attack Surface Analysis
  **TASK AGENT COORDINATION:** Use findings from the **Entry Point Mapper Agent** (Phase 1) and **Architecture Scanner Agent** (Phase 1) to populate this section.

The codebase does **not** expose HTTP routes, web controllers, or API endpoints. The only runtime server component in code is the MCP server that exposes tools such as `save_deliverable` and `generate_totp` (registered in `/target-repo/mcp-server/src/index.ts`). These tools are not guarded by authentication in code (`/target-repo/mcp-server/src/tools/save-deliverable.ts`, `/target-repo/mcp-server/src/tools/generate-totp.ts`). If the MCP transport is reachable over the network, these tools become the primary in-scope entry points. Otherwise, if the MCP server is bound to localhost or not exposed, the network attack surface is minimal.

Temporal services are exposed in `/target-repo/docker-compose.yml` (gRPC 7233, UI 8233). If deployed without firewalling, they are in-scope because an external request could trigger or interfere with workflows. This is significant because workflows execute external commands (`nmap`, `subfinder`, `whatweb`, `schemathesis`) and can write files inside the repo. This creates a high-privilege execution boundary: any network-accessible workflow trigger implies the ability to run scanners and manipulate outputs.

Input validation is limited to configuration parsing. `/target-repo/src/config-parser.ts` blocks obvious unsafe patterns (path traversal, `javascript:`/`data:`/`file:` URLs), but there is no network-layer validation or auth for MCP/Temporal in code. Background processing is handled by Temporal workflows (`/target-repo/src/temporal/workflows.ts`), and job execution occurs in activities (`/target-repo/src/temporal/activities.ts`), which call out to `runClaudePrompt` and external tools. From a pentest perspective, abuse of workflow triggers is the dominant risk if any of these services are network-reachable.

**Out-of-scope components (local-only):** The CLI entrypoint `shannon` and local scripts that run tools directly are out-of-scope unless they are exposed via a network-reachable service. Prompt templates and sample configs are also local-only unless explicitly served or exposed through MCP tooling.

  ## 6. Infrastructure & Operational Security

Secrets are supplied via config files and environment variables (e.g., `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` referenced indirectly in `/target-repo/src/ai/claude-executor.ts`). There is no secrets vault integration or encryption-at-rest for secrets; credentials are interpolated into prompts and logged. Operationally, this requires strict access controls on `audit-logs/` and `deliverables/` to prevent secret leakage. The MCP `generate_totp` tool (`/target-repo/mcp-server/src/tools/generate-totp.ts`) validates base32 format but does not protect secrets beyond in-memory use.

Configuration security is largely runtime and Docker-driven. The container config in `/target-repo/docker-compose.yml` uses `ipc: host` and `security_opt: seccomp:unconfined`, lowering containment. Temporal gRPC and UI ports are exposed by default, expanding the network footprint. No explicit infrastructure configuration for HSTS or `Cache-Control` headers was found in repo files; there are no Nginx/Ingress configs that set security headers, and no application-level header middleware is present.

External dependencies include `@anthropic-ai/claude-agent-sdk` and multiple scanning tools (`nmap`, `subfinder`, `whatweb`, `schemathesis`) invoked from `/target-repo/src/phases/pre-recon.ts`. These tools initiate outbound requests to user-specified targets, so any compromise or misuse could involve SSRF-like activity or scanning unauthorized hosts. Logging is extensive (`/target-repo/src/audit/logger.ts`, `/target-repo/src/audit/workflow-logger.ts`), which is valuable for traceability but raises data retention and secrecy risks if logs include credentials.

  ## 7. Overall Codebase Indexing

The repository is organized around a Temporal workflow engine (`/target-repo/src/temporal/`) with supporting phases in `/target-repo/src/phases/` and audit tooling in `/target-repo/src/audit/`. A separate MCP server package exists under `/target-repo/mcp-server/`, which defines tool endpoints and validation logic. Prompt templates are stored in `/target-repo/prompts/`, while configuration schemas and examples live in `/target-repo/configs/`. This structure centralizes security-relevant behavior in a few key locations: workflow orchestration, tool execution, audit logging, and MCP tool registration. For security review, focus on those directories because they define what can be invoked, what can execute, and what data is persisted.

Build and orchestration are Docker-based (`/target-repo/docker-compose.yml`), and the CLI entrypoint (`/target-repo/shannon`) controls execution. There are no web frameworks or API routers to enumerate. Consequently, the attack surface for an external attacker depends primarily on deployment exposure of Temporal and MCP services, rather than on code-level HTTP endpoints. This also means conventional web security concerns (route guards, session cookies, CSRF) are largely absent in the codebase.

   ## 8. Critical File Paths
		- List all the specific file paths referenced in the analysis above in a simple bulleted list. This list is for the next agent to use as a starting point.
	  - List all the specific file paths referenced in your analysis, categorized by their security relevance. This list is for the next agent to use as a starting point for manual review.
	  - **Configuration:**
      - `/target-repo/configs/config-schema.json`
      - `/target-repo/docker-compose.yml`
    - **Authentication & Authorization:**
      - `/target-repo/src/types/config.ts`
      - `/target-repo/src/prompts/prompt-manager.ts`
      - `/target-repo/prompts/shared/login-instructions.txt`
      - `/target-repo/mcp-server/src/tools/generate-totp.ts`
      - `/target-repo/mcp-server/src/index.ts`
    - **API & Routing:**
      - `/target-repo/mcp-server/src/index.ts`
      - `/target-repo/mcp-server/src/tools/save-deliverable.ts`
    - **Data Models & DB Interaction:**
      - `/target-repo/docker-compose.yml`
    - **Dependency Manifests:**
      - `/target-repo/package.json`
      - `/target-repo/tsconfig.json`
    - **Sensitive Data & Secrets Handling:**
      - `/target-repo/src/config-parser.ts`
      - `/target-repo/src/prompts/prompt-manager.ts`
      - `/target-repo/src/audit/logger.ts`
      - `/target-repo/src/audit/workflow-logger.ts`
      - `/target-repo/src/audit/utils.ts`
    - **Middleware & Input Validation:**
      - `/target-repo/src/config-parser.ts`
      - `/target-repo/src/queue-validation.ts`
      - `/target-repo/mcp-server/src/validation/totp-validator.ts`
      - `/target-repo/mcp-server/src/validation/queue-validator.ts`
    - **Logging & Monitoring:**
      - `/target-repo/src/audit/logger.ts`
      - `/target-repo/src/audit/workflow-logger.ts`
      - `/target-repo/src/audit/utils.ts`
    - **Infrastructure & Deployment:**
      - `/target-repo/docker-compose.yml`
      - `/target-repo/shannon`
      - `/target-repo/mcp-server/src/index.ts`

	 ## 9. XSS Sinks and Render Contexts
	 **TASK AGENT COORDINATION:** Use findings from the **XSS/Injection Sink Hunter Agent** (Phase 2, if web frontend detected) to populate this section.

	 **Network Surface Focus:** Only report XSS sinks that are on web app pages or publicly facing components. Exclude sinks in non-network surface pages such as local-only scripts, build tools, developer utilities, or components that require manual file opening.

	 No browser-rendered UI or web frontend exists in the codebase, and no XSS sinks were found. The agent scan did not identify `innerHTML`, `document.write`, `dangerouslySetInnerHTML`, or template-rendering engines that write to a browser context. Therefore, there are **no in-scope XSS sinks** to report.

	 For completeness, the only rendering-like behavior is prompt template substitution in `/target-repo/src/prompts/prompt-manager.ts`, which operates on strings destined for LLM prompts, not user-facing web pages. This is out-of-scope for browser XSS because it is not a network-accessible HTML rendering surface.

  ## 10. SSRF Sinks
  **TASK AGENT COORDINATION:** Use findings from the **SSRF/External Request Tracer Agent** (Phase 2, if outbound requests detected) to populate this section.

  **Network Surface Focus:** Only report SSRF sinks that are in web app pages or publicly facing components. Exclude sinks in non-network surface components such as local-only utilities, build scripts, developer tools, or CLI applications.

The only outbound network activity in code is executed by CLI-triggered scanning tools and the LLM API client. These are **not** network-reachable endpoints by themselves; they execute after a local CLI invocation or workflow trigger. Therefore, they are **out-of-scope for external SSRF** unless the Temporal or MCP services are exposed in a way that allows a remote attacker to trigger workflows or tool execution.

If Temporal or MCP is exposed, SSRF-like risks exist because user-controlled target URLs flow into external scanners and LLM calls. The key sinks are in `/target-repo/src/phases/pre-recon.ts:73`, `/target-repo/src/phases/pre-recon.ts:83`, `/target-repo/src/phases/pre-recon.ts:92`, and `/target-repo/src/phases/pre-recon.ts:111`, where `nmap`, `subfinder`, `whatweb`, and `schemathesis` are invoked with a user-specified `target`. The Anthropic SDK call (`/target-repo/src/ai/claude-executor.ts:344-345`) sends prompts containing `webUrl` and config data. These are outbound network operations, but their reachability depends on remote trigger exposure.

No in-process HTTP client libraries (`axios`, `fetch`, `got`, `undici`) were found in `/target-repo/src` or `/target-repo/mcp-server/src`, and there are no webhook handlers or HTTP endpoints implemented in the application code. This further confirms that SSRF risk is conditional on deployment-level exposure rather than intrinsic web handler logic.
