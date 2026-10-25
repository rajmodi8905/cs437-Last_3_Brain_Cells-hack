"""Optional independent native reference check, separate from application/test runtime.

Use Python with onnx==1.19.1, onnxruntime==1.30.0 and numpy installed.
The checked fixture and expected output were created with numpy RNG seed 437.
Node 24's TypeScript support runs the actual browser graph-lowering implementation.
"""
import json
import pathlib
import subprocess
import numpy as np
import onnx
import onnxruntime as ort

root = pathlib.Path(__file__).resolve().parents[1]
subprocess.run([
    'node', '--input-type=module', '-e',
    "import{readFile,writeFile}from'node:fs/promises';"
    "import{lowerQuantizedGather}from'./src/engine/onnx-q4.ts';"
    "await writeFile('.cache/q4-reference-lowered.onnx',"
    "lowerQuantizedGather(await readFile('tests/fixtures/q4-gather.onnx')));"
], cwd=root, check=True)
reference = json.loads((root/'tests/fixtures/q4-gather-expected.json').read_text())
indices = np.asarray(reference['indices'], dtype=np.int64)
original = ort.InferenceSession(str(root/'tests/fixtures/q4-gather.onnx'), providers=['CPUExecutionProvider'])
lowered_path = root/'.cache/q4-reference-lowered.onnx'
onnx.checker.check_model(onnx.load(lowered_path))
lowered = ort.InferenceSession(str(lowered_path), providers=['CPUExecutionProvider'])
a = original.run(None, {'indices': indices})[0]
b = lowered.run(None, {'indices': indices})[0]
np.testing.assert_allclose(a.reshape(-1), reference['values'], atol=1e-6, rtol=1e-6)
np.testing.assert_allclose(a, b, atol=1e-6, rtol=1e-6)
print('Native vs lowered maximum absolute error:', float(np.max(np.abs(a-b))))
