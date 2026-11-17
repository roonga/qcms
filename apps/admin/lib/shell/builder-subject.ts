/** The name the builder's top bar group shows, written by the build screen the layout cannot see. */

type Listener = () => void;

let current = "";
const listeners = new Set<Listener>();

export function builderSubjectName(): string {
  return current;
}

export function serverBuilderSubjectName(): string {
  return "";
}

export function setBuilderSubjectName(name: string): void {
  if (name === current) return;
  current = name;
  for (const listener of listeners) listener();
}

export function subscribeBuilderSubject(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
