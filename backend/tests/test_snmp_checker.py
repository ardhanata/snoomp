"""
Unit tests for SNMP checker including multi-core CPU discovery.
"""

import unittest
from unittest.mock import patch, MagicMock, AsyncMock

from app.checkers.snmp import _get_mock_metrics, check_snmp


class TestSnmpChecker(unittest.IsolatedAsyncioTestCase):

    def test_mock_metrics(self):
        m = _get_mock_metrics()
        self.assertIn("cpu_cores", m)
        self.assertEqual(m["cpu_cores"], 8)
        self.assertIn("cpu_percent", m)
        self.assertIn("mem_percent", m)
        self.assertIn("disk_percent", m)
        self.assertIn("uptime", m)

    async def test_snmp_mock_loopback(self):
        res = await check_snmp("127.0.0.1")
        self.assertEqual(res.status, "up")
        self.assertEqual(res.details.get("cpu_cores"), 8)

    @patch("app.checkers.snmp.bulkCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp.getCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp._make_target", new_callable=AsyncMock)
    async def test_snmp_cores_bulk_discovery(self, mock_target, mock_get_cmd, mock_bulk_cmd):
        mock_target.return_value = MagicMock()
        # Mock getCmd for system metrics
        # [0] ssCpuUser, [1] ssCpuSystem, [2] memTotalReal, [3] memAvailReal, [4] dskPercent, [5] hrSystemUptime, [6] dskTotal
        var_binds_get = [
            (MagicMock(), 10),
            (MagicMock(), 5),
            (MagicMock(), 32000000),
            (MagicMock(), 8000000),
            (MagicMock(), "45.0"),
            (MagicMock(), 8640000),
            (MagicMock(), 150000000),
        ]
        mock_get_cmd.return_value = (None, None, 0, var_binds_get)

        # Mock bulkCmd returning 8 cores
        base_oid = "1.3.6.1.2.1.25.3.3.1.2"
        bulk_rows = []
        for i in range(8):
            oid_mock = MagicMock()
            oid_mock.getOid.return_value = f"{base_oid}.{196608 + i}"
            val_mock = MagicMock()
            bulk_rows.append([(oid_mock, val_mock)])

        mock_bulk_cmd.return_value = (None, None, 0, bulk_rows)

        res = await check_snmp("192.168.1.100", community="public")
        self.assertEqual(res.status, "up")
        self.assertEqual(res.details.get("cpu_percent"), 15.0)
        self.assertEqual(res.details.get("cpu_cores"), 8)

    @patch("app.checkers.snmp.nextCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp.bulkCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp.getCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp._make_target", new_callable=AsyncMock)
    async def test_snmp_cores_next_cmd_fallback(self, mock_target, mock_get_cmd, mock_bulk_cmd, mock_next_cmd):
        mock_target.return_value = MagicMock()
        var_binds_get = [
            (MagicMock(), 5),
            (MagicMock(), 5),
            (MagicMock(), 16000000),
            (MagicMock(), 8000000),
            (MagicMock(), "30.0"),
            (MagicMock(), 8640000),
            (MagicMock(), 100000000),
        ]
        mock_get_cmd.return_value = (None, None, 0, var_binds_get)

        # bulkCmd fails or returns error
        mock_bulk_cmd.side_effect = Exception("GETBULK unsupported")

        # nextCmd returns 4 cores then advances beyond table
        base_oid = "1.3.6.1.2.1.25.3.3.1.2"
        next_calls = []
        for i in range(4):
            oid_mock = MagicMock()
            oid_mock.getOid.return_value = f"{base_oid}.{196608 + i}"
            next_calls.append((None, None, 0, [[(oid_mock, 10)]]))
        # 5th call is outside table
        out_oid = MagicMock()
        out_oid.getOid.return_value = "1.3.6.1.2.1.25.3.4.1.1"
        next_calls.append((None, None, 0, [[(out_oid, 1)]]))

        mock_next_cmd.side_effect = next_calls

        res = await check_snmp("192.168.1.101", community="public")
        self.assertEqual(res.status, "up")
        self.assertEqual(res.details.get("cpu_cores"), 4)

    @patch("app.checkers.snmp.bulkCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp.getCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp._make_target", new_callable=AsyncMock)
    async def test_snmp_memory_calculation_with_buffers_and_cached(self, mock_target, mock_get_cmd, mock_bulk_cmd):
        mock_target.return_value = MagicMock()
        # [0] ssCpuUser, [1] ssCpuSystem, [2] memTotalReal, [3] memAvailReal, [4] dskPercent, [5] hrSystemUptime, [6] dskTotal, [7] memBuffer, [8] memCached
        # Total: 16 GB = 16384000 kB. Free: 2 GB, Buffer: 1 GB, Cached: 5 GB -> Effective free: 8 GB -> 50% usage
        var_binds_get = [
            (MagicMock(), 5),
            (MagicMock(), 5),
            (MagicMock(), 16384000),
            (MagicMock(), 2048000),
            (MagicMock(), "50.0"),
            (MagicMock(), 8640000),
            (MagicMock(), 100000000),
            (MagicMock(), 1024000),
            (MagicMock(), 5120000),
        ]
        mock_get_cmd.return_value = (None, None, 0, var_binds_get)
        mock_bulk_cmd.return_value = (None, None, 0, [])

        res = await check_snmp("192.168.1.102", community="public")
        self.assertEqual(res.status, "up")
        self.assertEqual(res.details.get("mem_percent"), 50.0)
        self.assertEqual(res.details.get("ram_total_gb"), 15.6)

    @patch("app.checkers.snmp.bulkCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp.getCmd", new_callable=AsyncMock)
    @patch("app.checkers.snmp._make_target", new_callable=AsyncMock)
    async def test_snmp_memory_never_negative_when_free_exceeds_total(self, mock_target, mock_get_cmd, mock_bulk_cmd):
        mock_target.return_value = MagicMock()
        # Simulated host where free was reported greater than total (e.g. swap free included or misconfigured OID)
        # Total: 16384000 kB, Avail: 18000000 kB
        var_binds_get = [
            (MagicMock(), 2),
            (MagicMock(), 1),
            (MagicMock(), 16384000),
            (MagicMock(), 18000000),
            (MagicMock(), "20.0"),
            (MagicMock(), 8640000),
            (MagicMock(), 100000000),
            (MagicMock(), 0),
            (MagicMock(), 0),
        ]
        mock_get_cmd.return_value = (None, None, 0, var_binds_get)
        mock_bulk_cmd.return_value = (None, None, 0, [])

        res = await check_snmp("192.168.1.103", community="public")
        self.assertEqual(res.status, "up")
        self.assertEqual(res.details.get("mem_percent"), 0.0)
        self.assertGreaterEqual(res.details.get("mem_percent"), 0.0)


if __name__ == "__main__":
    unittest.main()
