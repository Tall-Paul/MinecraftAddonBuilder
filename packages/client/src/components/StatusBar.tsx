import { useQuery } from "@tanstack/react-query";

import { getStatus } from "../api/client.js";

export default function StatusBar() {
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 30_000,
  });

  return (
    <div className="flex items-center gap-4 text-sm">
      <StatusDot
        label="Docker"
        connected={status?.dockerConnected ?? false}
      />
      <StatusDot label="MCPEDL" connected={true} />
      <StatusDot
        label="CurseForge"
        connected={status?.curseforgeConfigured ?? false}
      />
    </div>
  );
}

function StatusDot({
  label,
  connected,
}: {
  label: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${
          connected ? "bg-green-400" : "bg-red-400"
        }`}
      />
      <span className="text-gray-400">{label}</span>
    </div>
  );
}
