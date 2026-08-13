/**
 * Whether a prompt is plausibly asking for a file change.
 *
 * Local models cannot reliably arbitrate "only use the edit format when asked",
 * so instead of describing the format on every run and hoping, the caller omits
 * it entirely for prompts that clearly only want an answer. A model that never
 * sees the format cannot emit a spurious edit block.
 *
 * Deliberately permissive: a false positive only restores the previous
 * behaviour, whereas a false negative would leave the model unable to propose
 * an edit the user genuinely asked for.
 */
const EDIT_VERBS = [
  "add",
  "amend",
  "append",
  "annotate",
  "apply",
  "change",
  "clean up",
  "correct",
  "create",
  "delete",
  "edit",
  "expand",
  "fill in",
  "fix",
  "format",
  "insert",
  "link",
  "make",
  "merge",
  "move",
  "reformat",
  "refactor",
  "remove",
  "rename",
  "reorganise",
  "reorganize",
  "replace",
  "restructure",
  "rewrite",
  "tidy",
  "update",
  "write"
];

/** Phrases that ask for a change even without one of the verbs above. */
const EDIT_PHRASES = [
  "propose an edit",
  "proposed edit",
  "agent-edit",
  "in the note",
  "to the note",
  "to this note",
  "in this file",
  "to the file"
];

export function looksLikeEditRequest(prompt: string): boolean {
  const text = prompt.toLowerCase();

  if (EDIT_PHRASES.some((phrase) => text.includes(phrase))) {
    return true;
  }

  // Word-boundary matched so "summarise" does not trigger on "marise", and
  // "linked" / "updating" still count.
  return EDIT_VERBS.some((verb) =>
    new RegExp(`(^|[^a-z])${verb.replace(/ /g, "\\s+")}(s|d|ed|ing)?([^a-z]|$)`, "i").test(
      text
    )
  );
}
