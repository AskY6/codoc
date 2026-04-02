import { Command } from "commander";

export function registerServerCommand(program: Command): void {
  const server = program.command("server").description("Manage the cobook server");

  server
    .command("status")
    .description("Check if the server is reachable")
    .action(async () => {
      const url = program.opts()["serverUrl"] as string;
      try {
        const res = await fetch(`${url}/`);
        if (res.ok) {
          console.log(`Server is running at ${url}`);
          return;
        }
        console.log(`Server at ${url} responded with status ${res.status}`);
      } catch {
        console.log(`Server is not reachable at ${url}`);
      }
    });
}
