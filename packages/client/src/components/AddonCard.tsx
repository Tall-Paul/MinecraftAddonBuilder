import { Link } from "react-router-dom";
import { Download, Eye } from "lucide-react";
import type { AddonSearchResult } from "../types/index.js";

interface Props {
  addon: AddonSearchResult;
  onInstall: () => void;
}

export default function AddonCard({ addon, onInstall }: Props) {
  // Extract the source-specific ID for the detail route
  const detailId =
    addon.source === "curseforge" && addon.curseforgeId
      ? addon.curseforgeId.toString()
      : addon.id.replace(/^(cf-|mcpedl-)/, "");

  return (
    <div className="card hover:border-gray-400 dark:hover:border-gray-600 transition-colors">
      <Link to={`/addon/${addon.source}/${detailId}`} className="block">
        <div className="flex gap-3 p-4">
          {/* Thumbnail */}
          {addon.thumbnailUrl ? (
            <img
              src={addon.thumbnailUrl}
              alt={addon.name}
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <span className="text-2xl">🧩</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate hover:text-bedrock-400 transition-colors">
              {addon.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">by {addon.author}</p>

            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  addon.source === "curseforge"
                    ? "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400"
                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                }`}
              >
                {addon.source === "curseforge" ? "CurseForge" : "MCPEDL"}
              </span>
              {addon.downloadCount !== undefined && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {formatNumber(addon.downloadCount)} downloads
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="px-4 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {addon.summary}
        </p>
      </Link>

      <div className="flex gap-2 p-3 mt-2 border-t border-gray-200 dark:border-gray-700">
        <button onClick={onInstall} className="btn-primary text-xs py-1.5 flex-1">
          <Download size={14} className="inline mr-1" />
          Install
        </button>
        <Link
          to={`/addon/${addon.source}/${detailId}`}
          className="btn-secondary text-xs py-1.5"
        >
          <Eye size={14} className="inline mr-1" />
          View
        </Link>
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
