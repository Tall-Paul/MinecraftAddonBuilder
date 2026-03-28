import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, CheckCircle } from "lucide-react";
import { getSettingsApi, updateSettingsApi, getDockerNetworks } from "../api/client.js";
import BackupSettings from "./BackupSettings.js";
import type { ServerDefaults } from "../types/index.js";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettingsApi,
  });

  const { data: networks } = useQuery({
    queryKey: ["docker-networks"],
    queryFn: getDockerNetworks,
  });

  const [form, setForm] = useState<ServerDefaults | null>(null);

  // Initialize form from loaded settings
  const current = form ?? settings;

  const mutation = useMutation({
    mutationFn: updateSettingsApi,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      setForm(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading || !current) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-bedrock-400" />
      </div>
    );
  }

  // Lazy-init form state once settings load
  if (!form && settings) {
    setForm({ ...settings });
    return null;
  }

  function update(field: keyof ServerDefaults, value: string | number | boolean) {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    setSaved(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form) mutation.mutate(form);
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Network Configuration */}
        <div className="card p-5">
          <h3 className="text-lg font-semibold mb-4">Network Configuration</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Network Mode
              </label>
              <select
                value={current.networkMode}
                onChange={(e) => update("networkMode", e.target.value)}
                className="input"
              >
                <option value="bridge">Bridge (port mapping)</option>
                <option value="host">Static IP (macvlan)</option>
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Bridge mode: containers share the host IP, each gets a unique port. Static IP: each container gets its own IP on your LAN.
              </p>
            </div>

            {current.networkMode === "host" ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    LAN Network
                  </label>
                  <select
                    value={current.hostNetwork}
                    onChange={(e) => update("hostNetwork", e.target.value)}
                    className="input"
                  >
                    <option value="">-- Select a network --</option>
                    {networks?.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name} ({n.driver}{n.subnet ? ` - ${n.subnet}` : ""})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    The Docker network to attach containers to (e.g. a macvlan network bridged to your LAN)
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      IP Range Start
                    </label>
                    <input
                      type="text"
                      value={current.ipRangeStart}
                      onChange={(e) => update("ipRangeStart", e.target.value)}
                      placeholder="192.168.250.110"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      IP Range End
                    </label>
                    <input
                      type="text"
                      value={current.ipRangeEnd}
                      onChange={(e) => update("ipRangeEnd", e.target.value)}
                      placeholder="192.168.250.140"
                      className="input"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  New servers will auto-assign the next available IP. Each IP is pinged first to verify it's free.
                </p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Port Range Start
                    </label>
                    <input
                      type="number"
                      value={current.portRangeStart}
                      onChange={(e) => update("portRangeStart", parseInt(e.target.value) || 19132)}
                      placeholder="19132"
                      className="input"
                      min={1024}
                      max={65535}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Port Range End
                    </label>
                    <input
                      type="number"
                      value={current.portRangeEnd}
                      onChange={(e) => update("portRangeEnd", parseInt(e.target.value) || 19162)}
                      placeholder="19162"
                      className="input"
                      min={1024}
                      max={65535}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  New servers will auto-assign the next available port. Each port is checked for conflicts before use.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Storage Configuration */}
        <div className="card p-5">
          <h3 className="text-lg font-semibold mb-4">Storage</h3>

          <div>
            <label className="block text-sm font-medium mb-1">
              World Data Base Path
            </label>
            <input
              type="text"
              value={current.dataBasePath}
              onChange={(e) => update("dataBasePath", e.target.value)}
              placeholder="/mnt/gamedata/bedrock"
              className="input"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Host path where server data will be stored. Each server gets a subfolder named after the container.
              Leave empty to use Docker named volumes instead.
            </p>
          </div>
        </div>

        {/* Server Defaults */}
        <div className="card p-5">
          <h3 className="text-lg font-semibold mb-4">New Server Defaults</h3>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Game Mode
                </label>
                <select
                  value={current.defaultGameMode}
                  onChange={(e) => update("defaultGameMode", e.target.value)}
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
                  value={current.defaultDifficulty}
                  onChange={(e) => update("defaultDifficulty", e.target.value)}
                  className="input"
                >
                  <option value="peaceful">Peaceful</option>
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Max Players
                </label>
                <input
                  type="number"
                  value={current.defaultMaxPlayers}
                  onChange={(e) =>
                    update("defaultMaxPlayers", parseInt(e.target.value) || 10)
                  }
                  className="input"
                  min={1}
                  max={100}
                />
              </div>
              <div className="flex items-end pb-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="defaultAllowCheats"
                    checked={current.defaultAllowCheats}
                    onChange={(e) =>
                      update("defaultAllowCheats", e.target.checked)
                    }
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-bedrock-500 focus:ring-bedrock-500"
                  />
                  <label htmlFor="defaultAllowCheats" className="text-sm">
                    Allow cheats by default
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save size={16} className="inline mr-1" />
                Save Settings
              </>
            )}
          </button>

          {saved && (
            <span className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
              <CheckCircle size={16} />
              Settings saved
            </span>
          )}

          {mutation.isError && (
            <span className="text-red-600 dark:text-red-400 text-sm">
              Failed to save: {(mutation.error as Error).message}
            </span>
          )}
        </div>
      </form>

      {/* Backup Settings */}
      <div className="mt-8">
        <h2 className="text-2xl font-bold mb-6">Backups</h2>
        <BackupSettings />
      </div>
    </div>
  );
}
