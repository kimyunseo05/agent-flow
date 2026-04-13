"""
PLC Modbus 수집 — agent-flow 수집부 CMS(PostgreSQL)와 연동

수집부에서 등록한 device_ip, device_port, 태그(tag_id, 데이터타입, 주소, 배율)를 DB에서 읽어 수집합니다.

환경 변수 (server.js 의 PG 설정과 동일하게 맞추면 됨):
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE  — 설정·태그 조회용 DB (기본 agent_flow_collect)

수집부 단위 선택 (하나만 설정):
  COLLECTOR_UNIT_ID       — collection_units.id
  COLLECTOR_PROCESS_CODE  — 공정코드
  COLLECTOR_PROCESS_NAME  — 공정명 (기본: 에어크리너)

측정값 저장 DB (기존 factory_db 등):
  DB_CONFIG — psycopg2 연결 문자열 (기본: host=localhost dbname=factory_db user=postgres password=postgres port=5432)
  DB_TABLE  — INSERT 대상 테이블명

경로 (CSV/로그):
  ROOT_PATH — 기본 D:/SmartFactory (macOS 등에서는 환경 변수로 변경)

부하 조절 (PLC 수집 주기는 COLLECT_INTERVAL_SECONDS, 기본 1초):
  CONFIG_REFRESH_SECONDS — CMS(PostgreSQL)에서 수집부·태그 설정을 다시 읽는 주기(초), 기본 600(10분). 0이면 매 주기마다 조회.
  DATA_FLUSH_SECONDS     — 측정값을 저장 DB에 일괄 INSERT 하는 주기(초), 기본 600. 0이면 값이 생길 때마다 즉시 저장.
"""

import os
import sys
import time
import logging
import csv
from datetime import datetime

from pymodbus.client import ModbusTcpClient
import psycopg2
from psycopg2.extras import execute_values

# --- 기본값 (환경 변수로 덮어씀) ---
DEFAULT_PROCESS_NAME = os.environ.get("COLLECTOR_PROCESS_NAME", "에어크리너")
DEFAULT_DB_TABLE = os.environ.get("DB_TABLE", "table_air_cleaner")
ROOT_PATH = os.environ.get("ROOT_PATH", "D:/SmartFactory")
STORAGE_DIR = os.path.join(ROOT_PATH, "STORAGE")
LOGS_DIR = os.path.join(ROOT_PATH, "LOGS")

DWORD_SEP = "|"

COLLECT_INTERVAL_SECONDS = float(os.environ.get("COLLECT_INTERVAL_SECONDS", "1"))
CONFIG_REFRESH_SECONDS = int(os.environ.get("CONFIG_REFRESH_SECONDS", "600"))
DATA_FLUSH_SECONDS = int(os.environ.get("DATA_FLUSH_SECONDS", "600"))

last_values = {}
cached_unit = None
cached_map = None
cached_max_addr = 40001
_config_fingerprint = None
pending_db_rows = []


def _pg_conninfo():
    return (
        f"host={os.environ.get('PGHOST', '127.0.0.1')} "
        f"port={os.environ.get('PGPORT', '5432')} "
        f"dbname={os.environ.get('PGDATABASE', 'agent_flow_collect')} "
        f"user={os.environ.get('PGUSER', 'deiludenseu')} "
        f"password={os.environ.get('PGPASSWORD', '')}"
    )


def _data_conninfo():
    return os.environ.get(
        "DB_CONFIG",
        "host=localhost dbname=factory_db user=postgres password=postgres port=5432",
    )


def get_bit(value, bit_index):
    return (value >> bit_index) & 1


def parse_dword_addrs(addr_str):
    s = (addr_str or "").strip()
    if DWORD_SEP in s:
        a, b = s.split(DWORD_SEP, 1)
        return int(a.strip()), int(b.strip())
    a = int(s)
    return a, a + 1


