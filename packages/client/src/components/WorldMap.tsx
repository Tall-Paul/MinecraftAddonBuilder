import { useState, useEffect, useRef } from "react";
import { Map, Loader2, RefreshCw } from "lucide-react";
import { getWorldMapUrl } from "../api/client.js";

interface Props {
  serverId: string;
  serverStatus: string;
}

export default function WorldMap({ serverId, serverStatus }: Props) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-load cached map on mount
  useEffect(() => {
    if (!initialized && serverStatus === "running") {
      setInitialized(true);
      setLoading(true);
      setMapUrl(getWorldMapUrl(serverId, false));
    }
  }, [serverId, serverStatus, initialized]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setMapUrl(getWorldMapUrl(serverId, true));
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Map size={18} />
          World Map
        </h3>
        {serverStatus === "running" && (
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="btn-primary text-xs py-1.5"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="inline mr-1 animate-spin" />
                {initialized ? "Generating..." : "Loading..."}
              </>
            ) : (
              <>
                <RefreshCw size={14} className="inline mr-1" />
                Refresh
              </>
            )}
          </button>
        )}
      </div>

      {serverStatus !== "running" && !mapUrl && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Server must be running to generate a map.
        </p>
      )}

      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 mb-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {mapUrl && (
        <div
          ref={containerRef}
          className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-900"
          style={{ maxHeight: "600px" }}
        >
          <img
            src={mapUrl}
            alt="World Map"
            className="max-w-none"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              if (!initialized) {
                setMapUrl(null);
              } else {
                setError("Failed to generate map. The world may not have been explored yet.");
                setMapUrl(null);
              }
            }}
          />
        </div>
      )}

      {!mapUrl && !error && !loading && serverStatus === "running" && (
        <div className="text-center py-8">
          <Map className="mx-auto mb-3 text-gray-400 dark:text-gray-600" size={36} />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No cached map available yet — click Refresh to generate one
          </p>
        </div>
      )}
    </div>
  );
}
