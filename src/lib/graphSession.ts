import type { GraphSceneSnapshot } from "./graphScene";
import type { GraphAppearance, GraphMode, GraphOptions } from "./graphTypes";
import { GraphReferenceIndex } from "./graphReferenceIndex";
import type { GraphStyle } from "./graphStyle";
import { GraphModelCache } from "./graphModelCache";

/** Small workspace-local cache. No live renderers, workers or timers are retained. */
export const graphSession: {
  references: GraphReferenceIndex;
  model: GraphModelCache;
  layouts: Partial<Record<GraphMode, GraphSceneSnapshot>>;
  preferences?: { appearances: Record<GraphMode, GraphAppearance>; options: GraphOptions; query: string; tags: string[]; timelineEnabled: boolean; timeline: number; originalStyle: GraphStyle };
} = { references: new GraphReferenceIndex(), model: new GraphModelCache(), layouts: {} };