def _normalize_dtype(ui_dt):
    s = (ui_dt or "DWord").strip()
    if s == "Boolean":
        return "bit"
    if s == "Word":
        return "word"
    return "dword"


def _addr_max_for_entry(addr_key, dtype):
    """MAP 항목에서 필요한 최대 Holding 레지스터 주소(4xxxx 정수)."""
    if "." in addr_key:
        base = int(addr_key.split(".", 1)[0])
        return base
    if dtype == "dword":
        hi, lo = parse_dword_addrs(addr_key)
        return max(hi, lo)
    return int(addr_key)


def build_map_from_tags(rows):
    """
    collection_unit_tags 행 목록 -> plc MAP_CONFIG 형식 dict
    키: 주소 문자열(40010.1, 40070, 40070|40071 등)
    값: (tag_id, 표시명, 내부타입 bit|word|dword, scale, is_realtime)
    """
    m = {}
    for r in rows:
        tag_id = (r.get("tag_id") or "").strip()
        address = (r.get("address") or "").strip()
        if not tag_id or not address:
            continue
        ratio_s = (r.get("ratio") or "1").strip() or "1"
        try:
            scale = float(ratio_s)
        except ValueError:
            scale = 1.0
        dt = _normalize_dtype(r.get("data_type"))
        tag_name = tag_id
        is_realtime = False
        m[address] = (tag_id, tag_name, dt, scale, is_realtime)
    return m


def compute_max_register_addr(map_config):
    if not map_config:
        return 40081
    mx = 40001
    for addr_key, cfg in map_config.items():
        dt = cfg[2]
        try:
            mx = max(mx, _addr_max_for_entry(addr_key, dt))
        except (ValueError, TypeError):
            continue
    return mx


def load_unit_and_map_from_db():
    """collection_units + tags 로드. 실패 시 (None, None)."""
    unit_id = os.environ.get("COLLECTOR_UNIT_ID", "").strip()
    process_code = os.environ.get("COLLECTOR_PROCESS_CODE", "").strip()
    process_name = os.environ.get("COLLECTOR_PROCESS_NAME", DEFAULT_PROCESS_NAME).strip()

    conn = None
    try:
        conn = psycopg2.connect(_pg_conninfo())
        cur = conn.cursor()
        row = None
        if unit_id.isdigit():
            cur.execute(
                "SELECT id, process_name, device_ip, device_port, in_use FROM collection_units WHERE id = %s",
                (int(unit_id),),
            )
            row = cur.fetchone()
        if not row and process_code:
            cur.execute(
                "SELECT id, process_name, device_ip, device_port, in_use FROM collection_units WHERE process_code = %s",
                (process_code,),
            )
            row = cur.fetchone()
        if not row and process_name:
            cur.execute(
                "SELECT id, process_name, device_ip, device_port, in_use FROM collection_units WHERE process_name = %s ORDER BY id LIMIT 1",
                (process_name,),
            )
            row = cur.fetchone()
        if not row:
            logging.warning("수집부 CMS에서 공정을 찾을 수 없습니다. UNIT_ID / PROCESS_CODE / PROCESS_NAME 을 확인하세요.")
            cur.close()
            conn.close()
            return None, None

        uid, pname, dip, dport, in_use = row
        cur.execute(
            """SELECT tag_id, data_type, address, ratio FROM collection_unit_tags
               WHERE collection_unit_id = %s ORDER BY sort_order ASC, id ASC""",
            (uid,),
        )
        tag_rows = [
            {"tag_id": t[0], "data_type": t[1], "address": t[2], "ratio": t[3]} for t in cur.fetchall()
        ]
        cur.close()
        conn.close()

        unit = {
            "id": uid,
            "process_name": pname or DEFAULT_PROCESS_NAME,
            "device_ip": (dip or "").strip(),
            "device_port": str(dport or "502").strip(),
            "in_use": in_use is not False,
        }
        mmap = build_map_from_tags(tag_rows)
        return unit, mmap
    except Exception as e:
        logging.error("수집부 DB 설정 로드 실패: %s", e)
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return None, None


