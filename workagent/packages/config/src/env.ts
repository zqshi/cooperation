import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// The source package is run through tsx. Anchor to this module, never to cwd
// or an ancestor search that could consume another project's configuration.
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function loadEnv(): void {
  dotenv.config({
    path: process.env.ENV_FILE ?? path.join(workspaceRoot, ".env"),
  });
}
