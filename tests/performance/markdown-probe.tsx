import { useMemo } from "react";
import { Markdown } from "../../node_modules/react-markdown/lib/index.js";
import { metrics } from "./probe";
export * from "../../node_modules/react-markdown/lib/index.js";

function startProbe(this: { data: (key: string, value?: unknown) => unknown }) {
  metrics.markdownParses++;
  this.data("synapse-profile-start", performance.now());
}
function endProbe(this: { data: (key: string) => unknown }) {
  return () => { metrics.markdownMs += performance.now() - Number(this.data("synapse-profile-start")); };
}
export default function MarkdownProbe(props: React.ComponentProps<typeof Markdown>) {
  const remarkPlugins = useMemo(() => [startProbe, ...(props.remarkPlugins ?? [])], [props.remarkPlugins]);
  const rehypePlugins = useMemo(() => [...(props.rehypePlugins ?? []), endProbe], [props.rehypePlugins]);
  return <Markdown {...props} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} />;
}
