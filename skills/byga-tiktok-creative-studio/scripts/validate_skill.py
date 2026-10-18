#!/usr/bin/env python3
"""Minimal packaging checks, not a substitute for the agentskills.io skills-ref validator."""
import argparse
from pathlib import Path
import re
import sys

def validate(root):
    issues=[]
    manifest=root/'SKILL.md'
    if not manifest.is_file():return ['Missing SKILL.md']
    txt=manifest.read_text(encoding='utf-8')
    m=re.match(r'^---\n(.*?)\n---\n',txt,re.S)
    if not m:return ['SKILL.md must begin with YAML frontmatter']
    fm=m.group(1)
    name=re.search(r'^name:\s*([a-z0-9-]+)\s*$',fm,re.M)
    desc=re.search(r'^description:\s*(.+?)\s*$',fm,re.M)
    if not name:issues.append('Invalid/missing name')
    else:
        n=name.group(1)
        if len(n)>64 or n.startswith('-') or n.endswith('-') or '--' in n or n!=root.name:
            issues.append('name must match folder, kebab-case, <=64 characters')
    if not desc: issues.append('Missing description')
    else:
        d=desc.group(1).strip().strip('"\'')
        if not d or len(d)>1024:issues.append('description must be 1–1024 chars')
    if not txt[m.end():].strip():issues.append('Missing instructions body')
    if len(txt.splitlines())>500:issues.append('SKILL.md exceeds recommended 500 lines')
    for rel in re.findall(r'`((?:references|assets|scripts)/[\w.\-/]+)`',txt):
        if not (root/rel).is_file():issues.append(f'Missing linked local resource: {rel}')
    for file in root.rglob('*'):
        if file.is_file() and file.suffix.lower() in ('.exe','.dll','.so','.dylib'):
            issues.append(f'Unexpected compiled executable: {file.relative_to(root)}')
    return issues

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('skill_root',nargs='?',type=Path,default=Path(__file__).resolve().parent.parent)
    args=parser.parse_args()
    issues=validate(args.skill_root.resolve())
    if issues:
        print('FAIL packaging check:');print('\n'.join(' - '+x for x in issues));return 1
    print('PASS: basic skill folder/manifest/resource checks. For full compliance use skills-ref validate.')
    return 0

if __name__=='__main__':sys.exit(main())
