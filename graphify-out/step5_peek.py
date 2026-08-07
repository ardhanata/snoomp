import json
analysis = json.loads(open("graphify-out/.graphify_analysis.json", encoding="utf-8").read())
for k, v in analysis["communities"].items():
    print(f"Community {k}: {len(v)} nodes")
    print("  " + ", ".join([n.get("name", n["id"]) for n in v[:10]]))
