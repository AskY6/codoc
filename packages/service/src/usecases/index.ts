// Barrel for the use case layer.
//
// One export per use case, grouped by aggregate in subdirectories.
// Transport packages (HTTP / CLI / MCP) import from here.
//
// New use cases land here as they are written.

export {
  listWorkspaces,
  type ListWorkspacesError,
} from "./workspace/list-workspaces.js";

export {
  getWorkspace,
  type GetWorkspaceError,
} from "./workspace/get-workspace.js";

export {
  createWorkspace,
  type CreateWorkspaceInput,
  type CreateWorkspaceError,
} from "./workspace/create-workspace.js";

export {
  deleteWorkspace,
  type DeleteWorkspaceError,
} from "./workspace/delete-workspace.js";

export {
  updateWorkspace,
  type UpdateWorkspaceInput,
  type UpdateWorkspaceError,
} from "./workspace/update-workspace.js";

export {
  listCodocsByWorkspace,
  type ListCodocsByWorkspaceError,
} from "./codoc/list-codocs-by-workspace.js";

export {
  createCodoc,
  type CreateCodocInput,
  type CreateCodocError,
} from "./codoc/create-codoc.js";

export {
  deleteCodoc,
  type DeleteCodocError,
} from "./codoc/delete-codoc.js";
