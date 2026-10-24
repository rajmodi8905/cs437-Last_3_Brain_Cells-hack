/**
 * Lower the pinned model's UINT8-packed, block-32 4-bit Gather to standard ONNX
 * operators. Only selected rows are dequantized; weights and precision stay q4.
 * ORT Web's WASM build lacks GatherBlockQuantized. WebGPU uses the original graph.
 * Wire fields not changed here are copied byte-for-byte, including external data.
 */
interface Field {
  number: number;
  wire: number;
  value: Uint8Array | bigint;
  raw: Uint8Array;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function varint(value: bigint): Uint8Array {
  let n = BigInt.asUintN(64, value);
  const bytes = [];
  do {
    let byte = Number(n & 127n);
    n >>= 7n;
    if (n) byte |= 128;
    bytes.push(byte);
  } while (n);
  return Uint8Array.from(bytes);
}
function join(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
function field(number: number, value: Uint8Array | bigint): Uint8Array {
  return typeof value === 'bigint'
    ? join(varint(BigInt(number * 8)), varint(value))
    : join(varint(BigInt(number * 8 + 2)), varint(BigInt(value.length)), value);
}
function fields(bytes: Uint8Array): Field[] {
  let offset = 0;
  const result: Field[] = [];
  const read = () => {
    let value = 0n;
    let shift = 0n;
    for (let count = 0; count < 10; count++) {
      if (offset >= bytes.length) throw Error('Truncated ONNX graph.');
      const b = bytes[offset++];
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) return value;
      shift += 7n;
    }
    throw Error('Invalid ONNX varint.');
  };
  while (offset < bytes.length) {
    const start = offset;
    const tag = Number(read());
    const wire = tag & 7;
    const number = tag >> 3;
    let value: Uint8Array | bigint;
    if (wire === 0) value = read();
    else if (wire === 2) {
      const length = Number(read());
      if (length < 0 || offset + length > bytes.length) throw Error('Invalid ONNX field length.');
      value = bytes.slice(offset, offset + length);
      offset += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      value = bytes.slice(offset, offset + length);
      offset += length;
    } else throw Error('Unsupported ONNX wire type.');
    result.push({ number, wire, value, raw: bytes.slice(start, offset) });
  }
  return result;
}
const strings = (data: Field[], number: number) =>
  data.filter((f) => f.number === number).map((f) => decoder.decode(f.value as Uint8Array));
const integer = (data: Field[], number: number) =>
  Number(data.find((f) => f.number === number)?.value ?? 0n);
function attr(name: string, value: number) {
  return join(field(1, encoder.encode(name)), field(3, BigInt(value)), field(20, 2n));
}
function node(
  name: string,
  op: string,
  inputs: string[],
  output: string,
  attrs: Record<string, number> = {},
) {
  return join(
    ...inputs.map((x) => field(1, encoder.encode(x))),
    field(2, encoder.encode(output)),
    field(3, encoder.encode(name)),
    field(4, encoder.encode(op)),
    ...Object.entries(attrs).map(([key, value]) => field(5, attr(key, value))),
  );
}
function tensor(name: string, values: number[], float = false, scalar = false) {
  const raw = new Uint8Array(values.length * (float ? 4 : 8));
  const view = new DataView(raw.buffer);
  values.forEach((value, i) =>
    float ? view.setFloat32(i * 4, value, true) : view.setBigInt64(i * 8, BigInt(value), true),
  );
  return join(
    ...(scalar ? [] : [field(1, BigInt(values.length))]),
    field(2, BigInt(float ? 1 : 7)),
    field(8, encoder.encode(name)),
    field(9, raw),
  );
}
export function lowerQuantizedGather(model: Uint8Array): Uint8Array {
  const root = fields(model);
  const graphField = root.find((f) => f.number === 7);
  if (!graphField) throw Error('ONNX graph is missing.');
  const graph = fields(graphField.value as Uint8Array);
  const initializers = new Map<string, Field[]>();
  for (const f of graph.filter((f) => f.number === 5)) {
    const value = fields(f.value as Uint8Array);
    initializers.set(strings(value, 8)[0], value);
  }
  const constants: Uint8Array[] = [];
  const replacement: Uint8Array[] = [];
  let changed = 0;
  for (const f of graph) {
    if (f.number !== 1) {
      replacement.push(f.raw);
      continue;
    }
    const data = fields(f.value as Uint8Array);
    if (strings(data, 4)[0] !== 'GatherBlockQuantized') {
      replacement.push(f.raw);
      continue;
    }
    const attrs: Record<string, number> = {};
    for (const a of data.filter((x) => x.number === 5)) {
      const af = fields(a.value as Uint8Array);
      attrs[strings(af, 1)[0]] = integer(af, 3);
    }
    if (
      attrs.bits !== 4 ||
      attrs.block_size !== 32 ||
      attrs.gather_axis !== 0 ||
      attrs.quantize_axis !== 1
    )
      throw Error('Unsupported quantized Gather configuration.');
    const [weights, indices, scales, zp] = strings(data, 1);
    const output = strings(data, 2)[0];
    const metadata = initializers.get(weights);
    if (!metadata || !zp || integer(metadata, 2) !== 2)
      throw Error('Unexpected quantized Gather weights.');
    const dims = metadata
      .filter((x) => x.number === 1)
      .flatMap((x) => (x.wire === 0 ? [Number(x.value)] : []));
    if (dims.length !== 2 || dims[1] % 16 !== 0) throw Error('Unexpected embedding table shape.');
    const hidden = dims[1] * 2,
      blocks = hidden / 32;
    const prefix = `campus_wasm_q4_${changed++}_`;
    const constant = (key: string, values: number[], float = false, scalar = false) => {
      const name = prefix + key;
      constants.push(field(5, tensor(name, values, float, scalar)));
      return name;
    };
    const axes = constant('axes', [-1]);
    const flatShape = constant('flat_shape', [-1]);
    const qShape = constant('q_shape', [-1, blocks, 32]);
    const zShape = constant('z_shape', [-1, blocks, 1]);
    const width = constant('width', [hidden]);
    const sixteen = constant('sixteen', [16], true, true);
    const op = (
      key: string,
      kind: string,
      inputs: string[],
      attrs: Record<string, number> = {},
      result = prefix + key,
    ) => {
      replacement.push(field(1, node(prefix + key, kind, inputs, result, attrs)));
      return result;
    };
    const flat = op('indices', 'Reshape', [indices, flatShape]);
    const unpack = (key: string, input: string, shape: string) => {
      const packed = op(key + '_gather', 'Gather', [input, flat], { axis: 0 });
      const float = op(key + '_cast', 'Cast', [packed], { to: 1 });
      const low = op(key + '_low', 'Mod', [float, sixteen], { fmod: 1 });
      const div = op(key + '_div', 'Div', [float, sixteen]);
      const high = op(key + '_high', 'Floor', [div]);
      const lowColumn = op(key + '_lo_col', 'Unsqueeze', [low, axes]);
      const highColumn = op(key + '_hi_col', 'Unsqueeze', [high, axes]);
      return op(key + '_reshape', 'Reshape', [
        op(key + '_concat', 'Concat', [lowColumn, highColumn], { axis: -1 }),
        shape,
      ]);
    };
    const quant = unpack('quant', weights, qShape);
    const zeros = unpack('zp', zp, zShape);
    const selectedScales = op('scales', 'Gather', [scales, flat], { axis: 0 });
    const expandedScales = op('scales_col', 'Unsqueeze', [selectedScales, axes]);
    const dequant = op('dequant', 'Mul', [op('center', 'Sub', [quant, zeros]), expandedScales]);
    const indexShape = op('index_shape', 'Shape', [indices]);
    const outputShape = op('output_shape', 'Concat', [indexShape, width], { axis: 0 });
    op('output', 'Reshape', [dequant, outputShape], {}, output);
  }
  if (!changed) return model;
  const rewrittenGraph = join(...replacement, ...constants);
  return join(...root.map((f) => (f === graphField ? field(7, rewrittenGraph) : f.raw)));
}
