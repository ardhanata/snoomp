# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

backend_dir = os.path.abspath(SPECPATH)
project_root = os.path.abspath(os.path.join(backend_dir, ".."))

datas = [
    (os.path.join(project_root, 'frontend', 'dist'), os.path.join('frontend', 'dist')),
    (os.path.join(project_root, 'VERSION'), '.'),
]

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

datas += collect_data_files('apprise')

hidden_imports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'asyncssh',
    'psycopg2',
    'pymongo',
    'redis',
    'redis.asyncio',
    'pysnmp',
    'icmplib',
    'apprise',
    'sqlalchemy.dialects.sqlite',
    'sqlalchemy.dialects.postgresql',
    'apscheduler',
    'apscheduler.schedulers.background',
    'apscheduler.triggers.interval',
    'app',
    'app.database',
    'app.main',
    'app.websockets',
    'app.auth.security',
    'app.routes.auth',
    'app.routes.targets',
    'app.routes.dashboard',
    'app.routes.status_pages',
    'app.routes.settings',
    'app.routes.notifications',
    'app.routes.backup',
    'app.models.notification',
    'app.services.dashboard',
    'app.services.settings_store',
    'app.services.thresholds',
    'app.services.retention',
    'app.services.notification_service',
    'worker.tasks',
] + collect_submodules('celery') + collect_submodules('kombu') + collect_submodules('apprise')

a = Analysis(
    ['snoomp_server.py'],
    pathex=[backend_dir, project_root],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL', 'scipy', 'numpy', 'testcontainers'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='snoomp',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='snoomp-windows-x64',
)
