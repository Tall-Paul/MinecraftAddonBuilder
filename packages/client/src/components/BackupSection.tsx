import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Trash2, Loader2, Cloud, HardDrive } from "lucide-react";
import {
  createBackupApi,
  listBackupsApi,
  deleteBackupApi,
  getBackupDownloadUrl,
} from "../api/client.js";
import type { Backup } from "../types/index.js";

interface Props {
  serverId: string;
  serverStatus: string;
}

export default function BackupSection({ serverId, serverStatus }: Props) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["backups", serverId],
    queryFn: () => listBackupsApi(serverId),
  });

  const createMutation = useMutation({
    mutationFn: () => createBackupApi(serverId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups", serverId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBackupApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups", serverId] });
      setConfirmDelete(null);
    },
  });

  const backups = data?.backups || [];

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso + "Z");
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Archive size={18} />
          Backups
        </h3>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || serverStatus !== "running"}
          className="btn-primary text-xs py-1.5"
        >
          {createMutation.isPending ? (
            <>
              <Loader2 size={14} className="inline mr-1 animate-spin" />
              Backing up...
            </>
          ) : (
            <>
              <Archive size={14} className="inline mr-1" />
              Backup Now
            </>
          )}
        </button>
      </div>

      {createMutation.isError && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 mb-3">
          <p className="text-sm text-red-600 dark:text-red-400">
            {(createMutation.error as Error).message}
          </p>
        </div>
      )}

      {createMutation.isSuccess && (
        <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-3 mb-3">
          <p className="text-sm text-green-600 dark:text-green-400">Backup created successfully</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-bedrock-400" />
        </div>
      ) : backups.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          No backups yet — click "Backup Now" to create one
        </p>
      ) : (
        <div className="space-y-2">
          {backups.map((backup: Backup) => (
            <div
              key={backup.id}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {formatDate(backup.created_at)}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {formatSize(backup.file_size)}
                  </span>
                  {backup.google_drive_id ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <Cloud size={10} /> Drive
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <HardDrive size={10} /> Local
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <a
                  href={getBackupDownloadUrl(backup.id)}
                  className="btn-secondary text-xs py-1 px-2"
                  title="Download"
                >
                  <Download size={14} />
                </a>
                {confirmDelete === backup.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteMutation.mutate(backup.id)}
                      disabled={deleteMutation.isPending}
                      className="btn-danger text-xs py-1 px-2"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="btn-secondary text-xs py-1 px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(backup.id)}
                    className="btn-secondary text-xs py-1 px-2 text-red-500 dark:text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
