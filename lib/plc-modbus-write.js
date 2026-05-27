/**
 * Modbus TCP Holding Register Write (plc_collector.py 주소 규칙과 동일)
 * - 40001 기준 주소 → 레지스터 인덱스 = 주소 - 40001
 * - Boolean: 40010.1 형식 (read-modify-write)
 * - DWord: 40070|40071 또는 단일 주소 + 다음 워드
 */
const ModbusRTU = require("modbus-serial");

const DWORD_SEP = "|";
const MODBUS_UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10) || 1;
const MODBUS_WRITE_TIMEOUT_MS = Number.parseInt(process.env.MODBUS_WRITE_TIMEOUT_MS || "3000", 10) || 3000;

function normalizeDtype(uiDt) {
  const s = String(uiDt ?? "DWord").trim();
  if (s === "Boolean") return "bit";
  if (s === "Word") return "word";
  return "dword";
}

function parseDwordAddrs(addrStr) {
  const s = String(addrStr ?? "").trim();
  if (s.includes(DWORD_SEP)) {
    const parts = s.split(DWORD_SEP);
    return [parseInt(parts[0].trim(), 10), parseInt(parts[1].trim(), 10)];
  }
  const a = parseInt(s, 10);
  return [a, a + 1];
}

function parseUseValue(raw) {
  const s = String(raw ?? "").trim();
  if (!s) {
    const err = new Error("사용값(plc_use_value)이 비어 있습니다.");
    err.status = 400;
    throw err;
  }
  const lower = s.toLowerCase();
  if (lower === "on" || lower === "true") return { kind: "bool", value: 1 };
  if (lower === "off" || lower === "false") return { kind: "bool", value: 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) {
    const err = new Error(`사용값을 숫자로 해석할 수 없습니다: ${s}`);
    err.status = 400;
    throw err;
  }
  return { kind: "number", value: n };
}

/** 수집 시 value = register * scale → 쓰기 시 register = value / scale */
function rawRegisterFromUseValue(useParsed, dataType, ratio) {
  const scale = Number.parseFloat(String(ratio ?? "1").trim() || "1") || 1;
  if (dataType === "bit") {
    const on =
      useParsed.kind === "bool" ? useParsed.value === 1 : Math.abs(useParsed.value) >= 0.5;
    return { bitOn: on };
  }
  const n = useParsed.kind === "bool" ? useParsed.value : useParsed.value;
  const raw = scale === 0 ? n : n / scale;
  if (dataType === "word") {
    const w = Math.round(raw) & 0xffff;
    return { word: w };
  }
  let dword = Math.round(raw);
  if (dword < 0) dword = (dword >>> 0) & 0xffffffff;
  else dword = dword >>> 0;
  return {
    hi: (dword >>> 16) & 0xffff,
    lo: dword & 0xffff,
  };
}

function selectWriteTargets(tags, controlTagId) {
  const valid = (tags || [])
    .map((t) => ({
      tag_id: String(t.tag_id ?? t.tagId ?? "").trim(),
      dataType: t.dataType ?? t.data_type ?? "DWord",
      address: String(t.address ?? "").trim(),
      ratio: String(t.ratio ?? "1").trim() || "1",
    }))
    .filter((t) => t.tag_id && t.address);

  const ctrl = String(controlTagId ?? "").trim();
  if (ctrl) {
    const matched = valid.filter((t) => t.tag_id === ctrl);
    if (matched.length) return matched;
  }
  return valid;
}

async function writeOneTag(client, tag, useParsed) {
  const dataType = normalizeDtype(tag.dataType);
  const encoded = rawRegisterFromUseValue(useParsed, dataType, tag.ratio);
  const address = tag.address;

  if (dataType === "bit") {
    if (!address.includes(".")) {
      throw new Error(`Boolean 태그는 주소에 비트 인덱스가 필요합니다 (예: 40010.1): ${address}`);
    }
    const [addrS, bitS] = address.split(".", 2);
    const regAddr = parseInt(addrS, 10);
    const bit = parseInt(bitS, 10);
    if (!Number.isFinite(regAddr) || !Number.isFinite(bit)) {
      throw new Error(`잘못된 Boolean 주소: ${address}`);
    }
    const idx = regAddr - 40001;
    const readRes = await client.readHoldingRegisters(idx, 1);
    let word = readRes.data[0] ?? 0;
    if (encoded.bitOn) word |= 1 << bit;
    else word &= ~(1 << bit);
    word &= 0xffff;
    await client.writeRegister(idx, word);
    return { address, register_index: idx, written: word, bit, bit_on: encoded.bitOn };
  }

  if (dataType === "dword") {
    const [hi, lo] = parseDwordAddrs(address);
    const idxHi = hi - 40001;
    const idxLo = lo - 40001;
    await client.writeRegister(idxHi, encoded.hi);
    await client.writeRegister(idxLo, encoded.lo);
    return {
      address,
      register_index_hi: idxHi,
      register_index_lo: idxLo,
      written_hi: encoded.hi,
      written_lo: encoded.lo,
    };
  }

  const regAddr = parseInt(address, 10);
  if (!Number.isFinite(regAddr)) {
    throw new Error(`잘못된 Word 주소: ${address}`);
  }
  const idx = regAddr - 40001;
  await client.writeRegister(idx, encoded.word);
  return { address, register_index: idx, written: encoded.word };
}

/**
 * @param {object} opts
 * @param {string} opts.plc_ip
 * @param {string|number} opts.plc_port
 * @param {string} opts.plc_use_value
 * @param {Array} opts.tags
 * @param {string} [opts.control_tag_id]
 */
async function executePlcModbusWrite(opts) {
  const plcIp = String(opts.plc_ip ?? "").trim();
  const plcPort = Number.parseInt(String(opts.plc_port ?? "502").trim(), 10) || 502;
  const useParsed = parseUseValue(opts.plc_use_value);
  const targets = selectWriteTargets(opts.tags, opts.control_tag_id);

  if (!plcIp) {
    const err = new Error("PLC IP가 필요합니다.");
    err.status = 400;
    throw err;
  }
  if (!targets.length) {
    const err = new Error("쓰기할 태그가 없습니다. tag_id와 주소를 확인하세요.");
    err.status = 400;
    throw err;
  }

  const client = new ModbusRTU();
  client.setTimeout(MODBUS_WRITE_TIMEOUT_MS);

  const results = [];
  let connected = false;

  try {
    await client.connectTCP(plcIp, { port: plcPort });
    connected = true;
    client.setID(MODBUS_UNIT_ID);

    for (const tag of targets) {
      try {
        const detail = await writeOneTag(client, tag, useParsed);
        results.push({
          tag_id: tag.tag_id,
          data_type: tag.dataType,
          ok: true,
          ...detail,
        });
      } catch (e) {
        results.push({
          tag_id: tag.tag_id,
          data_type: tag.dataType,
          ok: false,
          error: e.message || String(e),
        });
      }
    }
  } finally {
    if (connected) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const allOk = okCount === results.length;

  return {
    ok: allOk,
    plc_ip: plcIp,
    plc_port: plcPort,
    plc_use_value: String(opts.plc_use_value ?? "").trim(),
    unit_id: MODBUS_UNIT_ID,
    written_count: okCount,
    total_count: results.length,
    results,
    message: allOk
      ? `PLC Modbus Write 완료 (${okCount}개 태그)`
      : `PLC Modbus Write 부분 실패 (성공 ${okCount}/${results.length})`,
  };
}

module.exports = {
  executePlcModbusWrite,
  normalizeDtype,
  parseUseValue,
};
