import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trash2, Package, RotateCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerDetail } from "../hooks/useServers.js";
import { useUninstallAddon } from "../hooks/useInstall.js";
import { restartServer } from "../api/client.js";
import type { Installation } from "../types/index.js";

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useServerDetail(id || null);
  const uninstallMutation = useUninstallAddon();
  const queryClient = useQueryClient();
  const restartMutation = useMutation({
    mutationFn: restartServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-bedrock-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <Link
          to="/servers"
          className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4"
        >
          <ArrowLeft size={16} /> Back to servers
        </Link>
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">
            {error ? (error as Error).message : "Server not found"}
          </p>
        </div>
      </div>
    );
  }

  const { server, installations } = data;

  function handleUninstall(installation: Installation) {
    if (
      !confirm(
        `Uninstall "${installation.addon_name}" from ${server.containerName}?`
      )
    ) {
      return;
    }
    uninstallMutation.mutate({
      containerId: server.containerId,
      installationId: installation.id,
    });
  }

  return (
    <div>
      <Link
        to="/servers"
        className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to servers
      </Link>

      {/* Server Info */}
      <div className="card p-5 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              {server.serverName || server.containerName}
            </h2>
            <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{server.image}</span>
              <span className="text-gray-400 dark:text-gray-600">|</span>
              <span>ID: {server.containerId}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {server.status === "running" && (
              <button
                onClick={() => restartMutation.mutate(server.containerId)}
                disabled={restartMutation.isPending}
                className="btn-secondary text-xs py-1.5"
              >
                <RotateCw size={14} className={`inline mr-1 ${restartMutation.isPending ? "animate-spin" : ""}`} />
                Restart
              </button>
            )}
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              server.status === "running"
                ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
            }`}
          >
            {server.status}
          </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <InfoItem label="Level Name" value={server.levelName || "—"} />
          <InfoItem label="Game Mode" value={server.gameMode || "—"} />
          <InfoItem
            label="Ports"
            value={
              server.ports
                .map((p) => `${p.hostPort}:${p.containerPort}`)
                .join(", ") || "—"
            }
          />
          <InfoItem
            label="Registered Packs"
            value={`${server.installedBehaviorPacks.length} BP / ${server.installedResourcePacks.length} RP`}
          />
        </div>
      </div>

      {/* Installed Addons */}
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Package size={18} />
        Installed Addons ({installations.length})
      </h3>

      {installations.length === 0 ? (
        <div className="card p-8 text-center">
          <Package className="mx-auto mb-3 text-gray-400 dark:text-gray-600" size={36} />
          <p className="text-gray-500 dark:text-gray-400">No addons installed via this manager</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
            Search for addons or upload a .mcaddon file to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {installations.map((inst: Installation) => {
            const packs = JSON.parse(inst.packs) as Array<{
              name: string;
              uuid: string;
              type: string;
            }>;

            return (
              <div
                key={inst.id}
                className="card flex items-center justify-between p-4"
              >
                <div>
                  <h4 className="font-medium text-sm">{inst.addon_name}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {inst.addon_source}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-600">|</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {packs.length} pack{packs.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-600">|</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(inst.installed_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {packs.map((p) => (
                      <span
                        key={p.uuid}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          p.type === "behavior"
                            ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                            : "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400"
                        }`}
                      >
                        {p.type === "behavior" ? "BP" : "RP"}: {p.name}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => handleUninstall(inst)}
                  disabled={
                    uninstallMutation.isPending || server.status !== "running"
                  }
                  className="btn-danger text-xs py-1.5"
                  title="Uninstall addon"
                >
                  <Trash2 size={14} className="inline mr-1" />
                  Uninstall
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}
