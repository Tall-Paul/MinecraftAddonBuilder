import { useState, useEffect, useRef } from "react";
import { Map, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { getWorldMapUrl } from "../api/client.js";

interface Props {
  serverId: string;
  serverStatus: string;
}

export default function WorldMap({ serverId, serverStatus }: Props) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [initialized, setInitialized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-load cached map on mount
  useEffect(() => {
    if (!initialized && serverStatus === "running") {
      setInitialized(true);
      setLoading(true);
      setMapUrl(getWorldMapUrl(serverId, scale, false));
    }
  }, [serverId, serverStatus, initialized, scale]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setMapUrl(getWorldMapUrl(serverId, scale, true));
  }

  function handleZoom(newScale: number) {
    setScale(newScale);
    if (mapUrl) {
      setLoading(true);
      setError(null);
      setMapUrl(getWorldMapUrl(serverId, newScale, true));
    }
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Map size={18} />
          World Map
        </h3>
        <div className="flex items-center gap-2">
          {mapUrl && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleZoom(Math.max(1, scale - 1))}
                disabled={scale <= 1 || loading}
                className="btn-secondary text-xs py-1 px-2"
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-center">{scale}x</span>
              <button
                onClick={() => handleZoom(Math.min(8, scale + 1))}
                disabled={scale >= 8 || loading}
                className="btn-secondary text-xs py-1 px-2"
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          )}
          {serverStatus === "running" && (
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="btn-primary text-xs py-1.5"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="inline mr-1 animate-spin" />
                  Loading...
                </>
              ) : (
                "Refresh"
              )}
            </button>
          )}
        </div>
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
          style={{ maxHeight: "500px" }}
        >
          <img
            src={mapUrl}
            alt="World Map"
            className="max-w-none"
            style={{ imageRendering: "pixelated" }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              if (!initialized) {
                // No cached map available, just show empty state
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
