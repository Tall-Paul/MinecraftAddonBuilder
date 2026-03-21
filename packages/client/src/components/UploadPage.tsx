import { useState, useRef } from "react";
import { Upload, FileUp, CheckCircle } from "lucide-react";
import { useServers } from "../hooks/useServers.js";
import { useUploadAddon } from "../hooks/useInstall.js";

export default function UploadPage() {
  const [selectedServer, setSelectedServer] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: servers, isLoading: loadingServers } = useServers();
  const uploadMutation = useUploadAddon();

  const runningServers = servers?.filter((s) => s.status === "running") || [];

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file && isValidFile(file.name)) {
      setSelectedFile(file);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }

  function isValidFile(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.endsWith(".mcaddon") ||
      lower.endsWith(".mcpack") ||
      lower.endsWith(".zip")
    );
  }

  function handleInstall() {
    if (!selectedServer || !selectedFile) return;

    uploadMutation.mutate({
      containerId: selectedServer,
      file: selectedFile,
    });
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Upload Addon</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Upload a .mcaddon or .mcpack file to install it on one of your servers.
        Use this for addons downloaded manually from MCPEDL or other sources.
      </p>

      <div className="max-w-xl space-y-6">
        {/* File drop zone */}
        <div>
          <label className="block text-sm font-medium mb-2">Addon File</label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`card p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-bedrock-500 bg-bedrock-900/10"
                : "hover:border-gray-400 dark:hover:border-gray-600"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mcaddon,.mcpack,.zip"
              onChange={handleFileSelect}
              className="hidden"
            />

            {selectedFile ? (
              <div>
                <CheckCircle className="mx-auto mb-2 text-bedrock-400" size={32} />
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Click to change file
                </p>
              </div>
            ) : (
              <div>
                <FileUp className="mx-auto mb-2 text-gray-400 dark:text-gray-500" size={32} />
                <p className="text-gray-500 dark:text-gray-400">
                  Drag & drop a .mcaddon or .mcpack file here
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  or click to browse
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Server selection */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Target Server
          </label>
          {loadingServers ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading servers...</p>
          ) : runningServers.length === 0 ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              No running Bedrock servers found.
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

        {/* Status */}
        {uploadMutation.isError && (
          <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3">
            <p className="text-sm text-red-600 dark:text-red-400">
              Upload failed: {(uploadMutation.error as Error).message}
            </p>
          </div>
        )}

        {uploadMutation.isSuccess && (
          <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-3">
            <p className="text-sm text-green-600 dark:text-green-400">
              Addon installed successfully!
            </p>
          </div>
        )}

        {/* Install button */}
        <button
          onClick={handleInstall}
          disabled={
            !selectedFile ||
            !selectedServer ||
            uploadMutation.isPending ||
            uploadMutation.isSuccess
          }
          className="btn-primary w-full"
        >
          {uploadMutation.isPending ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block mr-2" />
              Uploading & Installing...
            </>
          ) : (
            <>
              <Upload size={16} className="inline mr-2" />
              Upload & Install
            </>
          )}
        </button>
      </div>
    </div>
  );
}
