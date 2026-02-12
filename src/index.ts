#!/usr/bin/env bun
import { loadConfig, initConfig, configExists, getConfigPath, resolveSecret, updateSlackConfig, type SlackOAuthInit } from "./config.js";
import { getEnabledServers } from "./mcp/registry.js";
import { MCPClientManager } from "./mcp/client.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { runAgent } from "./llm/agent.js";
import { buildSystemPrompt, buildUserMessage } from "./report/prompt.js";
import { loadPastReports, saveReport, listReports } from "./report/memory.js";
import { loginGitHub, logoutGitHub, loadStoredGitHubToken } from "./auth/github.js";
import { getSlackToken } from "./auth/tokens.js";
import { performSlackOAuth } from "./auth/slack.js";
import {
  AtlassianOAuthProvider,
  hasAtlassianAuth,
  getAtlassianTokenInfo,
  clearAtlassianAuth,
} from "./auth/atlassian.js";
import { waitForOAuthCallback } from "./auth/callback.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";
import { log, error } from "./utils/log.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
    case "init":
      return cmdInit();
    case "run":
      return cmdRun();
    case "auth":
      return cmdAuth();
    case "login":
      return cmdLogin();
    case "logout":
      return cmdLogout();
    case "history":
      return cmdHistory();
    case "schedule":
      return cmdSchedule();
    default:
      return cmdHelp();
  }
}

