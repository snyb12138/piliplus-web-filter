(function initPiliPlusPurifyPageCore(root, factory) {
  const api = factory();
  if (typeof process === 'object' && process?.versions?.node && typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.defineProperty(root, 'PiliPlusPurifyPageCore', {
      value: api,
      configurable: true,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildPageCore() {
  'use strict';

  const MAX_BYTES = 8 * 1024 * 1024;

  function readVarint(bytes, position) {
    let result = 0;
    let factor = 1;
    for (let index = 0; index < 10; index += 1) {
      if (position >= bytes.length) throw new Error('protobuf varint 被截断');
      const byte = bytes[position];
      position += 1;
      result += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) return [result, position];
      factor *= 128;
    }
    throw new Error('protobuf varint 过长');
  }

  function readFields(bytes) {
    const fields = [];
    let position = 0;
    while (position < bytes.length) {
      const start = position;
      let tag;
      [tag, position] = readVarint(bytes, position);
      const wire = tag & 7;
      const field = tag >>> 3;
      if (field === 0) throw new Error('protobuf 字段号非法');
      let value;
      let valueStart;
      if (wire === 0) {
        [value, position] = readVarint(bytes, position);
      } else if (wire === 2) {
        let length;
        [length, position] = readVarint(bytes, position);
        if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - position) {
          throw new Error('protobuf 字段长度越界');
        }
        valueStart = position;
        position += length;
      } else if (wire === 1) {
        position += 8;
      } else if (wire === 5) {
        position += 4;
      } else {
        throw new Error(`不支持的 protobuf wire 类型 ${wire}`);
      }
      if (position > bytes.length) throw new Error('protobuf 字段被截断');
      fields.push({ field, wire, start, end: position, value, valueStart });
    }
    return fields;
  }

  function decodeElem(inner, decoder) {
    const elem = { progress: 0, mode: 1, midHash: '', text: '' };
    for (const field of readFields(inner)) {
      if (field.wire === 0) {
        if (field.field === 2) elem.progress = field.value;
        else if (field.field === 3) elem.mode = field.value;
      } else if (field.wire === 2 && (field.field === 6 || field.field === 7)) {
        const text = decoder.decode(inner.subarray(field.valueStart, field.end));
        if (field.field === 6) elem.midHash = text;
        else elem.text = text;
      }
    }
    return elem;
  }

  function filterSegment(buffer, matcher) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength > MAX_BYTES) throw new Error('弹幕分段超过 8 MiB 限制');
    const decoder = new TextDecoder('utf-8');
    const kept = [];
    const hits = [];
    const observed = [];
    let total = 0;
    for (const span of readFields(bytes)) {
      if (span.field === 1 && span.wire === 2) {
        total += 1;
        const elem = decodeElem(bytes.subarray(span.valueStart, span.end), decoder);
        if (elem.text) {
          observed.push({ content: elem.text, progress: elem.progress, midHash: elem.midHash });
        }
        const match = elem.text ? matcher(elem.text, elem.midHash, elem) : null;
        if (match) {
          hits.push({ content: elem.text, progress: elem.progress, mode: elem.mode, reason: match.reason, kind: match.kind });
          continue;
        }
      }
      kept.push(bytes.subarray(span.start, span.end));
    }
    if (hits.length === 0) return { bytes, total, dropped: 0, hits, observed };
    const size = kept.reduce((sum, part) => sum + part.byteLength, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of kept) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return { bytes: output, total, dropped: hits.length, hits, observed };
  }

  function parseMid(value) {
    if (typeof value === 'string' && /^\d+$/u.test(value.trim())) value = Number(value.trim());
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function uploaderFromItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const candidates = [
      item.owner,
      item.upper,
      item.author && typeof item.author === 'object' ? item.author : null,
      item.modules?.module_author,
      item.card?.owner,
      item.archive?.owner,
    ];
    for (const candidate of candidates) {
      const mid = parseMid(candidate?.mid ?? candidate?.uid);
      if (mid !== null) {
        const name = String(candidate?.name ?? candidate?.uname ?? candidate?.author ?? '').trim();
        return { mid, name };
      }
    }
    const looksLikeContent = item.bvid || item.aid || item.arcurl || item.goto || item.title ||
      /(?:video|dynamic|archive|av)/iu.test(String(item.type || item.type_name || ''));
    if (!looksLikeContent) return null;
    const mid = parseMid(item.mid ?? item.uid);
    if (mid === null) return null;
    const name = String(item.author ?? item.uname ?? item.name ?? '').trim();
    return { mid, name };
  }

  function dynamicText(item) {
    const moduleDynamic = item?.modules?.module_dynamic;
    return [
      moduleDynamic?.desc?.text,
      moduleDynamic?.major?.opus?.summary?.text,
      item?.title,
      item?.desc,
      item?.description,
    ].filter((value) => typeof value === 'string').join('\n');
  }

  function adReasonFromItem(item, options = {}) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || options.filterAds !== true) return null;
    if (options.kind === 'homepage') {
      if (item.goto === 'ad' || item.card_goto === 'ad' || item.is_ad === true || item.is_ad === 1 ||
          item.ad_info || item.adInfo || item.business_info || item.cm_mark) {
        return '首页广告标记';
      }
    }
    if (options.kind === 'dynamic') {
      const moduleDynamic = item.modules?.module_dynamic;
      if (!moduleDynamic && !String(item.type || '').startsWith('DYNAMIC_TYPE_')) return null;
      if (moduleDynamic?.additional?.type === 'ADDITIONAL_TYPE_GOODS') return '商品推广';
      const text = dynamicText(item);
      const keyword = (options.keywords || []).find((rule) => typeof rule === 'string' && rule && text.includes(rule));
      if (keyword) return `推广关键词：${keyword}`;
    }
    return null;
  }

  function filterContentJson(input, blockedMids, options = {}) {
    const blocked = new Set((blockedMids || []).map(parseMid).filter((mid) => mid !== null));
    const uploaderHits = [];
    const adHits = [];
    let uploaderDropped = 0;
    let adsDropped = 0;
    const visit = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 18) return;
      if (Array.isArray(value)) {
        let write = 0;
        for (let index = 0; index < value.length; index += 1) {
          const item = value[index];
          const uploader = uploaderFromItem(item);
          if (uploader && blocked.has(uploader.mid)) {
            uploaderDropped += 1;
            if (uploaderHits.length < 50) uploaderHits.push(uploader);
            continue;
          }
          const adReason = adReasonFromItem(item, options);
          if (adReason) {
            adsDropped += 1;
            if (adHits.length < 50) adHits.push({ reason: adReason, title: String(item?.title || '').trim() });
            continue;
          }
          value[write] = item;
          write += 1;
          visit(item, depth + 1);
        }
        value.length = write;
        return;
      }
      for (const child of Object.values(value)) visit(child, depth + 1);
    };
    visit(input, 0);
    return { data: input, uploaderDropped, adsDropped, uploaderHits, adHits };
  }

  function filterUploaderJson(input, blockedMids) {
    const result = filterContentJson(input, blockedMids);
    return { data: result.data, dropped: result.uploaderDropped, hits: result.uploaderHits };
  }

  return Object.freeze({ MAX_BYTES, readVarint, readFields, decodeElem, filterSegment, uploaderFromItem, adReasonFromItem, filterContentJson, filterUploaderJson });
});
