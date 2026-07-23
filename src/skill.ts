import { constants } from "node:fs";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "explain-codex-token-usage";

export interface InstallSkillOptions {
  force?: boolean;
  skillsDirectory?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function installSkill(
  options: InstallSkillOptions = {},
): Promise<string> {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const source = join(packageRoot, ".agents", "skills", SKILL_NAME);
  const skillsDirectory =
    options.skillsDirectory ?? join(homedir(), ".agents", "skills");
  const destination = join(skillsDirectory, SKILL_NAME);

  if (!(await exists(join(source, "SKILL.md")))) {
    throw new Error(`Bundled skill is missing from ${source}.`);
  }
  if (await exists(destination)) {
    if (!options.force) {
      throw new Error(
        `Skill already exists at ${destination}. Re-run with --force to replace it.`,
      );
    }
    await rm(destination, { recursive: true, force: true });
  }

  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true });
  return destination;
}
