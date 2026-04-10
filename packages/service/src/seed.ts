import {
  createDb,
  createWorkspaceRepository,
  createCodocRepository,
  createChatRepository,
} from "@cobook/storage";
import { applyWorkspacePreset, getWorkspacePreset } from "./presets/index.js";
import { createWorkspaceService } from "./workspace-service.js";

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);
const service = createWorkspaceService({ db });
// Seed-only direct repos for the "find existing demo workspace by name" step
// and for the removeOtherCodocs flow that the public service API does not
// expose.
const workspaceRepo = createWorkspaceRepository(db);
const codocRepo = createCodocRepository(db);
const chatRepo = createChatRepository(db);

const PRESET_ID = "ai-dev-radar";
const LEGACY_WORKSPACE_NAME = "Welcome to Cobook";

try {
  const preset = getWorkspacePreset(PRESET_ID);
  if (!preset) {
    throw new Error(`Preset not found: ${PRESET_ID}`);
  }

  const existing = (await workspaceRepo.list()).find(
    (workspace) =>
      workspace.name === preset.defaultWorkspaceName ||
      workspace.name === LEGACY_WORKSPACE_NAME ||
      workspace.description === preset.workspaceDescription,
  );

  const workspace = existing
    ? await workspaceRepo.update(existing.id, {
      name: preset.defaultWorkspaceName,
      description: preset.workspaceDescription,
    })
    : await workspaceRepo.create({
      name: preset.defaultWorkspaceName,
      description: preset.workspaceDescription,
    });

  await applyWorkspacePreset(workspace.id, preset, {
    codocRepo,
    chatRepo,
    buildWorkspace: service.build,
    removeOtherCodocs: true,
  });

  console.log(`Seeded demo workspace "${preset.defaultWorkspaceName}" (${workspace.id})`);
} finally {
  await db.$pool.end();
}
