// Minimal dependency-free XLSX writer.
// Produces a valid .xlsx (an uncompressed ZIP of XML parts) from an array of
// arrays (rows of cell values). No external libraries, works fully offline.

(function (global) {
  // --- CRC32 (needed for ZIP entries) ---
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function dosDateTime(date) {
    const time =
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getSeconds() >> 1) & 0x1f);
    const day =
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0xf) << 5) |
      (date.getDate() & 0x1f);
    return { time, day };
  }

  // --- Tiny ZIP (stored, no compression) builder ---
  function buildZip(files) {
    // files: [{ name, data: Uint8Array }]
    const now = new Date();
    const { time, day } = dosDateTime(now);
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = strToBytes(file.name);
      const data = file.data;
      const crc = crc32(data);

      const localHeader = new DataView(new ArrayBuffer(30));
      localHeader.setUint32(0, 0x04034b50, true);
      localHeader.setUint16(4, 20, true);
      localHeader.setUint16(6, 0, true);
      localHeader.setUint16(8, 0, true); // no compression
      localHeader.setUint16(10, time, true);
      localHeader.setUint16(12, day, true);
      localHeader.setUint32(14, crc, true);
      localHeader.setUint32(18, data.length, true);
      localHeader.setUint32(22, data.length, true);
      localHeader.setUint16(26, nameBytes.length, true);
      localHeader.setUint16(28, 0, true);

      const localEntry = new Uint8Array(30 + nameBytes.length + data.length);
      localEntry.set(new Uint8Array(localHeader.buffer), 0);
      localEntry.set(nameBytes, 30);
      localEntry.set(data, 30 + nameBytes.length);
      localParts.push(localEntry);

      const centralHeader = new DataView(new ArrayBuffer(46));
      centralHeader.setUint32(0, 0x02014b50, true);
      centralHeader.setUint16(4, 20, true);
      centralHeader.setUint16(6, 20, true);
      centralHeader.setUint16(8, 0, true);
      centralHeader.setUint16(10, 0, true);
      centralHeader.setUint16(12, time, true);
      centralHeader.setUint16(14, day, true);
      centralHeader.setUint32(16, crc, true);
      centralHeader.setUint32(20, data.length, true);
      centralHeader.setUint32(24, data.length, true);
      centralHeader.setUint16(28, nameBytes.length, true);
      centralHeader.setUint16(30, 0, true);
      centralHeader.setUint16(32, 0, true);
      centralHeader.setUint16(34, 0, true);
      centralHeader.setUint16(36, 0, true);
      centralHeader.setUint32(38, 0, true);
      centralHeader.setUint32(42, offset, true);

      const centralEntry = new Uint8Array(46 + nameBytes.length);
      centralEntry.set(new Uint8Array(centralHeader.buffer), 0);
      centralEntry.set(nameBytes, 46);
      centralParts.push(centralEntry);

      offset += localEntry.length;
    });

    const centralOffset = offset;
    let centralSize = 0;
    centralParts.forEach((p) => (centralSize += p.length));

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralOffset, true);
    eocd.setUint16(20, 0, true);

    const totalSize =
      offset + centralSize + 22;
    const out = new Uint8Array(totalSize);
    let pos = 0;
    localParts.forEach((p) => {
      out.set(p, pos);
      pos += p.length;
    });
    centralParts.forEach((p) => {
      out.set(p, pos);
      pos += p.length;
    });
    out.set(new Uint8Array(eocd.buffer), pos);

    return out;
  }

  function xmlEscape(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function colName(index) {
    // 0-based column index -> "A", "B", ... "AA", etc.
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function buildSheetXml(rows) {
    let rowsXml = "";
    rows.forEach((row, rIdx) => {
      const rowNum = rIdx + 1;
      let cellsXml = "";
      row.forEach((value, cIdx) => {
        const ref = `${colName(cIdx)}${rowNum}`;
        if (value === null || value === undefined || value === "") {
          return;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          cellsXml += `<c r="${ref}"><v>${value}</v></c>`;
        } else {
          cellsXml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            value
          )}</t></is></c>`;
        }
      });
      rowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowsXml}</sheetData>
</worksheet>`;
  }

  function buildWorkbookXml(sheetNames) {
    const sheetsXml = sheetNames
      .map(
        (name, i) =>
          `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${
            i + 1
          }"/>`
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetsXml}</sheets>
</workbook>`;
  }

  function buildWorkbookRelsXml(sheetCount) {
    let rels = "";
    for (let i = 0; i < sheetCount; i++) {
      rels += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        i + 1
      }.xml"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  }

  function buildContentTypesXml(sheetCount) {
    let overrides = "";
    for (let i = 0; i < sheetCount; i++) {
      overrides += `<Override PartName="/xl/worksheets/sheet${
        i + 1
      }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
</Types>`;
  }

  const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  /**
   * Build an .xlsx file from one or more sheets.
   * sheets: [{ name: "Sheet1", rows: [[...], [...]] }]
   * returns: Uint8Array of the .xlsx file bytes
   */
  function buildXlsx(sheets) {
    const files = [];
    files.push({
      name: "[Content_Types].xml",
      data: strToBytes(buildContentTypesXml(sheets.length)),
    });
    files.push({
      name: "_rels/.rels",
      data: strToBytes(ROOT_RELS_XML),
    });
    files.push({
      name: "xl/workbook.xml",
      data: strToBytes(buildWorkbookXml(sheets.map((s) => s.name))),
    });
    files.push({
      name: "xl/_rels/workbook.xml.rels",
      data: strToBytes(buildWorkbookRelsXml(sheets.length)),
    });
    sheets.forEach((sheet, i) => {
      files.push({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: strToBytes(buildSheetXml(sheet.rows)),
      });
    });

    return buildZip(files);
  }

  function downloadXlsx(sheets, filename) {
    const bytes = buildXlsx(sheets);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  global.MiniXlsx = { buildXlsx, downloadXlsx };
})(window);
