import { useQuery } from "@tanstack/react-query";
import { get, useAuth } from "@workagent/ui";
import type { PersonalProfile, AgentSummary } from "@workagent/contracts";
export type PersonalState = {
  agent:
    (AgentSummary & { profile: PersonalProfile; activeVersion: number }) | null;
  readiness: {
    definitionReady: boolean;
    modelConfigured: boolean;
    canExecute: boolean;
  };
};

export function usePersonalAssistant() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["personal-assistant", user?.orgId, user?.id],
    queryFn: () => get<PersonalState>("/v1/personal-assistant"),
    enabled: !!user,
    retry: false,
    staleTime: 0,
  });
}
