import { Routes, Route, NavLink } from "react-router-dom";
import { Search, Server, Upload, Settings } from "lucide-react";
import SearchPage from "./components/SearchPage.js";
import ServersPage from "./components/ServersPage.js";
import ServerDetailPage from "./components/ServerDetailPage.js";
import UploadPage from "./components/UploadPage.js";
import AddonDetailPage from "./components/AddonDetailPage.js";
import SettingsPage from "./components/SettingsPage.js";
import StatusBar from "./components/StatusBar.js";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧱</span>
            <h1 className="text-xl font-bold text-bedrock-400">
              Eden's Minecraft Manager
            </h1>
          </div>
          <StatusBar />
        </div>
      </header>

      {/* Navigation + Content */}
      <div className="flex flex-1">
        {/* Sidebar */}
        <nav className="w-56 bg-gray-800 border-r border-gray-700 p-4 space-y-1">
          <NavItem to="/" icon={<Search size={18} />} label="Search Addons" />
          <NavItem to="/servers" icon={<Server size={18} />} label="Servers" />
          <NavItem to="/upload" icon={<Upload size={18} />} label="Upload Addon" />
          <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" />
        </nav>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-6xl mx-auto">
            <Routes>
              <Route path="/" element={<SearchPage />} />
              <Route path="/addon/:source/:id" element={<AddonDetailPage />} />
              <Route path="/servers" element={<ServersPage />} />
              <Route path="/servers/:id" element={<ServerDetailPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
          isActive
            ? "bg-bedrock-600/20 text-bedrock-400"
            : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        }`
      }
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </NavLink>
  );
}
