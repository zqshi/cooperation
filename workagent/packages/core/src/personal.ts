import { ensureDefaultProject } from "./projects.js";
import { config } from "@workagent/config";
import { tx } from "@workagent/db";
import {
  agentDefinitionSchema,
  personalProfileSchema,
  type PersonalProfile,
} from "@workagent/contracts";
import type { AuthUser } from "./auth.js";
import { compileAgent } from "./compiler.js";
import { audit } from "./audit.js";
import { notFound } from "./errors.js";

/** Narrow personal-only release policy: no tools, attachments, memory or publish override. */
export async function savePersonalAssistant(
  user: AuthUser,
  raw: unknown,
  create: boolean,
) {
  const profile = personalProfileSchema.parse(raw);
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7))", [
      user.orgId,
    ]);
    const live = await c.query(
      "SELECT user_id FROM membership WHERE org_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
      [user.orgId, user.id],
    );
    if (!live.rowCount) throw notFound();
    let agent = (
      await c.query<{ id: string; personal_profile: PersonalProfile }>(
        "SELECT id,personal_profile FROM agent WHERE org_id=$1 AND personal_owner_id=$2 FOR UPDATE",
        [user.orgId, user.id],
      )
    ).rows[0];
    await ensureDefaultProject(user, c);
    if (create && agent)
      return { id: agent.id, profile: agent.personal_profile };
    if (!create && !agent) throw notFound();
    if (!agent) {
      agent = (
        await c.query<{ id: string; personal_profile: PersonalProfile }>(
          "INSERT INTO agent(org_id,name,description,visibility,created_by,personal_owner_id,personal_profile) VALUES($1,$2,$3,'private',$4,$4,$5) RETURNING id,personal_profile",
          [
            user.orgId,
            profile.name,
            profile.purpose,
            user.id,
            JSON.stringify(profile),
          ],
        )
      ).rows[0]!;
    }
    const definition = agentDefinitionSchema.parse({
      name: profile.name,
      description: profile.purpose,
      instructions: [
        `你是用户的个人工作搭档${profile.role ? `，定位为${profile.role}` : ""}。`,
        profile.mission ? `你的使命：\n${profile.mission}` : "",
        profile.selfIntroduction ? `关于你：\n${profile.selfIntroduction}` : "",
        `工作职责：\n${profile.purpose}`,
        profile.userContext ? `关于用户及其工作背景：\n${profile.userContext}` : "",
        profile.styleTags.length ? `沟通风格：${profile.styleTags.join("、")}` : "",
        profile.personalSkills.length ? `用户启用的个人技能指引：\n${profile.personalSkills.map((item) => `【${item.name}】\n${item.instruction}`).join("\n\n")}` : "",
        profile.knowledgeEntries.length ? `用户提供的个人知识：\n${profile.knowledgeEntries.map((item) => `【${item.title}】\n${item.content}`).join("\n\n")}` : "",
        profile.memoryEntries.length ? `用户确认保留的记忆：\n${profile.memoryEntries.map((item) => `- ${item.content}`).join("\n")}` : "",
        `用户的工作偏好：\n${profile.preferences || "清晰、准确地回答；不确定时主动澄清。"}`,
      ].filter(Boolean).join("\n\n"),
      model: { model: config.modelName },
      visibility: "private",
      approval: { mode: "always" },
      memory: { enabled: false },
      limits: {
        maxTurns: 4,
        timeoutMs: 120000,
        maxToolCalls: 1,
        maxCostUsd: 0.25,
      },
    });
    const version = Number(
      (
        await c.query(
          "SELECT COALESCE(MAX(version),0)+1 AS version FROM agent_revision WHERE agent_id=$1",
          [agent.id],
        )
      ).rows[0].version,
    );
    const revision = (
      await c.query<{ id: string }>(
        "INSERT INTO agent_revision(agent_id,version,status,definition,created_by,changelog) VALUES($1,$2,'draft',$3,$4,'Personal text-only policy v1') RETURNING id",
        [agent.id, version, JSON.stringify(definition), user.id],
      )
    ).rows[0]!;
    const compiled = await compileAgent({
      orgId: user.orgId,
      agentId: agent.id,
      revisionId: revision.id,
      version,
      definition,
    });
    await c.query(
      "UPDATE agent_revision SET status='archived' WHERE agent_id=$1 AND status='published'",
      [agent.id],
    );
    await c.query(
      "UPDATE agent_revision SET status='published',bootstrap=$2,tool_plan=$3,published_at=now() WHERE id=$1",
      [
        revision.id,
        JSON.stringify(compiled.bootstrap),
        JSON.stringify(compiled.toolPlan),
      ],
    );
    await c.query(
      "UPDATE agent SET name=$2,description=$3,personal_profile=$4,current_revision_id=$5,published_version=$6,status='published' WHERE id=$1",
      [
        agent.id,
        profile.name,
        profile.purpose,
        JSON.stringify(profile),
        revision.id,
        version,
      ],
    );
    await audit(
      {
        orgId: user.orgId,
        actorId: user.id,
        action: create ? "personal.provision" : "personal.update",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: { version, policy: "personal-text-only-v1" },
      },
      c,
    );
    return { id: agent.id, profile };
  });
}
