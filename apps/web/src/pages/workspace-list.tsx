import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listWorkspaces,
  createWorkspace,
  listWorkspacePresets,
  createWorkspaceFromPresetStream,
  deleteWorkspace,
} from "@/api/workspace.js";
import { listAgents } from "@/api/chat.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen,
  Plus,
  MoreVertical,
  Trash2,
  FileText,
  Bot,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import type {
  AgentInfo,
  PresetApplyProgressStep,
  Workspace,
  WorkspaceListItem,
  WorkspacePresetSummary,
} from "@/types.js";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function WorkspaceListPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [presets, setPresets] = useState<WorkspacePresetSummary[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<WorkspacePresetSummary | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [presetApplySteps, setPresetApplySteps] = useState<PresetApplyProgressStep[]>([]);
  const [presetApplyError, setPresetApplyError] = useState<string | null>(null);
  const presetApplyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([listWorkspaces(), listWorkspacePresets(), listAgents()])
      .then(([workspaceList, presetList, agentList]) => {
        setWorkspaces(workspaceList);
        setPresets(presetList);
        setAgents(agentList);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const ws = await createWorkspace(addName.trim());
      setWorkspaces((prev) => [...prev, { ...ws, codocCount: 0, agentCount: 0 }]);
      setAddName("");
      setAddDialogOpen(false);
      if (workspaces.length === 0) {
        navigate(`/workspace/${ws.id}`);
      }
    } catch (err) {
      alert(String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWorkspace(id);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== id));
    } catch (err) {
      alert(String(err));
    }
  }

  function openPresetDialog(preset: WorkspacePresetSummary) {
    setSelectedPreset(preset);
    setPresetName(preset.defaultWorkspaceName);
    setSelectedAgentIds(getDefaultPresetAgentIds(preset));
    setPresetApplySteps([]);
    setPresetApplyError(null);
    setPresetDialogOpen(true);
  }

  function togglePresetAgent(agentId: string) {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  }

  async function handleCreateFromPreset(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPreset || !presetName.trim() || selectedAgentIds.length === 0) return;
    setCreatingPreset(true);
    setPresetApplySteps([]);
    setPresetApplyError(null);
    try {
      presetApplyAbortRef.current = createWorkspaceFromPresetStream(
        selectedPreset.id,
        presetName.trim(),
        selectedAgentIds,
        (eventType, data) => {
          if (eventType === "progress" && hasSteps(data)) {
            setPresetApplySteps(data.steps);
            return;
          }

          if (eventType === "done" && hasWorkspace(data)) {
            setPresetApplySteps(data.steps);
            presetApplyAbortRef.current = null;
            navigate(`/workspace/${data.workspace.id}`);
            return;
          }

          if (eventType === "error") {
            const message =
              typeof data === "object" &&
              data !== null &&
              "message" in data &&
              typeof data.message === "string"
                ? data.message
                : "Preset apply failed";
            if (hasSteps(data)) {
              setPresetApplySteps(data.steps);
            }
            presetApplyAbortRef.current = null;
            setPresetApplyError(message);
            setCreatingPreset(false);
          }
        },
      );
    } catch (err) {
      alert(String(err));
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-medium">Workspaces</h1>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Add workspace
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 mt-2">
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Workspace name..."
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={adding || !addName.trim()}>
                  {adding ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {workspaces.length === 0 ? (
        <div className="space-y-8 py-8">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Sparkles className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-medium">Start with a preset workspace</h2>
            <p className="text-sm text-muted-foreground">
              The fastest way to understand Cobook is to open a workspace that already has structure,
              content, and agent-ready next steps.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {presets.map((preset) => (
              <Card key={preset.id} className="border-border/70">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle>{preset.name}</CardTitle>
                        {preset.featured && (
                          <Badge variant="secondary">Recommended</Badge>
                        )}
                      </div>
                      <CardDescription>{preset.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {preset.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {preset.highlights.map((highlight) => (
                    <div key={highlight} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </CardContent>
                <CardFooter className="justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Default name: {preset.defaultWorkspaceName}
                  </span>
                  <Button onClick={() => openPresetDialog(preset)}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Use preset
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          <div className="flex flex-col items-center justify-center gap-3 border border-dashed rounded-lg py-8 text-center">
            <div className="rounded-full bg-muted p-4">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Prefer starting from scratch?</p>
              <p className="text-sm text-muted-foreground">
                You can still create an empty workspace and shape it yourself.
              </p>
            </div>
            <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Start empty
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((ws) => (
            <Card key={ws.id} className="group relative hover:shadow-md transition-shadow">
              <Link to={`/workspace/${ws.id}`} className="absolute inset-0 z-0" />
              <CardHeader className="relative z-10 pointer-events-none">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg">{ws.name}</CardTitle>
                    {ws.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {ws.description}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="pointer-events-auto h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.preventDefault()}
                        />
                      }
                    >
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="pointer-events-auto">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.preventDefault();
                          handleDelete(ws.id);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="relative z-10 pointer-events-none pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {ws.codocCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Bot className="h-3.5 w-3.5" />
                    {ws.agentCount}
                  </span>
                  <span>{relativeTime(ws.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={presetDialogOpen}
        onOpenChange={(open) => {
          if (!open && creatingPreset) return;
          if (!open) {
            presetApplyAbortRef.current?.abort();
            presetApplyAbortRef.current = null;
          }
          setPresetDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={!creatingPreset} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedPreset ? `Create ${selectedPreset.name}` : "Create from preset"}
            </DialogTitle>
          </DialogHeader>
          {creatingPreset ? (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                Applying the preset step by step so you can see exactly what is happening.
              </p>
              <div className="space-y-3">
                {presetApplySteps.map((step, index) => (
                  <div key={step.id} className="rounded-lg border px-3 py-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={getStepIndicatorClass(step.status)}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{step.title}</p>
                          <span className="text-xs text-muted-foreground">
                            {formatStepStatus(step.status)}
                          </span>
                        </div>
                        {step.detail && (
                          <p className="text-sm text-muted-foreground">{step.detail}</p>
                        )}
                        {step.substeps && step.substeps.length > 0 && (
                          <div className="space-y-2 pt-1">
                            {step.substeps.map((substep) => (
                              <div
                                key={substep.id}
                                className="flex items-start justify-between gap-3 rounded-md bg-muted/40 px-2 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{substep.title}</p>
                                  {substep.detail && (
                                    <p className="text-xs text-muted-foreground">
                                      {substep.detail}
                                    </p>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatStepStatus(substep.status)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateFromPreset} className="space-y-4 mt-2">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This will create a new workspace preloaded with the selected starter pack.
                </p>
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Workspace name..."
                  autoFocus
                />
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Preset agents</p>
                  <p className="text-sm text-muted-foreground">
                    Choose which agents this preset should enable for the new workspace.
                  </p>
                </div>
                <div className="space-y-2">
                  {selectedPreset?.agentOptions.map((option) => {
                    const agent = agents.find((item) => item.id === option.id);
                    const checked = selectedAgentIds.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className="flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left hover:bg-muted/40"
                        onClick={() => togglePresetAgent(option.id)}
                      >
                        <Checkbox checked={checked} readOnly className="mt-0.5 size-4" />
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{agent?.name ?? option.id}</span>
                            {option.selectedByDefault && (
                              <Badge variant="outline">Default</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {agent?.description ?? option.id}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedAgentIds.length === 0 && (
                  <p className="text-sm text-destructive">
                    Select at least one agent for this preset workspace.
                  </p>
                )}
                {presetApplyError && (
                  <p className="text-sm text-destructive">{presetApplyError}</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPresetDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    creatingPreset ||
                    !selectedPreset ||
                    !presetName.trim() ||
                    selectedAgentIds.length === 0
                  }
                >
                  Create workspace
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getDefaultPresetAgentIds(preset: WorkspacePresetSummary): string[] {
  const defaults = preset.agentOptions
    .filter((option) => option.selectedByDefault)
    .map((option) => option.id);

  if (defaults.length > 0) {
    return defaults;
  }

  return preset.agentOptions.map((option) => option.id);
}

function hasSteps(data: unknown): data is { steps: PresetApplyProgressStep[] } {
  return typeof data === "object" && data !== null && "steps" in data;
}

function hasWorkspace(
  data: unknown,
): data is { workspace: Workspace; steps: PresetApplyProgressStep[] } {
  return typeof data === "object" && data !== null && "workspace" in data && "steps" in data;
}

function formatStepStatus(status: PresetApplyProgressStep["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

function getStepIndicatorClass(status: PresetApplyProgressStep["status"]): string {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium";
  switch (status) {
    case "pending":
      return `${base} bg-muted text-muted-foreground`;
    case "in_progress":
      return `${base} bg-primary text-primary-foreground`;
    case "completed":
      return `${base} bg-emerald-600 text-white`;
    case "failed":
      return `${base} bg-destructive text-destructive-foreground`;
  }
}
