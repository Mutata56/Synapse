from pathlib import Path
import json, shutil, sys

source=Path(sys.argv[1]).resolve()
target=Path('/private/tmp/synapse-imported-editor-review')
if target.exists():
    raise SystemExit('Review copy already exists; choose a fresh test environment before preparing again.')
shutil.copytree(source,target/'notes')
notes=target/'notes'
notes.joinpath('Imported test.md').write_text('---\n# Preserve YAML\ncustom: {nested: true}\n---\n\n#Коломна #WTMS #WMSDriver #карта #обучение\n\nOriginal paragraph for editing.\n\n## Next heading\n\n- First\n- Second\n\n> [!info] Important [[Other|Link]]\n> Keep this callout.\n\n```mermaid\ngraph LR; A-->B\n```\n\n<div>Preserved HTML</div>\n')
notes.joinpath('Other.md').write_text('---\ntitle: Other\n---\n\nOther note.\n')
manifest=notes/'.synapse/obsidian-import.json'
manifest.parent.mkdir(parents=True,exist_ok=True)
data=json.loads(manifest.read_text()) if manifest.exists() else dict(version=1,kind='obsidian',notePaths=[p.relative_to(notes).as_posix() for p in notes.rglob('*.md') if not p.relative_to(notes).as_posix().startswith('.')])
data['notePaths']=sorted(set(data['notePaths']+['Imported test.md','Other.md']))
manifest.write_text(json.dumps(data))
print(target)
