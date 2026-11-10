"""Inventory the public copy and report high-confidence exposure patterns.

Only file names, line numbers and rule names are reported, never matched values.
This source scan supplements manual review; it is not a credential guarantee.
"""
from pathlib import Path
import csv
import hashlib
import json
import os
import re

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {'node_modules', '.validation', '.git', '.dart_tool', 'build', 'dist',
             '__pycache__', '.npm-cache', '.pub-cache', '.local-tools', '.gradle',
             '.kotlin', '.cxx', 'ephemeral', 'coverage', 'test-results'}
SKIP_ROOT = {'inventory-source.txt', 'review-inventory.json'}
rules = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'aws-access-key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'github-token': re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b'),
    'google-api-key': re.compile(r'\bAIza[A-Za-z0-9_-]{35}\b'),
}
denied = re.compile(r'(^|/)(?:\.env(?:\..*)?|secrets\.h|local\.properties|key\.properties)$|\.private(?:\.|$)|\.(?:dump|pgdump|backup|pem|key|jks|keystore)$', re.I)
files = []
findings = []
paths = []
for base, dirs, names in os.walk(ROOT, followlinks=False):
    dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
    for name in sorted(names):
        path = Path(base) / name
        relative = path.relative_to(ROOT).as_posix()
        if relative in SKIP_ROOT:
            continue
        if path.is_symlink():
            findings.append({'path': relative, 'line': None, 'rule': 'symlink-needs-review'})
            continue
        if denied.search(relative) and not relative.endswith(('.env.example', 'secrets.example.h')):
            findings.append({'path': relative, 'line': None, 'rule': 'private-file-name'})
        data = path.read_bytes()
        files.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        try:
            text = data.decode('utf-8-sig')
        except UnicodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            for rule, pattern in rules.items():
                if pattern.search(line):
                    findings.append({'path': relative, 'line': line_number, 'rule': rule})
            if relative.endswith(('.js', '.mjs', '.cjs', '.ps1', '.psm1', '.py', '.dart', '.json')) and re.search(r'[CD]:(?:[/\\])+(?:ChildGuard-V2|Users|develop|Program Files)', line):
                paths.append({'path': relative, 'line': line_number, 'category': 'machine-path-or-historical-policy'})

docs = ROOT / 'docs'
docs.mkdir(exist_ok=True)
generated = {'docs/public-files.csv', 'docs/public-paths.txt', 'docs/security-scan.json', 'docs/local-paths.csv'}
indexed = {row['path']: row for row in files}
for name in generated:
    indexed[name] = {'path': name, 'bytes': '-', 'sha256': 'generated-index-see-note'}
with (docs / 'public-files.csv').open('w', newline='', encoding='utf-8') as stream:
    writer = csv.DictWriter(stream, fieldnames=['path', 'bytes', 'sha256'])
    writer.writeheader()
    writer.writerows(indexed[name] for name in sorted(indexed))
(docs / 'public-paths.txt').write_text(''.join(':(literal)' + name + '\n' for name in sorted(indexed)), encoding='utf-8')
with (docs / 'local-paths.csv').open('w', newline='', encoding='utf-8') as stream:
    writer = csv.DictWriter(stream, fieldnames=['path', 'line', 'category'])
    writer.writeheader()
    writer.writerows(paths)
summary = {'scope': 'Public source only; dependencies, caches, builds and .validation excluded.',
           'public_files': len(indexed), 'high_confidence_findings': findings,
           'machine_path_references': len(paths),
           'limitations': ['Pattern matching cannot establish absence of unknown credentials.',
                           'Synthetic test passwords/tokens are intentionally retained.',
                           'Generated index files omit their own hashes to avoid circular checksums.',
                           'private-backups and original private configuration were not inspected.']}
(docs / 'security-scan.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'public_files': len(indexed), 'high_confidence_findings': len(findings), 'machine_path_references': len(paths)}))
raise SystemExit(bool(findings))
