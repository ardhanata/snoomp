---
type: "query"
date: "2026-08-06T22:14:47.149155+00:00"
question: "Why does Target connect Database Models to Target Routes, Backend Init & Websockets, Status Page Routes?"
contributor: "graphify"
source_nodes: ["Target"]
---

# Q: Why does Target connect Database Models to Target Routes, Backend Init & Websockets, Status Page Routes?

## Answer

Target is the core SQLAlchemy database model representing a monitoring endpoint. It connects these communities because:
1. Target Routes: The CRUD endpoints in targets.py directly depend on the Target model and its Pydantic schemas.
2. Backend Init & Websockets: The ConnectionManager broadcasts real-time status updates for Targets, and the scheduler retrieves Target records to execute checks.
3. Status Page Routes: Status pages aggregate metrics from specific Target endpoints, creating a cross-community dependency.

## Source Nodes

- Target