import type { Skill } from "./types.js";

const skills = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
  skills.set(skill.name, skill);
}

export function getSkill(name: string): Skill | undefined {
  return skills.get(name);
}

export function listSkills(): Skill[] {
  return [...skills.values()];
}

/**
 * Given a directory path, find the first skill that can handle it.
 */
export async function identifySkill(dirPath: string): Promise<Skill | undefined> {
  for (const skill of skills.values()) {
    if (await skill.identify(dirPath)) {
      return skill;
    }
  }
  return undefined;
}
