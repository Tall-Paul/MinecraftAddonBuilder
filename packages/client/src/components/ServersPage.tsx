import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Server,
  Play,
  Square,
  Pause,
  ChevronRight,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServers } from "../hooks/useServers.js";
import {
  startServer,
  stopServer,
  restartServer,
  deleteServerApi,
} from "../api/client.js";
import CreateServerModal from "./CreateServerModal.js";

export default function ServersPage() {
  const { data: servers, isLoading, error } = useServers();
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: startServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
  const stopMutation = useMutation({
    mutationFn: stopServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
  const restartMutation = useMutation({
    mutationFn: restartServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteServerApi,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["servers"] }),
  });

  function handleDelete(id: string, name: string) {
    if (
      !confirm(
        `Delete server "${name}"? This will remove the container. Volume data will be preserved.`
      )
    )
      return;
    deleteMutation.mutate(id);
  }

  const anyLoading =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Bedrock Servers</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-sm"
        >
          <Plus size={16} className="inline mr-1" />
          New Server
        </button>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4 mb-4">
          <p className="text-red-600 dark:text-red-400">
            Failed to connect to Docker: {(error as Error).message}
          </p>
          <p className="text-red-500 text-sm mt-1">
            Make sure the Docker socket is mounted at /var/run/docker.sock
          </p>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-bedrock-400" />
        </div>
      )}

      {servers && servers.length === 0 && (
        <div className="text-center py-16">
          <Server className="mx-auto mb-4 text-gray-400 dark:text-gray-600" size={48} />
          <p className="text-gray-500 dark:text-gray-400 text-lg">No Bedrock servers detected</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">
            Click "New Server" to create one, or start an existing
            itzg/minecraft-bedrock-server container
          </p>
        </div>
      )}

      {servers && servers.length > 0 && (
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.containerId}
              className="card flex items-center gap-4 p-4 hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
            >
              {/* Status icon */}
              <div
                className={`p-2 rounded-lg ${
                  server.status === "running"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    : server.status === "paused"
                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {server.status === "running" ? (
                  <Play size={20} />
                ) : server.status === "paused" ? (
                  <Pause size={20} />
                ) : (
                  <Square size={20} />
                )}
              </div>

              {/* Server info — clickable link */}
              <Link
                to={`/servers/${server.containerId}`}
                className="flex-1 min-w-0"
              >
                <h3 className="font-semibold hover:text-bedrock-400 transition-colors">
                  {server.serverName || server.containerName}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>{server.containerId}</span>
                  {server.ports.length > 0 && (
                    <>
                      <span>|</span>
                      <span>
                        {server.ports
                          .map(
                            (p) =>
                              `${p.hostPort}:${p.containerPort}/${p.protocol}`
                          )
                          .join(", ")}
                      </span>
                    </>
                  )}
                </div>
              </Link>

              {/* Status badge */}
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  server.status === "running"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    : server.status === "paused"
                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {server.status}
              </span>

              {/* Controls */}
              <div className="flex items-center gap-1">
                {server.status !== "running" ? (
                  <button
                    onClick={() => startMutation.mutate(server.containerId)}
                    disabled={anyLoading}
                    className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                    title="Start"
                  >
                    <Play size={16} />
                  </button>
                ) : (
                  <button
                    onClick={() => stopMutation.mutate(server.containerId)}
                    disabled={anyLoading}
                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Stop"
                  >
                    <Square size={16} />
                  </button>
                )}
                <button
                  onClick={() => restartMutation.mutate(server.containerId)}
                  disabled={anyLoading || server.status !== "running"}
                  className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-30"
                  title="Restart"
                >
                  <RotateCw size={16} />
                </button>
                <button
                  onClick={() =>
                    handleDelete(
                      server.containerId,
                      server.serverName || server.containerName
                    )
                  }
                  disabled={anyLoading}
                  className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
                <Link
                  to={`/servers/${server.containerId}`}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  title="Details"
                >
                  <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateServerModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
