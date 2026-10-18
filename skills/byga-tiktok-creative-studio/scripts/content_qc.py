#!/usr/bin/env python3
"""Offline structural QC for BYGA TikTok packages (JSON, stdlib only).

Usage: python scripts/content_qc.py --input examples/video-sample.json --mode video
Does not verify factual truth, artistic quality, claims, originality or rendering.
"""
import argparse
import json
import math
from pathlib import Path
import sys

EPS=1e-6

def validate_shots(shots, duration, base='shots'):
    issues=[]
    if not isinstance(shots,list) or not shots:
        return [f'{base}: expected non-empty shot array']
    if not isinstance(duration,(int,float)) or isinstance(duration,bool) or duration<=0 or not math.isfinite(duration):
        return [f'{base}: duration must be a positive finite number']
    previous=0.0
    ids=set()
    for i,shot in enumerate(shots,1):
        path=f'{base}[{i}]'
        if not isinstance(shot,dict):
            issues.append(f'{path}: shot must be an object');continue
        ident=str(shot.get('id','')).strip()
        if not ident: issues.append(f'{path}: missing id')
        elif ident in ids: issues.append(f'{path}: duplicate id {ident}')
        ids.add(ident)
        start=shot.get('start_sec');end=shot.get('end_sec')
        if any(not isinstance(t,(int,float)) or isinstance(t,bool) or not math.isfinite(t) for t in (start,end)):
            issues.append(f'{path}: start_sec and end_sec must be finite numbers');continue
        if start<0 or end<=start: issues.append(f'{path}: invalid positive time interval [{start},{end}]')
        if abs(start-previous)>EPS:
            issues.append(f'{path}: gap/overlap; expected start {previous:g}, actual {start:g}')
        previous=end
        if not isinstance(shot.get('visual_prompt'),str) or not shot['visual_prompt'].strip():
            issues.append(f'{path}: visual_prompt empty')
        if 'onscreen_text' in shot and not isinstance(shot['onscreen_text'],str):
            issues.append(f'{path}: onscreen_text must be string if present')
    if abs(previous-duration)>EPS:
        issues.append(f'{base}: final end {previous:g}s must equal duration {duration:g}s')
    return issues

def validate(data,mode):
    issues=[]
    if not isinstance(data,dict): return ['top-level JSON must be an object']
    if data.get('aspect_ratio')!='9:16':
        issues.append('aspect_ratio: expected "9:16" for this vertical TikTok preset')
    if mode=='carousel':
        count=data.get('slide_count');slides=data.get('slides')
        if not isinstance(count,int) or isinstance(count,bool) or count<1:
            issues.append('slide_count: expected positive integer')
        if not isinstance(slides,list): return issues+['slides: expected array']
        if isinstance(count,int) and len(slides)!=count:
            issues.append(f'slides: expected {count}, found {len(slides)}')
        nums=[]
        for i,slide in enumerate(slides,1):
            k=f'slides[{i}]'
            if not isinstance(slide,dict): issues.append(f'{k}: expected object');continue
            nums.append(slide.get('number'))
            for key in ('heading','image_prompt'):
                if not isinstance(slide.get(key),str) or not slide[key].strip():
                    issues.append(f'{k}: missing non-empty {key}')
            if 'body' in slide and not isinstance(slide['body'],str):
                issues.append(f'{k}: body must be a string')
        if nums!=list(range(1,len(slides)+1)):
            issues.append('slides: number fields must be sequential starting at 1')
    elif mode=='video':
        issues+=validate_shots(data.get('shots'),data.get('duration_seconds'),'shots')
    elif mode=='drama':
        eps=data.get('episodes')
        if not isinstance(eps,list) or not eps: return issues+['episodes: expected non-empty array']
        if not isinstance(data.get('story_bible'),dict) or not data['story_bible']:
            issues.append('story_bible: expected non-empty object')
        for i,ep in enumerate(eps,1):
            if not isinstance(ep,dict): issues.append(f'episodes[{i}]: expected object');continue
            if ep.get('number')!=i: issues.append(f'episodes[{i}]: nonsequential number')
            issues+=validate_shots(ep.get('shots'),ep.get('duration_seconds'),f'episodes[{i}].shots')
    else: issues.append(f'unsupported mode: {mode}')
    return issues

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True,type=Path)
    p.add_argument('--mode',required=True,choices=['carousel','video','drama'])
    args=p.parse_args(argv)
    try: data=json.loads(args.input.read_text(encoding='utf-8'))
    except (OSError,UnicodeError,json.JSONDecodeError) as e:
        print(f'ERROR reading {args.input}: {e}',file=sys.stderr);return 2
    issues=validate(data,args.mode)
    if issues:
        print(f'FAIL [{args.mode}] {len(issues)} issue(s):')
        for issue in issues: print(f'  - {issue}')
        return 1
    print(f'PASS [{args.mode}] basic JSON structural checks for {args.input}')
    print('NOTE: This does NOT verify authenticity, content quality, claims, rights, or media generation.')
    return 0

if __name__=='__main__':
    sys.exit(main())
