import { Command } from "commander";

const program = new Command();

program
  .name("cobook")
  .description("Cobook — composable knowledge workspace")
  .version("0.0.0");

program.parse();
