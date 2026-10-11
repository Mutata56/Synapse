import { createRoot } from "react-dom/client";
import { ALL_MODULES } from "../../src/lib/modules";
import App from "../../src/App";
import { listTree } from "../../src/lib/storage";
import { useNotesStore } from "../../src/store/notes";
import { useWorkspaceStore } from "../../src/store/workspace";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import "@mantine/core/styles.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../src/index.css";

useNotesStore.setState({ settings: { ...useNotesStore.getState().settings, modules: ALL_MODULES }, tree: await listTree(), view: "notes" });
await useWorkspaceStore.getState().openNote("Note blocks review");
useWorkspaceStore.getState().toggleRight();
useWorkspaceStore.getState().setRightPane("graph");
createRoot(document.getElementById("root")!).render(<LanguageProvider><App bootstrap={false} /></LanguageProvider>);
