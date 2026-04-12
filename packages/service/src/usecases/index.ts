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

export {
  getCodoc,
  type GetCodocError,
} from "./codoc/get-codoc.js";

export {
  updateCodocContent,
  type UpdateCodocContentInput,
  type UpdateCodocContentError,
} from "./codoc/update-codoc-content.js";

export {
  listThreadsByWorkspace,
  type ListThreadsByWorkspaceError,
} from "./thread/list-threads-by-workspace.js";

export {
  createThread,
  type CreateThreadInput,
  type CreateThreadError,
} from "./thread/create-thread.js";

export {
  deleteThread,
  type DeleteThreadError,
} from "./thread/delete-thread.js";

export {
  getThread,
  type GetThreadError,
} from "./thread/get-thread.js";

export {
  appendUserMessage,
  type AppendUserMessageInput,
  type AppendUserMessageError,
} from "./thread/append-user-message.js";

export {
  updateThread,
  type UpdateThreadInput,
  type UpdateThreadError,
} from "./thread/update-thread.js";

export {
  listAgents,
  type ListAgentsError,
} from "./agent/list-agents.js";

export {
  listWorkspaceAgents,
  type ListWorkspaceAgentsError,
} from "./agent/list-workspace-agents.js";

export {
  setWorkspaceAgents,
  type SetWorkspaceAgentsInput,
  type SetWorkspaceAgentsError,
} from "./agent/set-workspace-agents.js";

export {
  setThreadAgents,
  type SetThreadAgentsInput,
  type SetThreadAgentsError,
} from "./agent/set-thread-agents.js";

export {
  setThreadCodocs,
  type SetThreadCodocsInput,
  type SetThreadCodocsError,
} from "./agent/set-thread-codocs.js";

export {
  runAgentTurn,
  type RunAgentTurnInput,
  type RunAgentTurnOutput,
  type RunAgentTurnError,
} from "./agent/run-agent-turn.js";
