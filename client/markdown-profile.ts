import { $remark } from "@milkdown/utils";
import remarkFrontmatter from "remark-frontmatter";

import { codePlugin } from "./plugins/code";
import { linksPlugin } from "./plugins/links";
import { tasksPlugin } from "./plugins/tasks";
import { frontmatterSchema } from "./schema/frontmatter";

const yaml = $remark("jot-yaml", () => function jotYaml(this: unknown) {
  return remarkFrontmatter.call(this, ["yaml"]);
});

export const markdownProfile = [yaml, frontmatterSchema, tasksPlugin, linksPlugin, codePlugin].flat();
