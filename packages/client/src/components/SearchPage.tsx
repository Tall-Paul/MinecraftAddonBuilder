import { useState } from "react";
import { Search } from "lucide-react";
import { useAddonSearch } from "../hooks/useAddons.js";
import AddonCard from "./AddonCard.js";
import InstallModal from "./InstallModal.js";
import type { AddonSearchResult } from "../types/index.js";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedAddon, setSelectedAddon] = useState<AddonSearchResult | null>(
    null
  );

  const { data, isLoading, error } = useAddonSearch(searchQuery, source, page);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(query);
    setPage(0);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Search Addons</h2>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            size={18}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for Bedrock addons..."
            className="input pl-10"
          />
        </div>

        {/* Source filter */}
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(0);
          }}
          className="input w-40"
        >
          <option value="all">All Sources</option>
          <option value="mcpedl">MCPEDL</option>
          <option value="curseforge">CurseForge</option>
        </select>

        <button type="submit" className="btn-primary" disabled={!query.trim()}>
          Search
        </button>
      </form>

      {/* Results */}
      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4 mb-4">
          <p className="text-red-600 dark:text-red-400">
            Search failed: {(error as Error).message}
          </p>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-bedrock-400" />
        </div>
      )}

      {data && data.results.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 text-center py-12">
          No addons found. Try a different search term.
        </p>
      )}

      {data && data.results.length > 0 && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Found {data.totalCount} result{data.totalCount !== 1 ? "s" : ""}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.results.map((addon) => (
              <AddonCard
                key={addon.id}
                addon={addon}
                onInstall={() => setSelectedAddon(addon)}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex justify-center gap-3 mt-6">
            <button
              className="btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="text-gray-500 dark:text-gray-400 py-2">Page {page + 1}</span>
            <button
              className="btn-secondary"
              disabled={data.results.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}

      {!searchQuery && (
        <div className="text-center py-16">
          <Search className="mx-auto mb-4 text-gray-400 dark:text-gray-600" size={48} />
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            Search for Minecraft Bedrock addons to get started
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">
            Search CurseForge and MCPEDL for behavior packs, resource packs, and
            more
          </p>
        </div>
      )}

      {/* Install modal */}
      {selectedAddon && (
        <InstallModal
          addon={selectedAddon}
          onClose={() => setSelectedAddon(null)}
        />
      )}
    </div>
  );
}
