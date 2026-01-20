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
  The **Shannon** platform is a sophisticated, autonomous penetration testing system orchestrated by **Temporal** and powered by the **Anthropic Claude SDK**. It represents a "Human-in-the-Loop" AI agent architecture where specialized agents execute security assessments in a coordinated pipeline. The system's security posture relies heavily on **architectural isolation** rather than traditional network perimeter defenses. The primary attack surface is not a traditional web server but the **AI Agent's execution environment** and its interaction with the external world via the Model Context Protocol (MCP).

  The most critical security decision is the **sandboxing strategy** for the AI agents. Agents operate within a containerized environment (Chainguard Wolfi base) and communicate with tools (like Playwright) via MCP servers running in isolated subprocesses. However, our analysis reveals that the agents have unrestricted network browsing capabilities (via Playwright) and access to the full environment variables (including secrets) of the main process. While the system implements a novel "Git Checkpoint" mechanism to rollback changes after agent execution, there is a risk of secrets being committed to these checkpoints or leaked via audit logs.

  The application architecture is a **Temporal Workflow** driven system. There are no traditional HTTP API endpoints (Express/Fastify) exposed by the application code itself. Instead, the "entry points" are the Temporal Workflows and Activities that are triggered by CLI clients. This shifts the security focus from "Broken Access Control on API Routes" to "Privilege Escalation within the Agent Context" and "Prompt Injection/Jailbreaking" of the AI model to bypass safety guardrails.

  ## 2. Architecture & Technology Stack
  **TASK AGENT COORDINATION:** Use findings from the **Architecture Scanner Agent** (Phase 1) to populate this section.

  - **Framework & Language:** The core runtime is **Node.js (v22)** using **TypeScript** with strict typing enabled (`tsconfig.json`). The system is built on the **Temporal SDK for TypeScript** for reliable orchestration.
  - **Architectural Pattern:** **Distributed Agentic Workflow**. The system uses a microservices-like pattern where "Workers" poll "Task Queues" (`shannon-pipeline`) to execute "Activities" (Agent tasks). State is managed by the Temporal Server (external dependency).
  - **Critical Security Components:**
      - **Claude Executor (`src/ai/claude-executor.ts`):** The "brain" that initializes agents, manages the context window, and communicates with the LLM.
      - **MCP Server (`mcp-server/`):** A custom implementation of the Model Context Protocol that gates access to filesystem and system tools.
      - **Git Manager (`src/utils/git-manager.ts`):** Implements the rollback safety harness.
      - **Audit Logger (`src/audit/`):** Centralized logging for all agent actions.

  ## 3. Authentication & Authorization Deep Dive
  **TASK AGENT COORDINATION:** Use findings from the **Security Pattern Hunter Agent** (Phase 1) to populate this section.

  - **Authentication Mechanisms:**
      - **Service-Level Auth:** Authentication to the Temporal Server relies on mTLS (configured via environment variables `TEMPORAL_CERT_PATH`, `TEMPORAL_KEY_PATH`), though the provided local docker-compose setup likely runs in insecure mode.
      - **Agent Auth:** There is no "login" for the agents. They operate with the privileges of the worker process. The system uses **API Keys** (e.g., `ANTHROPIC_API_KEY`) loaded from `.env` to authenticate with external AI providers.
  - **Session Management:**
      - **Workflow Identity:** "Sessions" are effectively Temporal Workflow Executions, identified by a `workflowId`. State is persisted in Temporal's history.
      - **No Web Sessions:** As there is no web UI served by this code, there are no cookies, JWTs, or traditional sessions to analyze.
  - **Authorization Model:**
      - **Implicit Trust:** Once a worker picks up a task, it is fully trusted to execute the assigned Activity. There is no internal RBAC within the worker code to limit which workflows can run which activities.
      - **Tool Restrictions:** The MCP server (`mcp-server/src/index.ts`) acts as an authorization gate, exposing *only* specific tools (`save_deliverable`, `generate_totp`) to the agent. This is a critical security boundary.

  ## 4. Data Security & Storage
  **TASK AGENT COORDINATION:** Use findings from the **Data Security Auditor Agent** (Phase 2, if databases detected) to populate this section.

  - **Database Security:** The application code does not connect directly to a SQL/NoSQL database. It relies on Temporal for state persistence.
  - **Data Flow Security:**
      - **Secret Leaks:** Secrets loaded into `process.env` (via `dotenv`) are passed to the MCP server subprocess in `src/ai/claude-executor.ts`.
      - **Audit Logs:** Tool arguments, including sensitive ones like TOTP secrets, are logged in plain text in `src/audit/logger.ts`.
  - **Git Checkpoints:** The `src/utils/git-manager.ts` commits *all* changes in the directory (`git add -A`) to a checkpoint. If an agent writes a file containing secrets to the workspace, it will be permanently recorded in the git history of the session.

  ## 5. Attack Surface Analysis
  **TASK AGENT COORDINATION:** Use findings from the **Entry Point Mapper Agent** (Phase 1) and **Architecture Scanner Agent** (Phase 1) to populate this section.

  **Instructions:**
  1. Coordinate with the Entry Point Mapper Agent to identify all potential application entry points.
  2. For each potential entry point, apply the "Master Scope Definition." Determine if it is network-reachable in a deployed environment or a local-only developer tool.
  3. Your report must only list entry points confirmed to be **in-scope**.
  4. (Optional) Create a separate section listing notable **out-of-scope** components and a brief justification for their exclusion (e.g., "Component X is a CLI tool for database migrations and is not network-accessible.").

  - **External Entry Points:**
      - **Temporal Workflow Input:** The `pentestPipelineWorkflow` accepts a `PipelineInput` object (containing `webUrl`, `depth`, etc.). Malicious input here could influence agent behavior.
      - **Agent Prompt Injection:** Since the system processes external content (web pages found during crawling), it is highly susceptible to **Indirect Prompt Injection**. If the agent browses a malicious site, hidden instructions in that site could hijack the agent's context and force it to execute unauthorized tools.

  - **Internal Service Communication:**
      - **Main Process <-> MCP Server:** Communication happens over stdio. A compromise of the MCP server (child process) could lead to privilege escalation if the isolation is weak.
      - **Worker <-> Temporal Server:** Communicates via gRPC (port 7233).

  - **Input Validation Patterns:**
      - **Schema Validation:** The system uses **Zod** schemas (e.g., `SaveDeliverableInputSchema` in `mcp-server/src/tools/save-deliverable.ts`) to strictly validate inputs to MCP tools. This is a strong defense against malformed data impacting the tool execution logic.

  ## 6. Infrastructure & Operational Security
  - **Secrets Management:** Secrets are stored in `.env` files and loaded into environment variables. There is no integration with a dedicated secrets manager (Vault, AWS Secrets Manager) visible in the code.
  - **Configuration Security:** Configuration is loaded from local JSON files (`configs/`).
  - **External Dependencies:**
      - **Anthropic API:** Critical dependency for intelligence.
      - **Docker/Playwright:** Used for browser interactions.
  - **Monitoring & Logging:**
      - **Audit Logs:** Comprehensive JSON-based logs are stored in `audit-logs/`.
      - **Console Output:** Real-time progress is printed to stdout using `ink` and `react` components (via `src/cli/progress-indicator.ts`).

  ## 7. Overall Codebase Indexing
  The codebase follows a clear separation of concerns typical of hexagonal or clean architecture. `src/temporal/` contains the business logic orchestration. `src/ai/` encapsulates the intelligence and LLM interaction. `mcp-server/` is a distinct module defining the tools available to the agent. `configs/` holds schema definitions. This structure makes security boundaries explicit—specifically the boundary between the "Brain" (`src/ai`) and the "Hands" (`mcp-server`). The use of strict TypeScript and Zod schemas throughout aids in discoverability and static analysis of data structures.
    
   ## 8. Critical File Paths
	  - **Configuration:**
      - `/target-repo/configs/config-schema.json` (Input validation rules)
      - `/target-repo/docker-compose.yml` (Infrastructure definition)
      - `/target-repo/Dockerfile` (Runtime environment)

	  - **Authentication & Authorization:**
      - `/target-repo/src/ai/claude-executor.ts` (Agent initialization & MCP server setup)
      - `/target-repo/mcp-server/src/index.ts` (Tool exposure & restriction)

	  - **API & Routing (Temporal Workflows):**
      - `/target-repo/src/temporal/workflows.ts` (Workflow definitions)
      - `/target-repo/src/temporal/activities.ts` (Activity definitions)
      - `/target-repo/src/temporal/worker.ts` (Task queue listener)

	  - **Data Models & DB Interaction:**
      - `/target-repo/mcp-server/src/types/deliverables.ts` (Output file definitions)

	  - **Sensitive Data & Secrets Handling:**
      - `/target-repo/src/utils/git-manager.ts` (Checkpoint logic - potential secret leak)
      - `/target-repo/mcp-server/src/tools/generate-totp.ts` (TOTP secret handling)
      - `/target-repo/src/audit/logger.ts` (Logging logic - potential secret leak)

	  - **Middleware & Input Validation:**
      - `/target-repo/mcp-server/src/tools/save-deliverable.ts` (File write validation)
      - `/target-repo/src/config-parser.ts` (Config loading)

	 ## 9. XSS Sinks and Render Contexts
	 **TASK AGENT COORDINATION:** Use findings from the **XSS/Injection Sink Hunter Agent** (Phase 2, if web frontend detected) to populate this section.

	 **Network Surface Focus:** Only report XSS sinks that are on web app pages or publicly facing components. Exclude sinks in non-network surface pages such as local-only scripts, build tools, developer utilities, or components that require manual file opening.

   *   **Finding:** No traditional XSS sinks (like `innerHTML` in a web server response) were found because this application **does not serve a web UI**. It is a backend worker system.
   *   **Note:** The CLI UI uses React (`ink`), but this renders to the terminal, not a browser, so XSS is not applicable in the standard sense.

  ## 10. SSRF Sinks
  **TASK AGENT COORDINATION:** Use findings from the **SSRF/External Request Tracer Agent** (Phase 2, if outbound requests detected) to populate this section.

  **Network Surface Focus:** Only report SSRF sinks that are in web app pages or publicly facing components. Exclude sinks in non-network surface components such as local-only utilities, build scripts, developer tools, or CLI applications.

  ### 1. HTTP Clients and AI Communication
  *   **File:** `/target-repo/src/ai/claude-executor.ts`
  *   **Sink:** The `query` function from `@anthropic-ai/claude-agent-sdk`.
  *   **Context:** The `prompt` sent to the AI API is derived from user input (`webUrl`). While not a traditional SSRF, it is an injection point to the AI service.

  ### 2. Playwright Configuration (Browsing Capabilities)
  *   **File:** `/target-repo/src/ai/claude-executor.ts`
  *   **Sink:** Playwright MCP Server configuration.
  *   **Context:** The agent handles a headless browser via the MCP server.
  *   **Risk:** The configuration (`mcpArgs`) **does not restrict the domains** the agent can visit. If the agent is tricked (via prompt injection) into visiting a local metadata service (e.g., `http://169.254.169.254`), it could exfiltrate cloud credentials. This is a **Critical SSRF-via-Agent** vulnerability.
