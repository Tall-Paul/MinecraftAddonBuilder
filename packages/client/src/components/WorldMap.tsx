import { useState, useEffect, useRef, useCallback } from "react";
import { Map, Loader2, RefreshCw, ZoomOut, Crosshair } from "lucide-react";
import { getWorldMapUrl, getWorldMapMeta, getPlayerPositions } from "../api/client.js";
import type { MapMeta, MapAreaParams, PlayerPosition } from "../api/client.js";

interface Props {
  serverId: string;
  serverStatus: string;
}

export default function WorldMap({ serverId, serverStatus }: Props) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [meta, setMeta] = useState<MapMeta | null>(null);
  const [zoomArea, setZoomArea] = useState<MapAreaParams | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Player positions
  const [players, setPlayers] = useState<PlayerPosition[]>([]);

  // Poll player positions every 5 seconds when map is visible and server is running
  useEffect(() => {
    if (serverStatus !== "running" || !meta || !mapUrl) return;
    let active = true;

    async function poll() {
      try {
        const pos = await getPlayerPositions(serverId);
        if (active) setPlayers(pos);
      } catch { /* ignore */ }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [serverId, serverStatus, meta, mapUrl]);

  // Selection rectangle state
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ x: number; y: number } | null>(null);

  // Auto-load cached map on mount
  useEffect(() => {
    if (!initialized && serverStatus === "running") {
      setInitialized(true);
      setLoading(true);
      setMapUrl(getWorldMapUrl(serverId, false));
      // Fetch metadata for the overview map
      getWorldMapMeta(serverId).then(setMeta).catch(() => {});
    }
  }, [serverId, serverStatus, initialized]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setZoomArea(null);
    setMeta(null);
    setMapUrl(getWorldMapUrl(serverId, true));
  }

  function handleBackToOverview() {
    setLoading(true);
    setError(null);
    setZoomArea(null);
    setMapUrl(getWorldMapUrl(serverId, false));
  }

  // Convert block coords to percentage position on the image
  const blockToPercent = useCallback(
    (blockX: number, blockZ: number) => {
      if (!meta) return null;
      const pctX = ((blockX - meta.blockMinX) / (meta.blockMaxX - meta.blockMinX)) * 100;
      const pctZ = ((blockZ - meta.blockMinZ) / (meta.blockMaxZ - meta.blockMinZ)) * 100;
      return { left: pctX, top: pctZ };
    },
    [meta],
  );

  // For zoomed views, convert block coords relative to the zoom area
  const blockToPercentZoomed = useCallback(
    (blockX: number, blockZ: number) => {
      if (!zoomArea) return null;
      const pctX = ((blockX - zoomArea.blockX) / zoomArea.blockW) * 100;
      const pctZ = ((blockZ - zoomArea.blockZ) / zoomArea.blockH) * 100;
      return { left: pctX, top: pctZ };
    },
    [zoomArea],
  );

  // Convert pixel coords on the displayed image to block coords
  const pixelToBlocks = useCallback(
    (px: number, py: number) => {
      if (!meta || !imgRef.current) return null;
      const img = imgRef.current;
      // Map displayed pixel position to fraction of image
      const fracX = px / img.clientWidth;
      const fracZ = py / img.clientHeight;
      // Interpolate within the block-coordinate bounds from the metadata
      const blockX = meta.blockMinX + fracX * (meta.blockMaxX - meta.blockMinX);
      const blockZ = meta.blockMinZ + fracZ * (meta.blockMaxZ - meta.blockMinZ);
      return { blockX: Math.round(blockX), blockZ: Math.round(blockZ) };
    },
    [meta],
  );

  // Mouse handlers for drag-to-select on the overview
  function handleMouseDown(e: React.MouseEvent) {
    if (zoomArea || !meta) return; // Only on overview
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setSelecting(true);
    setSelStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setSelEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!selecting || !selStart) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setSelEnd({
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    });
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (!selecting || !selStart || !selEnd || !meta) {
      setSelecting(false);
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    setSelecting(false);

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const endX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const endY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    // If the drag was too small, treat as a click — zoom into a default area
    const minDrag = 20;
    const dragW = Math.abs(endX - selStart.x);
    const dragH = Math.abs(endY - selStart.y);

    let topLeftPx: { x: number; y: number };
    let bottomRightPx: { x: number; y: number };

    if (dragW < minDrag || dragH < minDrag) {
      // Click: zoom a 512x512 block area centered on click
      const center = pixelToBlocks(selStart.x, selStart.y);
      if (!center) {
        setSelStart(null);
        setSelEnd(null);
        return;
      }
      const area: MapAreaParams = {
        blockX: center.blockX - 256,
        blockZ: center.blockZ - 256,
        blockW: 512,
        blockH: 512,
        zoom: 2,
      };
      setSelStart(null);
      setSelEnd(null);
      setZoomArea(area);
      setLoading(true);
      setError(null);
      setMapUrl(getWorldMapUrl(serverId, false, area));
      return;
    } else {
      topLeftPx = {
        x: Math.min(selStart.x, endX),
        y: Math.min(selStart.y, endY),
      };
      bottomRightPx = {
        x: Math.max(selStart.x, endX),
        y: Math.max(selStart.y, endY),
      };
    }

    const tl = pixelToBlocks(topLeftPx.x, topLeftPx.y);
    const br = pixelToBlocks(bottomRightPx.x, bottomRightPx.y);
    if (!tl || !br) {
      setSelStart(null);
      setSelEnd(null);
      return;
    }

    const area: MapAreaParams = {
      blockX: tl.blockX,
      blockZ: tl.blockZ,
      blockW: br.blockX - tl.blockX,
      blockH: br.blockZ - tl.blockZ,
      zoom: 0, // Render zoomed area at zoom 0 (1 pixel = 1 block)
    };

    setSelStart(null);
    setSelEnd(null);
    setZoomArea(area);
    setLoading(true);
    setError(null);
    setMapUrl(getWorldMapUrl(serverId, false, area));
  }

  // Calculate selection rectangle style
  function getSelectionStyle(): React.CSSProperties | null {
    if (!selecting || !selStart || !selEnd) return null;
    const left = Math.min(selStart.x, selEnd.x);
    const top = Math.min(selStart.y, selEnd.y);
    const width = Math.abs(selEnd.x - selStart.x);
    const height = Math.abs(selEnd.y - selStart.y);
    return {
      position: "absolute",
      left,
      top,
      width,
      height,
      border: "2px dashed rgba(59, 130, 246, 0.8)",
      backgroundColor: "rgba(59, 130, 246, 0.15)",
      pointerEvents: "none",
    };
  }

  function handleZoomToPlayer(player: PlayerPosition) {
    const area: MapAreaParams = {
      blockX: player.x - 256,
      blockZ: player.z - 256,
      blockW: 512,
      blockH: 512,
      zoom: 2,
    };
    setZoomArea(area);
    setLoading(true);
    setError(null);
    setMapUrl(getWorldMapUrl(serverId, false, area));
  }

  const isOverview = !zoomArea;
  const canZoom = isOverview && meta && !loading;
  const overworldPlayers = players.filter(p => p.dimension === 0);

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Map size={18} />
          World Map
        </h3>
        <div className="flex items-center gap-2">
          {!isOverview && (
            <button
              onClick={handleBackToOverview}
              disabled={loading}
              className="btn-secondary text-xs py-1.5"
            >
              <ZoomOut size={14} className="inline mr-1" />
              Back to Overview
            </button>
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
      </div>

      {canZoom && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
          <Crosshair size={12} />
          Click or drag to select an area to zoom in
        </p>
      )}

      {overworldPlayers.length > 0 && mapUrl && (
        <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400 text-xs">Players:</span>
          {overworldPlayers.map((player) => (
            <button
              key={player.name}
              onClick={() => handleZoomToPlayer(player)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60 transition-colors"
              title={`Zoom to ${player.name} (${player.x}, ${player.z})`}
            >
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              {player.name}
              <span className="text-blue-400 dark:text-blue-500">({player.x}, {player.z})</span>
            </button>
          ))}
        </div>
      )}

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
          className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-900 relative"
          style={{ maxHeight: "600px" }}
        >
          <div className="relative inline-block">
            <img
              ref={imgRef}
              src={mapUrl}
              alt="World Map"
              className={`max-w-none ${canZoom ? "cursor-crosshair" : ""}`}
              draggable={false}
              onLoad={() => {
                setLoading(false);
                // Re-fetch meta after overview loads (in case it was just generated)
                if (isOverview) {
                  getWorldMapMeta(serverId).then(setMeta).catch(() => {});
                }
              }}
              onError={() => {
                setLoading(false);
                if (!initialized) {
                  setMapUrl(null);
                } else {
                  setError("Failed to generate map. The world may not have been explored yet.");
                  setMapUrl(null);
                }
              }}
              onMouseDown={canZoom ? handleMouseDown : undefined}
              onMouseMove={canZoom ? handleMouseMove : undefined}
              onMouseUp={canZoom ? handleMouseUp : undefined}
            />
            {/* Selection rectangle overlay */}
            {selecting && getSelectionStyle() && (
              <div style={getSelectionStyle()!} />
            )}
            {/* Player markers */}
            {overworldPlayers.map((player) => {
              const pos = isOverview
                ? blockToPercent(player.x, player.z)
                : blockToPercentZoomed(player.x, player.z);
              if (!pos) return null;
              // Hide markers outside the visible area
              if (pos.left < -2 || pos.left > 102 || pos.top < -2 || pos.top > 102) return null;
              return (
                <div
                  key={player.name}
                  className="absolute pointer-events-none"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%`, transform: "translate(-50%, -100%)" }}
                >
                  <div className="relative group pointer-events-auto">
                    {/* Pin marker */}
                    <div className="w-3 h-3 bg-blue-500 border-2 border-white rounded-full shadow-lg" />
                    {/* Name tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-gray-900/90 text-white text-xs rounded whitespace-nowrap">
                      {player.name}
                      <span className="text-gray-400 ml-1">({player.x}, {player.z})</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
