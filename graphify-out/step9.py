import json
from pathlib import Path
from datetime import datetime, timezone
from graphify.detect import save_manifest
from graphify.cli import _stamped_manifest_files

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
extract = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))

_corpus = detect.get('all_files') or detect['files']
_manifest_files = _stamped_manifest_files(_corpus, extract, Path('.'))
_sem_types = ('document', 'paper', 'image')
_dispatched = {f for t, fl in detect['files'].items() if t in _sem_types for f in fl}
_stamped = {f for fl in _manifest_files.values() for f in fl}
_cleared = _dispatched - _stamped
_scan = {f for fl in _corpus.values() for f in fl}
save_manifest(_manifest_files, root='.', scan_corpus=_scan, clear_semantic=_cleared or None)