def setup_logger(process_name):
    today = datetime.now().strftime("%Y%m%d")
    log_filename = f"{process_name}_sys_{today}.log"
    log_path = os.path.join(LOGS_DIR, log_filename)

    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler()],
    )


def save_to_csv(process_name, data_list):
    if not data_list:
        return
    today = datetime.now().strftime("%Y%m%d")
    csv_filename = f"{process_name}_data_{today}.csv"
    csv_path = os.path.join(STORAGE_DIR, csv_filename)

    file_exists = os.path.isfile(csv_path)
    try:
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["time", "tag_id", "tag_name", "value"])
            for row in data_list:
                writer.writerow([row[0].isoformat(), row[1], row[2], row[3]])
    except Exception as e:
        logging.error("CSV 저장 에러: %s", e)


def read_holding_map_full(client, max_reg_addr):
    """40001 ~ max_reg_addr Holding 레지스터를 125워드 단위로 읽어 맵으로 반환."""
    reg_map = {}
    pos = 40001
    while pos <= max_reg_addr:
        idx = pos - 40001
        chunk = min(125, max_reg_addr - pos + 1)
        res = client.read_holding_registers(address=idx, count=chunk)
        if res.isError():
            return None
        for i in range(chunk):
            reg_map[pos + i] = res.registers[i]
        pos += chunk
    return reg_map


def flush_data_db():
    """버퍼에 쌓인 측정 행을 저장 DB에 한 번에 반영. 실패 시 버퍼를 되돌려 두지 않고 로그만 남김(운영에서 재시도는 다음 주기)."""
    global pending_db_rows
    if not pending_db_rows:
        return
    batch = pending_db_rows
    pending_db_rows = []
    conn = None
    try:
        conn = psycopg2.connect(_data_conninfo())
        cur = conn.cursor()
        table = os.environ.get("DB_TABLE", DEFAULT_DB_TABLE)
        q = f"INSERT INTO {table} (time, tag_id, tag_name, value) VALUES %s"
        execute_values(cur, q, batch)
        conn.commit()
        logging.info("측정 DB 일괄 저장: %s건", len(batch))
    except Exception as db_err:
        logging.error("DB 일괄 저장 오류: %s — %s건을 버퍼 끝에 다시 쌓습니다.", db_err, len(batch))
        pending_db_rows = batch + pending_db_rows
    finally:
        if conn:
            conn.close()


def collect_and_save(unit, map_config, max_reg_addr):
    global last_values, pending_db_rows
    if not unit or not map_config:
        return
    if not unit.get("in_use", True):
        logging.info("수집부가 미사용(in_use=false)으로 설정되어 수집을 건너뜁니다.")
        return

    plc_ip = unit["device_ip"]
    try:
        plc_port = int(unit.get("device_port") or "502")
    except ValueError:
        plc_port = 502

    client = ModbusTcpClient(plc_ip, port=plc_port, timeout=3)

    try:
        if client.connect():
            reg_map = read_holding_map_full(client, max_reg_addr)
            if reg_map is None:
                logging.error("PLC 읽기 에러")
                return
            current_time = datetime.now()
            insert_data = []

            for addr_key, config in map_config.items():
                tag_code, tag_name, data_type, scale, is_realtime = config
                val = 0.0
                try:
                    if data_type == "bit":
                        if "." not in addr_key:
                            continue
                        addr_s, bit_s = addr_key.split(".", 1)
                        addr = int(addr_s)
                        bit = int(bit_s)
                        val = float(get_bit(reg_map.get(addr, 0), bit))
                    elif data_type == "dword":
                        hi, lo = parse_dword_addrs(addr_key)
                        val = float((reg_map.get(hi, 0) << 16) | reg_map.get(lo, 0)) * scale
                    else:
                        addr = int(addr_key)
                        val = float(reg_map.get(addr, 0)) * scale
                except Exception:
                    continue

                if is_realtime or (tag_code not in last_values or last_values[tag_code] != val):
                    insert_data.append((current_time, tag_code, tag_name, val))
                    last_values[tag_code] = val

            if insert_data:
                save_to_csv(unit["process_name"], insert_data)
                if DATA_FLUSH_SECONDS <= 0:
                    pending_db_rows.extend(insert_data)
                    flush_data_db()
                else:
                    pending_db_rows.extend(insert_data)
        else:
            logging.warning("PLC 연결 실패: %s", plc_ip)
    except Exception as e:
        logging.error("예기치 않은 에러: %s", e)
    finally:
        client.close()


