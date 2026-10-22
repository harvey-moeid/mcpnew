#!/usr/bin/env python3
"""Export source and marked configuration templates; never export runtime state."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = ('src', 'tests', 'skills', 'docs', 'migrations', '.github', 'scripts')
TOP_LEVEL = ('package.json', 'package-lock.json', 'tsconfig.json', 'worker-configuration.d.ts',
             '.gitignore', '.dev.vars.example', 'BACA-DULU.md',
             'installation.example.json', 'wrangler.example.toml')
EXTENSIONS = {'.ts', '.js', '.mjs', '.json', '.md', '.sql', '.yml', '.yaml', '.toml', '.py', '.csv', '.txt'}
EXCLUDED = {'.git', 'node_modules', '.wrangler', '__pycache__', 'work', 'output', 'dist'}


def portable_files():
    files = {}
    for name in TOP_LEVEL:
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f'Missing or unsafe required file: {name}')
        files[name] = path.read_bytes()
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob('*')):
            relative = path.relative_to(ROOT)
            if path.is_symlink() or not path.is_file() or set(relative.parts) & EXCLUDED:
                continue
            if path.suffix not in EXTENSIONS or path.name.startswith(('.env', '.dev.vars')):
                continue
            if any(part.lower() in {'secrets', 'credentials', 'backups'} for part in relative.parts):
                continue
            files[relative.as_posix()] = path.read_bytes()
    files['installation.json'] = (ROOT / 'installation.example.json').read_bytes()
    files['wrangler.toml'] = (ROOT / 'wrangler.example.toml').read_bytes()
    files['README.md'] = (
        '# MCP pribadi — paket portabel\n\n'
        'Mulai dari [BACA-DULU.md](BACA-DULU.md).\n\n'
        'Konfigurasi akun tujuan ditandai `GANTI_INSTALASI`. Isi `installation.json` '
        'dan `wrangler.toml`, buat secrets/resource baru, lalu ikuti '
        '[panduan deploy](docs/PINDAH-AKUN-DAN-DEPLOY.md).\n\n'
        'Paket ini berisi kode sumber; tidak membawa sesi OAuth atau data instance lama.\n'
    ).encode()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'work/private-mcp-portable.zip')
    args = parser.parse_args()
    files = portable_files()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            archive.writestr('private-mcp/' + name, content)
    print(f'Created {args.output}: {len(files)} source/template files; runtime state excluded.')


if __name__ == '__main__':
    main()
