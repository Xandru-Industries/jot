export type ElementId = { bunchId: string; counter: number };

export type SourceState = {
  text: string;
  idList: {
    at(index: number): ElementId;
    clone(): SourceState["idList"];
  };
};

export type SourceMutation =
  | {
      name: "insert";
      clientCounter: number;
      args: {
        before: ElementId | null;
        id: ElementId;
        content: string;
        isInWord: boolean;
      };
    }
  | {
      name: "delete";
      clientCounter: number;
      args: {
        startId: ElementId;
        endId: ElementId;
        contentLength: number;
      };
    };

type DiffOptions = {
  nextCounter(): number;
  newId(before: ElementId | null, idList: SourceState["idList"], count: number): ElementId;
  apply(state: SourceState, mutation: SourceMutation): SourceState;
};

function isWordChar(value: string) {
  return /[0-9A-Za-z_]/.test(value || "");
}

export function createSourceDiffMutations(
  state: SourceState,
  nextText: string,
  options: DiffOptions,
): SourceMutation[] {
  if (nextText === state.text) return [];

  let prefix = 0;
  while (prefix < state.text.length && prefix < nextText.length && state.text[prefix] === nextText[prefix]) {
    prefix++;
  }

  let previousSuffix = state.text.length;
  let nextSuffix = nextText.length;
  while (
    previousSuffix > prefix
    && nextSuffix > prefix
    && state.text[previousSuffix - 1] === nextText[nextSuffix - 1]
  ) {
    previousSuffix--;
    nextSuffix--;
  }

  const mutations: SourceMutation[] = [];
  let workingState = { text: state.text, idList: state.idList.clone() };
  if (previousSuffix > prefix) {
    const mutation: SourceMutation = {
      name: "delete",
      clientCounter: options.nextCounter(),
      args: {
        startId: workingState.idList.at(prefix),
        endId: workingState.idList.at(previousSuffix - 1),
        contentLength: previousSuffix - prefix,
      },
    };
    mutations.push(mutation);
    workingState = options.apply(workingState, mutation);
  }

  const content = nextText.slice(prefix, nextSuffix);
  if (content) {
    const before = prefix === 0 ? null : workingState.idList.at(prefix - 1);
    const previous = prefix > 0 ? workingState.text[prefix - 1] : "";
    const next = prefix < workingState.text.length ? workingState.text[prefix] : "";
    const mutation: SourceMutation = {
      name: "insert",
      clientCounter: options.nextCounter(),
      args: {
        before,
        id: options.newId(before, workingState.idList, content.length),
        content,
        isInWord: isWordChar(content[0]) && (isWordChar(previous) || isWordChar(next)),
      },
    };
    mutations.push(mutation);
  }

  return mutations;
}
