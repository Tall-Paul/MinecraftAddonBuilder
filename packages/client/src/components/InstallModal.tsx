import { useState } from "react";
import { X, Download, AlertTriangle } from "lucide-react";
import { useServers } from "../hooks/useServers.js";
import { useInstallAddon } from "../hooks/useInstall.js";
import type { AddonSearchResult } from "../types/index.js";

interface Props {
  addon: AddonSearchResult;
  onClose: () => void;
}

export default function InstallModal({ addon, onClose }: Props) {
  const [selectedServer, setSelectedServer] = useState("");
  const { data: servers, isLoading: loadingServers } = useServers();
  const installMutation = useInstallAddon();

  const runningServers = servers?.filter((s) => s.status === "running") || [];

  function handleInstall() {
    if (!selectedServer) return;

    installMutation.mutate(
      {
        containerId: selectedServer,
        source: addon.source,
        sourceId: addon.id,
        name: addon.name,
        modId: addon.curseforgeId,
        fileId: addon.curseforgeFileId,
        modrinthId: addon.modrinthId,
        modrinthVersionId: addon.modrinthVersionId,
      },
      {
        onSuccess: () => {
          setTimeout(onClose, 1500);
        },
      }
    );
  }

  const isMcpedl = addon.source === "mcpedl";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="font-semibold">Install Addon</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Addon info */}
          <div className="flex gap-3">
            {addon.thumbnailUrl ? (
              <img
                src={addon.thumbnailUrl}
                alt={addon.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center">
                <span className="text-xl">🧩</span>
              </div>
            )}
            <div>
              <p className="font-medium text-sm">{addon.name}</p>
              <p className="text-xs text-gray-400">by {addon.author}</p>
            </div>
          </div>

          {/* MCPEDL warning */}
          {isMcpedl && (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 flex gap-2">
              <AlertTriangle
                size={18}
                className="text-yellow-400 flex-shrink-0 mt-0.5"
              />
              <div className="text-xs text-yellow-300">
                <p className="font-medium">Manual download required</p>
                <p className="mt-1">
                  MCPEDL downloads can't be automated. Please download the
                  .mcaddon/.mcpack file from their website and use the Upload
                  page to install it.
                </p>
              </div>
            </div>
          )}

          {/* Server selection */}
          {!isMcpedl && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Select Server
                </label>
                {loadingServers ? (
                  <p className="text-sm text-gray-400">Loading servers...</p>
                ) : runningServers.length === 0 ? (
                  <p className="text-sm text-red-400">
                    No running Bedrock servers found. Make sure your servers are
                    running and Docker socket is connected.
                  </p>
                ) : (
                  <select
                    value={selectedServer}
                    onChange={(e) => setSelectedServer(e.target.value)}
                    className="input"
                  >
                    <option value="">Choose a server...</option>
                    {runningServers.map((s) => (
                      <option key={s.containerId} value={s.containerId}>
                        {s.serverName || s.containerName} ({s.containerId})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Status messages */}
              {installMutation.isError && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
                  <p className="text-sm text-red-400">
                    {(installMutation.error as Error).message}
                  </p>
                </div>
              )}

              {installMutation.isSuccess && (
                <div className="bg-green-900/30 border border-green-700 rounded-lg p-3">
                  <p className="text-sm text-green-400">
                    Addon installed successfully!
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <button onClick={onClose} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleInstall}
                  disabled={
                    !selectedServer ||
                    installMutation.isPending ||
                    installMutation.isSuccess
                  }
                  className="btn-primary text-sm"
                >
                  {installMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block mr-2" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download size={14} className="inline mr-1" />
                      Install
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {isMcpedl && (
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">
                Close
              </button>
              <a
                href={addon.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm inline-block"
              >
                Open MCPEDL Page
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
