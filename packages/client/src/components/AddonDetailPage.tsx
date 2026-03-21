import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Calendar,
  Tag,
  FileDown,
  Image as ImageIcon,
} from "lucide-react";
import { getAddonDetail } from "../api/client.js";
import InstallModal from "./InstallModal.js";
import type { AddonSearchResult } from "../types/index.js";

export default function AddonDetailPage() {
  const { source, id } = useParams<{ source: string; id: string }>();
  const [showInstall, setShowInstall] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  const {
    data: addon,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["addon-detail", source, id],
    queryFn: () => getAddonDetail(source!, id!),
    enabled: !!source && !!id,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-bedrock-400" />
      </div>
    );
  }

  if (error || !addon) {
    return (
      <div>
        <Link
          to="/"
          className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4"
        >
          <ArrowLeft size={16} /> Back to search
        </Link>
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">
            {error ? (error as Error).message : "Addon not found"}
          </p>
        </div>
      </div>
    );
  }

  // Build a search result object for the install modal
  const addonForInstall: AddonSearchResult = {
    id: addon.id,
    source: addon.source,
    name: addon.name,
    summary: addon.summary,
    author: addon.author,
    thumbnailUrl: addon.thumbnailUrl,
    downloadCount: addon.downloadCount,
    pageUrl: addon.pageUrl,
    curseforgeId: addon.curseforgeId,
    curseforgeFileId: addon.curseforgeFileId,
  };

  return (
    <div>
      <Link
        to="/"
        className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to search
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex gap-5">
          {addon.thumbnailUrl ? (
            <img
              src={addon.thumbnailUrl}
              alt={addon.name}
              className="w-24 h-24 rounded-xl object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-24 h-24 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <span className="text-4xl">🧩</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{addon.name}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">by {addon.author}</p>

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <span
                className={`text-xs px-2 py-1 rounded ${
                  addon.source === "curseforge"
                    ? "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400"
                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                }`}
              >
                {addon.source === "curseforge" ? "CurseForge" : "MCPEDL"}
              </span>

              {addon.downloadCount !== undefined && (
                <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Download size={14} />
                  {addon.downloadCount.toLocaleString()} downloads
                </span>
              )}

              {addon.dateModified && (
                <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Calendar size={14} />
                  Updated{" "}
                  {new Date(addon.dateModified).toLocaleDateString()}
                </span>
              )}

              {addon.latestFileName && (
                <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <FileDown size={14} />
                  {addon.latestFileName}
                </span>
              )}
            </div>

            {addon.categories && addon.categories.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Tag size={14} className="text-gray-400 dark:text-gray-500" />
                {addon.categories.map((cat) => (
                  <span
                    key={cat}
                    className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => setShowInstall(true)}
            className="btn-primary"
          >
            <Download size={16} className="inline mr-1" />
            Install to Server
          </button>
          <a
            href={addon.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <ExternalLink size={16} className="inline mr-1" />
            View on {addon.source === "curseforge" ? "CurseForge" : "MCPEDL"}
          </a>
        </div>
      </div>

      {/* Summary */}
      <div className="card p-5 mb-6">
        <p className="text-gray-700 dark:text-gray-300">{addon.summary}</p>
      </div>

      {/* Description */}
      {addon.description && addon.description !== addon.summary && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Description</h2>
          <div
            className="addon-description prose prose-invert max-w-none text-sm text-gray-700 dark:text-gray-300
              [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-gray-900 dark:[&_h1]:text-gray-100 [&_h1]:mt-4 [&_h1]:mb-2
              [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-gray-900 dark:[&_h2]:text-gray-100 [&_h2]:mt-4 [&_h2]:mb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-800 dark:[&_h3]:text-gray-200 [&_h3]:mt-3 [&_h3]:mb-1
              [&_p]:mb-2 [&_p]:leading-relaxed
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
              [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
              [&_li]:mb-1
              [&_a]:text-bedrock-600 dark:[&_a]:text-bedrock-400 [&_a]:underline hover:[&_a]:text-bedrock-500 dark:hover:[&_a]:text-bedrock-300
              [&_img]:rounded-lg [&_img]:my-3 [&_img]:max-w-full
              [&_strong]:text-gray-900 dark:[&_strong]:text-gray-100
              [&_hr]:border-gray-200 dark:[&_hr]:border-gray-700 [&_hr]:my-4"
            dangerouslySetInnerHTML={{ __html: addon.description }}
          />
        </div>
      )}

      {/* Screenshots */}
      {addon.screenshots.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ImageIcon size={18} />
            Screenshots ({addon.screenshots.length})
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {addon.screenshots.map((url, i) => (
              <button
                key={i}
                onClick={() => setSelectedScreenshot(url)}
                className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                <img
                  src={url}
                  alt={`Screenshot ${i + 1}`}
                  className="w-full h-32 object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Screenshot lightbox */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={() => setSelectedScreenshot(null)}
        >
          <img
            src={selectedScreenshot}
            alt="Screenshot"
            className="max-w-full max-h-[90vh] rounded-lg"
          />
        </div>
      )}

      {/* Install modal */}
      {showInstall && (
        <InstallModal
          addon={addonForInstall}
          onClose={() => setShowInstall(false)}
        />
      )}
    </div>
  );
}
