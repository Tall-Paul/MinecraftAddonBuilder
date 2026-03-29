import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Cloud, Save, Loader2, Upload, AlertTriangle, ExternalLink } from "lucide-react";
import {
  getBackupScheduleApi,
  updateBackupScheduleApi,
  getGoogleDriveConfigApi,
  uploadGoogleDriveCredentials,
  getServers,
} from "../api/client.js";

export default function BackupSettings() {
  const queryClient = useQueryClient();

  // Schedule
  const { data: schedule } = useQuery({
    queryKey: ["backup-schedule"],
    queryFn: getBackupScheduleApi,
  });
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("03:00");
  const [allServers, setAllServers] = useState(true);

  useEffect(() => {
    if (schedule) {
      setEnabled(schedule.enabled);
      setTime(schedule.time);
      setAllServers(schedule.containers.includes("all"));
    }
  }, [schedule]);

  const scheduleMutation = useMutation({
    mutationFn: () =>
      updateBackupScheduleApi({
        enabled,
        time,
        containers: allServers ? ["all"] : [],
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backup-schedule"] }),
  });

  // Google Drive
  const { data: gdrive } = useQuery({
    queryKey: ["gdrive-config"],
    queryFn: getGoogleDriveConfigApi,
  });
  const [credFile, setCredFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (gdrive) {
      setFolderId(gdrive.folderId);
    }
  }, [gdrive]);

  const gdriveMutation = useMutation({
    mutationFn: () => uploadGoogleDriveCredentials(credFile, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdrive-config"] });
      setCredFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  // Server list for reference
  const { data: servers } = useQuery({
    queryKey: ["servers"],
    queryFn: getServers,
  });

  return (
    <div className="space-y-6">
      {/* Backup Schedule */}
      <div className="card p-5">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock size={18} />
          Scheduled Backups
        </h3>

        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm">Enable daily automatic backups</span>
          </label>

          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Backup Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={!enabled}
                className="input text-sm py-1.5 px-3 w-32"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Servers
              </label>
              <select
                value={allServers ? "all" : "select"}
                onChange={(e) => setAllServers(e.target.value === "all")}
                disabled={!enabled}
                className="input text-sm py-1.5 px-3"
              >
                <option value="all">All running servers</option>
              </select>
            </div>
          </div>

          {servers && servers.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Currently tracking {servers.filter((s) => s.status === "running").length} running server(s).
              Old backups are automatically cleaned up (keeps last 7 per server).
            </p>
          )}

          <button
            onClick={() => scheduleMutation.mutate()}
            disabled={scheduleMutation.isPending}
            className="btn-primary text-sm"
          >
            {scheduleMutation.isPending ? (
              <Loader2 size={14} className="inline mr-1 animate-spin" />
            ) : (
              <Save size={14} className="inline mr-1" />
            )}
            Save Schedule
          </button>

          {scheduleMutation.isSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">Schedule saved</p>
          )}
        </div>
      </div>

      {/* Google Drive */}
      <div className="card p-5">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Cloud size={18} />
          Google Drive
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                gdrive?.configured
                  ? "bg-green-500"
                  : "bg-gray-400 dark:bg-gray-600"
              }`}
            />
            <span className="text-sm">
              {gdrive?.configured ? "Connected" : "Not configured"}
            </span>
          </div>

          {/* Last error */}
          {gdrive?.lastError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-red-600 dark:text-red-400">
                  <p className="font-medium mb-1">Last upload failed</p>
                  <p>{gdrive.lastError}</p>
                </div>
              </div>
            </div>
          )}

          {/* Setup instructions */}
          {!gdrive?.configured && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">Setup steps:</p>
              <ol className="text-xs text-blue-600 dark:text-blue-400 space-y-1 list-decimal list-inside">
                <li>Create a project in the <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="underline">Google Cloud Console</a></li>
                <li>Enable the <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer" className="underline">Google Drive API</a> for your project</li>
                <li>Create a Service Account under IAM &gt; Service Accounts</li>
                <li>Download the JSON key file and upload it below</li>
                <li>Create a folder in your Google Drive for backups</li>
                <li>Share the folder with the service account email (Editor access)</li>
                <li>Paste the folder ID below (from the folder URL)</li>
              </ol>
            </div>
          )}

          {/* Storage quota error hint */}
          {gdrive?.lastError?.includes("storage quota") && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Service accounts have no storage quota. Make sure you've set a <strong>Folder ID</strong> below
                and shared that folder with the service account email as an <strong>Editor</strong>.
              </p>
            </div>
          )}

          {/* API enable link when configured but API is disabled */}
          {gdrive?.configured && gdrive.projectId && gdrive.lastError?.includes("API has not been used") && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                The Google Drive API needs to be enabled for your project:
              </p>
              <a
                href={`https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${gdrive.projectId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 underline"
              >
                <ExternalLink size={12} />
                Enable Google Drive API for project {gdrive.projectId}
              </a>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Service Account Key File
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary text-sm py-1.5"
              >
                <Upload size={14} className="inline mr-1" />
                {credFile ? credFile.name : gdrive?.configured ? "Replace credentials" : "Upload JSON key"}
              </button>
              {credFile && (
                <span className="text-xs text-green-600 dark:text-green-400">
                  Ready to upload
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => setCredFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          {/* Show service account email when configured */}
          {gdrive?.configured && gdrive.serviceAccountEmail && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Service account: <span className="font-mono">{gdrive.serviceAccountEmail}</span>
              <br />Share your Drive folder with this email address.
            </p>
          )}

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Google Drive Folder ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              placeholder="e.g. 1ABC123def456..."
              className="input text-sm py-1.5 px-3 w-full"
              required
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Required — service accounts have no storage quota of their own, so backups must be
              uploaded to a folder you own. Create a folder in your Google Drive, share it with the
              service account email (Editor access), and paste the folder ID here (the long string
              after <span className="font-mono">/folders/</span> in the URL).
            </p>
          </div>

          <button
            onClick={() => gdriveMutation.mutate()}
            disabled={gdriveMutation.isPending}
            className="btn-primary text-sm"
          >
            {gdriveMutation.isPending ? (
              <Loader2 size={14} className="inline mr-1 animate-spin" />
            ) : (
              <Save size={14} className="inline mr-1" />
            )}
            Save Google Drive Settings
          </button>

          {gdriveMutation.isSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">Google Drive settings saved</p>
          )}
          {gdriveMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {(gdriveMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
