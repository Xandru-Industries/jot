import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";

export function isSafeLink(href: string) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(href, window.location.href).protocol);
  } catch {
    return false;
  }
}

export const linksPlugin = $prose(() => new Plugin({
  props: {
    handleClick: (_view, _pos, event) => {
      const link = (event.target as Element | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!link) return false;
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && isSafeLink(link.href)) window.open(link.href, "_blank", "noopener,noreferrer");
      return true;
    },
  },
}));
