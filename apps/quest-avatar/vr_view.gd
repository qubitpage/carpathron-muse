extends MeshInstance3D
## Carpathron Avatar 1.3 — VR view: the robot's camera picture on a curved screen that wraps around you
## (a piece of a sphere centred on your eyes), soft dark edges, nothing else around. Feels like sitting
## inside the robot instead of watching a flat TV. The flat "cinema" screen is still in the menu.

const R := 2.0          # metres from your eyes
const SIZES := {"normal": 84.0, "large": 104.0}   # horizontal degrees; the camera is 4:3

var mat: ShaderMaterial
var size_name := "normal"

const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;
uniform sampler2D tex : source_color, filter_linear_mipmap;
uniform vec4 tint : source_color = vec4(1.0);
uniform float has_tex = 0.0;
uniform sampler2D overlay : source_color, filter_linear;
uniform float has_overlay = 0.0;
void fragment() {
	vec2 uv = UV;
	vec3 c = mix(vec3(0.04, 0.05, 0.07), texture(tex, uv).rgb, has_tex);
	// soft dark edges so the picture melts into the dark instead of ending in a hard frame
	float ex = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
	float ey = smoothstep(0.0, 0.07, uv.y) * smoothstep(1.0, 0.93, uv.y);
	vec4 ov = texture(overlay, uv) * has_overlay;
	c = mix(c, ov.rgb, ov.a);
	ALBEDO = c * tint.rgb * ex * ey;
}
"""

func _ready() -> void:
	mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SHADER
	mat.shader = sh
	material_override = mat
	layers = 2
	set_size(size_name)

func set_size(n: String) -> void:
	size_name = n if SIZES.has(n) else "normal"
	mesh = _build(deg_to_rad(SIZES[size_name]), deg_to_rad(SIZES[size_name] * 0.75))

## a sphere piece in front of you (-Z), the picture mapped so its centre is straight ahead
static func _build(hspan: float, vspan: float) -> ArrayMesh:
	var nx := 48
	var ny := 36
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in ny + 1:
		var v := float(j) / ny
		var pitch := (0.5 - v) * vspan
		for i in nx + 1:
			var u := float(i) / nx
			var yaw := (u - 0.5) * hspan
			verts.append(Vector3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * R)
			uvs.append(Vector2(u, v))
	for j in ny:
		for i in nx:
			var a := j * (nx + 1) + i
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			idx.append_array([a, b, c, b, d, c])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

func set_overlay(t: Texture2D) -> void:
	mat.set_shader_parameter("overlay", t)
	mat.set_shader_parameter("has_overlay", 1.0 if t != null else 0.0)

## where a picture point (u, v in 0..1) is, a little in front of the curved screen (for labels)
func point(u: float, v: float) -> Vector3:
	var hs := deg_to_rad(SIZES[size_name])
	var vs := hs * 0.75
	var yaw := (u - 0.5) * hs
	var pitch := (0.5 - v) * vs
	return Vector3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * (R - 0.15)

func sync(t: Texture2D, tint: Color) -> void:
	mat.set_shader_parameter("tex", t)
	mat.set_shader_parameter("has_tex", 1.0 if t != null else 0.0)
	mat.set_shader_parameter("tint", tint)
