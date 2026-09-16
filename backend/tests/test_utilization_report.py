"""
Unit tests for metric utilization reporting service and PDF generation.
"""

import os
os.environ.setdefault("DATABASE_URL", "postgresql://snoomp_admin:dummy@localhost:5432/snoomp_db")

import datetime
import unittest
from unittest.mock import MagicMock

from app.services.utilization_report import _metric_stats, get_target_utilization_report
from app.reports.pdf import build_utilization_report, _fmt_storage
from app.checkers.ssh import parse_metrics_output, _parse_df_size_to_gb


class TestUtilizationReport(unittest.TestCase):

    def test_metric_stats_calculation(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        samples = [
            (10.0, now - datetime.timedelta(minutes=30)),
            (20.0, now - datetime.timedelta(minutes=20)),
            (95.0, now - datetime.timedelta(minutes=10)),  # Peak
            (40.0, now),  # Current
        ]
        stats = _metric_stats(samples)
        self.assertIsNotNone(stats)
        self.assertEqual(stats["current"], 40.0)
        self.assertEqual(stats["min"], 10.0)
        self.assertEqual(stats["max"], 95.0)
        self.assertEqual(stats["samples"], 4)
        self.assertEqual(stats["avg"], round((10 + 20 + 95 + 40) / 4, 2))
        self.assertEqual(stats["peak_time"], (now - datetime.timedelta(minutes=10)).isoformat())

    def test_get_target_utilization_report_no_metrics(self):
        db = MagicMock()
        target = MagicMock()
        target.id = "target-http-1"
        target.name = "Web API"
        target.host = "api.example.com"
        target.type = "http"

        query_mock = MagicMock()
        db.query.return_value = query_mock
        query_mock.filter_by.return_value.first.return_value = target
        query_mock.filter.return_value.filter.return_value.order_by.return_value.all.return_value = []

        res = get_target_utilization_report("target-http-1", hours=168, db=db)
        self.assertEqual(res["target_id"], "target-http-1")
        self.assertFalse(res["has_metrics"])
        self.assertEqual(res["total_samples"], 0)
        self.assertEqual(res["verdict"], "No Data")

    def test_get_target_utilization_report_with_metrics(self):
        db = MagicMock()
        target = MagicMock()
        target.id = "target-ssh-1"
        target.name = "Production App Server"
        target.host = "10.0.0.50"
        target.type = "ssh"

        now = datetime.datetime.now(datetime.timezone.utc)
        metric_rows = []
        cpu_vals = [25.0, 30.0, 85.0, 92.0, 28.0]
        mem_vals = [55.0, 60.0, 62.0, 65.0, 58.0]
        disk_vals = [70.0, 70.0, 71.0, 71.0, 72.0]

        for i in range(5):
            row = MagicMock()
            row.checked_at = now - datetime.timedelta(minutes=(5 - i) * 10)
            row.cpu_percent = cpu_vals[i]
            row.mem_percent = mem_vals[i]
            row.disk_percent = disk_vals[i]
            row.uptime = "14 days, 6 hours"
            row.details_json = {
                "cpu_cores": 8,
                "ram_total_gb": 32.0,
                "disk_total_gb": 500.0,
                "load_1min": 1.45,
                "load_percent": 18.1,
                "disks": [
                    {"mount": "/", "size_gb": 100.0, "used_gb": 72.0, "use_pct": 72.0, "fstype": "ext4"},
                    {"mount": "/data", "size_gb": 400.0, "used_gb": 340.0, "use_pct": 85.0, "fstype": "ext4"},
                ],
            }
            metric_rows.append(row)

        query_mock = MagicMock()
        db.query.return_value = query_mock
        query_mock.filter_by.return_value.first.return_value = target
        query_mock.filter.return_value.filter.return_value.order_by.return_value.all.return_value = metric_rows

        res = get_target_utilization_report("target-ssh-1", hours=24, db=db)
        self.assertEqual(res["target_id"], "target-ssh-1")
        self.assertTrue(res["has_metrics"])
        self.assertEqual(res["total_samples"], 5)
        self.assertEqual(res["cpu"]["max"], 92.0)
        self.assertEqual(res["cpu"]["current"], 28.0)
        self.assertEqual(res["verdict"], "Critical Saturation")
        self.assertEqual(res["verdict_level"], "critical")
        self.assertEqual(len(res["partitions"]), 2)
        self.assertEqual(res["partitions"][0]["mount"], "/data")
        self.assertTrue(len(res["spikes"]) >= 2)

    def test_build_utilization_report_pdf(self):
        target = MagicMock()
        target.name = "Database Primary"
        target.host = "10.0.0.10"
        target.port = 5432
        target.type = "db"

        report = {
            "target_name": "Database Primary",
            "target_host": "10.0.0.10",
            "target_type": "db",
            "range_hours": 168,
            "has_metrics": True,
            "total_samples": 120,
            "verdict": "Optimal Headroom",
            "verdict_level": "optimal",
            "cpu": {"current": 22.4, "avg": 25.1, "min": 12.0, "max": 65.0, "p95": 48.0},
            "memory": {"current": 45.2, "avg": 44.8, "min": 40.0, "max": 52.0, "p95": 50.0},
            "disk": {"current": 61.0, "avg": 60.5, "min": 58.0, "max": 62.0, "p95": 61.5},
            "host_info": {"uptime": "42 days", "cpu_cores": 16, "load_percent": 15.2, "load_1min": 2.43},
            "partitions": [
                {"mount": "/var/lib/postgresql", "size_gb": 1000.0, "used_gb": 610.0, "use_pct": 61.0, "fstype": "xfs"},
            ],
            "database": {
                "connections": {"current": 42, "avg": 38.5, "p95": 55, "max": 78},
                "cache_hit_ratio": {"current": 99.4, "avg": 99.2, "p95": 99.6, "min": 98.1},
            },
            "spikes": [],
            "saturation": {"total_spikes": 0},
            "timeline": [
                {"start": "2026-09-09T00:00:00Z", "avg_cpu": 24.0, "avg_mem": 45.0, "avg_disk": 60.0},
                {"start": "2026-09-10T00:00:00Z", "avg_cpu": 28.0, "avg_mem": 46.0, "avg_disk": 60.5},
                {"start": "2026-09-11T00:00:00Z", "avg_cpu": 22.0, "avg_mem": 44.0, "avg_disk": 61.0},
            ],
        }

        pdf_bytes = build_utilization_report(target, report)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 1000)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))

    def test_fmt_storage(self):
        self.assertEqual(_fmt_storage(None), "—")
        self.assertEqual(_fmt_storage(2048.0), "2.0 TB")
        self.assertEqual(_fmt_storage(95.0), "95.0 GB")
        self.assertEqual(_fmt_storage(3.2), "3.2 GB")
        self.assertEqual(_fmt_storage(1.0), "1.0 GB")
        self.assertEqual(_fmt_storage(0.15), "154 MB")
        self.assertEqual(_fmt_storage(0.0049), "5 MB")
        self.assertEqual(_fmt_storage(0.0, is_size=False), "0.0 GB")
        self.assertEqual(_fmt_storage(0.0, is_size=True), "< 100 MB")

    def test_parse_df_size_to_gb(self):
        self.assertEqual(_parse_df_size_to_gb("95G"), 95.0)
        self.assertEqual(_parse_df_size_to_gb("3.2G"), 3.2)
        self.assertEqual(_parse_df_size_to_gb("5.0M"), 0.0049)
        self.assertEqual(_parse_df_size_to_gb("0"), 0.0)
        self.assertEqual(_parse_df_size_to_gb("-"), 0.0)

    def test_parse_metrics_output_disks(self):
        raw_output = """
 21:00:01 up 14 days,  6:20,  2 users,  load average: 0.45, 0.52, 0.48
Mem:         32000       16000        8000           0        4000       16000
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        95G   20G   71G  22% /
tmpfs           3.2G     0  3.2G   0% /run
tmpfs            16G     0   16G   0% /dev/shm
tmpfs           5.0M     0  5.0M   0% /run/lock
/dev/sda2       1.0G  150M  850M  15% /boot
cpu  1000 200 300 8000 100 50 20 0 0 0
0.45 0.52 0.48 1/450 12345
8
"""
        metrics = parse_metrics_output(raw_output)
        self.assertIn("disks", metrics)
        disks = metrics["disks"]
        self.assertEqual(len(disks), 5)
        root = next(d for d in disks if d["mount"] == "/")
        self.assertEqual(root["size_gb"], 95.0)
        self.assertEqual(root["used_gb"], 20.0)
        self.assertEqual(root["used_percent"], 22.0)
        self.assertEqual(root["use_pct"], 22.0)

        lock = next(d for d in disks if d["mount"] == "/run/lock")
        self.assertEqual(lock["used_gb"], 0.0)
        self.assertGreater(lock["size_gb"], 0.0)  # Preserves sub-0.1 GB rather than truncating to 0

    def test_partition_fallback_computation(self):
        db = MagicMock()
        target = MagicMock()
        target.id = "target-legacy-disks"
        target.name = "Legacy Disk Host"
        target.host = "10.0.0.99"
        target.type = "ssh"

        now = datetime.datetime.now(datetime.timezone.utc)
        row = MagicMock()
        row.checked_at = now
        row.cpu_percent = 20.0
        row.mem_percent = 40.0
        row.disk_percent = 50.0
        row.uptime = "5 days"
        # Legacy details_json where only 'used_percent' exists and 'used_gb' is missing
        row.details_json = {
            "disks": [
                {"filesystem": "/dev/sda1", "mount": "/", "size_gb": 100.0, "used_percent": 45.0},
                {"filesystem": "tmpfs", "mount": "/run/lock", "size_gb": 0.0, "used_percent": 0.0},
            ]
        }

        query_mock = MagicMock()
        db.query.return_value = query_mock
        query_mock.filter_by.return_value.first.return_value = target
        query_mock.filter.return_value.filter.return_value.order_by.return_value.all.return_value = [row]

        res = get_target_utilization_report("target-legacy-disks", hours=24, db=db)
        partitions = res["partitions"]
        self.assertEqual(len(partitions), 2)
        root = next(p for p in partitions if p["mount"] == "/")
        self.assertEqual(root["use_pct"], 45.0)
        self.assertEqual(root["used_gb"], 45.0)  # Computed 100 * 0.45
        self.assertEqual(root["size_gb"], 100.0)

        # Ensure PDF generates without issue with these partitions
        pdf_bytes = build_utilization_report(target, res)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))

    def test_build_utilization_report_pdf_empty(self):
        target = MagicMock()
        target.name = "ICMP Ping GW"
        target.host = "192.168.1.1"
        target.type = "ping"

        report = {
            "target_name": "ICMP Ping GW",
            "target_host": "192.168.1.1",
            "target_type": "ping",
            "range_hours": 24,
            "has_metrics": False,
            "message": "Ping monitor does not collect system metrics.",
        }

        pdf_bytes = build_utilization_report(target, report)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 500)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))

    def test_multipage_utilization_report_pdf(self):
        target = MagicMock()
        target.name = "Multi-Page Host"
        target.host = "10.0.0.1"
        target.port = 22
        target.type = "ssh"

        now = datetime.datetime.now(datetime.timezone.utc)
        timeline = []
        for i in range(14):
            timeline.append({
                "start": (now - datetime.timedelta(hours=i*12)).isoformat(),
                "avg_cpu": 35.0, "max_cpu": 82.0,
                "avg_mem": 55.0, "max_mem": 70.0,
                "avg_disk": 75.0, "max_disk": 80.0,
            })

        partitions = [
            {"mount": "/", "size_gb": 145.0, "used_gb": 119.0, "use_pct": 82.0, "fstype": "local"},
            {"mount": "/boot", "size_gb": 1.0, "used_gb": 0.58, "use_pct": 58.0, "fstype": "local"},
            {"mount": "/run", "size_gb": 1.6, "used_gb": 0.016, "use_pct": 1.0, "fstype": "local"},
            {"mount": "/dev/shm", "size_gb": 7.8, "used_gb": 0.0, "use_pct": 0.0, "fstype": "local"},
            {"mount": "/run/lock", "size_gb": 0.005, "used_gb": 0.0, "use_pct": 0.0, "fstype": "local"},
        ]

        report = {
            "target_name": "Multi-Page Host",
            "target_host": "10.0.0.1",
            "target_type": "ssh",
            "range_hours": 168,
            "has_metrics": True,
            "total_samples": 200,
            "verdict": "Critical Saturation",
            "verdict_level": "critical",
            "cpu": {"current": 4.0, "avg": 20.0, "min": 2.0, "max": 92.6, "p95": 4.8},
            "memory": {"current": 25.2, "avg": 25.0, "min": 20.0, "max": 73.3, "p95": 30.0},
            "disk": {"current": 73.3, "avg": 73.0, "min": 70.0, "max": 77.6, "p95": 75.0},
            "host_info": {"uptime": "10 days", "cpu_cores": 4, "load_percent": 15.0, "load_1min": 0.05},
            "timeline": timeline,
            "partitions": partitions,
            "spikes": [],
            "saturation": {"total_spikes": 4},
        }

        # This must succeed across both passes and generate a 2+ page document without LayoutError
        pdf_bytes = build_utilization_report(target, report)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))
        self.assertGreater(len(pdf_bytes), 2000)


if __name__ == "__main__":
    unittest.main()

