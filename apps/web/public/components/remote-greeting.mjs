const React = globalThis.__cobookRuntime?.React;

export function RemoteGreeting(props) {
  if (!React) {
    throw new Error("React runtime is not available.");
  }

  return React.createElement("section", { className: "component-card local-hero-card" }, [
    React.createElement("p", { className: "eyebrow", key: "eyebrow" }, props.eyebrow ?? "Remote"),
    React.createElement("h3", { key: "title" }, props.title ?? "Untitled"),
    React.createElement("p", { className: "muted", key: "subtitle" }, props.subtitle ?? "")
  ]);
}

export default RemoteGreeting;
