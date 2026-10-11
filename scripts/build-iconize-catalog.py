"""Build offline Iconize 2.14.7 sprites from its official pack ZIPs.

Usage: python3 scripts/build-iconize-catalog.py --downloads DIR --iconize-source DIR
Place font-awesome-brands.zip and simple-icons.zip in DIR too. No runtime downloads.
"""
import argparse
import ast
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

PACKS = [
    ('font-awesome-brands', 'Font Awesome · Brands', 'Fab', '6.5.1', 'font-awesome-brands', '/svgs/brands/'),
    ('font-awesome-regular', 'Font Awesome · Regular', 'Far', '6.5.1', 'font-awesome-brands', '/svgs/regular/'),
    ('font-awesome-solid', 'Font Awesome · Solid', 'Fas', '6.5.1', 'font-awesome-brands', '/svgs/solid/'),
    ('remix-icons', 'Remix Icons', 'Ri', '4.2.0', 'remix-icons', 'icons/'),
    ('icon-brew', 'Icon Brew', 'Ib', 'Iconize 2.14.7', 'icon-brew', ''),
    ('simple-icons', 'Simple Icons · Logos', 'Si', '11.10.0', 'simple-icons', '/icons/'),
    ('lucide-icons', 'Lucide', 'Li', '0.363.0', 'lucide-icons', 'icons/'),
    ('tabler-icons', 'Tabler Icons', 'Ti', '3.1.0', 'tabler-icons', 'svg/'),
    ('boxicons', 'Boxicons', 'Bo', 'Iconize 2.14.7', 'boxicons', 'svg/'),
    ('rpg-awesome', 'RPG Awesome', 'Ra', 'Iconize 2.14.7', 'rpg-awesome', ''),
    ('coolicons', 'Coolicons', 'Co', '4.1', 'coolicons', 'cooliocns SVG/'),
    ('feather-icons', 'Feather Icons', 'Fi', '4.29.1', 'feather-icons', '/icons/'),
    ('octicons', 'Octicons', 'Oc', '19.8.0', 'octicons', '/icons/'),
]
ALLOWED_TAGS = {'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc'}
ALLOWED_ATTRS = {'viewBox', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'id', 'clip-path', 'mask', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'fx', 'fy'}
def normalized(s):
    return ''.join(part[:1].upper() + part[1:] for part in re.split(r'[ _-]', s))
def clean(svg, ident):
    root = ET.fromstring(svg)
    for node in list(root.iter()):
        node.tag = node.tag.split('}')[-1]
        if node.text is not None and not node.text.strip(): node.text = None
        if node.tail is not None and not node.tail.strip(): node.tail = None
        for key, value in re.findall(r'([\w-]+)\s*:\s*([^;]+)', node.attrib.get('style', '')):
            if key in ALLOWED_ATTRS and key not in node.attrib: node.attrib[key] = value
        for child in list(node):
            if child.tag.split('}')[-1] not in ALLOWED_TAGS: node.remove(child)
        for key in list(node.attrib):
            value = node.attrib[key]
            if key not in ALLOWED_ATTRS or re.search(r'(?:javascript:|https?:|data:|@import)', value, re.I): del node.attrib[key]
            elif key == 'id': node.attrib[key] = ident + '-' + value
            elif 'url(#' in value: node.attrib[key] = value.replace('url(#', 'url(#' + ident + '-')
            elif key in ('fill', 'stroke') and value not in ('none', 'transparent') and not value.startswith('url('): node.attrib[key] = 'currentColor'
    root.tag = 'symbol'; root.attrib['id'] = ident
    root.attrib.setdefault('viewBox', '0 0 24 24')
    root.attrib.pop('width', None); root.attrib.pop('height', None)
    root.attrib.setdefault('fill', 'currentColor')
    return ET.tostring(root, encoding='unicode', short_empty_elements=True)
