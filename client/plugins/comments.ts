import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";

export const commentsPlugin = $prose(() => new Plugin({}));
