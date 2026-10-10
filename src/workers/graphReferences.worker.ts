import { collectGraphReferences } from "../lib/graphReferences";
import type { GraphDocument, GraphReferenceMap } from "../lib/graphTypes";

self.onmessage = (event: MessageEvent<GraphDocument[]>) => {
  try {
    const result: GraphReferenceMap = Object.create(null);
    for (const document of event.data) result[document.id] = collectGraphReferences(document.body);
    self.postMessage({ ok: true, references: result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