async function cmdInit() {
  if (configExists()) {
    console.log(`Config already exists at ${getConfigPath()}`);
  } else {
    // Ask about Slack OAuth before writing config
    let slackOAuth: SlackOAuthInit | undefined;
    process.stderr.write("\nSet up Slack with OAuth? (y/N) ");
    const slackAnswer = await readLine();
    if (slackAnswer.trim().toLowerCase() === "y") {
      printSlackSetupGuide();
      process.stderr.write("  Slack app client ID: ");
      const clientId = (await readLine()).trim();
      if (!clientId) {
        error("Client ID is required. Skipping Slack setup.");
      } else {
        process.stderr.write("  Client secret env var [SLACK_CLIENT_SECRET]: ");
        const secretEnv = (await readLine()).trim() || "SLACK_CLIENT_SECRET";
        process.stderr.write("  Channels (comma-separated, e.g. #general, #eng): ");
        const channelsRaw = (await readLine()).trim();
        const channels = channelsRaw
          ? channelsRaw.split(",").map((c) => c.trim()).filter(Boolean)
          : [];
        slackOAuth = { client_id: clientId, client_secret_env: secretEnv, channels };
      }
    }

    console.log(initConfig(slackOAuth));
    const configPath = getConfigPath();
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, configPath], { stdio: ["ignore", "ignore", "ignore"] });
  }

  // Check LLM API key
  let config = loadConfig();
  const existingKey = resolveSecret(config.llm.api_key_env);
  if (existingKey) {
    log("LLM: API key found");
    // Verify it works
    try {
      await verifyAnthropicKey(existingKey, config.llm.model);
      log("LLM: connected");
    } catch (e) {
      error(`LLM: connection failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    process.stderr.write("\nEnter your Anthropic API key (sk-ant-...): ");
    const apiKey = (await readLine()).trim();
    if (apiKey) {
      try {
        await verifyAnthropicKey(apiKey, config.llm.model);
        saveApiKeyToConfig(apiKey);
        config = loadConfig();
        log("LLM: connected");
      } catch (e) {
        error(`LLM: connection failed — ${e instanceof Error ? e.message : String(e)}`);
        log("You can update the API key in " + getConfigPath());
      }
    } else {
      log(`Set ANTHROPIC_API_KEY env var or add the key to ${getConfigPath()}`);
    }
  }

  // Check OAuth status and offer login for missing auth
  if (!loadStoredGitHubToken() && !config.github.token_env) {
    process.stderr.write("\nLog in to GitHub with OAuth? (Y/n) ");
    const ghAnswer = await readLine();
    if (ghAnswer.trim().toLowerCase() !== "n") {
      await loginGitHub();
    }
  } else {
    log("GitHub: authenticated");
  }

  if (!hasAtlassianAuth()) {
    process.stderr.write("\nLog in to Atlassian (Jira) with OAuth? (y/N) ");
    const atlAnswer = await readLine();
    if (atlAnswer.trim().toLowerCase() === "y") {
      await cmdAuthLogin();
    }
  } else {
    log("Atlassian: authenticated");
  }

  const slackToken = getSlackToken() || (config.slack.token_env && resolveSecret(config.slack.token_env));
  if (slackToken) {
    log("Slack: authenticated");
  } else if (config.slack.client_id && config.slack.client_secret_env) {
    const clientSecret = resolveSecret(config.slack.client_secret_env);
    if (clientSecret) {
      process.stderr.write("\nRun Slack OAuth now? (Y/n) ");
      const authAnswer = await readLine();
      if (authAnswer.trim().toLowerCase() !== "n") {
        await performSlackOAuth(config.slack.client_id, clientSecret);
      } else {
        log('Run "contxt auth slack" later to complete Slack setup.');
      }
    } else {
      log(`Set ${config.slack.client_secret_env} env var, then run "contxt auth slack".`);
    }
  } else {
    process.stderr.write("\nSet up Slack with OAuth? (y/N) ");
    const slackAnswer = await readLine();
    if (slackAnswer.trim().toLowerCase() === "y") {
      printSlackSetupGuide();
      process.stderr.write("  Slack app client ID: ");
      const clientId = (await readLine()).trim();
      if (!clientId) {
        error("Client ID is required. Skipping Slack setup.");
      } else {
        process.stderr.write("  Client secret env var [SLACK_CLIENT_SECRET]: ");
        const secretEnv = (await readLine()).trim() || "SLACK_CLIENT_SECRET";
        process.stderr.write("  Channels (comma-separated, e.g. #general, #eng): ");
        const channelsRaw = (await readLine()).trim();
        const channels = channelsRaw
          ? channelsRaw.split(",").map((c) => c.trim()).filter(Boolean)
          : [];
        const slackInit: SlackOAuthInit = { client_id: clientId, client_secret_env: secretEnv, channels };
        updateSlackConfig(slackInit);
        log("Slack config saved.");

        const clientSecret = resolveSecret(secretEnv);
        if (clientSecret) {
          process.stderr.write("\nRun Slack OAuth now? (Y/n) ");
          const authAnswer = await readLine();
          if (authAnswer.trim().toLowerCase() !== "n") {
            await performSlackOAuth(clientId, clientSecret);
          } else {
            log('Run "contxt auth slack" later to complete Slack setup.');
          }
        } else {
          log(`Set ${secretEnv} env var, then run "contxt auth slack".`);
        }
      }
    }
  }
}

function printSlackSetupGuide() {
  console.error(
    `\n  To get your Slack credentials:\n` +
    `  1. Create a Slack app at https://api.slack.com/apps → "Create New App"\n` +
    `  2. Go to "OAuth & Permissions" → add redirect URL: http://localhost:8371/callback\n` +
    `  3. Under "Scopes" → "Bot Token Scopes", add: channels:history, channels:read, users:read, search:read\n` +
    `  4. Go to "Basic Information" → copy "Client ID" and "Client Secret"\n` +
    `  5. Set the secret as an env var: export SLACK_CLIENT_SECRET="your-secret"\n`
  );
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const str = Buffer.concat(chunks).toString();
      if (str.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        process.stdin.unref();
        resolve(str.split("\n")[0]);
      }
    };
    process.stdin.ref();
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function cmdAuth() {
  const subcommand = args[1];

  switch (subcommand) {
    case "login":
      return cmdAuthLogin();
    case "logout":
      return cmdAuthLogout();
    case "status":
      return cmdAuthStatus();
    case "slack":
      return cmdAuthSlack();
    default:
      console.log(`Usage:
  contxt auth login     Authenticate with Atlassian (Jira) via browser OAuth
  contxt auth logout    Remove stored Atlassian tokens
  contxt auth status    Show Atlassian authentication status
  contxt auth slack     Authenticate with Slack via browser OAuth`);
      process.exit(1);
  }
}

const CALLBACK_PORT = 32191;

async function cmdAuthLogin() {
  if (!configExists()) {
    error(`Config not found. Run "contxt init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const url = config.jira.url;

  log("Starting Atlassian OAuth login...");

  const provider = new AtlassianOAuthProvider();
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: provider,
  });

  try {
    await transport.start();
    log("Already authenticated!");
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;

    log("Opening browser for Atlassian authorization...");
    const code = await waitForOAuthCallback(CALLBACK_PORT);
    await transport.finishAuth(code);
  }

  // Verify by connecting and listing tools
  const client = new Client({ name: "contxt", version: "0.1.0" });
  await client.connect(transport);
  const result = await client.listTools();
  log(`Authenticated — ${result.tools.length} Jira tools available`);
  await transport.close();
}

function cmdAuthLogout() {
  if (hasAtlassianAuth()) {
    clearAtlassianAuth();
    log("Atlassian tokens removed.");
  } else {
    log("No stored Atlassian tokens found.");
  }
}

function cmdAuthStatus() {
  const info = getAtlassianTokenInfo();
  if (!info.hasTokens) {
    console.log("Atlassian: Not authenticated");
    console.log('  Run "contxt auth login" to authenticate.');
    return;
  }
  console.log("Atlassian: Authenticated");
  if (info.scope) console.log(`  Scope: ${info.scope}`);
  if (info.expiresIn) console.log(`  Token expires in: ${info.expiresIn}s`);
}

async function cmdAuthSlack() {
  if (!configExists()) {
    error(`Config not found. Run "contxt init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.slack.client_id) {
    error(
      `Missing client_id in [slack] config.\n` +
      `  1. Create a Slack app at https://api.slack.com/apps\n` +
      `  2. Under "OAuth & Permissions", add redirect URL: http://localhost:8371/callback\n` +
      `  3. Add bot token scopes: channels:history, channels:read, users:read, search:read\n` +
      `  4. Copy "Client ID" from "Basic Information" into ~/contxt/config.toml under [slack]`
    );
    process.exit(1);
  }

  if (!config.slack.client_secret_env) {
    error(
      `Missing client_secret_env in [slack] config.\n` +
      `  1. Copy "Client Secret" from your app's "Basic Information" page:\n` +
      `     https://api.slack.com/apps\n` +
      `  2. Set it as an env var: export SLACK_CLIENT_SECRET="xoxe-..."\n` +
      `  3. Add client_secret_env = "SLACK_CLIENT_SECRET" to [slack] in config`
    );
    process.exit(1);
  }

  const clientSecret = resolveSecret(config.slack.client_secret_env);
  if (!clientSecret) {
    error(
      `Could not resolve Slack client secret from "${config.slack.client_secret_env}".\n` +
      `  Set the ${config.slack.client_secret_env} environment variable.`
    );
    process.exit(1);
  }

  await performSlackOAuth(config.slack.client_id, clientSecret);
}

async function cmdLogin() {
  const service = args[1];
  if (service !== "github") {
    console.log('Usage: contxt login github');
    process.exit(1);
  }
  await loginGitHub();
}

async function cmdLogout() {
  const service = args[1];
  if (service !== "github") {
    console.log('Usage: contxt logout github');
    process.exit(1);
  }
  logoutGitHub();
}

async function cmdRun() {
  if (!configExists()) {
    error(`Config not found. Run "contxt init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const isDry = args.includes("--dry");
  const noSave = args.includes("--no-save");

  // Spawn MCP servers
  const servers = getEnabledServers(config);
  if (servers.length === 0) {
    error("No integrations enabled. Edit your config: " + getConfigPath());
    process.exit(1);
  }

  const mcpClient = new MCPClientManager(config.github.orgs ?? []);

  try {
    await mcpClient.connect(servers);

    const tools = mcpClient.getAllTools();
    if (tools.length === 0) {
      error("No tools available from any MCP server.");
      process.exit(1);
    }

    // Dry run: just list tools and exit
    if (isDry) {
      log(`${tools.length} tools available:`);
      for (const t of tools) {
        console.log(`  ${t.name} — ${t.description ?? "(no description)"}`);
      }
      return;
    }

    // Build prompt with memory
    const pastReports = loadPastReports(config);
    const systemPrompt = buildSystemPrompt(config, pastReports);
    const userMessage = buildUserMessage(config);

    // Run the agentic loop
    const provider = new AnthropicProvider(config);
    const report = await runAgent(provider, mcpClient, systemPrompt, userMessage);

    // Output to stdout
    console.log(report);

    // Save report
    if (!noSave) {
      const path = saveReport(config, report);
      log(`Report saved to ${path}`);
    }
  } finally {
    await mcpClient.disconnect();
  }
}

function cmdHistory() {
  if (!configExists()) {
    error(`Config not found. Run "contxt init" first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const reports = listReports(config);

  if (reports.length === 0) {
    console.log("No reports yet. Run \"contxt run\" to generate one.");
    return;
  }

  console.log("Past reports:");
  for (const r of reports) {
    console.log(`  ${r}`);
  }
}

function cmdSchedule() {
  const everyIdx = args.indexOf("--every");
  if (everyIdx === -1 || !args[everyIdx + 1]) {
    console.log('Usage: contxt schedule --every "9am"');
    console.log('       contxt schedule --every "*/6h"');
    console.log('       contxt schedule --every "*/15m"');
    process.exit(1);
  }

  const time = args[everyIdx + 1];
  const binPath = process.argv[1];

  // Parse simple time formats
  let cronExpr: string;
  if (time.match(/^\d{1,2}(am|pm)$/i)) {
    let hour = parseInt(time);
    if (time.toLowerCase().includes("pm") && hour !== 12) hour += 12;
    if (time.toLowerCase().includes("am") && hour === 12) hour = 0;
    cronExpr = `0 ${hour} * * *`;
  } else if (time.match(/^\*\/\d+h$/)) {
    const hours = parseInt(time.slice(2));
    cronExpr = `0 */${hours} * * *`;
  } else if (time.match(/^\*\/\d+m$/)) {
    const minutes = parseInt(time.slice(2));
    cronExpr = `*/${minutes} * * * *`;
  } else {
    // Assume raw cron expression
    cronExpr = time;
  }

  const cronLine = `${cronExpr} ${process.execPath} ${binPath} run`;

  console.log("Add this to your crontab (crontab -e):\n");
  console.log(`  ${cronLine}`);
  console.log("\nOr run:");
  console.log(`  (crontab -l 2>/dev/null; echo "${cronLine}") | crontab -`);
}

function cmdHelp() {
  console.log(`contxt — AI-powered daily work report generator

Commands:
  contxt init                    Create config at ~/contxt/config.toml
  contxt auth login              Authenticate with Atlassian (Jira) via browser OAuth
  contxt auth logout             Remove stored Atlassian tokens
  contxt auth status             Show Atlassian authentication status
  contxt auth slack              Authenticate with Slack via browser OAuth
  contxt login github            Authenticate with GitHub via browser OAuth
  contxt logout github           Remove stored GitHub token
  contxt run                     Generate report (stdout)
  contxt run --dry               List available tools, skip LLM
  contxt run --no-save           Don't save report to disk
  contxt history                 List past reports
  contxt schedule --every "9am"  Show crontab entry for scheduling
  contxt schedule --every "*/15m" Every N minutes
  contxt schedule --every "*/6h"  Every N hours

Environment:
  ANTHROPIC_API_KEY    Claude API key
  GITHUB_TOKEN         GitHub token (optional if using "contxt login github")
  SLACK_BOT_TOKEN      Slack bot token (optional if using "contxt auth slack")
  CONTXT_DEBUG       Set to 1 for debug logging`);
}

async function verifyAnthropicKey(apiKey: string, model: string): Promise<void> {
  const client = new Anthropic({ apiKey });
  await client.messages.create({
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "Say ok" }],
  });
}

function saveApiKeyToConfig(apiKey: string): void {
  const configPath = getConfigPath();
  const raw = readFileSync(configPath, "utf-8");
  const updated = raw.replace(
    /api_key_env\s*=\s*"[^"]*"/,
    `api_key_env = "${apiKey}"`
  );
  writeFileSync(configPath, updated);
}

main().catch((e) => {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
