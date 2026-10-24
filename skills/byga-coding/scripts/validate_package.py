#!/usr/bin/env python3
"""Validate this skill folder's manifest shape and local referenced paths (read-only)."""
import re, sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
skill=root/'SKILL.md'
if not skill.exists(): sys.exit('ERROR: SKILL.md missing')
txt=skill.read_text(encoding='utf-8')
parts=txt.split('---',2)
if len(parts)<3 or parts[0].strip(): sys.exit('ERROR: expected YAML frontmatter at top')
front=parts[1]
for field in ('name','description'):
    if not re.search(rf'(?m)^{field}:\s*\S',front):sys.exit(f'ERROR: missing {field}')
for p in re.findall(r'`((?:references|assets|scripts)/[^`]+)`',txt):
    if not (root/p).exists():sys.exit('ERROR: missing referenced file '+p)
print('OK: valid frontmatter and referenced local files. Skill not installed or remotely scanned.')
