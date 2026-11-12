#!/usr/bin/env python3
"""Dependency-free self-check for the extracted SADEEMAN starter; not an AI project test."""
from pathlib import Path
import os
import json, re, sys, xml.etree.ElementTree as ET
root=Path(__file__).resolve().parent.parent
required=['AGENTS.md','MASTER_PROMPT_FOR_CODEX.md','START_HERE_CODEX.txt','README.md','brand/brand.json','brand/tokens.css','brand/logo-orbital-lantern.svg','brand/preview.html','contracts/agent-events.schema.json','contracts/tool-registry-outline.json','fixtures/company_packages.DEMO_ONLY.json','tests/evals/scenarios.jsonl']
errors=[]
# Exclude installed dependencies and generated output after the starter becomes a workspace.
excluded={'node_modules','.pnpm-store','.git','.next','dist','coverage','.venv','__pycache__','test-results','playwright-report','.private','.supabase'}
files=[]
for directory,dirs,names in os.walk(root):
 dirs[:]=[name for name in dirs if name not in excluded]
 files.extend(Path(directory)/name for name in names)
for f in required:
 if not (root/f).is_file(): errors.append('Missing '+f)
for f in (item for item in files if item.suffix=='.json'):
 try: json.loads(f.read_text(encoding='utf-8'))
 except Exception as e: errors.append(f'{f.relative_to(root)}: JSON: {e}')
try:
 ET.parse(root/'brand/logo-orbital-lantern.svg')
except Exception as e: errors.append('Bad SVG: '+str(e))
try:
 data=json.loads((root/'brand/brand.json').read_text(encoding='utf-8'))
 assert data['product']['arabicName']=='سَدِيمًا'
 assert data['product']['englishName']=='SADEEMAN AI'
 assert data['colors']['nightPlum']=='#26192F'
except Exception as e: errors.append('Bad brand source of truth: '+str(e))
for n,line in enumerate((root/'tests/evals/scenarios.jsonl').read_text(encoding='utf-8').splitlines(),1):
 try:
  o=json.loads(line)
  for k in ['id','category','language','input','expected','requires']: assert k in o
 except Exception as e: errors.append(f'eval line {n}: {e}')
if errors:
 print('STARTER FAILED');print('\n'.join(errors));sys.exit(1)
print('STARTER PASS — '+str(len(files))+' source files checked; this DOES NOT test an implemented AI agent.')