def refresh_config():
    global cached_unit, cached_map, cached_max_addr, _config_fingerprint
    unit, mmap = load_unit_and_map_from_db()
    cached_unit = unit
    cached_map = mmap
    cached_max_addr = compute_max_register_addr(mmap) if mmap else 40081
    sig = (
        unit.get("id") if unit else None,
        (unit.get("device_ip") or "") if unit else "",
        str(unit.get("device_port") or "") if unit else "",
        unit.get("in_use") if unit else None,
        len(mmap) if mmap else 0,
        cached_max_addr,
        tuple(sorted(mmap.keys())) if mmap else (),
    )
    if sig != _config_fingerprint:
        _config_fingerprint = sig
        if unit and mmap:
            logging.info(
                "설정 갱신: %s | PLC %s:%s | 태그 %s개 | 레지스터 상한 주소 %s",
                unit["process_name"],
                unit["device_ip"],
                unit.get("device_port"),
                len(mmap),
                cached_max_addr,
            )
        elif unit and not mmap:
            logging.warning("태그가 없습니다. 수집부 CMS에서 태그를 등록하세요.")


def main():
    for d in (STORAGE_DIR, LOGS_DIR):
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    setup_logger(DEFAULT_PROCESS_NAME)
    refresh_config()
    pname = (cached_unit or {}).get("process_name") or DEFAULT_PROCESS_NAME
    setup_logger(pname)
    cfg_interval = "매 수집 주기" if CONFIG_REFRESH_SECONDS <= 0 else f"{CONFIG_REFRESH_SECONDS // 60}분"
    data_interval = "즉시" if DATA_FLUSH_SECONDS <= 0 else f"{DATA_FLUSH_SECONDS // 60}분"
    logging.info(
        "=== %s 수집 가동 (CMS 연동) | 수집 %.1fs | 설정 DB %s | 측정 DB %s ===",
        pname,
        COLLECT_INTERVAL_SECONDS,
        cfg_interval,
        data_interval,
    )

    last_checked_day = datetime.now().strftime("%Y%m%d")
    last_config_mono = time.monotonic()
    last_flush_mono = time.monotonic()

    try:
        while True:
            today = datetime.now().strftime("%Y%m%d")
            if today != last_checked_day:
                last_checked_day = today
                setup_logger((cached_unit or {}).get("process_name") or DEFAULT_PROCESS_NAME)

            now_mono = time.monotonic()
            if CONFIG_REFRESH_SECONDS <= 0 or (now_mono - last_config_mono) >= CONFIG_REFRESH_SECONDS:
                refresh_config()
                last_config_mono = now_mono

            collect_and_save(cached_unit, cached_map, cached_max_addr)

            now_mono = time.monotonic()
            if DATA_FLUSH_SECONDS > 0 and (now_mono - last_flush_mono) >= DATA_FLUSH_SECONDS:
                flush_data_db()
                last_flush_mono = now_mono

            time.sleep(COLLECT_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        flush_data_db()
        logging.info("종료")
        sys.exit(0)


if __name__ == "__main__":
    main()
