import { useState, useEffect, useRef, useCallback } from "react";
import { Map, Loader2, RefreshCw, ZoomOut, Crosshair } from "lucide-react";
import { getWorldMapUrl, getWorldMapMeta } from "../api/client.js";
import type { MapMeta, MapAreaParams } from "../api/client.js";

interface Props {
  serverId: string;
  serverStatus: string;
}

// At zoom Z, each pixel covers 2^(-Z) blocks.
function blocksPerPixel(zoom: number): number {
  return Math.pow(2, -zoom);
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
    setMapUrl(getWorldMapUrl(serverId, true));
    // Re-fetch metadata after refresh
    setTimeout(() => {
      getWorldMapMeta(serverId).then(setMeta).catch(() => {});
    }, 1000);
  }

  function handleBackToOverview() {
    setLoading(true);
    setError(null);
    setZoomArea(null);
    setMapUrl(getWorldMapUrl(serverId, false));
  }

  // Convert pixel coords on the displayed image to block coords
  const pixelToBlocks = useCallback(
    (px: number, py: number) => {
      if (!meta || !imgRef.current) return null;
      const img = imgRef.current;
      // The displayed image may be scaled; map to natural pixel coords
      const natX = (px / img.clientWidth) * meta.imageWidth;
      const natZ = (py / img.clientHeight) * meta.imageHeight;
      const bpp = blocksPerPixel(meta.zoomLevel);
      // Block coords relative to image top-left.
      // The overview is trimmed, centered on the explored area.
      // Approximate absolute coords assuming world centered on (0,0).
      const blockX = (natX - meta.imageWidth / 2) * bpp;
      const blockZ = (natZ - meta.imageHeight / 2) * bpp;
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
      const clickX = selStart.x;
      const clickY = selStart.y;
      const bpp = blocksPerPixel(meta.zoomLevel);
      const viewBlocks = 512;
      const viewPx = viewBlocks / bpp / 2;
      topLeftPx = { x: clickX - viewPx, y: clickY - viewPx };
      bottomRightPx = { x: clickX + viewPx, y: clickY + viewPx };
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

  const isOverview = !zoomArea;
  const canZoom = isOverview && meta && !loading;

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
