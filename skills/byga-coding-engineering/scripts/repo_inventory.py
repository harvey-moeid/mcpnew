#!/usr/bin/env python3
"""Read-only repository metadata inventory. No file bodies, secrets, or network access.

Usage: python repo_inventory.py /path/to/repository
Reports file existence and counts; excludes hidden/private data paths.
"""
import json
import sys
from pathlib import Path

INTERESTING = ["README.md", "package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "pyproject.toml", "requirements.txt", "wrangler.toml", "wrangler.json", "wrangler.jsonc", "tsconfig.json", "vite.config.ts", ".github/workflows", "migrations", "src", "tests"]
SKIP_DIRS={"node_modules", ".git", "dist", "build", "coverage", ".next", ".venv", "venv", "vendor", ".wrangler", ".env"}

def main():
    if len(sys.argv)!=2:
        print("Usage: python repo_inventory.py PATH",file=sys.stderr);return 2
    root=Path(sys.argv[1]).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        print("Repository directory not found",file=sys.stderr);return 2
    entries={x:(root/x).exists() for x in INTERESTING}
    dirs=[]
    for child in sorted(root.iterdir(),key=lambda p:p.name.lower()):
        if child.is_dir() and child.name not in SKIP_DIRS and not child.name.startswith("."):
            dirs.append(child.name)
    workflows=[]
    wf=root/'.github'/'workflows'
    if wf.is_dir():
        workflows=sorted(p.name for p in wf.iterdir() if p.is_file() and p.suffix in {'.yaml','.yml'})
    print(json.dumps({'path':str(root),'markers':entries,'top_level_dirs':dirs,'github_workflow_filenames':workflows},ensure_ascii=False,indent=2))
    return 0

if __name__=='__main__':raise SystemExit(main())
