import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getWorkspacePreset, type WorkspaceService } from "@cobook/service";
import type { WorkspaceRepository, Workspace } from "@cobook/service";
import { refreshWorkspaceFeeds } from "../rss-scheduler.js";

type ProgressStatus = "pending" | "in_progress" | "completed" | "failed";

interface ProgressSubstep {
  id: string;
  title: string;
  status: ProgressStatus;
  detail?: string;
}

interface ProgressStep {
  id: string;
  title: string;
  status: ProgressStatus;
  detail?: string;
  substeps?: ProgressSubstep[];
}

export function workspaceRoutes(
  service: WorkspaceService,
  workspaceRepo: WorkspaceRepository,
) {
  const app = new Hono();

  // GET /api/workspace — list all workspaces (with codoc/agent counts)
  app.get("/", async (c) => {
    const list = await workspaceRepo.listWithStats();
    return c.json(list);
  });

  // GET /api/workspace/presets — list available workspace presets
  app.get("/presets", (c) => {
    return c.json(service.listPresets());
  });

  // POST /api/workspace — create workspace { name }
  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string }>();
    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }
    try {
      const ws = await service.createWorkspace(body.name);
      return c.json(ws, 201);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/workspace/from-preset — create workspace from preset { presetId, name? }
  app.post("/from-preset", async (c) => {
    const body = await c.req.json<{ presetId?: string; name?: string; agentIds?: string[] }>();
    if (!body.presetId) {
      return c.json({ error: "presetId is required" }, 400);
    }
    if (body.agentIds !== undefined && !Array.isArray(body.agentIds)) {
      return c.json({ error: "agentIds must be an array when provided" }, 400);
    }
    try {
      const ws = await service.createWorkspaceFromPreset(body.presetId, body.name, body.agentIds);
      await refreshWorkspaceFeeds(service, ws.id, { force: true });
      return c.json(ws, 201);
    } catch (err) {
      const message = String(err);
      if (message.includes("Preset not found")) {
        return c.json({ error: message }, 404);
      }
      if (
        message.includes("At least one preset agent") ||
        message.includes("Preset agent not allowed")
      ) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/workspace/from-preset/stream — create workspace from preset with progress steps
  app.post("/from-preset/stream", async (c) => {
    const body = await c.req.json<{ presetId?: string; name?: string; agentIds?: string[] }>();
    if (!body.presetId) {
      return c.json({ error: "presetId is required" }, 400);
    }
    if (body.agentIds !== undefined && !Array.isArray(body.agentIds)) {
      return c.json({ error: "agentIds must be an array when provided" }, 400);
    }

    const preset = getWorkspacePreset(body.presetId);
    if (!preset) {
      return c.json({ error: `Preset not found: ${body.presetId}` }, 404);
    }

    return streamSSE(c, async (stream) => {
      const steps = createInitialSteps();
      let workspace: Workspace | undefined;

      async function emitProgress() {
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ steps }),
        });
      }

      async function emitError(message: string) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message, steps }),
        });
      }

      async function emitDone(createdWorkspace: Workspace) {
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ workspace: createdWorkspace, steps }),
        });
      }

      try {
        setStepState(steps, "create-workspace", "in_progress", "Creating workspace");
        await emitProgress();

        workspace = await service.createWorkspace(
          body.name?.trim() || preset.defaultWorkspaceName,
          preset.workspaceDescription,
        );

        setStepState(steps, "create-workspace", "completed", "Workspace created");
        setStepState(steps, "prepare-preset", "in_progress", "Writing preset structure");
        await emitProgress();

        await service.applyPreset(workspace.id, preset.id, body.agentIds);

        setStepState(steps, "prepare-preset", "completed", "Preset structure ready");

        const feedSubsteps = await buildFeedSubsteps(service, workspace.id);
        setStepState(
          steps,
          "fetch-live-sources",
          "in_progress",
          `Fetching ${feedSubsteps.length} live source${feedSubsteps.length === 1 ? "" : "s"}`,
          feedSubsteps,
        );
        await emitProgress();

        const feedResults = await refreshWorkspaceFeeds(service, workspace.id, {
          force: true,
          onFeedStart: async (feed) => {
            setSubstepState(
              steps,
              "fetch-live-sources",
              feed.path,
              "in_progress",
              "Fetching",
            );
            await emitProgress();
          },
          onFeedComplete: async (result) => {
            setSubstepState(
              steps,
              "fetch-live-sources",
              result.path,
              "completed",
              `${result.articleCount} article${result.articleCount === 1 ? "" : "s"}`,
            );
            await emitProgress();
          },
          onFeedError: async (result) => {
            setSubstepState(
              steps,
              "fetch-live-sources",
              result.path,
              "failed",
              result.error ?? "Fetch failed",
            );
            await emitProgress();
          },
        });

        const successCount = feedResults.filter((result) => result.status === "completed").length;
        const failedCount = feedResults.length - successCount;
        setStepState(
          steps,
          "fetch-live-sources",
          "completed",
          failedCount > 0
            ? `${successCount}/${feedResults.length} sources fetched, ${failedCount} failed`
            : `Fetched ${successCount}/${feedResults.length} sources`,
        );

        setStepState(steps, "finalize-workspace", "in_progress", "Finalizing workspace");
        await emitProgress();

        await service.build(workspace.id);

        setStepState(steps, "finalize-workspace", "completed", "Workspace ready");
        await emitProgress();
        await emitDone(workspace);
      } catch (err) {
        const message = String(err);
        if (workspace == null) {
          setStepState(steps, "create-workspace", "failed", message);
        } else if (getStep(steps, "prepare-preset")?.status === "in_progress") {
          setStepState(steps, "prepare-preset", "failed", message);
        } else if (getStep(steps, "fetch-live-sources")?.status === "in_progress") {
          setStepState(steps, "fetch-live-sources", "failed", message);
        } else {
          setStepState(steps, "finalize-workspace", "failed", message);
        }
        await emitProgress();
        await emitError(message);
      }
    });
  });

  // GET /api/workspace/:id — get workspace detail
  app.get("/:id", async (c) => {
    const ws = await workspaceRepo.findById(c.req.param("id"));
    if (!ws) return c.json({ error: "Workspace not found" }, 404);
    return c.json(ws);
  });

  // GET /api/workspace/:id/status — get workspace status
  app.get("/:id/status", async (c) => {
    try {
      const status = await service.getStatus(c.req.param("id"));
      return c.json(status);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // PATCH /api/workspace/:id — update workspace name / description
  app.patch("/:id", async (c) => {
    const body = await c.req.json<{ name?: string; description?: string | null }>();
    try {
      const ws = await service.updateWorkspace(c.req.param("id"), body);
      return c.json(ws);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // DELETE /api/workspace/:id — remove workspace
  app.delete("/:id", async (c) => {
    try {
      await workspaceRepo.delete(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}

function createInitialSteps(): ProgressStep[] {
  return [
    { id: "create-workspace", title: "Create workspace", status: "pending" },
    { id: "prepare-preset", title: "Prepare preset structure", status: "pending" },
    { id: "fetch-live-sources", title: "Fetch live sources", status: "pending", substeps: [] },
    { id: "finalize-workspace", title: "Finalize workspace", status: "pending" },
  ];
}

function getStep(steps: ProgressStep[], stepId: string): ProgressStep | undefined {
  return steps.find((step) => step.id === stepId);
}

function setStepState(
  steps: ProgressStep[],
  stepId: string,
  status: ProgressStatus,
  detail?: string,
  substeps?: ProgressSubstep[],
): void {
  const step = getStep(steps, stepId);
  if (!step) return;
  step.status = status;
  if (detail !== undefined) {
    step.detail = detail;
  } else {
    delete step.detail;
  }
  if (substeps) {
    step.substeps = substeps;
  }
}

function setSubstepState(
  steps: ProgressStep[],
  stepId: string,
  substepId: string,
  status: ProgressStatus,
  detail?: string,
): void {
  const step = getStep(steps, stepId);
  const substep = step?.substeps?.find((item) => item.id === substepId);
  if (!substep) return;
  substep.status = status;
  if (detail !== undefined) {
    substep.detail = detail;
  } else {
    delete substep.detail;
  }
}

async function buildFeedSubsteps(
  service: WorkspaceService,
  workspaceId: string,
): Promise<ProgressSubstep[]> {
  const codocs = await service.listCodocs(workspaceId);
  return codocs
    .filter(
      (codoc) =>
        codoc.path.startsWith("rss/") &&
        !codoc.path.slice("rss/".length).includes("/") &&
        codoc.meta.tags?.includes("rss") &&
        typeof codoc.meta.description === "string" &&
        codoc.meta.description.startsWith("http"),
    )
    .map((codoc) => ({
      id: codoc.path,
      title: codoc.meta.title ?? codoc.path,
      status: "pending" as const,
    }));
}
