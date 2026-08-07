### Task 1: Setup Dependencies

**Files:**
- Modify: `backend/requirements-test.txt`

**Interfaces:**
- Produces: Installed testing dependencies.

- [ ] **Step 1: Write the failing test**

```python
# test_imports.py
def test_dependencies():
    import testcontainers
    import pytest_asyncio
    import httpx
    assert True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest test_imports.py`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Write minimal implementation**

```text
# backend/requirements-test.txt
pytest==8.2.2
pytest-asyncio==0.23.7
testcontainers==4.5.1
httpx==0.27.0
```
Install them: `pip install -r backend/requirements-test.txt`

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest test_imports.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/requirements-test.txt
git commit -m "chore: add testing dependencies"
```

---

