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
  const [draft, setDraft] = useState<PersonalProfile>(
    initial ?? {
      name: "我的搭档",
      avatar: "spark",
      purpose: "",
      preferences: "",
    },
  );
  const save = useMutation({
    mutationFn: () =>
      initial
        ? put("/v1/personal-assistant", draft)
        : post("/v1/personal-assistant", draft),
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
