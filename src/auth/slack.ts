import { loadTokens, saveTokens } from "./tokens.js";
import type { SlackTokenData } from "./tokens.js";
import { log, error } from "../utils/log.js";
import { readLine } from "../utils/readline.js";

/**
 * Prompt the user to paste their Slack Bot User OAuth Token.
 * Validates the token format and saves it to ~/reporter/tokens.json.
 */
export async function promptSlackToken(): Promise<void> {
  printSlackSetupGuide();

  process.stderr.write("  Paste your Bot User OAuth Token (xoxb-...): ");
  const token = (await readLine()).trim();

  if (!token) {
    error("No token provided. Skipping Slack auth.");
    return;
  }

  if (!token.startsWith("xoxb-")) {
    error(
      `Token should start with "xoxb-". Got "${token.slice(0, 8)}..."\n` +
      `  Make sure you copy the "Bot User OAuth Token", not the signing secret.`
    );
    return;
  }

  const tokenData: SlackTokenData = {
    access_token: token,
    token_type: "bot",
    scope: "",
    team: { id: "unknown", name: "unknown" },
    obtained_at: new Date().toISOString(),
  };

  const store = loadTokens();
  store.slack = tokenData;
  saveTokens(store);

  log("Slack token saved.");
}

function printSlackSetupGuide() {
  console.error(
    `\n  To set up Slack:\n` +
    `  1. Go to https://api.slack.com/apps → "Create New App" → "From scratch"\n` +
    `  2. Go to "OAuth & Permissions" → under "Bot Token Scopes", add:\n` +
    `     channels:history, channels:read, users:read, search:read\n` +
    `  3. Click "Install to Workspace" and approve the permissions\n` +
    `  4. Copy the "Bot User OAuth Token" (starts with xoxb-)\n`
  );
}
