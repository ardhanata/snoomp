import sys, json
from networkx.readwrite import json_graph
import networkx as nx
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
G = json_graph.node_link_graph(data, edges='links')

start_nodes = []
for nid, ndata in G.nodes(data=True):
    if ndata.get("label") == "check_ssh()":
        start_nodes.append(nid)

frontier = set(start_nodes)
subgraph_nodes = set(start_nodes)
subgraph_edges = []
for _ in range(2): # Depth 2
    next_frontier = set()
    for n in frontier:
        for neighbor in G.neighbors(n):
            if neighbor not in subgraph_nodes:
                next_frontier.add(neighbor)
                subgraph_edges.append((n, neighbor))
    subgraph_nodes.update(next_frontier)
    frontier = next_frontier

lines = [f'Traversal: BFS from check_ssh() | {len(subgraph_nodes)} nodes']
for nid in subgraph_nodes:
    d = G.nodes[nid]
    lines.append(f'  NODE {d.get("label", nid)} [src={d.get("source_file","")} loc={d.get("source_location","")}] (Community {d.get("community_name", "")})')
for u, v in subgraph_edges:
    _raw = G[u][v]; d = next(iter(_raw.values()), {}) if isinstance(G, nx.MultiGraph) else _raw
    lines.append(f'  EDGE {G.nodes[u].get("label",u)} --{d.get("relation","")} [{d.get("confidence","")}]--> {G.nodes[v].get("label",v)}')

print('\n'.join(lines))
