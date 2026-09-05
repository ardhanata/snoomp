import sys, json
from graphify.build import build_from_json
from graphify.cluster import score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_html
from pathlib import Path
from networkx.readwrite import json_graph

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))
detection  = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
analysis   = json.loads(Path('graphify-out/.graphify_analysis.json').read_text(encoding='utf-8'))

G = build_from_json(extraction, root='.', directed=False)
communities = {int(k): v for k, v in analysis['communities'].items()}
cohesion = {int(k): v for k, v in analysis['cohesion'].items()}
tokens = {'input': extraction.get('input_tokens', 0), 'output': extraction.get('output_tokens', 0)}

# Re-use previous labels
labels = {
    0: "Database Models",
    1: "Frontend App Components",
    2: "Backend Init & Websockets",
    3: "Authentication Security",
    4: "Frontend Dependencies",
    5: "DB & DNS Checkers",
    6: "SSH & SNMP Checkers",
    7: "Status Page Routes",
    8: "TypeScript Configuration",
    9: "Target Routes",
    10: "Dashboard API",
    11: "Backend Init",
    12: "Vite Env Config",
    13: "Vite Configuration",
    14: "Native Windows Startup",
    15: "Windows Startup"
}
for k in communities:
    if k not in labels:
        labels[k] = f"Community {k}"

questions = suggest_questions(G, communities, labels)

report = generate(G, communities, cohesion, labels, analysis['gods'], analysis['surprises'], detection, tokens, '.', suggested_questions=questions)
Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8')
Path('graphify-out/.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding='utf-8')

to_json(G, communities, 'graphify-out/graph.json', community_labels=labels)

# Explicitly generate HTML correctly
html = to_html(G, communities, 'graphify-out/graph.html')

print("Report, JSON, and HTML generated successfully.")
