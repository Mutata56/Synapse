import {createRoot} from 'react-dom/client';
import {MarkdownSourceEditor} from '../../src/components/MarkdownSourceEditor';
import {useNotesStore} from '../../src/store/notes';
import {listTree} from '../../src/lib/storage';
import {LanguageProvider} from '../../src/components/LanguageProvider';
import {ConfirmDialog} from '../../src/components/ConfirmDialog';
import '@blocknote/mantine/style.css';import '../../src/index.css';
const real='Работа/LTM/Магнит/Коломна (обучение)/WMS Driver/0. Карта изучения WMS Driver';
useNotesStore.setState({tree:await listTree(),view:'notes'});
await useNotesStore.getState().selectNote(new URLSearchParams(location.search).get('data')==='real'?real:'Imported test');
function Fixture(){const note=useNotesStore(s=>s.activeNote);return <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)'}}>
 <nav style={{display:'flex',gap:16,padding:8,fontSize:12}}><button onClick={()=>useNotesStore.getState().selectNote('Imported test')}>Тестовая статья</button><button onClick={()=>useNotesStore.getState().selectNote(real)}>Карта WMS Driver</button><button onClick={()=>useNotesStore.getState().selectNote('Other')}>Другая заметка</button><button onClick={()=>location.reload()}>Перезапуск проверки</button></nav>
 {note?<MarkdownSourceEditor key={note.id}/>:null}<ConfirmDialog/></div>}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture/></LanguageProvider>);
