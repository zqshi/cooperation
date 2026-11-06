import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  ErrorText,
  Field,
  Input,
  Textarea,
  Select,
  post,
  put,
} from "@workagent/ui";
import type { PersonalProfile } from "@workagent/contracts";
const glyphs = { spark: "✦", leaf: "❧", star: "★", sun: "☀" };
export function ProfileForm({
  initial,
  onSaved,
}: {
  initial?: PersonalProfile;
  onSaved: () => void;
}) {
  const [styleTagsText, setStyleTagsText] = useState(initial?.styleTags?.join("，") ?? "");
  const [draft, setDraft] = useState<PersonalProfile>(
    initial ?? {
      name: "我的搭档",
      avatar: "spark",
      role: "",
      mission: "",
      selfIntroduction: "",
      userContext: "",
      styleTags: [],
      personalSkills: [],
      knowledgeEntries: [],
      memoryEntries: [],
      purpose: "",
      preferences: "",
    },
  );
  const save = useMutation({
    mutationFn: () => {
      const styleTags = styleTagsText.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
      const profile = { ...draft, styleTags };
      return initial
        ? put("/v1/personal-assistant", profile)
        : post("/v1/personal-assistant", profile);
    },
    onSuccess: onSaved,
  });
  return (
    <form
      className="wa-personal-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="搭档名称">
        <Input
          required
          maxLength={80}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <Field label="头像">
        <Select
          value={draft.avatar}
          onChange={(e) =>
            setDraft({
              ...draft,
              avatar: e.target.value as PersonalProfile["avatar"],
            })
          }
        >
          {Object.entries(glyphs).map(([key, value]) => (
            <option key={key} value={key}>
              {value}{" "}
              {{ spark: "星芒", leaf: "新叶", star: "星星", sun: "阳光" }[key]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="角色定位" hint="用一句话说明搭档擅长扮演什么角色。">
        <Input maxLength={160} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="例如：严谨的产品需求分析伙伴" />
      </Field>
      <Field label="使命" hint="搭档在协助你时要优先达成的目标。">
        <Textarea maxLength={800} rows={3} value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} placeholder="例如：帮助我把复杂问题拆解成清晰、可执行的步骤。" />
      </Field>
      <Field label="关于搭档" hint="可描述搭档的自我介绍和工作方式。">
        <Textarea maxLength={2000} rows={4} value={draft.selfIntroduction} onChange={(e) => setDraft({ ...draft, selfIntroduction: e.target.value })} placeholder="例如：我会先核实需求，再整理结论和待确认项。" />
      </Field>
      <Field
        label="工作职责"
        hint="希望搭档帮你做什么？这些内容会进入实际执行指令。"
      >
        <Textarea
          required
          maxLength={2000}
          rows={4}
          value={draft.purpose}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          placeholder="例如：帮助整理产品需求、起草周报，并明确标记待确认的信息。"
        />
      </Field>
      <Field label="关于我" hint="补充帮助搭档理解你的职责、团队和常见工作背景的信息。">
        <Textarea maxLength={4000} rows={4} value={draft.userContext} onChange={(e) => setDraft({ ...draft, userContext: e.target.value })} placeholder="例如：我负责企业产品规划，常与研发和运营团队协作。" />
      </Field>
      <Field label="沟通风格" hint="最多 8 项，以逗号分隔。">
        <Input value={styleTagsText} onChange={(e) => setStyleTagsText(e.target.value)} placeholder="先结论、简洁、严谨" />
      </Field>
      <Field label="协作偏好">
        <Textarea
          maxLength={4000}
          rows={3}
          value={draft.preferences}
          onChange={(e) => setDraft({ ...draft, preferences: e.target.value })}
          placeholder="例如：先给结论，使用中文，涉及不确定事实先向我澄清。"
        />
      </Field>
      <ErrorText error={save.error} />
      <Button type="submit" loading={save.isPending}>
        {initial ? "保存档案" : "创建搭档"}
      </Button>
      <p className="text-xs leading-5 text-slate-500">
        每个企业身份拥有一个私人搭档。你可以随时修改名称、工作职责与协作偏好。
      </p>
    </form>
  );
}
