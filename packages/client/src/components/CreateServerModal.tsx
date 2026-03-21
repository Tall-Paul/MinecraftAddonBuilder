import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createServer, getSettingsApi } from "../api/client.js";

interface Props {
  onClose: () => void;
}

export default function CreateServerModal({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [formReady, setFormReady] = useState(false);
  const [form, setForm] = useState({
    name: "",
    serverName: "",
    gameMode: "survival",
    difficulty: "normal",
    maxPlayers: 10,
    allowCheats: false,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettingsApi,
  });

  // Apply settings defaults once loaded
  if (settings && !formReady) {
    setForm((f) => ({
      ...f,
      gameMode: settings.defaultGameMode || f.gameMode,
      difficulty: settings.defaultDifficulty || f.difficulty,
      maxPlayers: settings.defaultMaxPlayers || f.maxPlayers,
      allowCheats: settings.defaultAllowCheats ?? f.allowCheats,
    }));
    setFormReady(true);
  }

  const mutation = useMutation({
    mutationFn: createServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      setTimeout(onClose, 1500);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.serverName) return;
    mutation.mutate(form);
  }

  function update(field: string, value: string | number | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Describe what networking will be used
  const networkInfo = settings
    ? settings.networkMode === "host" && settings.hostNetwork
      ? `Static IP auto-assigned on ${settings.hostNetwork} (${settings.ipRangeStart} - ${settings.ipRangeEnd})`
      : `Port auto-assigned from range ${settings.portRangeStart} - ${settings.portRangeEnd}`
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold">Create New Server</h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Container name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Container Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="bedrock-server-1"
              className="input"
              required
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Docker container name (lowercase, no spaces)
            </p>
          </div>

          {/* Server name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Server Name
            </label>
            <input
              type="text"
              value={form.serverName}
              onChange={(e) => update("serverName", e.target.value)}
              placeholder="My Bedrock Server"
              className="input"
              required
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              The name shown in the server list in-game
            </p>
          </div>

          {/* Game Mode / Difficulty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Game Mode
              </label>
              <select
                value={form.gameMode}
                onChange={(e) => update("gameMode", e.target.value)}
                className="input"
              >
                <option value="survival">Survival</option>
                <option value="creative">Creative</option>
                <option value="adventure">Adventure</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Difficulty
              </label>
              <select
                value={form.difficulty}
                onChange={(e) => update("difficulty", e.target.value)}
                className="input"
              >
                <option value="peaceful">Peaceful</option>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          {/* Max Players / Cheats */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Max Players
              </label>
              <input
                type="number"
                value={form.maxPlayers}
                onChange={(e) => update("maxPlayers", parseInt(e.target.value) || 10)}
                className="input"
                min={1}
                max={100}
              />
            </div>
            <div className="flex items-end pb-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="allowCheats"
                  checked={form.allowCheats}
                  onChange={(e) => update("allowCheats", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-bedrock-500 focus:ring-bedrock-500"
                />
                <label htmlFor="allowCheats" className="text-sm">
                  Allow cheats
                </label>
              </div>
            </div>
          </div>

          {/* Auto-assigned info */}
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            {networkInfo && (
              <p>
                <span className="text-gray-400 dark:text-gray-500">Network:</span>{" "}
                <span className="text-gray-700 dark:text-gray-300">{networkInfo}</span>
              </p>
            )}
            {settings?.dataBasePath && (
              <p>
                <span className="text-gray-400 dark:text-gray-500">Data path:</span>{" "}
                <span className="text-gray-700 dark:text-gray-300 font-mono">
                  {settings.dataBasePath}/{form.name || "<container-name>"}
                </span>
              </p>
            )}
          </div>

          {/* Status */}
          {mutation.isError && (
            <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-400">
                {(mutation.error as Error).message}
              </p>
            </div>
          )}

          {mutation.isSuccess && (
            <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-3">
              <p className="text-sm text-green-600 dark:text-green-400">
                Server created and starting up!
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                !form.name ||
                !form.serverName ||
                mutation.isPending ||
                mutation.isSuccess
              }
              className="btn-primary text-sm"
            >
              {mutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={14} className="inline mr-1" />
                  Create Server
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
