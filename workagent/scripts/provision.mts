import { provision } from "../packages/core/src/provision.js";
import { closePool } from "../packages/db/src/client.js";
const [action, email, slug, name] = process.argv.slice(2);
let password = process.env.WORKAGENT_PROVISION_PASSWORD ?? "";
if (!password && ["tenant", "platform", "rotate"].includes(action ?? "")) {
  for await (const c of process.stdin) {
    password += c;
    if (password.length > 1024) throw new Error("Password input too long");
  }
  password = password.replace(/\r?\n$/, "");
}
try {
  const result = await provision({
    action: action ?? "",
    email: email ?? "",
    slug,
    name,
    password,
  });
  console.log(JSON.stringify(result));
} catch {
  console.error(
    "Provisioning failed; check command, identity, password policy and database state",
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
