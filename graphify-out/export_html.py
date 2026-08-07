import json
from networkx.readwrite import json_graph
from pathlib import Path
from graphify.export import to_html

data = json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
G = json_graph.node_link_graph(data, edges='links')
communities = {}
for n, d in G.nodes(data=True):
    c = d.get('community', 0)
    if c not in communities:
        communities[c] = []
    communities[c].append(n)

to_html(G, communities, 'graphify-out/graph.html')
print(f"Generated HTML size: {Path('graphify-out/graph.html').stat().st_size}")
