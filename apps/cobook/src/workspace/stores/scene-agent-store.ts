/** Client-side representation of a scene agent */
export interface SceneAgentView {
  id: string;
  name: string;
  description: string;
  active: boolean;
  trusted: boolean;
}

type Listener = () => void;

export class SceneAgentStore {
  private sceneAgents: SceneAgentView[] = [];
  private listeners = new Set<Listener>();

  hydrateSceneAgents(agents: SceneAgentView[]): void {
    this.sceneAgents = agents;
    this.notify();
  }

  updateSceneAgent(id: string, update: Partial<SceneAgentView>): void {
    this.sceneAgents = this.sceneAgents.map((a) =>
      a.id === id ? { ...a, ...update } : a,
    );
    this.notify();
  }

  getSceneAgents(): SceneAgentView[] {
    return this.sceneAgents;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
