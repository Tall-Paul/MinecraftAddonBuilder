import { useQuery } from "@tanstack/react-query";
import { getServers, getServerDetail } from "../api/client.js";

export function useServers() {
  return useQuery({
    queryKey: ["servers"],
    queryFn: getServers,
    refetchInterval: 10_000, // Poll every 10s for container changes
  });
}

export function useServerDetail(id: string | null) {
  return useQuery({
    queryKey: ["servers", id],
    queryFn: () => getServerDetail(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });
}