def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--downloads', type=Path, required=True); parser.add_argument('--iconize-source', type=Path, required=True); parser.add_argument('--lucide-native', type=Path); args = parser.parse_args()
    out = Path(__file__).resolve().parent.parent / 'public/iconize'; out.mkdir(parents=True, exist_ok=True)
    if args.lucide_native:
        native_icons = json.loads(args.lucide_native.read_text())
    else:
        program = """import {icons} from 'lucide-react'; import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(icons).map(([name, icon])=>[name,renderToStaticMarkup(createElement(icon))]))));"""
        native_icons = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=out.parent.parent))
    native_version = json.loads((out.parent.parent / 'node_modules/lucide-react/package.json').read_text())['version']
    licenses = out / 'licenses'; licenses.mkdir(exist_ok=True)
    manifest = {'version': 1, 'upstream': 'https://github.com/FlorianWoelki/obsidian-iconize/tree/2.14.7', 'packs': []}
    for slug, title, prefix, version, archive, scope in PACKS:
        file = args.downloads / (archive + '.zip')
        if not file.exists(): file = args.iconize_source / 'iconPacks' / (archive + '.zip')
        symbols, index, used = [], [], set()
        with ZipFile(file) as z:
            names = sorted(z.namelist(), key=lambda name: ('/filled/' in name, name))
            for name in names:
                if not name.endswith('.svg') or name.startswith('__MACOSX/') or scope and scope not in name: continue
                base = Path(name).stem
                ident = prefix + normalized(base)
                if not re.fullmatch(r'[A-Za-z][\w-]*', ident): continue
                if ident in used:
                    if '/filled/' in name: ident += 'Filled'
                    else: ident += normalized(Path(name).parent.name)
                if ident in used: continue
                try: symbol = clean(z.read(name).decode('utf-8-sig'), ident)
                except (ET.ParseError, UnicodeDecodeError): continue
                used.add(ident); symbols.append(symbol); index.append([ident, re.sub(r'([a-z])([A-Z])', r'\1 \2', base).replace('-', ' ').replace('_', ' ')])
            for name in z.namelist():
                if Path(name).name.lower() in ('license', 'license.txt', 'license.md', 'license-graphics'):
                    (licenses / (slug + '-' + Path(name).name)).write_bytes(z.read(name)); break
        if slug == 'lucide-icons':
            for name, svg in native_icons.items():
                ident = prefix + name
                if ident not in used:
                    used.add(ident); symbols.append(clean(svg, ident)); index.append([ident, re.sub(r'([a-z])([A-Z])', r'\1 \2', name)])
            version += ' + Synapse native Lucide ' + native_version
        (out / (slug + '.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg">' + ''.join(symbols) + '</svg>')
        (out / (slug + '.json')).write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
        manifest['packs'].append({'id': slug, 'name': title, 'prefix': prefix, 'version': version, 'count': len(index), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        print(slug, len(index))
    # Twemoji has its original colors. It is served as SVG images, never executable HTML.
    twemoji = out / 'twemoji'; twemoji.mkdir(exist_ok=True)
    with ZipFile(args.downloads / 'twemoji.zip') as z:
        for name in z.namelist():
            if '/assets/svg/' in name and name.endswith('.svg'): (twemoji / Path(name).name).write_bytes(z.read(name))
            elif Path(name).name in ('LICENSE', 'LICENSE-GRAPHICS'): (licenses / ('twemoji-' + Path(name).name)).write_bytes(z.read(name))
    (licenses / 'iconize-MIT.txt').write_bytes((args.iconize_source / 'LICENSE').read_bytes())
    (licenses / 'lucide-native.txt').write_bytes((out.parent.parent / 'node_modules/lucide-react/LICENSE').read_bytes())
    emojis = []
    for line in (args.iconize_source / 'src/emoji.ts').read_text().splitlines():
        match = re.fullmatch(r"\s*('(?:\\.|[^'])*'):\s*('(?:\\.|[^'])*'),?\s*", line)
        if match:
            try: emojis.append([ast.literal_eval(match[1]), ast.literal_eval(match[2])])
            except (ValueError, SyntaxError): pass
    (out / 'emojis.json').write_text(json.dumps(emojis, ensure_ascii=False, separators=(',', ':')))
    for license_file in licenses.iterdir():
        if license_file.is_file():
            text = license_file.read_text()
            license_file.write_text('\n'.join(line.rstrip() for line in text.splitlines()) + '\n')
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
if __name__ == '__main__': main()
