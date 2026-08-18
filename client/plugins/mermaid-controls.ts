export type MermaidTransform = { scale: number; x: number; y: number };

const icons: Record<string, string> = {
  up: "↑", down: "↓", left: "←", right: "→", "zoom-in": "+", "zoom-out": "−", reset: "↺",
};
const labels: Record<string, string> = {
  up: "Pan up", down: "Pan down", left: "Pan left", right: "Pan right",
  "zoom-in": "Zoom in", "zoom-out": "Zoom out", reset: "Reset diagram view",
};

export function createMermaidControls(target: HTMLElement) {
  const dom = document.createElement("div");
  dom.className = "mermaid-toolbar";
  dom.setAttribute("contenteditable", "false");
  let transform: MermaidTransform = { scale: 1, x: 0, y: 0 };
  const apply = () => { target.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`; };
  const activate = (action: string) => {
    if (action === "zoom-in") transform.scale = Math.min(4, transform.scale + 0.25);
    if (action === "zoom-out") transform.scale = Math.max(0.25, transform.scale - 0.25);
    if (action === "up") transform.y += 50;
    if (action === "down") transform.y -= 50;
    if (action === "left") transform.x += 50;
    if (action === "right") transform.x -= 50;
    if (action === "reset") transform = { scale: 1, x: 0, y: 0 };
    apply();
  };
  for (const action of ["up", "zoom-in", "left", "reset", "right", "down", "zoom-out"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("aria-label", labels[action]);
    button.textContent = icons[action];
    dom.append(button);
  }
  apply();
  return { dom, activate, reset: () => { transform = { scale: 1, x: 0, y: 0 }; apply(); } };
}
