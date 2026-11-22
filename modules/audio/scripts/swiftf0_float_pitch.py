import sys, onnx
from onnx import helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
for o in g.output:
    print(o.name, o.type.tensor_type.elem_type)
out = [o for o in g.output if o.name == "pitch"][0]
assert out.type.tensor_type.elem_type == TensorProto.DOUBLE
# Rename the producer's output and cast it to float32 under the original name.
for n in g.node:
    for i, name in enumerate(n.output):
        if name == "pitch":
            n.output[i] = "pitch_f64"
    for i, name in enumerate(n.input):
        if name == "pitch":
            n.input[i] = "pitch_f64"
g.node.append(helper.make_node("Cast", ["pitch_f64"], ["pitch"], to=TensorProto.FLOAT, name="pitch_to_float"))
out.type.tensor_type.elem_type = TensorProto.FLOAT
m.producer_name = (m.producer_name or "") + "+arrangerbox-float-pitch"
onnx.checker.check_model(m)
onnx.save(m, dst)
print("ok")
