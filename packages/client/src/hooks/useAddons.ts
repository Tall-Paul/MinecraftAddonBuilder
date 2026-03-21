import { useQuery } from "@tanstack/react-query";
import { searchAddons } from "../api/client.js";

export function useAddonSearch(query: string, source: string, page: number) {
  return useQuery({
    queryKey: ["addons", "search", query, source, page],
    queryFn: () => searchAddons(query, source, page),
    enabled: query.length > 0,
    staleTime: 60_000, // Cache search results for 1 minute
  });
}
