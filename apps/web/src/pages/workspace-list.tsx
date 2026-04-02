import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listWorkspaces, createWorkspace } from "../api/workspace.js";
import { StatusPill } from "../components/status-pill.js";
import type { Workspace } from "../types.js";

export function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [addPath, setAddPath] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addPath.trim()) return;
    setAdding(true);
    try {
      const ws = await createWorkspace(addPath.trim());
      setWorkspaces((prev) => [...prev, ws]);
      setAddPath("");
    } catch (err) {
      alert(String(err));
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Loading workspaces...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-6">Workspaces</h1>

      {workspaces.length === 0 && (
        <p className="text-gray-500 mb-6">No workspaces yet. Add one below.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        {workspaces.map((ws) => (
          <Link
            key={ws.id}
            to={`/workspace/${ws.id}`}
            className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-lg">{ws.name}</h2>
                <p className="text-sm text-gray-500 mt-1 truncate max-w-[260px]">
                  {ws.rootPath}
                </p>
              </div>
              <StatusPill state="idle" />
            </div>
          </Link>
        ))}
      </div>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={addPath}
          onChange={(e) => setAddPath(e.target.value)}
          placeholder="Enter local path to add workspace..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={adding}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? "Adding..." : "+ Add"}
        </button>
      </form>
    </div>
  );
}
